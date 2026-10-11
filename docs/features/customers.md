# Customers

The people a shop sells to: their details, their addresses and their purchase history.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/sales.ts` |
| Controller | `app/controllers/Customer.Controller.ts` |
| Service (`phoneErrors`, `addAddress`, `updateAddress`, `removeAddress`) | `app/services/sales/Customer.Service.ts` |
| Repository | `app/repositories/Customer.Repository.ts` |
| Validator (`CustomerInput`, `CustomerAddressInput`) | `app/validators/Customer.Validator.ts` |
| Constants (`CUSTOMER_SORTS`) | `app/constants/Customer.Constant.ts` |
| Model | `app/models/Customer.ts` |
| List page, with the add and edit dialogs | `resources/js/Pages/Customers/Index.vue` |
| Detail page, with the purchase history | `resources/js/Pages/Customers/Show.vue` |
| The picker on the Sell screen | `resources/js/components/pos/CustomerPicker.vue` |

## The model

Customers are per shop.

| Field | Rule |
|---|---|
| `name` | Needed. At most 100 characters. |
| `phone` | Optional. At most 30 characters. **Unique per shop.** |
| `email` | Optional. Checked when present. **Stored lower-case** by `CustomerRepository`. |
| `note` | Optional free text. At most 1000 characters. |

### Phone

- A partial unique index keeps the phone unique per shop.
- `CustomerService.phoneErrors` also asks `phoneOwner` before a save.
- A number that is taken gives: "Phone already used by “X”".

### Email

- Migration 0080 made the old rows lower-case.
- It also added the `(shop_id, email)` index.

### Addresses

A customer has several addresses. They are rows in `customer_addresses`.

These are the same rows a signed-in store customer keeps on their account. The store checkout offers them.

Staff add, change and remove them in the **Addresses** card of the customer page. Every role may do it.

| Route | Does |
|---|---|
| `POST /customers/:id/addresses` | Adds one (`CustomerService.addAddress`) |
| `PUT /customers/:id/addresses/:address` | Changes one (`CustomerService.updateAddress`) |
| `DELETE /customers/:id/addresses/:address` | Removes one (`CustomerService.removeAddress`) |

`CustomerAddressInput` is looser than the store checkout's rules:

- Only the first line (`address_1`) is needed.
- The country is free text.
- An address may carry a `tax_id`. It is optional free text, at most 50 characters. Any country. No format is checked. It is for invoices.
- A change from the store account never sends the `tax_id`. So it is kept.

A customer has at most `ACCOUNT_ADDRESSES_MAX` (10) addresses.

The Tax Invoice extension lets staff pick one of the addresses. It takes the address's tax ID with it.

### Stats

`CustomerWithStats` adds:

- `orders_count`
- `total_spent` = the sum of `total − refunded`
- `last_order_at`

Voided orders are left out of all three.

## Endpoints

Every role may use these (cashier, manager and admin).

### `GET /customers?q=&sort=&dir=&page=`

The list. Newest first by default.

- `q` matches the name, the phone or the email.
- `sort` is one of `CUSTOMER_SORTS`: `name`, `email`, `orders`, `spent`, `last_order`.
- `dir` is `asc` or `desc`.

The column titles are `components/SortButton.vue`:

1. First click: A→Z, or low→high.
2. Second click: the other way.
3. Third click: back to newest first.

A customer with no email, or with no order yet, always goes last.

### `GET /customers/search?q=`

JSON: `{ customers }`.

- Up to 8 customers.
- `q` matches the name or the phone.
- Names that start with `q` come first.
- The Sell screen's picker uses it.
- The route is declared **before** the resource. Else `/customers/:id` would catch it.
- It sits in the `search` rate-limit bucket.

### `GET /customers/:id`

The detail page. It has:

- the customer and their addresses
- their orders, paged (`OrderService.forCustomer`)
- the shop's payment methods, for the badges
- a link to `/orders?customer=<id>`

### `POST /customers`

- From an Inertia form: the browser goes back to the list.
- With `Accept: application/json` and no `X-Inertia` header: the answer is `201 { customer }` or `422 { errors }`.

The JSON answer is the **quick-add** path of `CustomerPicker` ("Add & attach": a name and an optional phone).

### `PUT /customers/:id`

Edits the customer. The browser goes back to their page.

### `DELETE /customers/:id`

1. It sets `orders.customer_id = null`. The order history is kept.
2. It removes the row.
3. It redirects to `/customers`.

## Link to the checkout

- `CartPanel` shows the customer attached to the sale.
- `CustomerPicker` searches as you type. It can create a customer in place.
- The checkout checks that the `customer_id` still exists in this shop.
- Receipts print the customer's name and phone.
