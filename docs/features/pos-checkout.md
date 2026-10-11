# POS / Sell screen and checkout

The Sell screen (`/pos`): the product grid, the cart, the pay dialog, printing, the customer screen and Pay later.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/sales.ts` |
| Controller (`GET /pos`, `GET /pos/display`, `GET /pos/products`, `POST /pos/checkout`, `POST /pos/open`, `POST /pos/coupon`) | `app/controllers/Pos.Controller.ts` |
| Service (`checkout`, `open`, `quote`) | `app/services/sales/Order.Service.ts` |
| Cart pricing (`CartPricer.mergeItems`) | `app/services/sales/CartPricer.Service.ts` |
| Discount maths (`discountAmount`) | `app/helpers/discount.ts` |
| Repository (`create`) | `app/repositories/Order.Repository.ts` |
| Line prices | `ProductRepository.priceLine` |
| Is the method usable? | `PaymentMethodRepository.usable` |
| Validator (`CheckoutInput`, `OrderCreateInput`, `CouponQuoteInput`) | `app/validators/Order.Validator.ts` |
| Page | `resources/js/Pages/Pos/Index.vue` |
| Components | `pos/ProductCard.vue`, `pos/CartPanel.vue` (`discountCents`), `pos/CheckoutDialog.vue`, `pos/CustomerPicker.vue`, `ReceiptSlip.vue` |

## The screen

`/pos` is for every role.

### Props

- `products`: the first page of the shop's active products (`ProductService.page`)
- `categories`
- `payment_methods`: only the **enabled** ones
- `sales_staff`: the shop's active sales staff
- `adding`: set when the screen is opened for an order or a customer's bill. Else null.

### Left side: the grid

- A search box, category chips and the product grid (`ProductCard`).
- Search matches a part of the name, **or an exact barcode** of a product or a variant.
- A scanner that types a barcode and Enter adds the unit straight to the cart.
- Out-of-stock cards and variants are marked. Nothing is hidden.

### Products with variants

Clicking a product with variants opens a picker. It has a quantity field.

- **Guided**: one group at a time, built from `attributes`. Combinations that are impossible or out of stock are disabled.
- Or a plain list.

### Packages

A package is a product with `kind = 'bundle'`. See [products.md](products.md).

- A package that asks something opens the same sheet.
- There is one pill row per *choice* slot. The heading is like `12 × Pen`.
- An option that cannot fill the slot is disabled.
- The full recipe is listed under "In this package".
- A hint says how many can be built.
- A package whose slots are all fixed goes straight into the cart.

`lib/bundles.ts` holds the shared logic: `hasChoices`, `availableFor`, `optionLeft`, `lineKey`, `chosenNames`.

### Right side: the cart

`CartPanel` is on the right. On mobile it is a sheet.

- **Lines.** The key is `product_id:variant_id:slotId=variantId,…`.
  So two colours of the same package are two lines. The line's `variant_name` shows what was picked.
- **Quantity ±.** It is capped at the tracked stock. A toast shows when you go over.
- Remove and clear.
- **Customer.** Add or Change through `CustomerPicker`.
- **Order discount.** Percent or fixed, with quick % buttons. Or a discount code: **Apply code** asks `POST /pos/coupon`.
- Subtotal, discount, total.
- The **Charge** button.

### The cart is kept

- The unfinished sale (lines, discount, customer) is kept in `localStorage` under `cart:<shop_id>` for 1 day.
- So a page switch or a reload keeps the cart.
- On restore, the lines are checked against the current products:
  - units that are gone or out of stock are dropped
  - price and stock are refreshed
  - the quantity is clamped
- It is cleared on checkout and on Clear.

### The pay dialog

`CheckoutDialog`:

1. Pick a payment method. The first one is preselected.
2. A `tendered` method shows a cash input. It has quick-amount buttons (exact, next 5 / 10 / 20 / 50) and shows the change.
3. Other methods pay exactly the total.
4. Confirm sends `POST /pos/checkout`.

On success:

- The dialog shows the receipt summary.
- **Print** calls `printReceipt()` from `lib/rawbt.ts`. `Orders/Show` uses the same function.
- **Done** closes the dialog.
- The cart is reset.
- The grid fetches page 1 again at once (`reload()`). The current search and category are kept.

Why the grid reloads at once:

- The cards show the new stock counts.
- Leaving the page with the receipt open cannot leave the sold cart behind.
- The grid shows its own `loaded` list, not the `products` page prop. So an Inertia reload would not change a card.

## Printing

`printReceipt(order, currency, shopName)` in `resources/js/lib/rawbt.ts` is the single entry point.
`CheckoutDialog` and `Orders/Show` use it.

### RawBT off (the default)

- It calls `window.print()`.
- Only `#receipt` from `ReceiptSlip.vue` prints.
- The CSS in `app.css` is made for 72 mm thermal paper.

### RawBT on

1. `receiptLines()` builds the same receipt as a list of lines.
2. `drawSlip()` draws them on a canvas as wide as the paper.
   The browser draws the letters. So Thai, Myanmar and every other script print right.
3. `rasterBytes()` turns the picture into ESC/POS image commands (`GS v 0`, strips of 200 rows).
4. The bytes go to the [RawBT](https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter) Android app through `location.href = "rawbt:base64,…"`.
5. RawBT prints on the paired Bluetooth, USB or network thermal printer.

There is no dialog and no page navigation. Android switches to RawBT and back.

### The settings

Both settings are per device, because RawBT has to be installed there. So they live in `localStorage`:

| Key | Value |
|---|---|
| `rawbt` | A boolean. Default `false`. |
| `rawbt-cols` | 32 = 58 mm paper = 384 dots. 48 = 80 mm = 576 dots. |

- The switch and the paper-width select are the **Printing** section of `/settings`. Cashiers can reach it too.
- Long text wraps between words. `Intl.Segmenter` finds the words, also in Thai and Myanmar.
- Amounts sit at the right edge.

Tests: `resources/js/lib/__tests__/rawbt.test.ts` covers the lines and the image bytes. The canvas drawing needs a browser.

## Line notes

Every cart line has a note button (a speech bubble).

- It is a short text for the kitchen or the order, like "no onions".
- At most `CUSTOM_REQUEST_MAX` (1000) characters.
- It is kept with the cart.
- It is sent as `items[].note` by the checkout, Pay later and Add to order.
- It is saved on `order_items.note`. This is the same column as the online store's custom request.
- It shows under the line on the order page ("Note") and on the receipt.
- With the Restaurant extension it shows in the kitchen too.
- Tapping the same product again adds to the line. The note belongs to the whole line.

## Customer screen

`GET /pos/display`. It is for a second monitor on the same computer, facing the customer.

### Opening it

The monitor button next to the search box opens it in a window of its own (`openDisplay` in `Pos/Index.vue`).

In Chrome and Edge:

1. It asks Chromium's Window Management API (`window.getScreenDetails()`) for the other monitor. The browser asks for permission once.
2. It opens the window there, filling it, with the `fullscreen` window feature.

It is a plain window that the cashier drags over when:

- the permission is refused
- there is a single monitor
- it is another browser

### Full screen

Full screen needs a click. Opening the window uses up the button's click. So:

- The cashier's **next click anywhere on the Sell screen** is passed on to the customer screen.
  This is `delegateFullscreen` in `lib/display.ts`. It uses Chromium's capability delegation: `postMessage(…, { delegate: "fullscreen" })`.
- The customer screen then goes full screen.
- It happens again after someone leaves full screen with Esc.
- A click or tap on the customer screen itself does the same (`goFullscreen`).
- A small hint says so until the screen is full.

Other notes:

- The window handle lives in `lib/display.ts`. It is lost on a full reload of the Sell screen. Press the button again.
- A window the browser blocked (the permission question took too long) shows a toast: press again.

### How it follows the cart

- The page is `Pages/Pos/Display.vue`. No layout. No props (`PosController.display`).
- It is always the light theme, whatever the cashier picked (`theme: "light"` in `inertia()`).
- It reads `cart:<shop_id>` from `localStorage`.
- It listens to the browser's `storage` event. That event fires in every other window of the same site when the Sell screen saves the cart.
- There is no server call and no websocket. So a tablet or another computer does not follow the cart.

### What it shows

- The shop name. The number of units is on the right of the header.
- The picked customer's name, under it.
- Each line: picture, name, variant, qty × price, the line's note, line total.
- Subtotal, discount, tax and the total (`saleTotals`, the same sums as the cart).
- An empty cart shows "No items".
- A line that is new or got more units flashes (`.display-added`). The flash is off with `prefers-reduced-motion`. The line is scrolled into view (`markAdded`).
- A cart opened for an order (`cart:<shop_id>:order:…`) is followed too.

### Layout

There are two columns.

- **Left, the big one**: the extension slot `pos.display`.
  It shows the shop's logo and name while no running extension names the slot, or none of them draws anything.
  "Draws nothing" means their elements are empty. This is the `:has()` rule at the end of `Display.vue`.
- **Right**: the cart, under the shop's logo and name.

### The picked payment method

Every pay dialog draws its method buttons with `components/pos/PaymentMethodPicker.vue`:

- the Sell screen's checkout
- **Record payment** on `/orders/:id`
- extensions, through `api.paymentPicker()` (the Restaurant's Pay)

While the buttons are on screen:

- The picker writes `display:<shop_id>` = `{ name, image, extension, amount }` to `localStorage` (`showPayment` in `lib/display.ts`). `amount` is the cents asked for.
- It removes the key when it goes away (dialog closed, sale done).
- A reloaded Sell screen removes it too.

What the customer screen does with it:

- It shows the method's picture (`payment_methods.image`, see [payment-methods.md](payment-methods.md)) with its name and the amount in the big column.
- The picture sits over the logo or the extensions. The extensions stay mounted, but hidden.
- A method with no picture is left to the extensions (`payment()` below). The PromptPay extension draws its QR code this way.

### Another shop

- The Sell screen writes its shop id to the `localStorage` key `pos:shop` when it opens (`announceShop` in `lib/display.ts`).
- The customer's screen reloads itself when that id is not its own.
- So it shows the new shop and that shop's cart.

### In the pay dialog too

This is for a shop with no second monitor. The cashier turns the tablet or phone to the customer.

- `PaymentMethodPicker.vue` draws `components/pos/PaymentShow.vue`.
- It shows the picked method's picture, or the `pos.display` slot of the extension that added the method.
- Other extensions' elements are hidden. `paymentShows()` says if there is anything to show.
- It is in the picker. So every pay dialog has it, and no dialog's own layout changes.

Where it sits:

- With at least `SIDE_MIN` px free on the dialog's left, it is teleported into the dialog element as a card hanging off its left side.
- Else it sits under the method buttons.

Other details:

- The slot is handed the Sell screen's saved cart, read once.
- It sets `--display-height: auto`. So a drawing made to fill the customer's screen is only as tall as it needs.

### The extension slot `pos.display`

- Context: `{ sale(), onChange(fn), payment(), onPayment(fn) }`. Read only.
- Types in `extensions/types.ts`: `DisplaySale`, and `DisplayPayment` = `{ method, extension, amount }`.
- `payment()` is null while no pay dialog is open.

Tests: `e2e/z-pos-display.spec.ts`.

## Pay later

`POST /pos/open` (JSON).

The checkout dialog's **Pay later** button saves the cart as an unpaid order instead of a sale. Every role may use it.

### Request

- The body has the same `items`, `customer_id` and `sales_staff_id` as the checkout.
- `paid` is ignored. It is always 0.
- No payment method is needed. The order shows "Pay later".
- A discount or a code is refused (`validation.unpaid_no_discount`). The cashier removes it first.

### What the server does

It calls `OrderService.open`:

- Prices are read again from the database.
- The stock is taken at once.
- `payment_status = unpaid`.

### One bill per customer

- The server asks `OrderService.openFor`: does the cart's customer already have an order that is not paid in full?
- If yes, the cart is added to that order (`OrderService.addItems`, one `order_history` row). The answer is that order.
- This is how a restaurant table keeps every round on one bill. In the Restaurant extension a table is a customer.

### Response

- `201 { order }`. The dialog shows "Order saved, not paid yet", with **Still due** instead of Change, and Print.
- `422 { errors }` otherwise.

### After that

- The order can take more items and give items back on `/orders/:id`. The money is recorded there. See [orders.md](orders.md) › Open orders.
- `/pos?customer=<id>[&back=<path>]` opens the screen for that customer's bill.
  The cart is added to their open order, or starts one through this route. See [orders.md](orders.md) › For a customer's bill.

## Checkout API

`POST /pos/checkout` (JSON).

### Request

The body is `CheckoutInput`:

```json
{ "items": [{ "product_id": 1, "variant_id": null, "qty": 2, "choices": { "7": 3 } }], "paid": 1500, "payment_method": "Cash",
  "customer_id": null, "discount_type": "percent" | "fixed" | null, "discount_value": 10, "coupon": "" }
```

- `coupon` is optional. It is a discount code. When given, it replaces the manual discount. See [coupons.md](coupons.md) › At the POS.
- `choices` only means something on a package line: `{ "<bundle_item id>": <chosen variant id> }`. Everywhere else it is `{}`.

### Server steps

`OrderService.checkout` does this:

1. **Payment method.** `payment_method` must be the name of an **enabled** method of this shop. Else `errors.cart`.
2. **Customer.** `customer_id`, if given, must exist in this shop.
3. **Merge.** Duplicate lines are merged (`CartPricer.mergeItems`).
   The key is product + variant and, for a package, the same `choices`.
   So the stock check sees the real quantity.
4. **Price.** Each line is priced again from the database (`priceLine`). See below.
5. **Totals.** See below.
6. **Write.** `OrderRepository.create` runs in one transaction. See below.

It also asks `PlanLimitService.orderError` first. In the open-source app that never refuses.

### Step 4: pricing a line

`priceLine` reads:

- the name, as `"Product — Variant"`
- the price
- the cost: the variant's cost, else the product's cost, else null
- `track_stock` and `stock`

Refusals, all as `errors.cart`:

- The item is missing.
- A product with variants is sold without a `variant_id`. This counts as missing.
- A tracked item has `stock < qty`. The message is friendly: "Only N × X left" or "X is out of stock".

A **package** line resolves its slots instead:

- Each slot takes its only option, or the one `choices` names.
- A slot with no answer, or with an option that is not allowed, gives `errors.cart`: "Choose an option for “Pen — 1 dozen”".
- The line's `name` becomes `"Pen — 1 dozen (12 × Red)"`. It lists the picked options of the choice slots, in slot order. So receipts and `/orders` show what was sold.
- `cost` = the sum of component cost × slot qty.
- Availability = the scarcest resolved component.
- The resolved `components` ride along.

### Step 5: totals

- `subtotal` = the sum of price × qty.
- `discount = discountAmount(subtotal, type, value)`. Percent is rounded. Fixed is cents. It is never more than the subtotal.
- With a `coupon`, the discount is what `CouponService.resolve` says the code takes off. A code that does not apply gives `errors.coupon`.
- The tax is worked out on `subtotal − discount`. See [shops.md](shops.md) › Tax / VAT.
- `total = subtotal − discount`, plus the tax when it is added on top.
- `paid < total` gives `errors.cart`.

### Step 6: the write

`OrderRepository.create`, in one transaction:

- It inserts the order, with `change = paid − total`. The discount fields are zeroed when the discount is 0.
- It inserts the items, with a `cost` snapshot.
- For each tracked line it calls `StockRepository.move(tx, …)` with type `sale` and a negative quantity.
- A package moves its tracked **components** instead (`component qty × line qty`).
  It stores the snapshot in `order_items.components`. So refunds and voids can put the same units back.
- If a move returns false (someone else took the last unit), it throws `OutOfStockError`. The transaction rolls back. The answer is 422 `errors.cart`.

### Response

- `201 { order }`: the order and its items. `customer` is filled in the browser.
- `422 { errors }`.

### Discount maths in the browser

The discount is also worked out in the browser (`CartPanel.discountCents`). That is for display only. The server works it out again.

## Product pictures

- The grid's cards show the cover photo through `components/store/StoreImage.vue`.
  It is the same square `object-cover` image the storefront uses. Every upload is cropped to 1:1 in the image editor.
- The product sheet on the Sell screen shows the photos through `components/ImageGallery.vue`. Its main photo goes through `StoreImage` too.
- The order of the photos is `galleryOf()` in `lib/images.ts`: the chosen variant's first, then the product's, then every variant's.
- With more than one photo there is a thumbnail strip (`sm:` and up) next to the cover image.

## Sales staff

- When the shop has active sales staff, the checkout dialog shows an optional "Sales staff" dropdown (prop `sales_staff` of `/pos`).
- The pick is sent as `sales_staff_id`.
- An id that is unknown, switched off or from another shop gives 422 `{ errors: { cart } }`.
- See [auth-and-users.md](auth-and-users.md) › Sales staff.

## Product grid paging

`/pos` ships only the first page of products: `POS_PER_PAGE` = 16, through `ProductService.page`.

- The grid appends the next page when the sentinel under it scrolls into view (`IntersectionObserver`, `loadMore()` in `Pages/Pos/Index.vue`).
- Search and the category pills are server-side too: `GET /pos/products?q=&category=&page=` (JSON).
  The calls are debounced 200 ms. Stale responses are ignored.
- The picked category is kept in the address (`/pos?category=<id>`). `PosController.index` reads it for page 1. So a refresh stays on it.
- Only active products are listed.

Everything that needs a product that is not on a loaded page asks the server:

- A restored cart re-syncs through `?ids=1,2` right after mount. At most 100 ids are read.
- Reopening a cart line fetches its product by id.
- A scanned barcode that is not on screen is looked up with `?q=<code>` and matched exactly.
