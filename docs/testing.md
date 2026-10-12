# Testing

How to run the unit tests and the browser tests, what each test file covers, and what CI runs.

## Commands

| Command | What it does |
|---|---|
| `bun run test` | The unit tests |
| `bun check` | The type check |
| `bun run lint` | Biome |
| `bun run test:e2e` | Builds the frontend, then runs the browser tests (Playwright) |
| `bunx playwright test e2e/<file>.spec.ts` | One browser test file, without a new build |

## Unit tests

### How they are found

- `bun run test` runs `bun test ./app ./resources ./extensions`.
- `bunfig.toml` sets the test `root` to `app`.
  So a bare `bun test` finds only `app/`. It never finds the Playwright files `e2e/*.spec.ts`.
- Pass folders as paths that start with `./`.
  A bare name like `resources` is read as a name filter. It then matches nothing, and says nothing.

### Rules

All test files share **one process and one module cache**. So:

- Never call `sql.close()` in a test file.
- Point the database at a temp file with `DB_FILE` **before** you import app code.
  Do the same with `UPLOAD_DIR` for uploads.
- Call `await migrate(true)` from `@database/migrate`.
  Any file may run first. It applies only what is missing.
- Never touch the real `storage/` or `data/` of the project.

See `app/repositories/__tests__/Product.Repository.test.ts` for the pattern.

### The preload file

`app/test.preload.ts` runs before every test file (`bunfig.toml` › `[test] preload`).

Why it exists:

- Constants such as `EXTENSION_UPLOAD_DIR` read their env var once, on first import.
- The module cache is shared by the whole run.
- So a value set inside one test file is ignored when an earlier file already imported the app.

Pin such values in the preload. It pins these:

| Value | Set to |
|---|---|
| `DB_CONNECTION`, `DB_FILE` | A throwaway SQLite file in the temp folder. Never the real database. |
| `RESEND_API_URL` | An address nothing listens on. So no test sends real email. |
| `EXTENSION_UPLOAD_DIR` | A temp folder. Uploaded extension zips are unpacked there. |
| `EXTENSION_BUILTIN_DIR` | A temp folder. So unit tests start with no built-in extensions, and upload the repo's examples as zips. |
| `UPLOAD_DIR` | A temp folder for images |

### Other databases

**MySQL**

```
TEST_DATABASE_URL=mysql://user:password@host:3306/<empty database> bun run test
```

- This runs the same tests on MySQL.
- Add `DB_ALLOW_PUBLIC_KEY_RETRIEVAL=1` for MySQL 8 without TLS.
- Tests that open the SQLite file directly are skipped there.

**Postgres**

```
TEST_DATABASE_URL=postgres://user:password@host:5432/<empty database> bun run test
```

- This runs the unit tests on Postgres.
- The browser tests do not run on Postgres.

### What exists

Services:

| File | Covers |
|---|---|
| `app/services/sales/__tests__/Order.Service.test.ts` | Checkout (prices from the database, duplicate lines merge, discount, paid < total). Stock (checked up front and atomic). Refund rules. Void. Report numbers. Package lines (component stock, the `components` snapshot, cost, a missing or impossible choice, restock on refund and void). |
| `app/services/settings/__tests__/User.Service.test.ts` | Staff rules: role rules, the owner's account, what a manager may do, delete vs deactivate, sessions dropped, other accounts stay hidden |
| `app/services/settings/__tests__/Auth.Service.test.ts` | Sign-in rules |
| `app/services/catalog/__tests__/Product.Service.test.ts` | Barcodes, description sanitising, packages (computed availability, contents validation, the delete and variant-removal guards) |
| `app/services/settings/__tests__/PaymentMethod.Service.test.ts`, `Shop.Service.test.ts` | Service rules |
| `app/services/catalog/__tests__/ProductCsv.Service.test.ts` | The product CSV: export shape, export → import round-trip, per-row errors. `app/helpers/__tests__/csv.test.ts` covers the RFC-4180 parser and writer. |
| `app/services/settings/__tests__/Mail.Service.test.ts` | Email settings: encrypted secrets, provider switching, `send()` |
| `app/mail/smtp/Smtp.Mailer.test.ts` | The SMTP dialogue against a fake server |
| `app/services/sales/__tests__/OrderMail.Service.test.ts` | Renders the order confirmation: quantity-first lines, totals, support address, do-not-reply |
| `app/services/sales/__tests__/Store.Service.test.ts` | The online store's rules. It also checks that the confirmation is really sent after a paid checkout. |
| `app/services/sales/__tests__/Marketing.Service.test.ts` | The unsubscribe token. The marketing validators. The abandoned-cart sweep (due once, skips). The restore link. The campaign sweep (claimed once, unsubscribed skipped, a crash never sends again). |
| `app/services/settings/__tests__/ExchangeRate.Service.test.ts`, `app/helpers/__tests__/currency.test.ts` | Exchange rates. The fetch (bad values dropped, a failure keeps the table). The schedule (`run()` due, not due, off). A shop's currencies (saved, own dropped, manual beats automatic, no rate = left out). The input rules. |
| `app/services/settings/__tests__/Passkey.Service.test.ts` | Passkeys, with a software passkey that signs like a real device. The password before a challenge. A saved passkey. Every refusal: another origin, another site, not verified, another user's challenge, a used challenge, another key, a counter that does not go up, a switched-off account. The limit. Delete. |
| `app/services/settings/__tests__/ApiKey.Service.test.ts` | API keys. Stored as a hash and shown once. Wrong keys. The role cap (the key's role vs the maker's role today). A switched-off or deleted maker. A shop that left the account. `last_used_at` once a minute. The limit per shop. |

More service test files, each for the service it is named after:

- `app/services/sales/__tests__/`: `Coupon.Service`, `Domain.Service`, `OrderAlert.Service`, `PostalCode.Service`, `StoreAuth.Service`, `StoreReconcile.Service`
- `app/services/settings/__tests__/`: `Extension.Service`, `ExtensionEvents`, `Invite.Service`, `OAuth.Service`, `Owner.Service`, `Signup.Service`

Other layers:

| File | Covers |
|---|---|
| `app/repositories/__tests__/*.test.ts` | The Product, Category and Customer repositories |
| `app/controllers/api/Api.test.ts` | The REST API through the real router handlers. It is the one place where an HTTP-level file makes sense, because it also proves the docs. It covers: 401 / 403 / 404 / 422, every area's routes, each answer parsed with its `ApiSchemas` model, the OpenAPI file compared with the registered routes, the docs host (its address, CORS for that origin only), and the MCP server at `/mcp` (protocol versions, notifications, batches, the tool list per role, the pinned tool names, tool calls and their refusals). |
| `app/validators/validate.test.ts` | zod → Inertia errors |
| `app/xcore/http/__tests__/url.test.ts` | The store's host. `Url.slugOfHost`: one label under `STORE_DOMAIN` = a slug. `Url.storeOrigin`: the shop's own domain, else the subdomain with `APP_URL`'s scheme and port. |
| `app/xcore/*/__tests__/*.test.ts` | The router, paginate, compress, rate limit, outbound requests, storage (magic bytes), the database helpers, extensions, i18n, Inertia |
| `app/helpers/__tests__/*.test.ts` | time (zones, buckets), csv (RFC-4180), html (the shared sanitiser for store pages and product descriptions), crypto (credential encryption), costs, feed, qr, tax, workers, zip |
| `app/xcore/view/__tests__/store.test.ts` | The store document: the head, the page inside the theme layout, scripts, the data island (valid JSON, no raw `<`), JSON-LD escaping, `noindex`, escaped product names |
| `app/xcore/view/__tests__/themes.test.ts`, `aurora.test.ts` | The built-in store themes, and the Aurora extension theme |
| `app/mail/resend/Resend.Mailer.test.ts`, `app/mail/azure/Azure.Mailer.test.ts` | The two HTTPS mail providers |
| `app/emails/*.test.ts` | The test email, and the pictures in emails |

Frontend and extensions:

| File | Covers |
|---|---|
| `resources/js/lib/__tests__/*.test.ts` | Client helpers. `rawbt`: receipt lines, ESC/POS image bytes. `bundles`: slot options, availability, cart key, chosen names. `share`: the product's store link, utm tags, network links. Also `curve`, `search` and `approval` (a payment method its extension must approve first). |
| `resources/js/lib/password.test.ts` | The password helper |
| `resources/js/store/__tests__/*.test.ts` | `window.Store`. The cart: stock caps, events, storage, 24 h expiry, re-sync, another tab. The option picker: guided, editing a line, plain list, package slots. Money with a display currency. URLs. |
| `extensions/<key>/**/*.test.ts` | The extensions' own tests: `stripe`, `paypal`, `omise`, `2c2p`, `promptpay`, `stripe-terminal`, `labels` (Code 128), `loyalty`, `tax-invoice` |

## End-to-end tests

### How a run works

`bun run test:e2e` does this:

1. It builds the frontend once.
2. Playwright boots **one production server per spec file** (the `webServer` array in `playwright.config.ts`).
3. `e2e/tmp.ts` lists the spec files and gives each a port: `3100 + index`, in alphabetical order.
4. Each server gets a throwaway database and uploads folder under `$TMPDIR/pos-e2e-<port>`.
   The folder is wiped before boot, and again by `global-teardown.ts`.

What follows from that:

- Each file is a Playwright project pointed at its own server. So files run in parallel.
- Locally Playwright uses its default worker count: half of the CPU cores.
- The tests inside a file stay serial.
- They log in as the seeded admin (`e2e/helpers.ts`).
- Test data still uses unique names per run.
- Counts and totals may only be asserted inside the file that created them.
- The specs run under Node, not Bun. So Bun globals are not there.

### Running one file

- `bunx playwright test e2e/<file>.spec.ts` (or `--project <name>`) runs one file without a new build.
  It still boots the small servers for every file.
- It serves what is already built.
  Run `bun run build` first after a change in the frontend, a theme or `resources/js/store`.
- `E2E_PORT=<port>` moves the whole port range. So several runs can share a machine.
- `E2E_MYSQL_URL=mysql://user:password@host:3306 bun run test:e2e` runs the browser tests on MySQL.
  Every spec's server gets its own database `pos_e2e_<port>` (`e2e/fixtures/mysql-db.ts`).

### `BUILD_DIR`

`BUILD_DIR=<dir>` moves the build output. The default is `public/build`.

- `vite.config.ts` writes there.
- The server (`app.buildDir` in `config/app.ts`) serves `/build/*` from there.

Set it for both the build and the server.
Then a second test server can run next to another one without overwriting its files.

### A running dev server

When you test against a running dev server, use another port.
Do not kill someone's `bun run dev`.

### Built-in extensions in e2e

- The e2e servers run with `NODE_ENV=production`.
- They read the built-in extensions from `build/extensions`. So run `bun run build` first.
- Specs switch an extension on with `enableGlobally()` (`e2e/helpers.ts`).

### The store in e2e

- The store opens at `storeOf(spec)` = `http://main-shop.localhost:<port>` (`e2e/tmp.ts`). It is the store's free subdomain.
- The specs find the Edge theme pages by the accessible names and `data-*` hooks listed in [features/store-themes.md](features/store-themes.md).

### The spec files

**Sign-in and accounts**

| File | Covers |
|---|---|
| `auth.spec.ts` | Guest redirect. The main host has no front page, so a guest goes to the login. Wrong password. Login and logout. The theme switch survives a reload. Google and Microsoft sign-in: an email with no account is refused, the admin's own signs in. Microsoft sign-in: claiming a user's email does not get in, but a connected account does. |
| `j-users.spec.ts` | Staff CRUD and validation. A cashier session in a second page: nav, the 403 page, sells, no refund or void. What a manager may do. Sales staff with a commission. Self-guards. Deactivate and reset password drop sessions. Delete rules. `/settings`: rename, the RawBT printing toggle, password change. Outgoing email is for the platform admin only. Shop email. It restores the admin's name and password at the end. |
| `q-shop-owners.spec.ts` | The platform admin creates a shop for a new owner by email. The invitation link is shown because email is off. The owner accepts it and sees only their shop and staff. The link works once. The owner gets 404 on another account's shop and 403 on the platform settings (email, `/postal-codes`, creating shops for others). The platform admin keeps them. |
| `r-signup.spec.ts` | Forgot password: the emailed link sets a new password once, the old session is signed out, an unknown email gets the same answer. Self sign-up: `/register` is 404 while off. The platform admin turns it on (`PUT /owners/signup`). Sign-up is refused while email is off. With Resend on, a stranger follows the link on `/login`, signs up, sees only the "Confirm your email" screen, resends, opens the newest link and sees only their new shop. A taken email and the admin email are refused. Sign-up with Google and with Microsoft. A non-platform user gets 403 on the switch. Off again = 404. |
| `s-owner-stats.spec.ts` | The platform admin's Users pages (`/owners`): the list (the Invited badge, search), an owner's shops, a shop's totals and a period switch, the shop's product list and search, the sign-up switch. A plain owner gets no link and a 403. |
| `v-passkeys.spec.ts` | Passkeys with Chromium's virtual authenticator. A guest cannot start. `/settings` › Passkeys: a wrong password is refused, a passkey is added, the same device is refused a second time. Sign in with **Use a passkey**. Delete it, and the sign-in is refused. |
| `p-i18n.spec.ts` | The language switch: user menu → German sidebar, a German server validation message, the cookie survives a reload, back to English. The storefront footer switch and `Accept-Language: de`. |

In `r-signup.spec.ts` the fixture server stands in for Resend: `RESEND_API_URL`, and `GET /resend/last?to=` gives the last email to that address.

**Selling and the catalog**

| File | Covers |
|---|---|
| `flow.spec.ts` | Category → payment method → products with and without variants and images → sell with different methods → orders list, receipt and stats → delete keeps history. The totals are exact, because it is the first source of orders. The image editor is covered too, with "Remove background" failing politely while the model host is blocked. |
| `g-customers.spec.ts` | Customer CRUD and validation. Search and pager. Detail and purchase history. Several addresses. The CustomerPicker at checkout: pick and quick-add. Delete keeps the order. |
| `h-stock.spec.ts` | `track_stock` on simple and variant products. The `/stock` list with the low and out filters. Adjust (add, remove, set) and history. The product form has no stock field. The POS cart cap and out of stock. Sale movements. The negative guard. |
| `i-orders.spec.ts` | Cart discount (percent, fixed). A discount code at the till. Receipt. Order detail. Partial, money-only and full refund with restock. Void. Status badges. `/reports`: cards, series, breakdowns and period switching. |
| `k-catalog.spec.ts` | Category rename, colour and picture. Product edit, barcode uniqueness, rich-text description, search, featured, switched off, pager. POS search, scan, cart and paging on scroll. Payment-method edit (icon, colour, tendered, disable → hidden at checkout). A second shop (currency, timezone, logo, switch, isolation, delete rules). Global search. It ends with the seeded shop active. |
| `m-csv.spec.ts` | Product CSV export and import round-trip. Skipped rows are reported. |
| `n-packages.spec.ts` | Build a package: contents editor, allowed variants, savings summary. The "Package" badge and contents line on `/products`. Sell it on the POS with a colour choice (the option that can't fill the slot is disabled). Component stock and movement. The order line "Pen — 1 dozen (Red)". The same picker on the storefront. The delete and variant-removal guards. |
| `x-send-order.spec.ts` | A store with no payment option. The cart's button is **Send order**. The order is written at once and shown on the thank-you page. Bad input is refused. Staff find it unpaid ("Pay later"), add items to it from the Sell screen (`/pos?order=`), take one off with a line's delete button (a draft: Undo, then Save changes), see the History card (before and after), can't remove the last unit, then record the money. After that the order is closed for both. **Pay later** on the Sell screen. With a payment option on, the button is Checkout again and `/checkout/send` answers 422. |
| `y-stripe-terminal.spec.ts` | The Stripe Terminal extension against a stand-in. The confirm button stays off while Card reader is picked. A declined card shows the reason. An approved card completes the sale by itself and the hold is captured. The customer screen only says what to do. A refund goes back to the card. |
| `z-pos-display.spec.ts` | The customer screen follows the Sell screen. An extension fills the `pos.display` slot. A payment method's picture shows while that method is picked. The PromptPay extension adds a payment method and shows a QR code for the amount. |

**The online store**

| File | Covers |
|---|---|
| `l-store.spec.ts` | Online-store settings: slug and domain validation with reserved slugs, the template switch, custom pages in the GrapesJS editor. The public storefront as a logged-out visitor: server paging, search, sort, cart, product page, delivery. The catalog without JavaScript. The banner and contact block. |
| `l-store-checkout.spec.ts` | Payment extensions, checkout, coupons, manual payment, track, custom request, guided address, customer accounts and an extension theme. Its first test builds the shop the others count on: zones, tax, a product, the store on, a remembered address. |
| `marketing.spec.ts` | Product Share: no button while the store is off. On, the row and form open the dialog with the store link and tagged network links, and the link opens the product page for a guest. `/marketing`: a guest is sent to login, the abandoned-cart switch and delay persist, a campaign is written, gets a customer, is saved, scheduled and cancelled. "Send test to me" (Resend fixture) → the unsubscribe link → button → done. A forged link says so. A cart row with a restore token (written straight into the spec's SQLite file) → `…/cart/<token>` refills the store cart on the checkout. |
| `t-currencies.spec.ts` | Multi-currency. The platform admin's `/exchange-rates`: fetched on boot from the fixture server's `/rates`, schedule saved, Refresh now. The owner adds EUR (automatic) and GBP (own rate) on `/online-store` › Currencies. A visitor switches in the header dropdown: converted cards, the cart in GBP, the checkout in USD with the note. Removing them hides the switcher. |

`l-store` and `l-store-checkout` were one file.
They were split so CI runs them in two shards at the same time.
A serial file can not be faster than the sum of its tests.

**The API and extensions**

| File | Covers |
|---|---|
| `w-api.spec.ts` | The REST API. A key made in the dialog: shown once, calls `/api/v1`, and stops when deleted. OAuth: an assistant sends a guest to sign in, the admin allows it, and the code becomes a key for the MCP server. The keys page is for admins only. The docs host (`developer.localhost`) may call the API from a browser; another site may not. |
| `o-extensions.spec.ts` | Global Extensions lists the built-ins, off and not deletable. A bad zip and a built-in key are refused. An uploaded one can be deleted. Switched on for all shops, the shop enables Webhook; it needs its URL first. The switch, and Configure keeping a secret. Off for all shops hides it. Upload again upgrades it. A cashier sees neither page. A shop owner has no Global Extensions page. |
| `y-restaurant.spec.ts` | The Restaurant extension. See the list below. |
| `y-daily-report.spec.ts` | The daily report needs a Chat alerts channel, then keeps its time and channel. |
| `y-labels.spec.ts` | Labels: pick a product, set copies, preview the barcode, print one page per label. |
| `y-loyalty.spec.ts` | Loyalty: paid sales to a customer earn points, and the goal gives a discount code. |
| `y-tax-invoice.spec.ts` | Tax invoice: a paid order with VAT prints one with the buyer, and keeps its number. |

What `y-restaurant.spec.ts` covers:

- The extension is switched on with nothing to fill in.
- The Customers link is gone, and its Tables page takes its place.
  Tables are added with a range `1-2` and a name. One is removed after asking.
  Each table is a customer. The Customers page is as it was.
- The numbers, the filters, and a table's details panel.
- **Make QR code** shows the code and prints it at once. `window.print` is stubbed and counted. **Print QR** prints again.
- A guest orders two rounds through the link with **Send to kitchen**.
  There is a review dialog, and a note for one dish.
  The table stays on the address while browsing. The guest sees one bill.
- A forged link is a 422.
- The store without a table's link shows "Invalid link". Nothing is remembered.
  An old or made-up code shows "This QR code has expired".
- The bill's remove buttons are a draft until **Save changes**.
- **Move or join tables** has its two tabs, and joins two bills.
- **Pay** takes a discount and refuses a wrong code. It takes the payment method and the cash handed over, and shows the change.
  It records the money in its own dialog, with **Print receipt**, without leaving the page.
- The Kitchen page shows each round as its own ticket.
  Start, Done, Back and drag and drop move a line. It is kept after a reload.
- Staff find both rounds on one order. Paying it kills the code and empties the kitchen.
- On the Sell screen the picker picks a table. **Pay later** is the main button, and two carts land on one bill.
- **Add items** starts a bill with a line note, shown on the bill and in the kitchen, and adds to it.
- A dish removed on the order page shows as cancelled in the kitchen until **Got it**.
- The product form's **Send to kitchen** switch saves at once, and waits on a new product.

### An add-on's specs

An add-on may bring its own spec files in its own folder.
`e2e/tmp.ts` adds them to the list when the folder is there.
The open-source app has none.

## The fixture server

`playwright.config.ts` starts `e2e/fixtures/serve.ts` on port `BASE_PORT − 1`.
The app servers never reach the real sites during `bun run test:e2e`. They reach this server.

| Stand-in for | How the app is pointed at it |
|---|---|
| GeoNames | `GEONAMES_ZIP_URL` and `GEONAMES_DUMP_URL` (`app.geonames` in `config/app.ts`) |
| Exchange rates | `EXCHANGE_RATES_URL` → `/rates`. The table is USD 1, EUR 0.5, GBP 0.8, THB 35. |
| Resend | `RESEND_API_URL` → `/resend/emails` |
| Firebase sign-in | `FIREBASE_LOOKUP_URL` → `/firebase/lookup` |
| Stripe Terminal | `STRIPE_TERMINAL_API_URL` → `/terminal`. A charge is approved the moment it reaches the reader. An amount that ends in 01 is declined. `GET /terminal/last` hands a spec the card payments. |

### GeoNames

- The files are in `e2e/fixtures/geonames/`.
- `zip/TH.zip` is the real Thailand file, fetched once (14 KB).
- The guided address test downloads it.
- Any other country is a 404 there. GeoNames gives the same answer for a country it does not cover.
- If the format ever changes, download it again from `https://download.geonames.org/export/zip/TH.zip`.

## CI

There are two workflows. Both run on pull requests that target `main`. They do not run on push or merge.

### `.github/workflows/test.yml` (Tests)

| Job | What it runs |
|---|---|
| `unit` | `bun install --frozen-lockfile`, `bun check`, `bun test` |
| `unit-mysql` | `bun test` on MySQL 8.0, with `TEST_DATABASE_URL` |
| `unit-postgres` | `bun test` on Postgres 16, with `TEST_DATABASE_URL` |

### `.github/workflows/e2e.yml` (E2E)

- A matrix of 6 shards × 2 databases (SQLite and MySQL). The jobs run at the same time.
- Each job runs inside Microsoft's `mcr.microsoft.com/playwright:v<version>-noble` image.
  Browsers and system libraries are already in it.
- The image tag must match `@playwright/test` in `package.json`. Bump both together.
- Each job installs Bun, then runs `bun run test:e2e` with `E2E_SHARD=<i>/6`.
- A job runs two spec files at a time (`workers` in `playwright.config.ts`). A 4-vCPU runner can't do more.
- Traces are uploaded per shard on failure.

How the shards work:

- `e2e/tmp.ts` reads `E2E_SHARD` and keeps every 6th spec file, round-robin over the sorted list.
- So a job boots only its own servers.
- A new spec file joins a shard by itself. No workflow edit is needed.
- Locally, `E2E_SHARD=2/6 bunx playwright test` runs the same share.
