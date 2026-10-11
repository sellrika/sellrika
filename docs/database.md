# Database

The database engines, the rules for migrations and queries, and every table.

## Where the code is

| What | Where |
|---|---|
| The connection and the helpers (`sql`, `dialect`, `ID_PK`, `Db`) | `app/xcore/database/Database.ts` |
| The connection settings | `config/database.ts` |
| The MySQL translator for migrations | `app/xcore/database/MysqlDdl.ts` |
| The migrations | `database/migrations/000N_*.ts` |
| The migration registry | `database/migrations/index.ts` |
| The migration runner | `database/migrate.ts` |
| The first-boot seed | `database/seed.ts` |

## Engines

The app uses `Bun.sql`.

| `DB_CONNECTION` | Engine |
|---|---|
| `sqlite` (default) | SQLite |
| `postgres` | Postgres |
| `mysql` | MySQL 8 or MariaDB |

## Migrations

- The schema lives in `database/migrations/000N_*.ts`.
- Each file is registered in `database/migrations/index.ts`. The registry is static, so the migrations bundle into the binary.
- `database/migrate.ts` applies the pending versions, in order of the file name prefix.
- Each migration runs in its own transaction.
- Each applied version is recorded in `migrations(version, applied_at)`.
- Up only. There is no rollback.

### Rules for a new migration

- Create it with `bun run make:migration <name>`. This adds the file and the registry line.
- The DDL must run on all three engines.
  - Use `${ID_PK}` for ids.
  - Use `text`, `integer`, `timestamp`, `boolean` and `current_timestamp`.
  - Write one column per line.
- Money is `integer` cents.
- JSON is `text`.
- Partial unique indexes (`… where col is not null`) work on all three.

## MySQL

The SQL is written once, for SQLite and Postgres.
MySQL reads some of it differently. Two places hide that.

### Migrations on MySQL

On MySQL the runner hands every migration a connection whose `unsafe()` goes through `MysqlDdl`.
(`migrationDb()` in `database/migrate.ts` does this.)

It changes:

| Written | On MySQL | Why |
|---|---|---|
| `text` | `longtext` | MySQL's `text` holds only 64 KB. |
| `text` with `primary key` or `unique` | `varchar(191)` | A key needs a length. |
| `text … default 'x'` | `default ('x')` | A default on text must be in brackets (MySQL 8.0.13+). |
| `timestamp` | `datetime` | `timestamp` ends in 2038. |
| `references t(id)` on a column | left out | MySQL ignores it, MariaDB would enforce it. Both now act the same. |
| `key`, `change` | in backticks | Reserved words. |
| `create index … (text column)` | `(column(191))` | Looked up in `information_schema`. |
| `create index if not exists` | checked first | MySQL has no such clause. |
| `… where col is not null` on an index | left out | MySQL allows many nulls in a unique index. |
| `create table` | `+ charset utf8mb4, collate utf8mb4_bin` | Text compares byte by byte, like Postgres. |

MySQL commits after every DDL statement.
So a migration that fails half way is not rolled back there.

### Queries on MySQL

MySQL has no `returning` and no `on conflict`.
Use the `Db` helpers. They work on every engine.

| Helper | Instead of |
|---|---|
| `Db.insert(db, table, query, cols?)` | `insert … returning` (one row, a table with an `id`) |
| `Db.update(db, table, set, where, cols?)` | `update … returning` (one row). An empty list = no row matched. |
| `Db.delete(db, table, where)` | `delete … returning id`. True = a row was deleted. |
| `Db.upsert(db, table, rows, keys, update?)` | `on conflict (keys) do update` / `do nothing` |
| `Db.insertOnce(db, table, row, keys)` | `on conflict do nothing returning id` |

### More rules that only MySQL enforces

- In an `update`, assignments run left to right and see the new values.
  Read a column before the assignment that changes it.
  Example: `payment_status = case when paid …` comes before `paid = paid + …`.
- An `update` or `delete` may not read its own table in a plain subquery.
  Wrap it: `(select … from (select … from t) x)`.
  Better: two statements, like `EmailQueueRepository.take`. That also avoids a deadlock.
- `key` and `change` are reserved. Write `${sql("key")}`.
- A reserved alias is quoted: `as "by"`, `as "rows"`.
- A date comes back as a `Date`, as on Postgres. Use `dbDate()`.
- A `sum()` comes back as text. Use `Number()`.
- Bun sets the session time zone to UTC. So `current_timestamp` is UTC.

## Postgres

Rules that only Postgres enforces:

- A `count()` or a `sum()` comes back as text. Wrap it in `Number()` before it leaves the repository.
- `select distinct x … order by <another expression>` is refused.
  Use `group by x order by min(<expression>), x`. See `PostalCodeRepository.#suggest`.
- Foreign keys are checked at once. Delete the child rows first. See `CampaignRepository.#drop`.
  SQLite and MySQL do not check them.
- The connection's time zone is set to UTC in `config/database.ts`.
  Without it, `current_timestamp` follows the server's time zone, and a `timestamp` column would hold local time.

## Tables: global

These tables have no `shop_id`, or belong to an account or the whole platform.

### `users`

Owners and staff.

| Column | Meaning |
|---|---|
| `id`, `name` | |
| `email` | Unique |
| `password_hash` | |
| `role` | `admin`, `manager` or `cashier`. Default `admin`. |
| `active` | Boolean |
| `owner_id` | The owner a staff member works for. Null = an owner. Migration 0052. |
| `email_verified_at` | Null = an owner who signed up by themselves and has not opened the confirmation link yet. The app then shows only "Confirm your email". Migration 0057. |
| `campaign_email_limit` | An owner's monthly campaign email limit through the platform's email. Null = the default. Migration 0066. |
| `firebase_uid` | Unique. The Firebase user id of the Google or Microsoft sign-in account the user signed up with, when its provider did not prove the email. That account signs in by it. It is never on a `User` object. Migration 0087. |
| `created_at` | |

### `user_invites`

One-time link tokens (migration 0053). They are used for:

- invitations to new shop owners
- sign-up email confirmations
- "forgot password" links

Columns: `id`, `user_id`, `token_hash` (SHA-256 of the link's token, unique), `expires_at`, `created_at`.

Accepting a link deletes the row.

### `sessions`

| Column | Meaning |
|---|---|
| `id` | A random token. It is the cookie value. |
| `user_id` | |
| `shop_id` | The active shop. Nullable. |
| `expires_at` | |

### `passkeys`

A staff user's passkeys. One row per device or password manager.
Migration 0071. See [features/auth-and-users.md](features/auth-and-users.md) › Passkeys.

| Column | Meaning |
|---|---|
| `id`, `user_id` | |
| `credential_id` | The passkey's own id, base64url. Unique. |
| `public_key` | SPKI DER as base64url |
| `name` | `''` = none |
| `sign_count` | The device's use counter. 0 for passkeys that sync. |
| `last_used_at`, `created_at` | |

The rows are deleted with the user.

### `settings`

Platform-level and account-level key/value settings. It has no `shop_id`.

Columns: `key` (primary key), `value` (JSON text).

| Key | Value |
|---|---|
| `mail` | The platform's email setup: `{driver, from_email, credentials: {driver: {field: value}}}`. `from_email` is the one sender address. An older row's `from_domain` still reads. Secret fields are AES-256-GCM encrypted with `APP_KEY`. See [features/email.md](features/email.md). |
| `mail:shop:<id>` | A shop's own email setup. Same shape. |
| `signup` | The self sign-up switch |
| `postal_codes` | The outcome of the GeoNames download. See [features/online-store.md](features/online-store.md) › Delivery. |
| `exchange_rates` | The last fetched rate table: `{base, rates, fetched_at, tried_at, error}`. See [features/online-store.md](features/online-store.md) › Currencies. |
| `exchange_rates_schedule` | How often the rates are fetched |
| `slug_renames:<owner id>` | An account's store address changes |
| `reminders:<owner id>:<YYYY-MM>` | The count of an account's abandoned-cart emails in one month |

### `postal_codes`

GeoNames cities and postal codes. One list for every shop. Migration 0044.

Columns: `id`, `country`, `postal_code`, `place`, `admin1`, `admin2`.

Indexes: `(country, place)`, `(country, postal_code)`, `(country, admin1, place)`.

### `platform_extensions`

The platform admin's "Enabled for all shops" switch, per extension key.
Migration 0055. See [features/extensions.md](features/extensions.md).

| Column | Meaning |
|---|---|
| `id` | |
| `key` | The manifest key. Unique. |
| `enabled` | Default false |
| `users` | A JSON list of the owner user ids who may use it. Default `[]` = every user. Migration 0056. |
| `created_at` | |

No row = off.

### `subscriptions`

Migration 0065 makes this table.
The open-source app never reads or writes it. It is there for an add-on.

### `migrations`

Bookkeeping: `version`, `applied_at`.

## Tables: shops and their staff

### `shops`

The basics:

| Column | Meaning |
|---|---|
| `id`, `name`, `created_at` | |
| `owner_id` | The account that owns it. Migration 0052. |
| `currency` | 3 letters. Default `USD`. |
| `logo` | An upload URL, or null |
| `timezone` | IANA name. Default `UTC`. |
| `support_email` | Shown on order emails. Null = the owner's account email. |
| `country` | A country NAME, or null. It is where the shop is. |

Tax:

| Column | Meaning |
|---|---|
| `tax_rate` | Hundredths of a percent. Default 0. |
| `tax_label` | Default `Tax` |
| `tax_included` | Boolean. Default false. |

Delivery:

| Column | Meaning |
|---|---|
| `pickup` | Boolean. The buyer may collect in store. Migration 0043. |
| `delivery_zones` | JSON text `[{name, countries, states, cities, fee, free_delivery_min}]`. The shipping zones. Migration 0045. The default is one rest-of-world zone at 0. |
| `guided_address` | Boolean. Default true. State → City lists at the checkout. |

The online store (see [features/online-store.md](features/online-store.md)):

| Column | Meaning |
|---|---|
| `slug` | Unique. The store's subdomain `<slug>.<STORE_DOMAIN>`. Never a `RESERVED_SLUGS` name. |
| `online_enabled` | Boolean |
| `online_template` | The template key. Default `classic`. |
| `domain` | A custom hostname, unique, or null |
| `domain_status` | `''` = none, `pending` = waiting for DNS, `live` = routed with SSL. `DomainService` sets it. Migration 0067. |
| `google_site_verification` | The Search Console HTML-tag token, or null. Printed as a `<meta>` on every store page. |
| `payment_credentials` | JSON text `{option: {field: value}}`. It holds the fields of the manual payment options. Secret ones are AES-256-GCM encrypted with `APP_KEY`. The online providers are extensions since migration 0050. Their keys live in `shop_extensions.config`. |
| `manual_gateways` | A comma list of the manual options that are on: `cod`, `bank_transfer` |
| `languages` | A comma list of the locales the store offers. The first is the default. Default `en,de`. Migration 0060. |
| `currencies` | JSON text `[{code, rate}]`. The extra currencies the store shows prices in. Display only. `rate` = the shop's own rate per 1 of its currency. Null = automatic. Default `[]`. Migration 0063. |
| `theme_config` | JSON text `{ <template>: { primary, secondary, background, text, muted, surface, surface_text, footer, footer_text, font } }`. The shop's own colours (`#rrggbb`) and font (a key of `STORE_FONTS`) per built-in template. `''` = none. Migration 0085. |
| `fulfillment_steps` | JSON text `[{key, label, color}]`. The delivery steps of its online orders, in order. `''` = the built-in new → packing → shipped → delivered. Migration 0064. |
| `customer_logins` | A comma list of the sign-in providers that are on for store customers. `''` = off. Migration 0046. |
| `firebase_config` | The shop's Firebase web config, as JSON, or null. Migration 0046. |

New-order alerts and analytics (migration 0037):

| Column | Meaning |
|---|---|
| `alert_email` | Null = off |
| `telegram_bot_token` | AES-256-GCM encrypted with `APP_KEY`. Kept out of the model, like `payment_credentials`. |
| `telegram_chat_id` | Null = off |
| `ga_id` | GA4 `G-…`, or null. Loaded on every store page. |
| `meta_pixel_id` | Digits, or null. Loaded on every store page. |

Storefront content (migration 0038). All are text. Null = not shown.

| Column | Meaning |
|---|---|
| `banner` | The announcement strip over the header |
| `banner_type` | Its tone: `info`, `success`, `warning` or `danger`. Default `info`. Migration 0039. |
| `phone`, `address`, `hours` | The footer contact block |
| `facebook`, `instagram` | https URLs |
| `viber`, `whatsapp` | Phone digits with the country code. They become chat links. |

Marketing (migration 0061):

| Column | Meaning |
|---|---|
| `abandoned_cart` | Boolean. Default false. The abandoned-cart email switch. |
| `abandoned_cart_hours` | The delay. Default 4. |

The daily report (migration 0084):

| Column | Meaning |
|---|---|
| `report_enabled` | Boolean. Default false. |
| `report_time` | `HH:MM` on the shop's clock. Default `22:00`. |
| `report_channels` | A comma list of `slack`, `discord`, `line` |
| `report_sent_on` | The shop's day of the last report. `''` = never. |

### `sales_staff`

The people named on a sale. They have no login. Per shop.
Migration 0072. See [features/auth-and-users.md](features/auth-and-users.md) › Sales staff.

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `name`, `created_at` | |
| `commission` | Hundredths of a percent, 0..10000 |
| `active` | Boolean. Off = not offered at the POS. |

- `orders.sales_staff_id` names one. It is nullable, and set to null when the sales person is deleted.
- The commission due is not stored.

### `sales_commissions`

The commission payments. One row per payment. Migration 0072.

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `sales_staff_id` | |
| `amount` | Cents paid |
| `sales` | Cents sold in the paid period |
| `orders` | How many sales |
| `commission` | The rate it was paid at, in hundredths of a percent |
| `created_at` | When it was paid |

- The newest row of a sales person is their last payment. Only later orders count for the next commission.
- The rows are deleted with the sales person.

### `api_keys`

The keys programs call `/api/v1` with. Per shop.
Migration 0073. See [features/api.md](features/api.md).

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `name`, `created_at` | |
| `user_id` | The admin who made it. The key acts as them. |
| `role` | `admin`, `manager` or `cashier`. The most the key may do. |
| `key_hash` | SHA-256 of the key. Unique. The key itself is never stored. |
| `last4` | Its last 4 characters, for the list |
| `last_used_at` | Written at most once a minute |

The rows are deleted with the shop, and with the user who made them.

### `shop_extensions`

An extension a shop installed.
Migration 0047. See [features/extensions.md](features/extensions.md).

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `created_at` | |
| `key` | The manifest key |
| `enabled` | Boolean |
| `config` | JSON `{field: value}`. Secret fields are encrypted with `APP_KEY`. |

Unique `(shop_id, key)`. Deleted with the shop.

### `extension_data`

Small values an extension keeps for a shop (`ctx.data`).
Migration 0075. See [features/extensions.md](features/extensions.md).

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `updated_at` | |
| `ext_key` | The manifest key |
| `name` | The extension's own name for the value |
| `value` | JSON text |

Unique `(shop_id, ext_key, name)`. Deleted with the shop.

The Restaurant extension keeps these here:

| Name | Value |
|---|---|
| `tables` | Its table names |
| `qr:<table>` | `{token, made_at}` |
| `kitchen:<order id>` | `{<order line id>: {step, at, qty, name, note}}`. Deleted once the order is paid or voided. |
| `kitchen:cancelled` | Cancelled dishes, until acknowledged |
| `kitchen:skip` | Product ids that skip the kitchen |

### `extension_rows`

Lists an extension keeps for a shop, one row per record (`ctx.data.collection(name)`).
Migration 0083. See [features/extensions.md](features/extensions.md).

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `created_at`, `updated_at` | |
| `ext_key` | The manifest key |
| `collection` | The extension's name for the list |
| `ref` | One lookup key the extension picks. `''` = none. |
| `value` | JSON text |

Index `(shop_id, ext_key, collection, ref, id)`. Deleted with the shop.

## Tables: catalog

### `categories`

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `name`, `position` | |
| `color` | `#rrggbb`, or null |
| `image` | An `/uploads/<shop id>/categories/…` picture. Null = none. Migration 0086. |

### `products`

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `name`, `description`, `created_at` | |
| `slug` | The URL slug of the storefront product page. Unique per shop. Derived from the name on every write. |
| `sku` | The merchant's code, or null. No uniqueness check. |
| `unit` | The sale unit, as text, or null |
| `amount` | How much one sale unit holds, as a number (50 for "50 g"). The unit is `unit`. Null = none. Migration 0048. |
| `price` | Cents |
| `purchase_price` | Cents, or null. It is the cost. |
| `original_price` | Cents, or null. The "was" price. Display only. |
| `images` | A JSON text array of `/uploads/...` paths. The first is the cover. |
| `barcode` | Unique per shop when not null. Only used when the product has no variants. |
| `track_stock` | Boolean |
| `stock` | On hand, when there are no variants |
| `low_stock_at` | The alert threshold |
| `featured` | Boolean. Pinned to the front of every product list. |
| `active` | Boolean. Default true. False hides the product from the POS and the online store. Migration 0051. |
| `extra` | The "Additional data" rows, JSON text `[{title, value}]`. Default `[]`. Migration 0049. |
| `custom_request` | Boolean. The online store asks the buyer for a note. Migration 0070. |
| `custom_request_label` | The question. `''` = "Your request". |
| `kind` | `item` or `bundle`. Default `item`. |
| `updated_at` | Bumped on every product-form save. Lists order by it. |

A `bundle` row is a **package**:

- Its recipe is in `bundle_items`.
- It always stores `track_stock = false`, `stock = 0` and `purchase_price = null`.
- It has no variants.
- Its availability and cost are computed from the components on read.

### `product_categories`

`(product_id, category_id)` is the primary key.

### `product_variants`

| Column | Meaning |
|---|---|
| `id`, `product_id`, `name`, `position` | |
| `sku` | Or null |
| `price` | Cents |
| `purchase_price` | Null = falls back to the product's cost |
| `attributes` | JSON text `{group: value}`, or null |
| `barcode`, `images` (JSON), `stock` | |

### `bundle_items`

One *slot* of a package.

| Column | Meaning |
|---|---|
| `id` | |
| `bundle_id` | The `bundle` product |
| `product_id` | The component |
| `variant_ids` | JSON text `number[]` of the allowed variants. Null when the component has no variants. 2 or more ids = the customer picks one at sale time. |
| `qty` | Units per package |

- The rows are replaced as a whole on every save of the package.
- They are deleted with the package.
- The table is not shop-scoped. Both sides are products of the same shop already.

### `stock_movements`

The stock ledger.

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `product_id`, `created_at` | |
| `variant_id` | Null = product level |
| `type` | `sale`, `refund`, `void` or `adjustment` |
| `qty` | Signed: + in, − out |
| `reason` | |
| `order_id`, `user_id` | Nullable |

## Tables: sales

### `payment_methods`

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `name`, `color`, `position`, `created_at` | |
| `icon` | A lucide export name. See `app/constants/PaymentMethod.Constant.ts`. |
| `image` | An `/uploads/<shop id>/payments/…` picture for the customer's screen. Null = none. Migration 0076. |
| `extension` | The key of the extension that added it. Null = the shop's own. Migration 0077. |
| `tendered` | Boolean. Ask for the cash amount and show the change. |
| `enabled` | Boolean. Offered at checkout. |

Each shop is seeded with Cash, Card and Other.

### `customers`

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `name`, `email`, `note`, `created_at`, `updated_at` | |
| `phone` | Unique per shop when not null |
| `firebase_uid` | The Firebase user behind a store account. Nullable. |

### `customer_addresses`

The addresses of a customer. Migration 0046.

Columns: `id`, `customer_id`, `shop_id`, `label`, `phone`, `address_1`, `address_2`, `city`, `state`, `country`, `postal_code`, `tax_id`, `created_at`.

- `tax_id` is free text for invoices. `''` = none. Migration 0079.
- A customer keeps up to `ACCOUNT_ADDRESSES_MAX` = 10.
- The oldest comes first. It is the checkout's default.

### `customer_sessions`

A store customer's sign-in. Migration 0046.

| Column | Meaning |
|---|---|
| `id` | A random token. It is the `csid` cookie value. |
| `customer_id` | |
| `shop_id` | The store it was made on |
| `expires_at` | |

### `orders`

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `created_at` | |
| `reference` | The public order code, like `P8J4-MJSQ-4Z8T`. Unique and random. It is what the buyer sees. Null only if migration 0036 could not reach the row. |
| `user_id` | The cashier |
| `customer_id` | Nullable. Set to null when the customer is deleted. |
| `sales_staff_id` | Nullable. Migration 0072. |
| `status` | `completed`, `partially_refunded`, `refunded` or `voided` |
| `subtotal` | Cents |
| `discount_type` | `percent`, `fixed` or null |
| `discount_value` | A percent 0..100, or cents |
| `discount` | Cents, computed by the server |
| `coupon_code` | The discount code that was used, as text. It survives a deleted coupon. Null = none. |
| `delivery_fee` | Cents. Default 0. Online store only. |
| `tax` | Cents, on `subtotal − discount`. Default 0. |
| `tax_rate`, `tax_label`, `tax_included` | The shop's tax settings, frozen at sale time |
| `total` | `subtotal − discount + (tax unless tax_included) + delivery_fee` |
| `paid`, `change` | Cents |
| `refunded` | The cached sum of `refunds.amount` |
| `payment_method` | The method NAME, as text |
| `payment_status` | `paid`, `partial` or `unpaid`. `paid` (the column) = the cents received so far. Manual online orders start unpaid. |
| `fulfillment` | `''` for POS sales. For online orders: a key of the shop's `fulfillment_steps`. Built in: `new`, `packing`, `shipped`, `delivered`. |
| `tracking` | Free text |
| `note` | Free text. The online store writes the delivery details here. |
| `voided_at`, `voided_by` (user id), `void_reason` | |

### `order_items`

| Column | Meaning |
|---|---|
| `id`, `order_id`, `qty` | |
| `product_id`, `variant_id` | Nullable |
| `name` | A snapshot: "Product — Variant", or "Package (Red)" for a package |
| `price` | The unit price, a snapshot |
| `cost` | The unit cost, a snapshot, or null |
| `refunded_qty` | Cached |
| `components` | JSON text `[{product_id, variant_id, qty}]`, or null. It is what one sold package took off the shelves. `qty` is per ONE package, so multiply by the line's `qty`. |
| `image` | The order's own shrunk copy of the line's picture: `/uploads/<shop id>/orders/<uuid>.<ext>`. Older rows: `/uploads/order-<uuid>.<ext>`. Null = none, or the copy failed. Migrations 0058 and 0059. |
| `note` | Text. `''` = none. The buyer's custom request, or the note a cashier put on the line. Migration 0070. |

### `refunds`

Columns: `id`, `order_id`, `shop_id`, `user_id`, `amount` (cents), `reason`, `restock` (boolean), `created_at`.

### `refund_items`

Columns: `id`, `refund_id`, `order_item_id`, `qty` (the units returned per line).

### `order_history`

What changed on an order after it was made.
Migration 0074. See [features/orders.md](features/orders.md) › Open orders.

| Column | Meaning |
|---|---|
| `id`, `order_id`, `shop_id`, `created_at` | |
| `user_id` | Who did it. Nullable. |
| `type` | `items_added` or `items_removed` |
| `data` | JSON text `{ changed, before, after }` |

In `data`:

- `changed` = the lines added, or the units removed.
- `before` and `after` = the order at that moment: its lines `[{name, qty, price}]` and its `subtotal`, `discount`, `tax`, `total`.

Index `order_history(order_id)`.

### `coupons`

A discount code. Migration 0040.

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `description`, `active`, `created_at`, `updated_at` | |
| `code` | Upper-case. Unique per shop. |
| `type` | `percent`, `fixed` or `free_delivery` |
| `value` | A whole percent, or cents. 0 for free delivery. |
| `min_subtotal` | The cents the items must reach. 0 = none. |
| `max_discount` | A cents cap for a percent code, or null |
| `starts_at`, `ends_at` | `YYYY-MM-DD` in the shop's time zone, inclusive. Or null. |
| `usage_limit`, `per_customer_limit` | Null = unlimited |
| `product_ids`, `category_ids` | JSON `number[]`. `[]` = every product. |
| `emails` | JSON `string[]`, lower-cased. `[]` = anyone. |

### `coupon_redemptions`

One row per order that used a code.

| Column | Meaning |
|---|---|
| `id`, `coupon_id`, `shop_id`, `order_id`, `created_at` | |
| `email` | The buyer's, lower-cased |
| `amount` | The cents the code took off. The waived delivery is included. |

- Usage counts are counts of these rows.
- A voided order's row is deleted.
- A deleted coupon takes its rows with it.

## Tables: online store and marketing

### `store_pages`

Custom storefront pages.

Columns: `id`, `shop_id`, `slug` (unique per shop), `title`, `body`, `css`, `created_at`, `updated_at`.

`body` is HTML. `app/helpers/html.ts` sanitises it on save.

### `store_carts`

A priced cart, snapshotted while the customer pays on the gateway.

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `created_at` | |
| `payload` | JSON text |
| `stripe_session_id` | |
| `order_id` | Null = open. 0 = fulfilment in progress (claimed). Else the created order. |
| `checks` | How many times the gateway has been asked |
| `next_check_at` | When to ask again. Null = at the next sweep. |
| `reminded_at` | The abandoned-cart email was claimed. Migration 0061. |
| `restore_token` | The key of its "Complete your order" link. Migration 0061. |
| `coupon_id` | The discount code this checkout holds. Null = none. Migration 0062. |
| `coupon_email` | The buyer's email, lower-cased, for the per-customer limit. Migration 0062. |
| `coupon_customer_id` | The signed-in customer who holds the code. Null = a guest. Migration 0082. |

- `checks` and `next_check_at` drive the reconcile sweep.
- Rows without an order are purged after 7 days (`STORE_CART_TTL_MS`).
- The reconcile sweep only asks the gateway about carts younger than a day (`STORE_RECONCILE_WINDOW_MS`).
- A code is held while the cart has no order and is younger than `COUPON_HOLD_MS`.

### `campaigns`

An email campaign. Migration 0061. See [features/marketing.md](features/marketing.md).

| Column | Meaning |
|---|---|
| `id`, `shop_id`, `subject`, `created_by`, `created_at`, `updated_at` | |
| `body` | HTML, sanitised on save |
| `product_ids`, `customer_ids` | JSON `number[]` |
| `status` | `draft`, `scheduled`, `sending` or `sent` |
| `send_at` | UTC. Null = a draft. |
| `sent`, `failed` | Counts, set when it finishes |

### `campaign_sends`

One row per recipient. It is written **before** the email goes out.

| Column | Meaning |
|---|---|
| `id`, `campaign_id`, `customer_id`, `email`, `created_at` | |
| `sent_at` | Null = failed, skipped, or cut off by a crash |
| `error` | |
| `platform` | Boolean. It went through the platform's email, so it counts toward the monthly limit. Migration 0066. |

Unique `(campaign_id, customer_id)`. So nobody gets a campaign twice.

### `email_queue`

Emails waiting for a worker.
They are kept in the database, so a restart loses none.
Migration 0069. See [features/marketing.md](features/marketing.md).

| Column | Meaning |
|---|---|
| `id`, `to_email`, `taken_at`, `created_at` | |
| `kind` | `campaign` |
| `group_id` | The batch: the campaign |
| `ref_id` | The `campaign_sends` row |
| `status` | `queued` or `sending` |

- Unique `(kind, ref_id)`. Index `(kind, group_id, status)`.
- A row is deleted when its email is done. The result stays on `campaign_sends`.

### `email_unsubscribes`

Who said "no more marketing emails" to a shop.

Columns: `id`, `shop_id`, `email` (lower case), `created_at`. Unique `(shop_id, email)`.

It is used for campaigns and the abandoned-cart email. Order emails ignore it.

## Indexes worth knowing

| Table | Indexes |
|---|---|
| `categories` | `(shop_id)` |
| `products` | `(shop_id)`, unique `(shop_id, barcode) where barcode is not null`, unique `(shop_id, slug)` |
| `product_variants` | `(product_id)` |
| `bundle_items` | `(bundle_id)` |
| `orders` | `(shop_id)`, `(shop_id, created_at)`, `(customer_id)`, `(sales_staff_id)`, unique `(reference)` |
| `order_items` | `(order_id)`, `(product_id)` |
| `order_history` | `(order_id)` |
| `refunds` | `(order_id)`, `(shop_id, created_at)` |
| `refund_items` | `(refund_id)` |
| `customers` | `(shop_id)`, `(shop_id, email)`, `(shop_id, firebase_uid)`, unique `(shop_id, phone) where phone is not null` |
| `customer_addresses` | `(customer_id)` |
| `stock_movements` | `(product_id, variant_id, id)`, `(shop_id, created_at)`, `(order_id)` |
| `shops` | unique `(slug)`, unique `(domain)` |
| `store_pages` | unique `(shop_id, slug)` |
| `store_carts` | `(stripe_session_id)`, `(coupon_id)`, `(shop_id, created_at)`, `(created_at)`, unique `(restore_token)` |
| `coupons` | unique `(shop_id, code)` |
| `coupon_redemptions` | `(coupon_id)`, `(order_id)`, `(shop_id)` |
| `campaigns` | `(shop_id)` |
| `campaign_sends` | unique `(campaign_id, customer_id)` |
| `email_queue` | unique `(kind, ref_id)`, `(kind, group_id, status)` |
| `email_unsubscribes` | unique `(shop_id, email)` |
| `api_keys` | unique `(key_hash)`, `(shop_id)` |
| `passkeys` | unique `(credential_id)`, `(user_id)` |
| `user_invites` | unique `(token_hash)` |
| `users` | unique `(firebase_uid)` |
| `sales_staff` | `(shop_id)` |
| `sales_commissions` | `(sales_staff_id)` |
| `shop_extensions` | unique `(shop_id, key)` |
| `extension_data` | unique `(shop_id, ext_key, name)` |
| `extension_rows` | `(shop_id, ext_key, collection, ref, id)` |

## Migration history

What each version added. There is no 0054.

| # | Adds |
|---|---|
| 0001_init | `users`, `sessions`, `shops`, `categories`, `products`, `product_categories`, `product_variants`, `orders`, `order_items` |
| 0002 | `product_variants.attributes` |
| 0003 | `shops.logo` |
| 0004 | `categories.color` |
| 0005 / 0006 | `products.barcode` (+ unique index) / `product_variants.barcode` |
| 0007 | `products.images`, `product_variants.images` (drops `products.image`) |
| 0008 | The `payment_methods` table. It seeds Cash, Card and Other, and maps the old lowercase order values. |
| 0009 / 0010 | `products.purchase_price` / `product_variants.purchase_price` |
| 0011 | `payment_methods.enabled` |
| 0012 | `users.role`, `users.active` |
| 0013 | `shops.timezone` |
| 0014 | The `customers` table, `orders.customer_id` |
| 0015 | `orders.subtotal/discount_type/discount_value/discount`, `order_items.cost` |
| 0016 | `orders.status/refunded/voided_*`, `order_items.refunded_qty`, `refunds`, `refund_items` |
| 0017 | `products.track_stock/stock/low_stock_at`, `product_variants.stock`, `stock_movements` |
| 0018 | The online store: `shops.slug` (+ unique index, backfilled), `online_enabled`, `online_template`, `stripe_*_key`, the `store_carts` table |
| 0019 | `products.unit` |
| 0020 | `shops.payment_gateway`, `shops.payment_credentials` (replaces the `stripe_*_key` columns) |
| 0021 | `products.sku`, `product_variants.sku` |
| 0022 | `shops.store_terms/store_privacy` (dropped again by 0023) |
| 0023 | The `store_pages` table (+ unique index `(shop_id, slug)`). The old terms and privacy text moved into pages. |
| 0024 | `shops.domain` |
| 0025 | `products.featured`, `products.updated_at` (backfilled from `created_at`) |
| 0026 | `products.original_price` |
| 0027 | `products.kind`, the `bundle_items` table (+ index), `order_items.components` |
| 0028 | `products.slug` (+ unique index `(shop_id, slug)`, backfilled from the name) |
| 0029 | `orders.note`. A free-text note. The online store writes the delivery details. |
| 0030 | Delivery pricing: `shops.country/delivery_fee/delivery_fee_abroad`, `orders.delivery_fee` |
| 0031 | The `settings` table (key/value; key `mail`) |
| 0032 | `shops.support_email` |
| 0033 | `store_carts.checks`, `store_carts.next_check_at` (the reconcile back-off) |
| 0034 | `shops.google_site_verification` |
| 0035 | `orders.payment_status/fulfillment/tracking`, `shops.manual_gateways`. Existing online orders were backfilled to `fulfillment = 'new'`. |
| 0036 | `orders.reference` (+ unique index), backfilled for every existing order |
| 0037 | `shops.alert_email/telegram_bot_token/telegram_chat_id` (new-order alerts), `shops.ga_id/meta_pixel_id` (analytics) |
| 0038 | `shops.banner`, `shops.phone/address/hours/facebook/instagram/viber/whatsapp` (the storefront contact block) |
| 0039 | `shops.banner_type` |
| 0040 | The `coupons` and `coupon_redemptions` tables, `orders.coupon_code` |
| 0041 | The tax / VAT line: `shops.tax_rate/tax_label/tax_included`, `orders.tax/tax_rate/tax_included` |
| 0042 | `orders.tax_label`. It is its own migration because 0041 had already run on a dev database without it. |
| 0043 | Delivery options: `shops.pickup` (boolean), `shops.free_delivery_min` (cents or null), `shops.delivery_rates` (JSON `[{city, fee}]`) |
| 0044 | `postal_codes` (GeoNames cities and postal codes). The settings key `postal_codes` holds the download outcome. |
| 0045 | Shipping zones: `shops.delivery_zones`. It carries over the 0030 / 0043 prices, which are dropped: `delivery_fee`, `delivery_fee_abroad`, `free_delivery_min`, `delivery_rates`. Also `shops.guided_address`. |
| 0046 | `shops.customer_logins`, `shops.firebase_config`, `customers.firebase_uid`, the `customer_addresses` table, the `customer_sessions` table |
| 0047 | The `shop_extensions` table |
| 0048 | `products.amount` |
| 0049 | `products.extra` |
| 0050 | Online payment gateways became extensions. `shops.payment_gateway` is dropped. Each provider's keys moved from `shops.payment_credentials` into a `shop_extensions` row. |
| 0051 | `products.active` |
| 0052 | Shop owners: `shops.owner_id`, `users.owner_id`. Every existing shop and user goes to the `ADMIN_EMAIL` admin, else the oldest admin. |
| 0053 | `user_invites` |
| 0055 | `platform_extensions`. Every key some shop already has a `shop_extensions` row for is switched on. |
| 0056 | `platform_extensions.users` |
| 0057 | `users.email_verified_at`. Every existing user is set to now. |
| 0058 | `order_items.image` |
| 0059 | `order_items.image` becomes the order's own copy. Each old line's product picture is copied into the shop's `/uploads/<shop id>/orders/` folder, shrunk, once per distinct path. A picture that cannot be copied becomes null. Lines that already point at an order copy are left alone. |
| 0060 | `shops.languages` (`'en,de'` for every shop) |
| 0061 | Marketing: `shops.abandoned_cart/abandoned_cart_hours`, `store_carts.reminded_at/restore_token` (+ unique index), `email_unsubscribes`, `campaigns`, `campaign_sends` |
| 0062 | `store_carts.coupon_id`, `store_carts.coupon_email` (+ index). A code is held from the moment an online checkout starts. |
| 0063 | `shops.currencies` (`'[]'` for every shop) |
| 0064 | `shops.fulfillment_steps` |
| 0065 | The `subscriptions` table. The open-source app does not use it. |
| 0066 | `users.campaign_email_limit`, `campaign_sends.platform` (the monthly campaign email limit) |
| 0067 | `shops.domain_status`. Saved domains start `pending`. |
| 0068 | Renames a shop slug that is now reserved (`RESERVED_SLUGS`) to `<slug>-shop`. Every slug is a subdomain. |
| 0069 | `email_queue` |
| 0070 | `products.custom_request`, `products.custom_request_label`, `order_items.note` |
| 0071 | `passkeys` |
| 0072 | `sales_staff`, `sales_commissions`, `orders.sales_staff_id` |
| 0073 | `api_keys` |
| 0074 | `order_history` |
| 0075 | `extension_data` |
| 0076 | `payment_methods.image` |
| 0077 | `payment_methods.extension` |
| 0078 | Indexes only, for speed: `store_carts (shop_id, created_at)`, `store_carts (created_at)`, `order_items (product_id)`, `postal_codes (country, admin1, place)`, `stock_movements (order_id)`, `coupon_redemptions (shop_id)` |
| 0079 | `customer_addresses.tax_id` |
| 0080 | Customer emails are lower-cased. Index `customers(shop_id, email)`. |
| 0081 | Saved HTML (`products.description`, `campaigns.body`, `store_pages.body`) is cleaned again where it holds a raw-text tag. |
| 0082 | `store_carts.coupon_customer_id` |
| 0083 | `extension_rows` |
| 0084 | The daily report: `shops.report_enabled/report_time/report_channels/report_sent_on` |
| 0085 | `shops.theme_config` |
| 0086 | `categories.image` |
| 0087 | `users.firebase_uid` |

## Seed (`database/seed.ts`)

It runs on boot, and with `bun run seed`.

When `users` is empty:

- It makes the platform admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- The defaults are `admin@sellrika.local` and `password`.
- The password is only read here. After the first boot it lives in the database, and `/settings` changes it.

When `shops` is empty:

- It makes "Main Shop": USD, the server's time zone, slug `main-shop`.
- That admin owns it.
- It gets the default payment methods.
