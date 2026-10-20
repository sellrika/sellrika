# Extensions

How the app loads, switches on and runs extensions, and what the built-in extensions do. This page is the app side, not the author guide.

## What an extension is

An extension is an add-on written in TypeScript or JavaScript. It is a folder with:

- an `extension.json` manifest
- an entry module: event listeners, `routes`, `publicRoutes`, and `payment` for a payment gateway
- `assets/` browser scripts, for its own pages and for slots inside the app's pages

The guide for extension authors (manifest, module, events, zip layout, how to develop and ship) is not in this folder.
The app links to it from **Admin › Global Extensions** (`Hooks.docs.extensions`).

## One catalog for the whole platform

The code is **one catalog for the whole platform**. The platform admin (the `ADMIN_EMAIL` user) manages it.

### Built in

Every folder of the repo's `extensions/` that holds a manifest is built in.

- A built-in extension cannot be deleted.
- A zip with a built-in key is refused ("built in — its updates ship with the app").

Where they are read from is `EXTENSION_BUILTIN_DIR` (`app/constants/Extension.Constant.ts`, with an env override):

| Mode | Folder | Read |
|---|---|---|
| Local development (`NODE_ENV` unset) | The raw `extensions/` folder | Again on every call (`EXTENSION_BUILTIN_LIVE`). So an edit shows on the next request. |
| Production (`NODE_ENV=production`: `bun run start`, the binary, the e2e servers) | `build/extensions/<key>/` | Once |

In development a second folder may be read too, when it exists: an add-on's own extensions (`EXTENSION_BUILTIN_DIRS`).

`bun run build` writes the production copy:

- It runs `bun extensions/build.ts --out build/extensions`.
- It bundles each extension unpacked. These are the same files as its zip.
- The folder sits outside `public/`, because server code must not be served.
- It is gitignored.
- The `Dockerfile` copies it into the runtime image.

### Uploaded

The platform admin adds zips, as a file or an https link.

- They are kept in `storage/extensions/platform/<key>/<stamp>/`.
- The same key again is an update to the new version. Older stamps are dropped.
- They can be deleted.

### The global switch

Each extension has a **global switch** (`platform_extensions`, migration 0055).

- Off: it runs in no shop, and no shop lists it.
- New ones start off. That goes for built-in and uploaded ones.

### For some users only

An extension can be **for some users only** (`platform_extensions.users`, migration 0056).

- The value is the owners' user ids. `[]` = every user.
- Then only the shops of those owners list it and run it.
- `ExtensionService.available(shopId)` checks the shop's `owner_id`.
- Every runtime lookup goes through it: events, routes, pages, slots, themes, payments.
- A shop that loses access keeps its saved settings.

## The two pages

### Admin › Global Extensions

`/admin/extensions`. Platform admin only (`Guard.platform` route group).

Every extension shows with:

- its name, version, icon and description
- a **Built in** or **Uploaded** badge
- **Available to**: "All users", one email, or "N users"
- the **Enabled for all shops** switch
- **Delete** (uploaded only)

**Add extension** = upload a zip, or from a link. There are no settings here.

The **Available to** dialog:

- It has a tags picker: `ChipPicker.vue` over `GET /admin/extensions/users?q=`.
- That finds owners by name or email, `EXTENSION_USER_CHOICES` = 20 at a time.
- `PUT /admin/extensions/:key/users {users: emails}` saves it.
- An email that is not an owner is refused.

### Settings › Extensions

`/extensions`. Every admin, for their active shop.

- It lists only the globally enabled extensions.
- Each has the shop's **Enable** switch and **Configure** (the settings dialog).
- There is no upload and no delete here.

## Where the code is

### The `extensions/` folder

It holds the built-in extensions and the developer workspace.

| File or folder | What |
|---|---|
| `types.ts` | The author-facing types: `Listeners`, `Routes`, `PageScript`, `SlotScript`, `SlotContexts`, and the payment contract `HostedPayment` / `TokenizePayment` / `PaymentScript` |
| `make.ts` | `bun run make:extension <key>` |
| `build.ts` | `bun run build:extension <key>`, or `bun run build:extensions` for all |
| `stripe/`, `omise/`, `2c2p/`, `paypal/` | The online store's payment providers. See [online-store.md](online-store.md) › Payments. |
| `webhook/` | Rows of URL + events. Signed POSTs. |
| `chat-alerts/` | Alerts to chat. See below. |
| `restaurant/`, `labels/`, `loyalty/`, `tax-invoice/`, `promptpay/`, `stripe-terminal/` | See The built-in extensions below |
| `aurora/` | An example storefront theme |

### The `custom-extensions/` folder

Our own extensions that are not part of the app. It is a git repository of its own, and git ignores it here.

- One folder per extension, at its root: `custom-extensions/<key>/`.
- Development loads them like the built-in ones (`EXTENSION_BUILTIN_DIRS`). `bun run build` bundles them into `build/extensions` when the folder is there.
- `bun run make:extension <key> --custom` scaffolds one there. `bun run build:extension <key>` finds it by key.
- Import the types with the alias: `import type { Routes } from "@extensions/types"`.
- Unit tests: `bun test --path-ignore-patterns='**/e2e/**' ./custom-extensions`. Browser tests: `custom-extensions/e2e/*.spec.ts`, picked up by `e2e/tmp.ts` like the app's own.
- The app runs fine without the folder.

What `build.ts` does:

- `Bun.build` bundles `main` for bun, and every page and slot script for the browser.
- It rewrites the manifest to `.js`.
- It zips to `extensions/<key>/dist/<key>-<version>.zip`.
- With `--out <dir>` it writes unpacked into `<dir>/<key>/` instead. This is what `bun run build` does for `build/extensions`.

### Chat alerts

`extensions/chat-alerts/` posts one text for each of these: new orders, paid later, refunds, voids, low stock.

- It posts to Slack and Discord webhooks, to LINE (Messaging API push or broadcast) and to Telegram (Bot API `sendMessage` to one chat).
- Telegram needs both the bot token and the chat ID. A token that is not `<digits>:<letters>` is refused before the request, so it can not change the path.
- Every filled channel gets every ticked event.
- The daily sales report of `/reports` (`report.daily`) goes to the channels picked there, whatever is ticked.
- Low stock fires once, when `unit.stock` crosses `low_stock_at`. 0 = out of stock.

### An extension's icon

- The manifest's optional `icon` is an image under `assets/`.
- It is served like any asset.
- It is sent as a URL on `ExtensionRow.icon` and `ExtensionUi.icon`, for the list, the sidebar and the extension's pages.

### Search from an extension

- A browser script may open the ⌘K palette with its own search: `api.search`.
- That is `borrowSearch()` in `resources/js/lib/search.ts`.
- The one search-js instance is lent to the extension, with its callbacks swapped in, until it closes.

### The mechanics: `app/xcore/extensions/`

| Function | Does |
|---|---|
| `ExtensionFiles.scan` | Finds the folders with a manifest |
| `ExtensionFiles.unpack` | Zip → files, with safety checks |
| `ExtensionFiles.write`, `.move`, `.remove` | File work |
| `ExtensionLoader.load` | `import()` once per file → `{ on, routes, publicRoutes, payment }` |
| `ExtensionLoader.matchRoute` | Matches `"METHOD /path/:id"` tables |
| `ExtensionLoader.asset` | Serves `assets/…` files |

About `ExtensionLoader.asset`:

- A `.ts` or `.tsx` file is transpiled with `Bun.Transpiler`. The result is cached until the file changes.
- A `.tsx` gets the JSX runtime `app/xcore/extensions/jsx-runtime.txt` in front.
- JSX compiles to its `__h` / `__F` DOM factories. These are the same settings as `tsconfig.json`.
- `extensions/build.ts` puts the same runtime before every browser bundle.

### The rules: `app/services/settings/extensions/`

`Extension.Service.ts` holds the rules. It is a thin facade. The work is in the files beside it, with the same method names:

- `Extension.Catalog.ts`
- `Extension.Settings.ts`
- `Extension.Runtime.ts`
- `Extension.Routes.ts`
- `Extension.Events.ts`
- `Extension.Storefront.ts`

Its methods:

| Method | Does |
|---|---|
| `builtins`, `catalog` | Built-ins + uploads. A built-in wins a key. |
| `available` | The catalog, globally enabled only. Every runtime lookup starts here. |
| `platformList`, `setGlobal` | Global Extensions |
| `upload`, `fromUrl` | Add an extension |
| `remove` | An uploaded one's code and switch |
| `adoptShopUploads` | Runs on boot. See below. |
| `list` | The shop's page |
| `save`, `active` | The shop's settings |
| `ui` | Sidebar pages and slot scripts, for the shared props |
| `page` | An extension's page |
| `handle` | Routes and assets |
| `running`, `emit` | Events |
| `payments`, `onlinePayment` | The payment gateways running for a shop |
| `themes`, `storeTheme` | The storefront themes |
| `storeOwner`, `storeLinks`, `storePaths` | The pages an extension brings to the store. See Store pages below. |

`fromUrl` is the **Add extension › From URL** dialog: `POST /admin/extensions` with `url`.
It takes https only, with `MAX_EXTENSION_ZIP_BYTES` and `EXTENSION_FETCH_TIMEOUT_MS`. Then it calls `upload`. Refusals come back under `errors.url`.

Other files in the folder:

| File | What |
|---|---|
| `types/Extension.Types.ts`, `Extension.Events.Types.ts`, `Extension.Payments.Types.ts`, `Extension.Themes.Types.ts` | The types |
| `Extension.Field.ts` | The field rules |
| `Extension.Config.ts` | The stored settings |
| `Extension.Manifest.ts` | The manifest reading |
| `Extension.Mail.ts` | Email from an extension |

### Other backend files

| What | Where |
|---|---|
| Repository (`shop_extensions` and the `platform_extensions` switch) | `app/repositories/Extension.Repository.ts` |
| Model (`ShopExtension`) | `app/models/Extension.ts` |
| Validator (`ExtensionManifest`, `ExtensionInput`, `GlobalExtensionInput`) | `app/validators/Extension.Validator.ts` |
| Constants (dirs, limits, `EXTENSION_EVENTS`, `EXTENSION_PAYMENT_MODES`) | `app/constants/Extension.Constant.ts` |
| Controller | `app/controllers/Extension.Controller.ts` |
| The functions with no API route (`ExtensionHandles.for()`) | `app/controllers/support/Extension.Handles.ts` |

Routes:

- `routes/settings.ts`: `/admin/extensions*` (platform), `/extensions` and `PUT /extensions/:key` (admin), `/extensions/:key/:page` and `/ext/:key/*` (auth).
- `routes/storefront.ts`: `/store/:slug/ext/:key/*`, in the `storeExtension` bucket. And `GET /*`, the store pages of an extension, in the `storePage` bucket.

### Frontend

| What | Where |
|---|---|
| Admin › Global Extensions | `Pages/Extensions/Global.vue` |
| Settings › Extensions (enable and configure) | `Pages/Extensions/Index.vue` |
| An extension's page | `Pages/Extensions/Page.vue` |
| A slot | `components/ExtensionSlot.vue` |
| `extensionApi`, `mountExtension` | `lib/extensions.ts` |
| The shared prop `extension_ui` (`ExtensionUi`) | Every page |
| Types `ExtensionRow`, `ExtensionField`, `ExtensionUi` | `types.ts` |

- Each page names its sidebar section (`pages[].group`). The default is "Extensions". `AppLayout.vue` draws it.
- The `product.form` slot is in `Pages/Products/Form.vue`.

### Tests

| File | Checks |
|---|---|
| `app/services/settings/__tests__/Extension.Service.test.ts` | It uploads the examples raw and built, and switches them on for all shops. The payment gateway rules. Built-ins in a temp `EXTENSION_BUILTIN_DIR`. The global switch. The boot move. Migration 0055. |
| `app/services/sales/__tests__/fakeGateway.ts` | Fake hosted and tokenize gateways for the store tests |
| `extensions/<key>/<key>.test.ts` | Each provider against a stubbed `fetch` |
| `app/services/settings/__tests__/ExtensionEvents.test.ts` | A recorder extension and the real services, one step per event. `ExtensionService.idle()` waits for the `void` emits. |
| `app/services/settings/__tests__/ExtensionStorefront.test.ts` | Store pages of an extension: the themed and cleaned page, one shop never sees another's, menu links, sitemap paths, pictures kept by `ctx.data` |
| `e2e/o-extensions.spec.ts` | The pages in a browser |

About the e2e spec:

- The repo's extensions are built in there. The prod server reads `build/extensions`.
- So specs switch them on with `enableGlobally()` (`e2e/helpers.ts`).
- Upload, update and delete use `packExtension("webhook", patch)`, with the key patched to one that is not built in.
- Playwright sets `EXTENSION_UPLOAD_DIR` to the spec's temp folder.

## Languages

An extension ships `i18n/<locale>.ts`.

- Each file is `export default { key: text }`. It is flat. It may use `{placeholders}`.
- One file per language. `en` is the fallback.
- Nothing is registered.

On the server (`app/xcore/extensions/ExtensionI18n.ts`):

| Function | Does |
|---|---|
| `ExtensionI18n.load(dir)` | Reads them all. Cached per folder. |
| `ExtensionI18n.translator(dicts, locale)` | The extension's `t()` |
| `ExtensionI18n.strings(dicts, locale)` | The merged dictionary a browser script gets |

How the manifest's texts are resolved:

- `available()` resolves the manifest to **English** (`ExtensionInfo`). English is stable: `orders.payment_method` and the tests use it. It keeps `raw` and `i18n`.
- `ExtensionService.localized(ext)`, `translator(ext)` and `strings(ext)` give the current request's language (`I18n.current()`, see [i18n.md](i18n.md)).

Who uses the request's language:

- `list()`
- `ui()` (plus `strings`)
- `page()` (plus `strings`)
- `save()`: the field names in messages
- `handle()` and `deliver()`: `t` and `locale` on the context
- `payments()`: `RunningPayment.t`. `StoreService` shows a `GatewayError` whose message is a key translated.
- `StoreService.paymentLabel()`

In the browser:

- `extensionApi(key, context, strings)` gives `api.t` and `api.locale` (`lib/extensions.ts` › `extensionT`).
- On the storefront, `Tokenize.strings` gives the checkout script's `api.t`.

Tools:

- `build:extension` bundles `i18n/*.ts`.
- `make:extension` scaffolds `en.ts` and `de.ts`.

## Themes

A `theme` block in the manifest makes the extension a look for the online store.

- Its keys: `label`, `description`, `views`, `css`, `script`, `scheme`, `featured`.
- The shop picks it on `/online-store` › Template. It is stored as `ext:<key>`.
- It has the same shape as a built-in Edge theme: `views/<page>.edge` for every `STORE_THEME_PAGES` entry, its own CSS and its own browser script.
- An upload that misses a page is refused.

How it is rendered:

- `ExtensionService.themes(shopId)` feeds the picker.
- `storeTheme(shop)` registers the templates as `ext/<key>/<file>` (`StoreView.useExtensionTheme`). It returns what `StoreViewService.theme()` renders with.
- A theme that is off, or that throws while rendering, is logged. The page is drawn with Classic.

The contract is in [store-themes.md](store-themes.md). The example is `extensions/aurora/`.

## Where uploaded code lives

- Built in: `EXTENSION_BUILTIN_DIR` (`extensions/` in development, `build/extensions/` in production).
- Uploaded: `storage/extensions/platform/<key>/<stamp>/` (env `EXTENSION_UPLOAD_DIR`).

About uploads:

- Each upload lands in a fresh `<stamp>` folder. So the module cache never serves an old version.
- The older stamps are deleted.
- The uploads are read once, and refreshed on upload and delete.

### Upgrade from per-shop uploads

Before the platform catalog, each shop had its own zips in `storage/extensions/<shop_id>/<key>/<stamp>/`.

On boot, `ExtensionService.adoptShopUploads()` runs (`app/server.ts`, after the migrations):

- It moves the newest version of each key into the platform folder, whichever shop it came from.
- A key that is built in, or already in the catalog, is left alone. So a second boot moves nothing.
- It deletes nothing. The versions left behind stay in the shop folders. They can be removed by hand.

Migration 0055 switched every key a shop already had a `shop_extensions` row for on for all shops. So running shops kept working.

## Tables

### `shop_extensions` (migration 0047)

`id`, `shop_id`, `key`, `enabled`, `config`, `created_at`.

- `config` is JSON `{field: value}`. Secret fields are encrypted with `APP_KEY`.
- Unique `(shop_id, key)`.
- Deleted with the shop.
- The manifest is not stored. It is read from the folder every time.

### `platform_extensions` (migration 0055)

`id`, `key` (unique), `enabled`, `users`, `created_at`.

- This is the "Enabled for all shops" switch. No row = off.
- `users` (migration 0056) is a JSON list of the owners' user ids who may use it. `[]` = every user.

### `extension_data` (migration 0075) and `extension_rows` (migration 0083)

What an extension stores. See `ctx.data` below.

## Rules

### When an extension runs

Four things must be true, and its code must be in the catalog:

| Word | Meaning |
|---|---|
| **Enabled for all shops** | The platform switch |
| **Installed** | The shop has a row (its first save) |
| **Enabled** | The shop's switch |
| **Ready** | Every `required` field is filled |

One silent way an enabled extension stops running:

- A saved secret that the server's current `APP_KEY` cannot decrypt. The key changed between deploys.
- `active()` returns null and logs it.
- The list shows it as **Keys unreadable** (`ExtensionRow.problem`, `ready: false`) until the keys are entered again.

Other rules:

- A folder whose manifest does not validate is skipped with a warning. It never shows on the page.
- Uploaded code runs in the app's own process with its rights. There is no sandbox. Only the platform admin can add code.

### Upload

`POST /admin/extensions` (multipart `file` or `url`, platform admin).

Limits:

- at most 5 MB zipped (`MAX_EXTENSION_ZIP_BYTES`)
- at most 20 MB unpacked (`MAX_EXTENSION_UNPACKED_BYTES`)
- at most 500 files (`MAX_EXTENSION_FILES`)

Checks:

- Entry names must be safe relative paths: no `..`, no absolute path, no backslashes.
- A single top-level folder is stripped.
- `extension.json` must be at the root and valid.
- `main` and every page and slot script must be in the zip.
- `main` must import. A module that throws on import is refused and its files are deleted.
- A built-in key is refused.

Result:

- A new key starts off for all shops.
- An existing key is an **update**. Its global switch and every shop's settings stay.

### Global switch

`PUT /admin/extensions/:key` with `{ enabled }`.

- Off hides it from every shop's list. It stops running everywhere: events, routes, pages, slots, themes, payments.
- The shops keep their settings. So switching it on again brings them back.

### Save

`PUT /extensions/:key` with `{ enabled, config? }`.

Every value is checked against its field's `type` (`EXTENSION_FIELD_TYPES`). `coerce()` does it:

| Type | Rule |
|---|---|
| `text` | Text |
| `number` | A number box arrives as text and is stored as a number |
| `select`, `multiselect` | The values must be among the manifest `options` |
| `switch`, `checkbox` | Become booleans |
| `url` | Must be http(s) |
| `color` | Must be `#rrggbb` |
| `image` | Must be an upload of this site or an https link. Never `javascript:` in a `src`. |
| `list` | An array of rows. Each row is checked against the manifest's sub-`fields`. No secrets inside rows. |

- List errors come back as `config.<field>.<row>.<sub-field>`.
- With the switch on, every required field is needed. `filled()` decides: `""` and `[]` do not count, booleans always do.
- With the switch off, a half-filled extension may be saved.
- A blank secret keeps the stored one.
- Secrets are never sent back. `secret_set` says whether one is stored.
- `config` left out changes only the switch.
- So `shop_extensions.config` holds JSON values by type, not only strings.

### Payment gateways

Manifest: `payment: { mode: hosted | tokenize, public_field?, script? }`.

- The module must export `payment` with the mode's functions. This is checked at upload.
- `starts_with` on a field refuses a value with another prefix.
- One gateway runs per shop. `save()` switching one on switches every other enabled payment extension of the shop off.
- Neither an upload nor the global switch ever switches one on in a shop, even with no required fields.
- `payments(shopId)` and `onlinePayment(shopId)` hand `StoreService` the running one, with its decrypted `config`.
- The storefront loads a tokenize gateway's `script` from `/store/<slug>/ext/<key>/<script>?v=<version>`.
- The manual options (cash on delivery, bank transfer) are not extensions. They are in `app/gateways/manual/`.

### Delete

`DELETE /admin/extensions/:key`. Uploaded only. A built-in one is refused.

- It deletes the code and the global switch.
- The shops' `shop_extensions` rows stay. So an upload of the same key later finds their settings again.
- There is no per-shop remove. A shop switches an extension off.

### Events

`ExtensionService.emit(event, shop | shopId, data)` is called with `void` right after the write that caused it. It is never awaited.

What it does:

1. It loads the shop's running extensions.
2. It decrypts their settings.
3. It calls each listener inside a try/catch.

A failing or unloadable extension is logged (`[extensions] …`). It is never thrown. So it cannot break a checkout.

`emitAll(event, data)` fires for every shop. Staff events use it.

Where events are fired:

| Place | Events |
|---|---|
| `OrderService.checkout` | `order.created`, `order.paid`, `stock.updated` |
| `StoreService.fulfill` | The same. `order.paid` only when the gateway paid. |
| `OrderService.refund`, `recordPayment`, `setFulfillment`, `void` | `order.updated`, one `order.status_changed` per moved field, then `order.refunded` / `order.paid` / `order.voided`, and `stock.updated` for restocks |
| `ProductService.create`, `update`, `setFeatured`, `remove` | The product events |
| `CustomerService.create`, `update`, `remove` | The customer events |
| `StockService.adjust` | `stock.updated` |
| `UserService.create`, `update`, `remove` | The staff events (`emitAll`) |
| `DailyReportService` | `report.daily` |

- For the order changes, a private `#changed()` reads the order again before it fires.
- Stock rows are found with `stockMark()` before the write and `stockMoved()` after (`StockRepository.lastId` / `since`, narrowed to the order or the unit).
- Each `stock.updated` also carries `unit` (`StockRepository.unit`): the name, the variant, `stock` after the row, and `low_stock_at`.
  So a listener can spot "just went low" without a database read.

The full list is `EXTENSION_EVENTS`.

**The payment reference.** A pay dialog may send `payment_ref`: the short text an extension gave when it approved the payment (see Payment methods by extension).

- It rides on the events of that write: `order.created` and `order.paid` for a sale, `order.updated` and `order.paid` for a recorded payment.
- The app stores nothing of it. The extension keeps the link to the order in its own data.
- It comes from the browser. So an extension must look it up in its own records before it trusts it.

### Routes

| Route | Who | Goes to |
|---|---|---|
| `ANY /ext/:key/*` | Signed in, every role, the session's active shop. The handler gets `user`. | The module's `routes` |
| `ANY /store/:slug/ext/:key/*` | No login. The store must be on. | The module's `publicRoutes` |
| `GET /<storefront.path>` and below, on a store's host | No login. | The module's `publicRoutes`, with `ctx.storefront`. See Store pages. |

- The public path is the same on every host. It is the only store path that keeps the `/store/<slug>` prefix.
- Both answer 404 unless the extension runs (installed + enabled + ready).
- A handler that throws answers 500 and is logged.

Assets: `…/assets/<file>` under either mount serves the folder's `assets/`, also for an extension that is not running yet.

- Under `/ext/`: any extension of the catalog. The lists show the logo of one that is still off.
- Under the storefront mount: only the globally enabled ones.
- Safe paths only. `.ts` becomes JavaScript.

### Pages

- `GET /extensions/:key/:page` renders `Extensions/Page.vue`.
- It imports the page script (`/ext/<key>/assets/…?v=<version>`) and calls its default export with the element and the `api`.
- A page is admin-only unless the manifest says `admin: false`. A cashier then gets the 403 page.
- A page may name its own `icon` (manifest `pages[].icon`, else the extension's logo). It is sent as `pages[].icon` in `extension_ui` and as `page.icon` to the page. The sidebar link and the page heading show it.
- The sidebar's Extensions group comes from the `extension_ui` shared prop. It is filtered by role on the server.

### A page's frame

In `Extensions/Page.vue`:

- The page is full width, with the app's padding.
- `api.actions` = the right side of the title row.
- `api.aside` = a full-height right column for a details panel. It is 400 px wide, sticky under the top bar, and hidden while empty.
- `api.ui.switch()` = a checkbox drawn like the app's Switch.
- Extension scripts change page with `api.visit(url)` (Inertia), never `location.href`.

### Full screen pages

- `pages[].fullscreen: true` (Restaurant's Kitchen page): `Extensions/Page.vue` adds a **Full screen** button to the title row.
- `pages[].breadcrumb: false` (Kitchen and Tables) is its own option: `AppLayout` shows no breadcrumb bar on that page.
- `pages[].centered: true` gives the page the width, padding and title size of the app's own list pages (`max-w-6xl`, like Orders). The default is the whole width.
- `pages[].fill: true` (Kitchen) makes the page as tall as the screen from `md` up. The title row stays. The script's root gets the rest of the height.
  So the Kitchen's three columns each scroll their own list under a heading that stays.

The button switches `maximized` (`lib/fullscreen.ts`, kept in `sessionStorage` for the tab):

- The sidebar and the mobile bar hide on **every** page, and the browser goes full screen.
- It stays so until the button (now a minimize icon) is clicked again.
- The browser itself leaves full screen on a print, a page load or Esc. The layout's click listener `keepFullscreen` takes it back on the next click.
- The Sell screen has the same button, next to its customer screen button.
- A page with no button of its own (an order, Tables) shows a small minimize button at the bottom left.

### Browser cache

- In production, a file under `assets/` asked for with `?v=<version>` is sent with `cache-control: public, max-age=3600`.
- A script changed without a new `version` in the manifest can be stale for up to one hour.
- In development, and without `?v=`, it stays `no-cache`.

### Slots

`ExtensionSlot.vue` renders one element per running extension that names the slot. It mounts its script with `api.context`.
`EXTENSION_SLOTS` lists the names.

| Slot | Where | Context |
|---|---|---|
| `order.show` | The order page's button row, before Print | `{ order() }` = the order as the page shows it now. Read only. |
| `pos.display` | The customer's screen `/pos/display`, and next to every pay dialog | `{ sale(), onChange(fn), payment(), onPayment(fn), place, approve(ref) }`. The cart is read only. |
| `product.side` | The product form's side column, under Featured | `{ id }`. null while the product is new. |
| `product.form` | The product form | `{ values(), set(patch) }`. `set` only touches fields the form has. |
| `order.receipt` | Inside `ReceiptSlip.vue`, hidden | `{ order(), add(lines) }` |
| `pos.cart` | `CartPanel.vue`, under the customer row | `{ customer(), code(), onChange(fn), applyCode(code) }` |
| `extension.config` | The Configure dialog | See below |
| `store.page` | Every page of the shop's online store | See below |

Notes per slot:

- **`pos.display`.** An extension that leaves its element empty lets the shop's logo show. See [pos-checkout.md](pos-checkout.md) › Customer screen.
  The script can run in two places at the same moment. `place` tells them apart: `"dialog"` next to a pay dialog, `"screen"` on the customer's screen. Work that must happen once (charge a card reader) belongs in the dialog only.
  `approve(ref)` is described under Payment methods by extension. On the customer's screen it does nothing.
- **`order.receipt`.** A script adds text lines. They are kept per order in `receiptExtras` (`lib/rawbt.ts`, at most 12 lines of 200 characters).
  They are printed over "Thank you" by both the browser slip and `receiptLines` (RawBT).
  The slot is keyed by the order's status and money. So the scripts run again after a payment or a refund, from no lines.
- **`pos.cart`.** `applyCode` runs the same `POST /pos/coupon` quote as the cashier's Apply code.

**`extension.config`** (`EXTENSION_CONFIG_SLOT`) is the extension's own settings form.

- It is not rendered by `ExtensionSlot` and it is not in `extension_ui`. It must also show while the extension is off.
- `ExtensionRow.config_script` and `strings` carry it.
- `ExtensionConfigDialog.vue` mounts it with `ExtensionConfigForm.vue`, in place of the fields and its own Enabled switch.
- Context: `{ values(), set(patch), enabled(), setEnabled(on), errors(), onErrors(fn) }`, over the dialog's own form. `set` only touches fields of the manifest.
- The dialog gets wide and shows the logo.
- `ExtensionRoutes.#staffFiles` serves every asset of such an extension to the staff of a shop that may use it.

**`store.page`** (`EXTENSION_STORE_SLOT`) is not in the staff app.

- `ExtensionService.storeScripts(shop)` puts each running extension's script on the store's data island: `extensions: [{ key, script, base, strings }]`.
- `window.Store` imports it after boot. It calls its default export with `{ key, base, t, locale, fetch, store }` (`runExtension` in `resources/js/store/index.ts`).
- A script that throws is only logged.
- `ui()` leaves that slot out.

### What an extension can do = the REST API as functions

`app/xcore/api/ApiCall.ts` builds the functions, the way the MCP server builds its tools.

1. Every API route names its function where it is registered: `fn: "products.create"` in `routes/api.ts`. `api()` requires it.
2. The route keeps its handler behind its role check only: `ApiDoc.run` = `ApiGuard.role(role)(router.bare(action))`.
3. `ApiCall.functions(caller)` turns `apiDocs` into `{ products: { list, get, create, update, delete }, orders: { … }, … }`.

How a function runs:

- It fills the path's ids from its first arguments.
- It sends the next argument as the body. For a route with no body, that argument is the query.
- It puts the caller in `Context.set` and runs the handler.
- That is the same controller, validators and service classes as a call with a key. Nothing is written twice.
- A status ≥ 400 becomes an `ApiCallError` (`name` "ApiError", `status`, `type`, `fields`).
- A read of one record that is gone is `null`.
- There is no key and no rate limit.

`ExtensionService.handle` gives the functions to every route. `deliver` gives them to every listener.

**The caller**

| Where | Who the functions run as |
|---|---|
| A staff route | The signed-in staff member. Their role decides. |
| A public route | The online store's system user, acting for the shop's account with every right (`ExtensionController.storeActor`). So a guest's order is signed "Online Store". |
| A listener | The shop's owner (`ExtensionRuntime.ownerOf`) |

A new API route needs only its `fn` name, plus a line in `ApiFunctions` (`extensions/types.ts`) for the author's autocomplete.

### Store pages

An extension may bring pages of its own to the shop's online store, like a blog.

**The manifest** names the first part of their address: `"storefront": { "path": "blog" }` (2 to 30 lower-case letters, digits and dashes).

**The route.** `GET /*` (`ExtensionController.storePage`) is the last route of the app. So every page of the app itself wins.

1. It finds the store by host. No store: 404 as plain text, as before.
2. It asks `storeOwner(shop, segment)` which running extension has that path. None: 404 as plain text.
3. It hands the request to the extension's `publicRoutes`, with the whole path: `"GET /blog"`, `"GET /blog/:slug"`.
4. A 404 from the extension becomes the theme's not-found page.

**The page.** The handler returns `ctx.storefront.page({ title, body, css, description, image, canonical, back, noindex, status })`.

- It is drawn with the theme's `page` template, the one the shop's own pages use. So it has the theme's header, footer, colours and font.
- The body is cleaned with `sanitizeHtml`, always. The CSS can't close its `<style>` tag.
- `frame: "full"` draws the shared `store/extension` template instead: only the theme's header and footer. The extension's body is the whole page between them, with its own heading and back link. It styles itself with the theme's CSS variables (`--store-fg`, `--store-bg`, `--store-muted`, `--store-line`, `--store-accent`, …).
- `back: { title, path }` replaces the theme's "Back to shop" link over the page ("Back to blog"). The `page` template gets it as `back { title, url }`, null for the shop's own pages.
- Head tags come from `StoreViewService.storeSeo`: the title, the description, the share picture.
- `image` must be an upload path. Every `/uploads/…` picture in the body and the share picture is loaded from the app's own host (`Url.uploadsIn`, `Url.upload`), never the store's host. The CDN cache works that way.

**The module** may export `storefront` with two functions. Each gets `{ shop, config, t, locale, data }`.

| Function | Gives | Limit |
|---|---|---|
| `links` | Links for the store's menu and footer: `{ title, path }` | `EXTENSION_STORE_LINKS_MAX` (5) |
| `sitemap` | Paths for the store's `sitemap.xml` | `EXTENSION_STORE_PATHS_MAX` (5000) |

- A path that is not the extension's own path or below it is left out.
- A function that throws is logged and counts as an empty list. A store page never breaks because of an extension.
- The links join `store.pages` with the path as `slug` (`/blog`). `url.page()` knows both forms, so no theme changes.

### The functions with no API route

`ExtensionHandles.for()` in `app/controllers/support/Extension.Handles.ts`. Routes only.

- `products.idBySku`
- `orders.openFor`
- `orders.move` and `orders.join` (staff routes: `OrderService.moveTo` / `join`)
- `customers` (`customersOf()`): `create` with the customer form's rules, `get`, `search`
- `html.clean(html)`: the app's HTML cleaner (`sanitizeHtml`), for text a person typed
- `uploads.drop(urls)`: pictures the extension stopped using. Each leaves storage when nothing else uses it (`UploadCleaner.dropUnused`). Only paths of the shop's own folder are looked at, `EXTENSION_DROP_MAX` per call.
- `storefront.page(page)`: store page requests only. See Store pages above.

`handle` joins them with the API's functions under the same area names.

Every route also gets:

- `store_url` (`Url.storeOrigin(shop)`)
- `sign(value)` (`extensionSignature` in `app/helpers/crypto.ts`: HMAC-SHA256 with `APP_KEY` over the extension key, the shop id and the value)

Staff routes also get `user`.

### Pictures and the text editor

The browser api lends two things of the app (`resources/js/lib/extensions.ts`):

- `api.upload(file)`: `POST /uploads` into `/uploads/<shop id>/extensions/`. Managers and admins, with the upload limit. It answers `{ url }` or `{ error }`.
- `api.richText({ value, label, onChange })`: the app's own editor, `RichText.vue`, with its picture tool on. It answers `{ el, value(), set(html), destroy() }`.

A picture is kept as long as the extension's data names its path: `UploadRepository.inUse` also searches `extension_rows` and `extension_data`.
The extension tells the app when it stops using one (`ctx.uploads.drop`).

### `ctx.data`

For routes and listeners.

**Small values**

- `get` / `set` / `delete` of small JSON values, per shop and extension.
- Table `extension_data` (migration 0075). `ExtensionRepository.getData` / `setData` / `deleteData`. Built by `ExtensionRuntime.dataOf`.
- Deleted with the shop.

**`ctx.data.collection(name)`** = a list that grows, one row per record.

- Table `extension_rows` (migration 0083): `shop_id`, `ext_key`, `collection`, `ref`, `value`.
- Functions: `add`, `get`, `list` (paged, newest first, by `ref`), `update`, `delete`, `clear(ref)`.
- `ref` is the only thing a list can be searched by.
- Every query carries shop + extension + list (`ExtensionRepository.#inList`).

**`ctx.data.lock(name, job)`** = one job at a time per shop + extension + name (`oneAtATime`, in memory, single process).

Extensions never get raw SQL.

### Email from an extension

Listeners and routes get `mail.customer(id, { subject, text })`.

- Code: `ExtensionMail` in `Extension.Mail.ts` → `NoteEmail`, `resources/views/emails/note.edge`.
- The extension names a customer of its own shop by id, never an address.
- The text is plain and escaped. It is cut to `EXTENSION_MAIL_SUBJECT_MAX` (200) and `EXTENSION_MAIL_TEXT_MAX` (5000).
- An unsubscribed customer gets nothing.
- It answers a reason and never throws.

### The store's customer on public routes

- `ctx.customer` = `{ id, name, email }` of the customer signed in to that shop's store (`Auth.currentCustomer`).
- It is null for a guest (`ExtensionController.storeRoute`).
- Staff routes do not have it.

### App settings from a field

`fields[].app`, with the names in `EXTENSION_APP_SETTINGS`.

- `ui()` sends `extension_ui[].app` = `{ "pos.primary": value }`. A blank select = its first option.
- `CheckoutDialog.vue` makes Pay later the main button when one says `pay_later`.
- The manifest's own `app` block (`{ "orders.delivery": "hide" }`) sets one outright, with no field. A field's value wins.
- `deliveryHidden()` in `lib/orders.ts` reads it. Then:
  - the Orders list shows no delivery step tabs and no steps dialog
  - `statusBadges` leaves the step badge out
  - the order page has no Delivery card

### Hidden sidebar links

Manifest `hide_nav`, like `["/customers"]`.

- `ui()` sends them as `extension_ui[].hide_nav`. An extension with only this still gets an entry.
- `AppLayout.vue` leaves those links out (`hiddenNav`).
- The page still opens by its address.

### Rewording the app

- A key `app.<app key>` in an extension's dictionary rewords that app text in the staff app while it runs.
- `ExtensionService.ui()` sends the dictionary as `extension_ui[].strings`, even for an extension with no page or slot.
- `appWords()` in `resources/js/lib/i18n.ts` gives those keys priority, like a theme's `strings` on the store.
- Server texts (emails, receipts) are not reworded.

### Printing

`api.print(slip)`, `api.printReceipt(order)` and `api.qr(text)` in `lib/extensions.ts`.

- `printReceipt` prints an order with the app's own `ReceiptSlip` and `printReceipt()`. It is the same receipt as the Sell screen and the order page. The order comes from `orders.get()` in a route.
- `printSlip()` in `lib/rawbt.ts` = a `#receipt` slip for `window.print()`. Through RawBT it is the title and lines as a picture, plus the printer's QR command (`GS ( k`).
- The QR encoder is `app/helpers/qr.ts` (`qrSvg`).

### Payment methods by extension

- Manifest `payment_method: { name, icon, color, confirm }` adds a method to the shop while the extension is switched on.
- `name` may be a key of its dictionary. `icon` is one of `PAYMENT_ICON_NAMES`.
- It is a real `payment_methods` row with `extension = <key>`. It is made and switched when the extension is saved. See [payment-methods.md](payment-methods.md) › Rules.
- `api.paymentPicker({ methods, value?, amount, onChange?, onApproval? })` → `{ el, value(), setAmount(cents), blocked(), ref(), destroy() }` (`lib/extensions.ts`).
  It mounts the app's own `PaymentMethodPicker.vue` for an extension's pay dialog. The rows of `orders.payOptions()` fit it.

**A method that must be approved first** (`confirm: true`, a card reader for example):

1. While such a method is picked, every pay dialog keeps its confirm button off. The rule is `usePaymentApproval()` in `lib/approval.ts`, used by `PaymentMethodPicker.vue`. So it holds for the Sell screen's checkout, Record payment, and an extension's own dialog.
2. The extension's `pos.display` script, drawn next to the dialog, calls `api.context.approve(ref)` when the money is taken. `ref` is a short text of its own, at most `PAYMENT_REF_MAX` = 200 characters.
3. The dialog then confirms by itself. The cashier does not tap again.
4. The dialog sends `ref` as `payment_ref` with `POST /pos/checkout` or `POST /orders/:id/payments`. It comes back on the events (see Events).
5. Another method or another amount takes the approval away.

The shared prop `extension_ui[].payment_confirm` tells the picker which extensions ask for it.
An extension's own dialog reads `blocked()` for its button, gets `onApproval(ref)` when the state changes, and sends `ref()` along. The Restaurant's Pay dialog does this.

### For AI assistants

This is about the MCP server. See [api.md](api.md).

- Manifest `guide` = a Markdown file. It becomes the topic `<key>` of `read_user_guide` while the extension runs for the shop (`ExtensionService.guides`).
- Manifest `tools` = staff routes offered as MCP tools `<key>_<name>`.
  Keys: `name`, `summary`, `description`, `route` (a key of `routes`), `role` (default admin), `input` (JSON Schema per argument), `required`.
- `ExtensionService.tools` lists them. `ExtensionController.run` runs them as the key's user.
- An upload is refused when the guide file is not in the zip, or a tool names a route the module does not have (`missingToolRoutes`).
- Summary and description may be dictionary keys. The assistant reads the English text.

## Endpoints

| Who | Routes |
|---|---|
| Platform admin | `GET /admin/extensions` (page), `POST /admin/extensions` (zip upload or `url`; a refusal is Inertia `errors.file` / `errors.url`), `PUT /admin/extensions/:key` (`{enabled}`), `DELETE /admin/extensions/:key` (errors under `key`), `GET /admin/extensions/users`, `PUT /admin/extensions/:key/users`. Everyone else gets 403. |
| Admin | `GET /extensions` (page), `PUT /extensions/:key` (errors `config.<field>` or `key`). Cashiers get the 403 page. |
| Every role | `GET /extensions/:key/:page`, `ANY /ext/:key/*` |
| Public | `ANY /store/:slug/ext/:key/*` |

## The built-in extensions

### Restaurant

`extensions/restaurant/`.

**Settings**

- Only `primary_button` (`app: "pos.primary"`). The default is Pay later = the checkout's main button, which joins the table's open bill. See [pos-checkout.md](pos-checkout.md) › Pay later.

**What it changes in the app**

- It hides the Customers link (`hide_nav`).
- Its `app.*` texts make the Sell screen's customer picker a table picker.
- They name the Orders list's **Online** tab **QR Scan** (`app.orders.online`). Guests order by scanning the table's code. Such an order was made by the store's system user, so it is under that tab.
- Its manifest `app` block hides the delivery steps on the Orders list (`orders.delivery: hide`). Nothing is shipped.
- Its pages sit in their own sidebar section **Restaurant** above Sales (`pages[].group` = a name of its own, `group_before: "Sales"`). `AppLayout.navGroups` moves the section.

**Data** (`ctx.data`)

| Key | Holds |
|---|---|
| `tables` | The names |
| `qr:<table>` | `{token, made_at}` |
| `kitchen:<order id>` | Each line's `{step, at, qty, name, note}` |
| `kitchen:cancelled` | Dishes cancelled and not yet acknowledged |
| `kitchen:skip` | Product ids that never go to the kitchen |

**Tables page**

Every role. Script `assets/tables.tsx`. Built from the Pencil design. It asks again every 30 s.

- **Add tables**, next to the title (`api.actions`). Managers and admins.
  `POST /ext/restaurant/tables {names}` takes names, `5` or `1-30`. Each becomes a customer at once. At most 200 tables.
- The numbers: unpaid total, open bills, free tables, QR codes ready.
- **All / Open bill / Free** filters.
- Table tiles.
- The picked table's details, in the page's right column (`api.aside`).

The details panel has a header (name, opened, state) and two tabs.

*Tab **Bill***

- The bill's lines with their notes. The lines scroll.
- The footer stays in view: discount, tax, total, and the buttons.
- The list keeps its scroll place across the 30 s refresh.
- **View order**.
- **Add items**: `/pos?customer=<table's customer>&back=<the page>`.
- **Pay**. See below.
- **Print bill**: the open order from `GET …/tables/:name/bill` through `api.printReceipt`, before the guests pay.
- A bin button on each bill line. It takes one unit off **on screen**. This is a draft, like the order page's.
  **Save changes** sends the whole draft once: `POST …/tables/:name/items/remove {items}` → `orders.remove`, one history row.
  **Undo** forgets it. The last dish cannot go.
- **Move or join tables**. A dialog: free tables = move the bill there, tables with a bill = join both.
  `POST …/tables/:name/move {to}` → `orders.move`, or `orders.join` plus the kitchen records merged.

*Tab **Table setup***

- The table's name, with **Rename**: `POST …/tables/:name/rename {to}`, managers and admins.
  The list, the table's customer (`customers.update`) and the QR record follow. A printed code must be printed again.
- The QR code (`api.qr`), with **Print QR** and **New QR code** / **Make QR code**.
  `POST …/tables/:name/qr` makes a random 16-byte token. Older codes die. It prints at once.
- **Remove QR code**: `DELETE …/tables/:name/qr`, after asking.
- **Remove table** at the bottom: `DELETE …/tables/:name`. It is refused with an open bill.

Picking another table opens it on Bill.

*The Pay dialog*

It works like the Sell screen's checkout.

1. A **Discount** box like the Sell screen's: percent or amount, quick percents, a discount code, Remove discount.
   `POST …/tables/:name/discount {type, value, coupon}` → `orders.setDiscount`.
2. The payment methods.
3. The amount received, with quick amounts, and the change for a method that takes cash.
4. The **Waiter** = the shop's sales staff.
5. The sums.
6. `POST …/tables/:name/pay {method, received, sales_staff_id}` → `orders.pay` with `payment_method` / `tendered` / `sales_staff_id`.
7. **Print receipt** through `api.printReceipt`, with the order the pay route answers.

The methods and staff come from `orders.payOptions()`. Every role may pay.

**Guests**

The link is `<store>/?table=<name>&t=<token>`.

- The `store.page` script names the cart's button **Send to kitchen**.
- It replaces `Store.checkout()` with its own review dialog.
- Its `store.page` slot has `wait: true`. So the page is hidden (`STORE_WAIT_STYLE` in the head) until the script ran, or 4 s passed. `window.Store` takes the style out. The menu never flashes before the notice.
- The seat is read from the address only (`?table=&t=`). Nothing is in sessionStorage.
- `carrySeat()` keeps it there: links, GET forms, `Store.url.product`.

When the link is not right:

- An address without the seat gets a full-page "Invalid link" notice.
- A code the `GET …/bill` route refuses (422) gets "This QR code has expired".
- `Store.checkout()` sends nothing.
- This is a block in the browser only. The store's own checkout routes still answer.

The review dialog:

- It shows the cart once more, with an optional note box per dish (at most 200 characters).
- The note is sent as the line's `note`. It goes to the bill, the kitchen ticket and the receipt.
- A refusal shows in the dialog.
- `POST …/ext/restaurant/order` checks the table and token. Then `orders.openFor()` → `orders.add()` or `orders.create()` (unpaid, note = the table).
- The bill shows in a bar and a dialog (`GET …/bill`).

**Kitchen page**

Script `assets/kitchen.tsx`. Its own chef-hat icon. It asks again every 5 s.

- Columns: To do → Preparing → Done. The Done one is narrower.
- Each dish has its picture (`order_items.image`). A chef's hat when there is none.
- One **ticket per round** = the lines of a bill that arrived together. Oldest first.
  So a table's later round queues behind other tables' earlier ones.
- Each line has its qty, its note under it, and **Start** / **Done** / **Back**. Or drag and drop.
  `POST …/kitchen/:order/:item {step}`.
- **Longest wait** shows next to the title. Waits turn red from 10 minutes.
- Lines are stamped by the `order.created` / `order.updated` listeners (`syncKitchen`, one write at a time).
  So a round keeps its time with the page closed.

Cancelled dishes:

- A line that lost units or was removed (not one already done), or a voided order's unfinished lines, go to `kitchen:cancelled`.
- They show as a red banner plus a greyed line with "Cancelled … · do not start / stop cooking".
- They stay until **Got it**: `POST …/kitchen/cancelled/:id/ack`.

**Send to kitchen**

The `product.side` slot, `assets/product-side.tsx`.

- It is a switch card on the product form. It is saved at once.
- Routes: `GET` and `POST …/products/:id/kitchen`, managers and admins.
- Off = that product's lines never show in the kitchen.
- The same two routes are its MCP tools: `restaurant_get_send_to_kitchen` (cashier) and `restaurant_set_send_to_kitchen` (manager).
- `guide.md` is its guide topic `restaurant`.

**Paying**

`order.paid` does two things:

- It forgets the bill's kitchen record.
- It deletes the QR token of the table named like the order's customer. It matches by name, so a re-made customer still matches.

The old code then answers 422 "This QR code has expired".

Tests: `e2e/y-restaurant.spec.ts`.

### Labels

`extensions/labels/`. No settings. It prints barcode and price labels.

Its page **Labels** sits in the sidebar's Catalog group, for every role (`/extensions/labels/print`, `assets/labels.tsx`).

**Search**

- `GET /ext/labels/products?q=` → `products.list`, 30 per search.
- `unitsOf` makes one unit per product, or one per variant with its own price and code.
- The code is the barcode only, never the SKU. The Sell screen's scanner matches `barcode` exactly.

**The Products card**

- A search box.
- The tabs **All** (the search results) and **Picked**.
- One row per unit: picture, name, a chip with the variant, price · barcode, or a **No barcode** warning.
- **Add**. Once picked, a copies stepper: −, a number box, +. 0 takes it off.
- At most `MAX_LABELS` = 2000 labels per print.

**The Label card**

- The preview of one picked unit at a fixed width (`zoom`).
- Arrows to walk through the picked units (`name · 1 of 4`).
- **Size** (`SIZES` in `assets/utils.ts`):
  - 50 × 30 mm and 40 × 30 mm rolls = one label per page
  - A4 with 24 per sheet = 70 × 37 mm, 3 × 8, no margins or gaps
- The **Show** chips: Name, Price, Barcode.
- The print hint.

**Clear all** and **Print N labels** sit in the title row (`api.actions`).

**How it prints**

- Everything is drawn in the browser.
- `components/Label.tsx` uses inline styles in mm only. The labels are printed from a hidden `<iframe>` with its own `@page` size. The app's page and stylesheet are not in it.
- The frame goes away on `afterprint`.
- The price is shown like the app's (`trailingZeroDisplay`).
- Nothing is stored. No app code is changed.

**The bars**

They are **Code 128**, from the extension's own `assets/code128.ts`. No package.

- Digits are packed two per symbol (set C). So an EAN stays short. An odd last digit switches to set B.
- Any other printable ASCII uses set B.
- A code with other letters gets no bars.

Tests: `extensions/labels/assets/code128.test.ts` (the table, the checksum, the units), `e2e/y-labels.spec.ts`.
Its guide topic is `labels` (`guide.md`).

### Loyalty Points

`extensions/loyalty/`.

**Settings**

Four, all required:

| Setting | Meaning |
|---|---|
| `spend` | The money for 1 point, in the shop's currency |
| `goal` | The points for a reward |
| `reward_type` | `fixed` or `percent` |
| `reward_value` | An amount, or a percent 1–100 |

The settings form is its own (slot `extension.config`, `assets/config.tsx`):

- Left: three numbered questions and the shop's switch.
- Right: what the answers mean. "About every $30 paid gives one $5 off code", two example orders, the bar, the reward.
- It is drawn again on every key. Nothing is saved before Save.

**Earning**

The listeners `order.paid`, `order.refunded` and `order.voided` all call `settle()`, inside `data.lock("customer:<id>")`.

1. The order is worth `pointsFor()` points now (`assets/utils.ts`): 0 unless paid in full and not voided, else `floor((total − refunded) / spend)`.
2. The difference from what the order gave before is booked.

So:

- A repeated event changes nothing.
- A refund takes back the points of that money.
- A void takes all of them.
- An order with no customer earns nothing.
- A member's points never go below 0. Points already spent on a reward are not taken back.

**Reward**

- While the points reach the goal, `coupons.create` makes a code `LOYAL-` + 8 random characters.
- The type and value come from the settings. `usage_limit: 1`.
- It is not tied to an email. A listener cannot read the customer's email.
- Then the goal is taken off the points.
- A code that could not be made leaves the points for the next order.
- It is a normal row on `/coupons`.

**Telling the customer**

Four ways. All read `standing()` = `{ points, goal, rewards }`, with the rewards not used yet.

1. **Email.** `mail.customer` sends the code when the reward is made. Nothing is sent for a customer with no email, or while email is off.
2. **Receipt** (slot `order.receipt`, `assets/receipt.ts`). "Points earned +25", "Your points 20 of 30", and each unused reward with its code.
   It reads `GET /ext/loyalty/orders/:id/receipt`. It asks again up to 6 times while `pending`, because the points are booked just after the sale.
3. **The till** (slot `pos.cart`, `assets/till.tsx`). The picked customer's points, and a **Use reward** button per unused reward. The button puts the code on the sale. It reads `GET /ext/loyalty/customers/:id/standing`.
4. **The store's account page** (slot `store.page`, `assets/store.ts`). The signed-in customer's points, bar and codes, in the theme's `[data-account-extra]` box.
   It reads the public `GET /store/<slug>/ext/loyalty/me`, which reads the customer from the session only.

**Used or not**

- Each reward is a row in `rewards` (ref `customer:<id>`, `{ customer_id, code, type, value, used }`).
- It has an index row in `codes` (ref `code:<CODE>`).
- `order.created` / `order.updated` with a `LOYAL-` `coupon_code` mark it used.
- A voided order marks it unused again.
- A known gap: a code taken off an open order stays "used".

**Data** (collections)

| Collection | Ref | Value |
|---|---|---|
| `members` | `customer:<id>` | `{ customer_id, points, total }` |
| `earned` | `order:<id>` | `{ customer_id, points }` = what each order has given |
| `history` | `customer:<id>` | `{ type: earn | take | reward, points, reference?, code? }` |
| `rewards`, `codes` | See above | |

`customer.deleted` clears the member, their history and their rewards.

**The Loyalty page**

Sidebar › Sales. Every role. `assets/loyalty.tsx`. Read only.

- The members, newest first, with points and a bar up to the goal. Previous / Next.
- The search box finds members by the customer's name or phone (`customers.search`, then each one's row).
- A row opens the history in a dialog (Show more).

**Routes**

- `GET /ext/loyalty/members?page=&q=`
- `GET /ext/loyalty/members/:id/history?page=`
- the two above
- No route changes points.

**Not there yet**

- No change by hand.
- The code is not tied to the customer. Anyone who knows it can use it once.

Texts: `i18n/en.ts` only.
Tests: `assets/utils.test.ts`, `Extension.Service.test.ts`, `e2e/y-loyalty.spec.ts`.
Its guide topic is `loyalty`.

### Tax Invoice

`extensions/tax-invoice/`. For any country: a tax ID is free text, and no format is checked.

**Settings**

| Setting | Rule |
|---|---|
| **Seller name** | Required |
| **Seller address** | Required |
| **Seller tax ID** | Required |
| **Branch** | Optional |
| **Invoice number prefix** | Empty = `INV-` |

**The button**

Its `order.show` script (`assets/order.tsx`) puts a **Tax invoice** button in the order page's button row, for every role.

The button opens a dialog for the buyer:

- Name and address are required. Tax ID and branch are optional.
- It starts with the name of the order's customer (`customers.get`) and their first saved address with its tax ID.
- A **Saved address** list offers every address of the customer (`customers.addresses`, shaped by `savedAddress()`).
- Picking one fills the address box and the tax ID box. Both stay free to edit.

**Save and print** sends it to `POST /ext/tax-invoice/orders/:id`. It prints one A4 page from a hidden frame.

**The paper** (`components/Invoice.tsx`)

- the seller
- the title Tax Invoice
- the number
- the date, on the shop's clock
- the buyer. The block is headed **To**.
- the lines
- subtotal, discount
- value before tax = `total − tax − delivery_fee`
- the tax, under the order's own `tax_label` with its rate
- delivery, total

Money has two decimals. A tax ID or branch left empty is not printed.

**Rules**

`refusal()` in `assets/utils.ts`. Checked in the browser and again on the server:

- The order is paid.
- It is not voided or fully refunded.
- It has tax (`orders.tax > 0`). So the shop sets its tax rate first.

**Data** (`ctx.data`)

- `invoice:<order id>` = `{ number, issued_at, buyer }`.
- The number is `<prefix>` + the order's public code, like `INV-9JDW-QTGP-FR7U` (`invoiceNumber()`). For an old order with no code it is the id. So there is no counter.
- The number and the date are given once.
- Saving again only changes the buyer. So a reprint is the same paper.
- `GET /ext/tax-invoice/orders/:id` = the seller plus the saved invoice, or null.

**Not there**

No credit notes. No amount in words. No invoice list page.

Texts: `i18n/en.ts` and `i18n/th.ts`. The invoice prints in the page's language.
Tests: `assets/utils.test.ts`, `Extension.Service.test.ts`, `e2e/y-tax-invoice.spec.ts`.
Its guide topic is `tax-invoice`.

### PromptPay QR

`extensions/promptpay/`.

**Settings**

| Setting | Rule |
|---|---|
| The shop's **PromptPay ID** | Required |
| **Name under the QR code** | Optional |
| **Account name** | Optional |

Each optional line shows under the code only when filled. The shop's name is never shown there.

It also has its `payment_method` "PromptPay" (QrCode icon).

**What it draws**

Its `pos.display` script (`assets/display.tsx`):

1. It reads the ID once from `GET /ext/promptpay/config`.
   `promptpayId()` keeps digits only: 10 = a phone, 13 = a national or tax ID, 15 = an e-wallet. Else null.
2. While a pay dialog has **its** method picked (`payment().extension === api.key`), it draws a card with a QR code for the exact amount.

The card looks like a bank's Thai QR Payment sheet (`components/PayCode.tsx`):

- a blue header with `assets/thai-qr-mark.svg`
- `assets/promptpay.png`, from the Pencil component "PromptPay logo"
- the code, with the mark in its middle
- the amount under the code
- the two lines from the settings

**The code**

`promptpayPayload(id, cents)` in `assets/promptpay.ts` makes the EMVCo text, drawn through `api.qr`:

- dynamic code `12`
- AID `A000000677010111`
- a phone as `0066…`
- currency 764
- the amount
- CRC-16/CCITT-FALSE

**Limits**

- Only in a THB shop. Else it shows a notice. A wrong ID shows a notice too.
- No provider. No fee.
- **No payment check.** The cashier looks at the bank app, then confirms the sale.

Tests: `assets/promptpay.test.ts`, `Extension.Service.test.ts`, `e2e/z-pos-display.spec.ts`.
Its guide topic is `promptpay`.

### Stripe Terminal

`extensions/stripe-terminal/`. Card payments at the till with a Stripe card reader.

**Not yet tested on real hardware.** Nobody on the project has a reader. It was built and tested with Stripe's simulated reader only.

It is its own extension, not a part of `extensions/stripe`:

- Only one online payment extension can be on per shop. A shop that uses PayPal online could never use the reader.
- A shop with a reader and no online store does not have to switch on online payments.

It imports nothing from `extensions/stripe`. `stripe.ts` is its own copy of the Stripe `call()` and of the amount rule `stripeAmount()` (zero-decimal and three-decimal currencies).

**Settings**

| Setting | Rule |
|---|---|
| **Secret key** | Required. Secret. Starts with `sk_`. |

It also has its `payment_method` "Card reader" (Nfc icon) with `confirm: true`.
The readers are not a setting. They come from Stripe (`GET /v1/terminal/readers`). The shop registers a reader in its Stripe Dashboard.

**For the cashier**

1. Pick **Card reader** in a pay dialog. A box for the reader shows next to the dialog.
2. With more than one reader, pick the reader. The browser remembers it (`localStorage` key `stripe-terminal:reader:<shop id>`). An offline reader can't be picked.
3. Press **Send to reader**. The reader shows the amount.
4. The customer taps, inserts or swipes the card.
5. The box shows **Approved** and the sale is completed by itself.

A declined card shows the reason and **Try again**. **Cancel** clears the reader.

**The flow is driven by the server.** No Stripe JS SDK and no webhooks.

| Route (`/ext/stripe-terminal/…`) | What it does |
|---|---|
| `GET /readers` | The shop's readers and whether each is online |
| `POST /charge` `{ reader, amount }` | Makes a PaymentIntent (`card_present`, `capture_method: manual`) and sends it to the reader (`process_payment_intent`). Answers `{ pi }`. |
| `GET /status?pi=` | Asks Stripe about the PaymentIntent, and about the reader when no card came yet. `waiting`, `approved`, `declined` (with the reason) or `cancelled`. The dialog asks every 2 seconds. |
| `POST /cancel` `{ pi }` | Clears the reader (`cancel_action`) and cancels the PaymentIntent |
| `GET /orders/:id` | The order's card payments, for the order page |
| `POST /orders/:id/retry` | Takes money that was not captured and sends refunds that failed |

**The two places of the script** (`assets/display.tsx`, slot `pos.display`):

- `place: "dialog"`: it drives the reader and calls `approve(<PaymentIntent ID>)`.
- `place: "screen"`: it only shows "Tap your card on the reader" and the amount. It never touches the reader. So the card is not charged twice.

**No money without an order**

- The reader only holds the money (`capture_method: manual`).
- The dialog saves the order with the PaymentIntent ID as `payment_ref`.
- The listeners of `order.created`, `order.updated` and `order.paid` get the reference. The first one ties the charge to the order and captures it. The others find nothing left to do.
- A reference counts only when it is a charge this shop's extension made, with no order yet.
- A hold with no order is cancelled when the dialog closes. After a browser crash the hold ends by itself at Stripe.
- The dialog also closes right after a sale. So `POST /cancel` waits 5 seconds (`timing.grace`) for an approved hold. An order that was just saved claims its charge in that time.
- A capture can fail. The charge is then `uncaptured`.

**Refunds to the card**

- The `order.refunded` listener refunds the same amount at Stripe. The `order.voided` listener refunds all that is left.
- An order paid in several card payments is refunded newest charge first.
- A void also lets go of a hold that was never captured.
- An order with no linked charge is left alone.
- A refused refund is kept on the charge as `failed` cents, with Stripe's reason.

**On the order page** (`assets/order.tsx`, slot `order.show`)

- An order with a card payment gets a **Card payment** button. Its dialog lists each card payment and what went back to it.
- The button turns red and says **Card payment not captured** or **Card refund failed** when something needs the staff's eye.
- **Try again** in the dialog calls `POST /orders/:id/retry`.
- The script looks at the page's order every 3 seconds and reads the card payments again after a change.

**What it keeps**

One row per charge in the `ctx.data` collection `charges`:

| Field | Meaning |
|---|---|
| `pi` | The PaymentIntent ID |
| `amount`, `currency` | The cents asked for, as the app stores money |
| `reader` | The reader it was sent to |
| `state` | `waiting`, `declined`, `held`, `cancelled`, `captured` or `uncaptured` |
| `order` | The order, once known |
| `refunded`, `failed`, `error` | Cents given back, cents whose refund failed, and the last reason |

The row's lookup key is the PaymentIntent ID until the order is known, then `order:<id>`.

Locks (`ctx.data.lock`): `reader:<id>` = one charge at a time per reader, `pi:<id>` = status, cancel and capture of one charge, `order:<id>` = refunds and retries of one order.

**Limits**

- Stripe's internet readers only: BBPOS WisePOS E and Stripe Reader S700. The Bluetooth readers (M2) need a mobile app and are not supported.
- Stripe Terminal is not sold in every country. The shop's Stripe account must be in a country that has it, and the shop's currency must be one the reader takes.
- Some cards need the card present for a refund (Interac in Canada). Those refunds fail and are shown as failed on the order page.
- The amount of a charge comes from the pay dialog. The order page's dialog shows it, so a wrong one can be seen.

**Testing without a reader**

- In Stripe's test mode, make a simulated reader (`simulated-wisepos-e`).
- `POST /v1/test_helpers/terminal/readers/:id/present_payment_method` plays the customer's tap.
- Stripe's test amounts give declined cards.
- `STRIPE_TERMINAL_API_URL` points the extension at a stand-in. It is for tests only.

Texts: `i18n/en.ts`.
Tests: `terminal.test.ts` (a stubbed `fetch`), `resources/js/lib/__tests__/approval.test.ts` (the picker's rule), `Extension.Service.test.ts`, `ExtensionEvents.test.ts` (`payment_ref`), `e2e/y-stripe-terminal.spec.ts`.
Its guide topic is `stripe-terminal`.
