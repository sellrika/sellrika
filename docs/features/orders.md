# Orders, refunds, void

What an order holds, how it is listed and shown, and how it changes: payments, delivery steps, open orders, refunds and void.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/sales.ts` |
| Controller | `app/controllers/Order.Controller.ts` |
| Service (`refund`, `void`, `recordPayment`, `setFulfillment`, `saveSteps`, `refundValue`, `refundable`, `stats`, `create`, `open`, `addItems`, `removeItems`, `setDiscount`, `moveTo`, `join`, `openFor`) | `app/services/sales/Order.Service.ts` |
| Repository | `app/repositories/Order.Repository.ts` |
| Validators (`RefundInput`, `VoidInput`, `PaymentInput`, `FulfillmentInput`, `FulfillmentStepsInput`, `OrderCreateInput`, `OrderItemsInput`, `RemoveItemsInput`, `OrderDiscountInput`) | `app/validators/Order.Validator.ts` |
| Models | `app/models/Order.ts` |
| Constants (`PAYMENT_STATUSES`, `FULFILLMENT_STATUSES`, the filter sets) | `app/constants/Order.Constant.ts` |
| Order pictures | `app/xcore/storage/OrderImages.ts` |
| Pages | `resources/js/Pages/Orders/Index.vue`, `resources/js/Pages/Orders/Show.vue` |
| Badges (`ORDER_STATUS`, `PAYMENT_STATUS`, `FULFILLMENT`) | `resources/js/lib/orders.ts` |
| The receipt | `resources/js/components/ReceiptSlip.vue` |

The detail page is titled with the order code, like `Order # 3CGJ-9RGM-HACU`.
The dialogs and the void toast use the code too.
The id shows only for an old row with no code.

## The order model

### Money

| Column | Meaning |
|---|---|
| `subtotal` | The sum of the lines |
| `discount_type`, `discount_value`, `discount` | The order discount |
| `coupon_code` | The discount code that was used, as text. See [coupons.md](coupons.md). |
| `delivery_fee` | Cents. The online store's delivery charge. 0 at the POS. |
| `tax`, `tax_rate`, `tax_label`, `tax_included` | The shop's tax line, frozen at sale time (migration 0041). See [shops.md](shops.md) › Tax / VAT. |
| `total` | `subtotal − discount + (tax unless included) + delivery_fee` |
| `paid`, `change` | The money received and the change given |
| `refunded` | The cached sum of the refunds |

Notes:

- A percent or fixed code fills `discount_*` like a POS discount.
- A free-delivery code leaves `discount = 0` and sets `delivery_fee = 0`.
- `tax` is the cents on `subtotal − discount`.
- `tax_included` = the tax sits inside the prices. It is not added to the total.

### Other columns

| Column | Meaning |
|---|---|
| `payment_method` | The **name** as text. It survives a rename or delete of the method. |
| `customer_id` | The customer, if any |
| `user_id` | The cashier |
| `status` | See Statuses |
| `voided_at`, `voided_by`, `void_reason` | Set by a void |

### Lines

Each line (`order_items`) is a snapshot: `name`, `price`, `cost`, `qty`, `refunded_qty` and `image`.

### The line's picture

`order_items.image` is the order's **own copy** of the line's picture (migrations 0058 and 0059).

- The path is `/uploads/<shop id>/orders/<uuid>.<ext>`. Older lines have `/uploads/order-<uuid>.<ext>`.
- A product may delete its pictures. So the order never points at the product's file.

Where the picture comes from:

1. The variant's first upload.
2. Else the product's first upload.
3. Else none.

It is never an https link. A package uses the package's own picture. `ProductRepository.priceLine` picks it.

How the copy is made:

- `OrderImages.copyAll()` in `app/xcore/storage/OrderImages.ts` makes it, right before `OrderRepository.create`.
- This happens in the POS checkout and in `StoreService.fulfill`.
- It never happens when a cart is only priced. So an unpaid cart leaves no file.
- The copies are made side by side.

The size:

- It is only a thumbnail. It is shrunk to fit `ORDER_IMAGE_PX` (224 px, a few KB).
- A PNG stays PNG. Anything else becomes JPEG.
- A picture `Bun.Image` cannot read is copied as it is.

The memory of copies:

- The copy of each product picture is remembered in memory, up to `ORDER_IMAGE_CACHE_MAX` entries.
- So later sales of the same picture point at the same file. It is not shrunk again.
- This is safe because order pictures are never deleted.

When something fails:

- A copy that fails (file gone, storage error) is logged as `[orders] …`. The line keeps `image = null`. The sale still goes through.
- When the order is refused (out of stock), the copies are deleted again. Only a copy the order made itself, and that nobody else got, is deleted.

Guards:

- `OrderRepository.create` only stores an order picture path (`OrderImages.is`). Anything else becomes null.
- `Storage.delete()` refuses order pictures. So an order keeps its picture for good.
- The order emails show the picture.

### Statuses

- `completed` → `partially_refunded` or `refunded`, through refunds.
- `completed` → `voided`, through void.

Voided orders are left out of every sales number: stats, reports and customer totals.

### The public order code

`reference` is the public code, like `P8J4-MJSQ-4Z8T` (migration 0036).

- It is 12 random symbols from a 32-letter alphabet with no look-alikes.
- `orderReference()` in `app/helpers/crypto.ts` makes it. There is a unique index.
- Orders made before the code was shortened carry 16 symbols. `normalizeReference` accepts both lengths. So their confirmations still track.
- The migration gave a code to the orders that existed then.

Why it exists:

- It is what the buyer sees: emails, the thank-you page, tracking.
- It replaces the sequential id. So nobody can find an order by guessing the next number.

Where staff see it:

- It is the first column on the order list.
- It is printed under the title on `/orders/:id`.
- `?q=` on the list matches it. Case and dashes do not matter.

### Payment status

`payment_status` is `paid`, `partial` or `unpaid` (migration 0035). `paid` holds the cents received so far.

| Order | Starts as |
|---|---|
| A POS sale | `paid` |
| An online order paid through a gateway | `paid` |
| A POS cart saved with **Pay later** | `unpaid`. See Open orders. |
| An online order placed with a manual option (cash on delivery, bank transfer). See [online-store.md](online-store.md). | `unpaid`, `paid = 0` |
| An order sent straight from the cart of a store with no payment option | `unpaid` |
| An order an extension opens | `unpaid`. See Open orders. |

- Reports and customer totals count an unpaid order like any other sale. It is a sale.
- A refused delivery is voided. That removes it everywhere.

`OrderRepository.paymentStatus(received, total)` is the one rule:

- `received ≥ total` → `paid`
- `received > 0` → `partial`
- else `unpaid`

### Delivery

Only online orders have delivery.

- `fulfillment` = one of the shop's delivery steps. Any order of steps is allowed. Going back is allowed.
- `tracking` = free text: a courier number or a link.
- POS sales carry `''`. This is also how "online" is told from "POS" in the filters.
- The migration set the online orders that existed then to `new`.

### Delivery steps per shop

`shops.fulfillment_steps` is JSON `[{key, label, color}]`, in the order the shop wants (migration 0064).

`''` means the built-in list: `new` → `packing` → `shipped` → `delivered`.
`defaultSteps()` builds it. Each step has its starting colour in `FULFILLMENT_COLORS`.

**Editing**

Admins edit the list with the gear button next to the search box on `/orders`.

- Dialog: `components/orders/StepsDialog.vue`
- Route: `PUT /orders/steps` (JSON, `FulfillmentStepsInput`)
- Service: `OrderService.saveSteps`

What an admin can do:

- Rename any step. A `label` of `''` means the translated built-in name.
- Move any step up or down.
- Pick a badge colour (`#rrggbb`, the category `ColorPicker`). None = the built-in colour, or grey for the shop's own step.
- Add their own step. It gets a random 8-letter `key`, needs a name and starts amber. At most `FULFILLMENT_STEPS_MAX` = 12 steps.
- Remove `packing` or their own steps.
- **Reset to default**. It is saved on Save.

What cannot be removed:

- `new`, `shipped` and `delivered` (`FULFILLMENT_LOCKED`). The checkout writes `new`, and `shipped` emails the buyer. Their place in the list is free.
- A step that open (not voided) orders still sit on: "Some orders are still at …" (`OrderRepository.fulfillmentInUse`).

**Where the list is used**

- `PUT /orders/:id/fulfillment` accepts only the shop's steps.
- The badges use the step's colour (`stepStyle()` in `lib/orders.ts`, a tint that reads on light and dark).
- The storefront's progress bar and account badges follow the same list and names (`store.fulfillment_steps` and `orderStatus(key)` in the Edge themes).

## The list

`GET /orders`, for every role. Paged, newest first.

### Filters

All filters run on the server.

| Filter | Values |
|---|---|
| `q` | The order id with or without `#`, the public order code, a part of an item name or of a customer name |
| `method` | A payment name, or `all` |
| `status` | `all`, `completed`, `partially_refunded`, `refunded`, `voided`, `refunded_any`, `unpaid` |
| `source` | `all`, `pos`, `online` |
| `fulfillment` | One of the shop's steps |
| `cashier` | A user id |
| `sales` | A sales staff id |
| `customer` | A customer id. The customer page links here. |

Details:

- **`method`.** The dropdown lists the shop's methods plus every other name found on its orders (`OrderRepository.methodNames`).
  Those are online gateway labels like "Stripe" or "Cash on delivery", and deleted methods.
- **`status = unpaid`** means not fully paid: `unpaid` and `partial`.
- **`source = online`** means the order has a delivery step, or was made by the online store's system user.
  A restaurant guest's QR order has no step and is online too.
- **`fulfillment`.** The tabs are in the shop's order. They show under Any source and Online. They are hidden under POS.
  They are hidden everywhere while an extension sets `orders.delivery: hide`.
- **`cashier`.** The dropdown lists the staff who made sales in this shop (`OrderRepository.cashiers`).
  The online store's system user is left out. The source filter covers it.
- **`sales`.** It shows only the sales that name that person. The dropdown lists the shop's sales staff, id and name only.
  It only filters the list. What a person sold and their commission are on their own page. See [auth-and-users.md](auth-and-users.md) › Sales staff.

### Columns

1. **Order**: the public code, like `# SM4A-83WY-V8W3`. `#id` for a row without one.
2. Items: a count and a summary.
3. Customer.
4. **Payment**: the method badge with the total under it. A refunded amount shows when there is one.
5. Status.
6. Date, last.

Badges:

- A payment badge shows when the order is not fully paid.
- A delivery badge shows on online orders.
- Method badges take the icon and colour from the shop's current methods. A deleted method gets a plain badge.

### Header stats

From `OrderRepository.stats`:

- today's net revenue = sales − refunds today. The day is the shop's local day (`startOfToday(tz)`).
- today's order count
- the all-time average order, voided left out

Caching:

- Today's numbers read today's orders only.
- The all-time count and sum are kept in memory per shop for `ORDER_TOTALS_CACHE_MS` (60 s).
- The two filter lists are kept for `ORDER_FILTERS_CACHE_MS` (5 min).
- A new order, a recorded payment or a void clears them at once.

## The detail page

`GET /orders/:id`.

`OrderDetail` = the order plus:

- `items`
- `cashier`
- `customer`
- `refunds[]`, each with `by` and the returned `items`
- `history[]`: items added or removed later. See Open orders.
- `voided_by_name`

The page says "sold by <name>" next to the cashier when the order names a sales person.

### Actions

| Action | Who | When |
|---|---|---|
| Print | Every role | Always |
| **Add items**, and a delete button per line | Every role | While the order is `completed` and not paid in full. See Open orders. |
| **Record payment** | Every role | While `payment_status ≠ paid` |
| Refund, Void | Admins only (`useAuth().isAdmin`). The server enforces it. | |

### The Record payment dialog

It works like the Sell screen's checkout, without a discount.

- Payment method buttons: the shop's enabled ones. An online order keeps its own name until one is picked.
- **Amount received**, with the Exact and next-note buttons for a cash method. More than what is due = change, sent as `tendered`.
- The sales person, from the `sales_staff` prop. It is sent only when changed.

### Other parts

- Online orders get a **Delivery** card: a status select and a tracking number. Every role may use it.
- The totals block shows "Still due" instead of "Change" while money is outstanding.

## Open orders

An order that is paid later can be changed until the money is in. Examples: a table's bill, a tab, an unpaid online order.

The methods are on `OrderService`. They are reached from the order page and through the `orders` handle of an extension route. See [extensions.md](extensions.md).

### `create(shopId, userId, OrderCreateInput)`

The one way in for the REST API (`POST /api/v1/orders`) and an extension's `orders.create()`.

- With `paid`: it is `checkout`, a sale like the till.
- Without `paid`, or with 0: it is `open`.
- An unpaid order takes no discount and no code (`validation.unpaid_no_discount`).

### `open(shopId, userId, {items, customer_id, payment_method, note, sales_staff_id})`

Also behind the Sell screen's **Pay later** button (`POST /pos/open`). See [pos-checkout.md](pos-checkout.md).

- It makes a new order with `payment_status = unpaid`, `paid = 0`, `fulfillment = ''` and no discount.
- Prices are read again from the database. The stock is taken at once.
- The optional sales person must be active and of that shop.
- `payment_method` is only the name shown. `""` = "Pay later".
- It fires `order.created`.

### `addItems(orderId, shopId, userId, {items})`

- New lines join the order.
- They are appended, never merged into an old line. So each round stays visible.
- Stock is checked and taken.

### `removeItems(orderId, shopId, userId, {items: [{order_item_id, qty}]})`

- Units leave a line. The whole quantity deletes the line.
- The stock goes back. This is a `void` movement with the reason "Removed from order #id".
- The last line cannot go ("void the order instead").
- The total cannot drop under the money already received.

### Rules for add and remove

- The order must be `completed` (not refunded, not voided) and not paid in full. So `unpaid` and `partial` both work.
- Anything else answers "This order is closed".
- A line may carry a `note`. It is kept as given.

The totals are worked out again by `totalsOf()`:

- `subtotal` = the lines
- a manual percent or fixed discount is worked out again
- a coupon's discount stays as it was
- the tax uses the rules **frozen on the order**
- `delivery_fee` stays
- `payment_status` follows `OrderRepository.paymentStatus()`

Two changes at once:

- Each call runs one at a time per order (`oneAtATime("order:<id>")`).
- The write itself only lands on the order as it was read: still not paid, same subtotal (`#retotal` in `OrderRepository`).
- So a payment or a void that got in between refuses the change. It does not mix with it.

Events:

- Both fire `order.updated`.
- They fire `order.status_changed` when the payment status moves.
- They fire `stock.updated`.

`OrderService.openFor(shopId, customerId)` = the customer's newest order that can still change.

### Discount on an open order

`OrderService.setDiscount(orderId, shopId, {discount_type, discount_value, coupon})`

- Reached by `PUT /api/v1/orders/:id/discount` and by extensions as `orders.setDiscount`. The Restaurant's Pay dialog uses it.
- It gives a till order that is not paid in full a percent or fixed discount, or a discount code (`applyCoupon`, the same rules as the till). Or it takes the discount off.
- The tax and the total are worked out again.
- The total never goes below what is paid.
- A code's use is recorded. The old code's use is given back.
- Online orders are refused.
- It writes no `order_history` row.

### On the order page

For every role, only while the order can change.

**Add items**

1. The button opens the Sell screen for that order: `/pos?order=<id>`.
2. `PosController.index` sends `adding: { id, code, back }`. It is null when the order is closed.
3. The screen shows a banner with the way back.
4. The cart has no customer and no discount.
5. Its lines are kept under their own `localStorage` key: `cart:<shop>:order:<id>`. The unfinished sale is left alone.
6. The button **Add to order** posts the cart to `POST /orders/:id/items` (JSON, `OrderItemsInput`). The answer is 201 `{ order }` or 422 `{ errors }`.
7. The screen goes back to the order.

**Delete a line**

1. Each line has a **delete button**. It takes one unit off **on screen only**. This is a draft.
2. A line at 1 goes away from the list. The very last unit cannot go.
3. A bar under the lines says how many will be removed. It has **Undo** and **Save changes**.
4. Only Save posts `POST /orders/:id/items/remove` (JSON, `RemoveItemsInput`).
5. It is one call for the whole draft. So it is one history row.

Both routes sit in the `Guard.auth` group next to Record payment.

### Move and join

- `OrderService.moveTo(orderId, shopId, customerId)`
- `OrderService.join(fromId, intoId, shopId, userId)`

Extensions reach them as `orders.move` and `orders.join` on staff routes. The Restaurant's "Move or join tables" uses them.

`moveTo`:

- It gives an order that is not paid in full to another customer of the shop.
- Nothing else changes.

`join`:

- It moves every line of `fromId` into `intoId`, in one transaction.
- The lines, their `stock_movements`, `order_history` and `store_carts` rows change order.
- `intoId` is totalled again. The tax is worked out again. One `items_added` history row is written.
- `fromId` is deleted.
- No stock moves.
- `fromId` may have no money received and no discount. Join it the other way round instead.
- Both orders are locked, the lower id first.

### For a customer's bill

`/pos?customer=<id>` opens the Sell screen for that customer.

| The customer has | `adding` is | What happens |
|---|---|---|
| An open order | `{ id, code, back }` | The cart is added to that order |
| No open order | `{ id: null, code: "", customer: { id, name }, back }` | The banner says "New order for <name>". **Add to order** posts the cart to `POST /pos/open` with that customer. That starts their unpaid order, or joins one opened meanwhile. |

- `?back=<path>` is where the screen goes after sending. It is also what the banner's Back link opens. It must be a same-site path (`Url.samePath`). The default is the order.
- `/orders/:id?pay=1` opens **Record payment** at once, while money is due.
- The Restaurant's table cards use both: **Add items** and **Pay**.

### History

Every add or remove writes one `order_history` row in the same transaction (migration 0074).

| Field | Meaning |
|---|---|
| `type` | `items_added` or `items_removed` |
| `user_id` | Who did it |
| `created_at` | When |
| `data` | JSON `{ changed, before, after }` |

- `changed` = the lines that were added, or the units that were removed (`name`, `qty`, `price`).
- `before` and `after` are each a snapshot of the order at that moment: its lines (`name`, `qty`, `price`) and its `subtotal`, `discount`, `tax`, `total`.

`OrderDetail.history[]` carries the rows, oldest first, with `by` = who did it.

`/orders/:id` shows a **History** table across the full width under the order. It shows only when there is a row. One row per change:

- Date
- What changed
- Items: `+ 1× Soup` in green for added, `− 1× Soup` in red for removed
- Before: lines and total
- After: lines and total
- By

## Record a payment

`POST /orders/:id/payments` (every role, JSON).

```json
{ "amount": 600 }
```

Use it when cash on delivery was collected, or a bank transfer was seen.

Optional fields of `PaymentInput`:

| Field | Meaning |
|---|---|
| `payment_method` | The name of one of the shop's enabled methods. The order then shows it. Left out = the order keeps its name, like "Cash on delivery" or "Bank transfer". |
| `tendered` | The cents the buyer handed over when `amount` pays the order off. What is over is kept as the order's change. Ignored on a part payment. |
| `sales_staff_id` | The sales person to name on the order. null takes the name off. Left out = unchanged. |

Rules (`OrderService.recordPayment`):

- The order exists.
- It is not voided.
- `due = total − (paid − change) > 0`. Else: "already paid in full".
- `amount ≤ due`.

`OrderRepository.addPayment` adds to `paid` and works out `payment_status` again.

The answer is `201 { paid, payment_status }` or `422 { errors }`.

## Delivery status

`PUT /orders/:id/fulfillment` (every role, an Inertia form): `{ fulfillment, tracking }`.

Rules (`OrderService.setFulfillment`):

- The order exists.
- It has a fulfillment status. A POS sale is refused: "Only online orders have a delivery status".
- It is not voided.

The "shipped" email:

- Moving **to** `shipped` from another step emails the buyer the "on its way" notice with the tracking number.
- It is sent once, and not awaited. See [email.md](email.md).
- Saving `shipped` again (a tracking correction) does not send it.

Errors come back as `errors.fulfillment` on the Show page. Success goes back to the order.

## Refund

`POST /orders/:id/refund` (admin, JSON).

```json
{ "amount": 500, "reason": "", "restock": true, "items": [{ "order_item_id": 12, "qty": 1 }] }
```

### The dialog

- `items` is optional. Without it, the refund is money only.
- The default amount is `refundValue(order, lines)` = the returned lines' gross × `total/subtotal`.
  That is their share of what was really paid after the order discount.
- "Refund all" fills every returnable quantity and the remaining amount.

### Rules

`OrderService.refund` checks:

- The order exists.
- It is not voided.
- It is not `unpaid`: "Nothing has been paid on this order yet — void it instead".
- `remaining = refundable(order) = paid − change − refunded > 0`.
  Only money that really came in can go back. A partly paid cash-on-delivery order refunds at most what was recorded.
- `amount ≤ remaining`.
- Each line id is valid and unique.
- `qty ≤ qty − refunded_qty`.

### The write

`OrderRepository.refund`, in one transaction:

1. It inserts `refunds` and `refund_items`.
2. It adds to `order_items.refunded_qty`.
3. When `restock` is true, it writes a `refund` stock movement (+qty) per line.
   - A package line puts back its `order_items.components` snapshot instead. So the pens go back, not the package.
   - A product that no longer exists, or is not tracked, is skipped silently.
4. It updates `orders.refunded` and `status`: `refunded` when `refunded ≥ total`, else `partially_refunded`.

### Response

`201 { refund }` or `422 { errors }` (`order`, `amount`, `items.N.qty` …).

## Void

`POST /orders/:id/void` (admin, an Inertia form): `{ reason }`.

- Only `completed` orders can be voided. A refunded one answers "Refunded orders can't be voided". An already voided one is an error.
- It sets the status and the voided-at, voided-by and reason columns.
- It writes a `void` movement (+qty) for every line with a product id.
- Errors come back as `errors.void` on the Show page. Success redirects to the order.

## Receipt

`ReceiptSlip.vue` is teleported to `<body>` as `#receipt` and hidden. `@media print` hides everything else.

It shows:

- the shop name
- the order code and date (`Order # 3CGJ-9RGM-HACU`, the id only for an old row with no code)
- the payment
- the customer (no cashier)
- a VOIDED banner
- the lines
- subtotal, discount, tax, total, paid, change
- the refunded amount

The tax line reads "VAT 7%", or "Incl. VAT 7%" when the prices hold it.

The RawBT receipt has the same lines (`receiptLines()` in `lib/rawbt.ts`, printed as a picture).

### The order note

`orders.note` is free text (migration 0029).

- It shows under the customer on `/orders/:id`.
- It is printed on the receipt. `slipNote()` in `lib/rawbt.ts` puts the "Deliver to" line alone, and joins the address lines after it with commas.
- The online store fills it with the delivery details.
- POS orders leave it empty.
