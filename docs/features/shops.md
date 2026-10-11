# Shops (multi-shop)

One account can run several shops. This page covers the shop record, the shop switcher and the tax setting.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/settings.ts` |
| Controller | `app/controllers/Shop.Controller.ts` |
| Service | `app/services/settings/Shop.Service.ts` |
| Repository | `app/repositories/Shop.Repository.ts` |
| Validator (`ShopInput`) | `app/validators/Shop.Validator.ts` |
| Constants (`TIMEZONES = Intl.supportedValuesOf("timeZone")`) | `app/constants/Shop.Constant.ts` |
| The tax rule | `app/helpers/tax.ts` |
| The list page | `resources/js/Pages/Shops/Index.vue` |
| The form page (create and edit) | `resources/js/Pages/Shops/Form.vue` |
| Components | `CurrencySelect.vue` (a combobox built on `Intl`), `TimezoneSelect.vue`, `ShopLogo.vue` |
| The shop switcher | `resources/js/layouts/AppLayout.vue` (shared props `shop` and `shops`) |

### The form page

`Shops/Form.vue` does create and edit on one page. It has:

- a compact logo uploader (through `lib/upload.ts`)
- the name
- the currency and the time zone, side by side
- the Tax / VAT card, with `id="tax"`. This is where the ⌘K entry "Tax settings" lands.

### How to reach `/shops`

`/shops` has no sidebar link.
Admins open it from the switcher's **Manage shops**, or from ⌘K.

## The model

Table `shops`.

### General

| Column | Meaning |
|---|---|
| `name` | The shop's name |
| `currency` | A 3-letter code, kept in upper case |
| `logo` | An upload URL, or null |
| `timezone` | An IANA zone. Default `UTC`. |
| `support_email` | The address order emails tell customers to write to (migration 0032). Empty = the account owner's email. See [email.md](email.md). |

`support_email` is edited on `/online-store` › Banner & contact. It is not in the shop form.

### Delivery

Columns from migrations 0030, 0043 and 0045: `country`, `pickup`, `delivery_zones`, `guided_address`.

They are edited on `/online-store` › Delivery. See [online-store.md](online-store.md) › Delivery.

### Tax

Columns from migration 0041:

| Column | Meaning |
|---|---|
| `tax_rate` | In hundredths of a percent. 750 = 7.5%. 0 = no tax line. At most 10000. |
| `tax_label` | "VAT", "GST" and so on. Default `Tax`. At most 20 characters. |
| `tax_included` | A boolean. true = the prices already hold the tax. |

## Behaviour

### Everything belongs to a shop

- **Every** category, product, order, customer and payment method belongs to one shop.
- Every shop belongs to one account (`shops.owner_id`, migration 0052).
- A user sees only the shops of their own account. See [auth-and-users.md](auth-and-users.md) › Accounts.

### The active shop

The active shop is `sessions.shop_id`.

`POST /shops/:id/switch` changes it:

1. Any signed-in user may call it.
2. The shop must be one of the user's own account. Else the answer is 404.
3. The session gets the new shop.
4. The browser goes to `/pos` as a **whole page load** (`Inertia.away` → 409 + `X-Inertia-Location`, like the browser's refresh).
   So nothing of the old shop stays on screen.

The account's first shop by id is used when:

- the session has no shop
- the session's shop was deleted
- the session's shop belongs to another account

### Currency and time zone

- `shop.currency` drives all `money()` formatting on the frontend.
- `shop.timezone` drives "today" on the Orders stats.
- It also drives the day, week and month buckets in Reports. See `app/helpers/time.ts`.
- Database timestamps stay UTC.

### Admin pages at `/shops`

`/shops` is a `resource`, for admins only.

- `/shops/create` and `/shops/:id/edit` are pages.
- `store` and `update` redirect to the list.
- Errors show the form again.

**Create**

- It also gives the shop the default payment methods (Cash, Card, Other) through `PaymentMethodRepository.seedDefaults`.
- It asks `PlanLimitService.shopError` first. In the open-source app that never refuses. An add-on may put its own rules there.
- The platform admin may fill **Owner email**. Then the shop is made for a new person, with an invitation. See [auth-and-users.md](auth-and-users.md) › Accounts.

**Delete**

Delete is refused for:

| Case | Message |
|---|---|
| The account's **last shop** | "You need at least one shop" |
| A shop that **still has products** | "Delete or move this shop's products first" |

The message comes back as `errors.shop`.

A deleted shop's own email setup is forgotten too (`MailService.forget`).

### Delivery is not in the shop form

- The country, the shipping zones, pick-up and the address lists live on `/online-store` › Delivery (`PUT /online-store/delivery`, `StoreDeliveryInput`).
- The rules are in [online-store.md](online-store.md) › Delivery.
- `ShopRepository.create` leaves them at the column defaults. That is one rest-of-world zone at price 0.
- `ShopService.update` never touches them.
- The POS never charges delivery.

### Tax / VAT

The form fields are `ShopInput.tax_rate`, `tax_label` and `tax_included`.
The rate is typed as a percent and sent ×100.

`taxAmount(base, shop)` in `app/helpers/tax.ts` is the single rule. These use it:

- the POS checkout
- the online checkout
- the POS cart and the store checkout page, for the live totals

What the tax is worked out on:

- The base is the goods after the discount.
- Delivery is never taxed.

The two modes:

| Mode | `tax_included` | What happens |
|---|---|---|
| **Added** | `false` | `total = subtotal − discount + tax (+ delivery)`. A hosted gateway gets the tax as its own line, so it charges it. |
| **Included** | `true` | The tax is backed out of the price: `base − base / (1 + rate)`. It shows as "Incl. VAT 7%". The total does not change. |

Other rules:

- Every order freezes the amount, the rate, the label and the mode.
  So a later change to the shop leaves old receipts alone. See [orders.md](orders.md).
- Reports subtract the collected tax from profit. See [reports.md](reports.md).

### First boot

When `shops` is empty, the seed makes "Main Shop":

- currency USD
- the server's time zone
- owned by the `ADMIN_EMAIL` admin
