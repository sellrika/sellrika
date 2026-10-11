# Coupons / discount codes

How a shop makes discount codes, and how they work at the online checkout and at the POS.

## What a code does

A shop can hand out codes.

- Buyers type them at the **online checkout** (`<store>/checkout`).
- The cashier types them at the **POS**, in the cart's discount popover.

A code does one of three things:

- takes a percentage off the eligible items
- takes a fixed amount off the eligible items
- waives the delivery fee

A code can be limited:

- by date
- by how often it is used, in total and per customer
- by a minimum order
- to specific products or categories
- to specific customers

## Where the code is

| What | Where |
|---|---|
| Admin pages (`/coupons`) | `app/controllers/Coupon.Controller.ts` |
| The rules | `app/services/sales/Coupon.Service.ts`: `resolve` = every rule, `couponDiscount` = the maths, `redeem` |
| SQL | `app/repositories/Coupon.Repository.ts` |
| Validator | `app/validators/Coupon.Validator.ts` (`CouponInput`) |
| Model | `app/models/Coupon.ts` |
| Constants | `app/constants/Coupon.Constant.ts` (`COUPON_TYPES`, `COUPON_CODE_RE`, `COUPON_HOLD_MS`) |
| Bounds and the rate bucket | `MAX_COUPON_SCOPE`, `MAX_COUPON_EMAILS` and the `storeCoupon` bucket in `app/constants/Security.Constant.ts` |
| The percent / fixed maths | `discountAmount` in `app/helpers/discount.ts` |
| The one-at-a-time lock | `app/helpers/lock.ts` |

Checkout side:

- `StoreService.quote` / `checkout` / `fulfill`. The work is in `app/services/sales/store/StoreCheckout.Service.ts` and `StoreFulfill.Service.ts`.
- `POST /checkout/coupon` in `Store.Controller.ts`.
- `StoreCouponInput` + `StoreCheckoutInput.coupon` in `app/validators/Store.Validator.ts`.
- `CheckoutArgs.discount` in `extensions/types.ts`.

POS side:

- `OrderService.quote` / `checkout` (`#applyCoupon`).
- `POST /pos/coupon` in `Pos.Controller.ts`.
- `CouponQuoteInput` + `CheckoutInput.coupon` in `app/validators/Order.Validator.ts`.

Pages:

- `Pages/Coupons/Index.vue`: the list + the add/edit dialog.
- `Pages/Coupons/Show.vue`: one code's history.
- The code box of the online checkout: `resources/js/store/islands/Checkout.vue` (`quoteCoupon` in `resources/js/store/checkout-api.ts`).
- The code box of the POS: the cart's discount popover in `components/pos/CartPanel.vue` (its own `quoteCoupon`).
  `Pages/Pos/Index.vue` asks for a new quote whenever the lines or the customer change.
- The code is printed on `Orders/Show`, the receipt, the thank-you and track pages and the order emails.

Tables: `coupons`, `coupon_redemptions`, `orders.coupon_code` (migration 0040) → [database.md](../database.md).
The holds are on `store_carts`: `coupon_id` + `coupon_email` (migration 0062) and `coupon_customer_id` (migration 0082).

## Setting one up (`/coupons`, admin)

There is one dialog. Everything except the code and the discount is optional.

| Field | Rule |
|---|---|
| **Code** | 3–30 of `A-Z 0-9 - _`. Stored upper-case. Unique per shop. Buyers may type it in any case. A "generate" button makes an 8-letter code without look-alikes. |
| **Description** | Shown to the buyer under the applied code ("10% off your first order"). |
| **Discount** | `percent` (1–100, with an optional **maximum discount** cap in money), `fixed` (an amount in money), or `free_delivery` (the fee is waived, `value` is 0). |
| **Starts on / Ends on** | Days in the shop's time zone (`shops.timezone`). Both are inclusive. Blank = open ended. |
| **Minimum order** | The items subtotal (before delivery) the cart must reach. |
| **Total uses / Uses per customer** | Blank = unlimited. Counted from `coupon_redemptions` plus the online checkouts that hold the code (see below). "Per customer" is per checkout email, lower-cased. |
| **Applies to** | All products, or specific products *and/or* categories. A line counts when its product is listed **or** is in a listed category. The discount is worked out on those lines only. A code that touches nothing in the cart is refused. Bundles match by the package product. |
| **Only for these customers** | One email per line. The code only works when the checkout email is one of them. |
| **Active** | Off = refused like an unknown code, without deleting the history. |

### The cards

Four cards sit on top of the list.
They add up every code of the shop, not just the page shown:

- **Times used**
- **Total discount given**
- **Sales with a code** (the totals of those orders)
- **Average discount** per use

They come from `CouponRepository.summary` (the prop `summary`).
The cards are hidden while the shop has no codes.

### The list

- The list is newest first.
- A click on the **Used** header sorts it by times used, most first (`?sort=used`). Click again for newest first.
- Each row shows the discount in words, the conditions, the validity, and **used / limit** with the money it took off in total.
- Each row has a status: Active / Scheduled / Expired / Used up / Off.

### The history

The **History** button on a row opens `/coupons/:id` (`Pages/Coupons/Show.vue`).

It shows:

- times used, total discount given, last use
- every order that used the code: date, the order's public code (opens `/orders/:id`), customer + email, order total, the discount

The orders are paged (`CouponRepository.history`).
A voided order's row was deleted, so it is not listed.

### Deleting

Deleting a coupon removes its usage rows.
Orders that used it keep the code as text (`orders.coupon_code`).
This is like `payment_method`, which survives a deleted method.

## At the checkout

**One code per order.** This is on purpose. Combining codes is where surprising totals and abuse come from.

### 1. Apply

The order summary has a **Discount code** box.

**Apply** posts to `POST /checkout/coupon` on the store's host:

- the cart
- the code
- the email and country typed so far

The input is `StoreCouponInput`. The rate bucket is `storeCoupon`: 30 per 10 minutes per IP.

`StoreService.quote`:

1. Prices the cart from the database.
2. Works out the delivery fee for that country.
3. Runs `CouponService.resolve`.

The page gets one of two answers:

- `{quote}`: code, type, value, description, `discount`, and the `delivery_fee` after the code (0 = waived).
- A 422 with `errors.coupon`, shown under the box.

The applied code replaces the box, with a remove button.

It is checked again (debounced) whenever the email, the country or the cart changes.
Any of those can change the answer: a customer-only code, a per-customer limit, a minimum order, the fee.

### 2. Pay / Place order

The page sends the code along (`StoreCheckoutInput.coupon`).

`StoreService.checkout` applies it again from scratch. The page's quote is never trusted.

- When the code no longer works (used up in the meantime, expired at midnight…), the checkout is refused with `errors.coupon`.
- The page drops the code and shows why.

What the code took off is frozen on the cart snapshot:

- `payload.discount`
- `payload.coupon = {id, code, type, value, saved}`
- `payload.delivery_fee`, already waived
- `total = subtotal − discount + delivery_fee`

### The checkout holds the code

From this moment the checkout holds the code.

- The cart row keeps `coupon_id` + `coupon_email`.
- `CouponRepository.usage` counts a cart with no order yet, younger than `COUPON_HOLD_MS` (1 hour), as a use.
- `CouponService.oneAtATime` runs the checkout one at a time per code. It is an in-process lock (`app/helpers/lock.ts`).
  So parallel checkouts cannot all pass a one-time code.
- A card charged later through `POST …/checkout/pay` is refused ("This checkout has expired") in two cases:
  the hold ran out, or the code was switched off, deleted or expired since.

### 3. The gateway

Hosted gateways are told about the discount explicitly: `CheckoutArgs.discount = {label, amount}`.

| Gateway | What it does |
|---|---|
| **Stripe** | Gets a one-off coupon object (`POST /v1/coupons`, `duration: once`), attached to the session as `discounts`. So its page shows the lines *and* "Coupon SAVE10 −$1.00". |
| **PayPal**, **2C2P** | Charge `checkoutTotal(args)` = lines − discount. |
| **Omise**, the manual options | Use the snapshot's `total`. |

### 4. The order

`fulfill` writes the order:

- `discount_type` / `discount_value` / `discount` for a percent or fixed code. This is the way a POS discount is stored.
- `coupon_code`
- `delivery_fee = 0` for a free-delivery code. `discount` stays 0. The pages then print "Delivery · CODE  Free".

Then it records one `coupon_redemptions` row (email + `saved`).
It does this before the cart gets its order.
So the use counts twice for a moment, rather than not at all.

Voiding the order deletes the row. So the use is given back.

## At the POS

### Apply code

**Apply code** in the cart's discount popover posts to `POST /pos/coupon`:

- the lines
- the code
- the attached customer

The input is `CouponQuoteInput`. Every role may use it.

`OrderService.quote`:

1. Prices the cart again.
2. Runs `CouponService.resolve` with `delivery_fee: 0` and the customer's email (`""` for a walk-in).

It answers `{ quote: {code, type, value, description, discount} }`, or 422 `{ errors: { coupon } }`.

In the browser:

- The cart keeps the quote as its discount (`Discount = { type: "coupon", quote }`). It is saved with the cart.
- The code shows where "Discount" was.
- `Pos/Index.vue` asks the server again whenever the lines or the customer change.
- When the code no longer applies, it drops the code with a toast.

### Rules

- **One discount per sale.** A code replaces a manual % or amount, and the other way round. **Remove** clears either.
- `POST /pos/checkout` with `coupon` applies the code again from scratch. The manual `discount_*` fields are ignored.
- It writes `discount_type` / `discount_value` / `discount` from the coupon, plus `coupon_code`.
- It records the `coupon_redemptions` row once the order is in. The email is the customer's, or `""` for a walk-in.
- One sale per code at a time, like the online checkout.
- So per-customer limits and customer-only codes need a customer with an email attached to the sale.
- There is no delivery at the till. A `free_delivery` code is refused: "Delivery is already free for this order".

## The rules, in the order they are checked

`CouponService.resolve` checks them in this order.

| Check | Message |
|---|---|
| Unknown code, or `active = false` | That code isn't valid |
| Today (shop time zone) is before `starts_at` or after `ends_at` | That code isn't valid |
| `emails` is set and the buyer is not proven, whatever email is typed | Sign in with the email address the code was sent to |
| `emails` is set, the buyer is proven, and their email is not one of them | That code isn't valid |
| `usage_limit` reached | That code isn't valid |
| `per_customer_limit` is set and there is no email yet | Enter your email to use that code |
| `per_customer_limit` reached for this buyer | That code isn't valid |
| Items subtotal `< min_subtotal` | That code needs an order of at least $X |
| Nothing in the cart is in scope | That code doesn't apply to anything in your cart |
| Free delivery when the fee is already 0 | Delivery is already free for this order |

Who is "proven":

- Online, only a **signed-in** store customer's email counts. A typed email proves nothing.
- At the POS the cashier's customer always counts.

Every "isn't valid" is the same on purpose.
A different answer would tell a stranger:

- which codes exist
- which emails a customer-only code is for
- which emails used a code already

### The maths

`CouponService.couponDiscount(coupon, eligible, fee)`:

| Type | Result |
|---|---|
| percent | `round(eligible × value / 100)`, capped by `max_discount` |
| fixed | `min(value, eligible)` |
| free delivery | `{discount: 0, delivery_fee: 0}` |

`saved` = the discount + the waived fee.

## Who a code tells what

### Customer-only codes

A customer-only code (`emails`) answers "Sign in…" to every buyer who is not proven.
That is: not signed in, and not at the till. It does not matter which email they typed, or none.

Only a proven email that is not on the list gets "isn't valid".

So the answer never tells who is on the list.

### The per-customer limit

- For a **proven** customer (signed in to the store, or attached by the cashier), the limit counts:
  the orders written to their own customer record, and their own open checkouts
  (`CouponRepository.usage(…, customerId)`, `store_carts.coupon_customer_id`).
- A guest's uses are counted by the typed email.

So a guest who types another person's email does not use up or hold that person's limit.

### No payment after the hold

A payment cannot land after the hold is over (`COUPON_HOLD_MS`, 1 hour). So a usage limit holds.

| Gateway | How |
|---|---|
| Stripe | A checkout that holds a code passes `expires_at` (the end of the hold) to a hosted gateway. Stripe closes its page then. |
| Omise (a card charge) | The checkout asks `stillHeld` first. |
| PayPal | It takes the money only when the buyer comes back. `StoreFulfillService` then calls `getPayment(config, id, { capture: false })` when the hold is over. PayPal does not capture. The buyer reads "The discount code is no longer valid. Nothing was charged. Please check out again." |

## Tests

| File | What it checks |
|---|---|
| `app/services/sales/__tests__/Coupon.Service.test.ts` | The maths, the validator, code uniqueness per shop, every rule above (dates inclusive, email matching, limits + release on void, minimum, product/category scope, cap, free delivery), delete. |
| `app/services/sales/__tests__/Store.Service.test.ts` › coupons | Quote. A bad code stops the checkout. COD with a percent code (order fields, usage counted, per-customer refusal). Free delivery (fee 0, `saved` = the fee). Stripe gets the coupon + `discounts`. Void gives the use back. |
| `e2e/l-store.spec.ts` | The admin adds a code on `/coupons`. The buyer applies it at the checkout, sees the discount and places the order. The code shows on `/orders/:id` and the usage on `/coupons`. |
