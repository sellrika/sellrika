# Stock / inventory

How the app counts what a shop has on hand, and how every change is written down.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/catalog.ts` |
| Controller | `app/controllers/Stock.Controller.ts` |
| Service (`adjust`) | `app/services/catalog/Stock.Service.ts` |
| Repository (`move`, `level`, `pageForShop`, `summary`, `lowCount`, `movements`) | `app/repositories/Stock.Repository.ts` |
| Validator (`StockAdjustInput`) | `app/validators/Stock.Validator.ts` |
| Constants (`ADJUST_REASONS`, `STOCK_FILTERS`, `LOW_STOCK_CACHE_MS`) | `app/constants/Stock.Constant.ts` |
| Models | `app/models/Stock.ts` |
| Page (list, Adjust dialog, movement history dialog) | `resources/js/Pages/Stock/Index.vue` |

Other code that moves stock:

- `OrderRepository`: a sale, a refund and a void.
- `ProductRepository.create` / `update`: the opening counts. The CSV import goes through them too.
- `ReportService`: reads the stock summary.

## The model

### Which products are counted

- `products.track_stock` turns inventory on **per product**. It covers the product's variants too.
- The count on hand is:
  - `products.stock`, when the product has no variants
  - `product_variants.stock` per variant, when it has variants
- `products.low_stock_at` is the alert threshold. Variants use the product's threshold.

### The ledger

Every change is one row in `stock_movements`.

| Column | Meaning |
|---|---|
| `type` | `sale` (−), `refund` (+), `void` (+) or `adjustment` (±) |
| `qty` | The signed quantity. Plus is in, minus is out. |
| `reason` | A free text line |
| `order_id` | The order, when the change comes from one |
| `user_id` | Who did it |

The stock columns are the running total of the ledger.

The reasons of a manual adjustment are `ADJUST_REASONS`: `received`, `count`, `damaged`, `other`.

### Packages hold no stock

A package is a product with `kind = 'bundle'`.

- In the database it keeps `track_stock = false` and `stock = 0`.
- So it never shows on `/stock`, in the `low_stock` badge or in the report's stock summary.
- Its availability is worked out on every read from its components. See [products.md](products.md).

Selling a package moves its components:

- `OrderRepository` writes one `sale` movement per tracked component of the line.
  The quantity is `component qty × line qty`.
- A refund with restock and a void put the same units back.
  They read them from the `order_items.components` snapshot.

Example: a pack of 12 pens is sold once. The pen's history shows `-12`. The package has no movement.

## The one write path

`StockRepository.move(tx, { shopId, productId, variantId, type, qty, reason?, orderId?, userId? })`

How it works:

1. It runs inside the caller's transaction (`tx`).
2. It runs one `UPDATE` that adds `qty` to the stock column.
3. The guard is in the `WHERE` of that `UPDATE`: `track_stock = true` and `stock >= floor`.
   For an outgoing move, `floor` is the quantity that leaves. Else it is 0.
4. So two sales at the same moment cannot both take the last unit.

What it returns:

| Answer | When |
|---|---|
| `false`, nothing written | The unit is not tracked, or it is missing, or the stock would go below zero |
| `true` | The stock changed and the movement row was inserted |

On success it also clears the shop's kept low-stock number (`StockRepository.forgetLow`) and marks the store catalog as changed (`catalogChanged`).

The update goes through `Db.update`, so it works on SQLite, Postgres and MySQL.

### Who calls it

| Caller | Type | Note |
|---|---|---|
| Checkout and items added to an open order | `sale` | On `false` it throws `OutOfStockError`. The transaction rolls back. |
| Refund with `restock` | `refund` | |
| Void | `void` | |
| Manual adjust | `adjustment` | |

One place writes ledger rows without `move`:
`ProductRepository` writes `adjustment` rows directly for the counts set on the product form and in the CSV import (`#formMovement`, reason "Set on product form").

## Screens and endpoints

All of these are for managers and admins.

### `GET /stock?filter=all|low|out&q=&page=`

The list. There is one row per tracked unit.

- Untracked products and packages do not appear.
- A tracked product with variants shows each variant.
- `low` = `stock ≤ low_stock_at`. It includes units that are out.
- `out` = `stock ≤ 0`.
- `q` matches the product name, the variant name or the barcode.
- The header `summary` is `{ tracked, low, out }`.

### The sidebar badge

The shared prop `low_stock` shows on the Stock link when it is above 0.

- Sidebar open: it shows the count.
- Sidebar collapsed: it shows a red dot.
- `low` already includes the units that are out of stock.

Where the number comes from:

1. `#sharedProps` in `app/xcore/view/Inertia.ts` asks `StockRepository.lowCount()`.
2. That is `summary().low`, kept in memory per shop for `LOW_STOCK_CACHE_MS` (30 seconds).
3. `StockRepository.move` clears it at once. So does a product create, update or delete.
4. Only managers and admins with an active shop get the number. Everyone else gets 0.

### `POST /stock/adjust`

An Inertia form: `{ product_id, variant_id, delta | set, reason, note }`.

`StockService.adjust` does this in one transaction:

1. It reads the current level.
2. It turns `set` into a delta. `set` wins when both are sent.
3. A delta of 0 is a success with nothing written.
4. It refuses a change that would go below zero ("Only N in stock").
5. The reason text is the reason's label. With a note it is the label plus the note.
6. It calls `move` with type `adjustment`.

Errors come back as page props. On success the browser goes back to the list.

After a successful adjust the extension event `stock.updated` is fired.

### `GET /stock/movements?product_id=&variant_id=&page=`

JSON. The history of one unit.

- Newest first.
- 25 rows per page.
- Each row has `by` (the user's name) and `order_id`.
- Without a `product_id` the answer is 422 `{ errors }`.

## POS behaviour

- The POS shows every product.
- It caps the quantity in the cart at the available count.
- It shows a toast when you try to go over.
- It marks cards and variants that are out of stock.
- The checkout checks the stock again and gives a friendly error.
- The transaction checks it once more, atomically.

For a package:

- The cap is how many packages the *chosen* components can still cover (`availableFor` in `resources/js/lib/bundles.ts`).
- An option that cannot fill its slot is disabled in the picker.
  Example: 5 pens left for a slot that needs 12.
