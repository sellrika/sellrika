# Architecture

How the app is built: the stack, the request flow, the folders, and the rules every layer follows.

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Runtime and HTTP | Bun, `Bun.serve({ routes })` | No express. `app/xcore/http/Router.ts` builds the routes object. |
| Database | `Bun.sql` (`app/xcore/database/Database.ts`) | SQLite by default (`./data/pos.db`), or Postgres, or MySQL. Switched by env. |
| Views | Inertia v3 protocol (`app/xcore/view/Inertia.ts`) and Edge.js (`app/xcore/view/Edge.ts`, one instance) | Edge renders the root HTML template (`resources/views/app.edge`), the email templates (`resources/views/emails/*.edge`) and the store themes. |
| Frontend | Vue 3, Inertia Vue adapter, Tailwind v4, shadcn-vue (reka-ui), lucide icons, vue-sonner toasts | Built by Vite (`bunx --bun vite`). |
| Validation | zod v4 (`app/validators`) | `validate(schema, body)` gives `{ data }` or `{ errors }`. `errors` is a flat `field → message` map. |
| Dependency injection | typedi and reflect-metadata (`app/xcore/di.ts`) | Controllers, services and repositories are `@Service()` classes, wired by the constructor. |
| Auth | Cookie session (`sid`, httpOnly, 30 days), stored in the `sessions` table | Passwords use `Bun.password` (argon2). |

## Commands

```
bun run dev        # Bun server --hot on :3000 + Vite dev server on :5173 (assets and HMR only)
bun run build      # frontend → public/build (with a manifest) + SSR bundle → build/ssr + extensions → build/extensions
bun run start      # NODE_ENV=production bun app/server.ts (serves public/build)
bun run migrate    # apply pending migrations (up only)
bun run seed       # first admin + shop (also runs on boot)
bun run make:migration <name>
bun run test       # unit tests
bun check          # type check
bun run lint       # Biome
bun run test:e2e   # build, then Playwright
bun run compile    # single binary `compiled-server`
```

`bun run compile` sets `NODE_ENV=production` itself.
The value is inlined at compile time, so it must be `production`.

## Boot

`app/server.ts` does this, in order:

1. `migrate()`
2. `seed()`
3. `Storage.ensure()`
4. `ExtensionService.adoptShopUploads()`. It moves old per-shop extension uploads into the one catalog. After the first time it does nothing.
5. `SessionRepository.purgeExpired()`
6. `Bun.serve({ routes: router.routes })`. An unknown path gets a 404.
7. `JobRegistry.start()`

Migrations run on every boot.
A `ponytail:` note in `server.ts` says: split this into a command if several instances could race.

### Background jobs

`app/jobs/Job.Registry.ts` is the one list of background jobs.

- Each job is started with `Schedule.cron(name, expression, …)` (`app/xcore/schedule/Schedule.ts`).
- `Schedule.cron` runs on `Bun.cron`. It runs in the same process.
- Two runs of one job never overlap.
- Each job runs once on boot, and then on its timer.
- The expression has 5 fields and is read in UTC.
- A run that fails is logged. It never stops the server.

The jobs:

| Name | Service | What it does |
|---|---|---|
| `store-reconcile` | `StoreReconcileService` | Turns a paid online checkout whose buyer never came back into an order. |
| `marketing` | `MarketingService` | Sends the abandoned-cart emails and the campaigns that are due. |
| `exchange-rates` | `ExchangeRateService` | Fetches the automatic exchange rates when the schedule says so. |
| `daily-report` | `DailyReportService` | Sends the daily sales report of each shop whose time has come. |
| `domains` | `DomainService` | Checks custom store domains. Only while `DOMAIN_CNAME` is set. |

An add-on may add a job with `JobRegistry.add()`.

## Request flow

### 1. Routes

`routes/web.ts` loads the routes. There is one file per area.
It is the same split as `app/services` and the sidebar.

| File | What it holds |
|---|---|
| `routes/storefront.ts` | The public online shops |
| `routes/account.ts` | Health, sign-in, own settings, ⌘K search |
| `routes/sales.ts` | POS, orders, customers, coupons, reports, the `/online-store` admin |
| `routes/catalog.ts` | Products, categories, stock |
| `routes/settings.ts` | Shops, staff, payment methods |
| `routes/files.ts` | Uploads, the static `/uploads/*` from the storage driver, the `/build/*` Vite output |
| `routes/api.ts` | The REST API (`/api/v1`) |
| `routes/limits.ts` | The rate-limit buckets: `limit("name")` and `loginLimit` |

The router is Laravel-style (`app/xcore/http/Router.ts`):

- `router.get/post/put/patch/delete/any/resource/redirect/group`
- Each route points at `[Controller, "method"]`.
- One route per line.
- `router.any(path, action)` registers get, post, put, patch and delete.

Each file wraps its own routes in the middleware they need:

| Middleware | Who gets in |
|---|---|
| `Guard.maybeAuth` | Everyone (public pages) |
| `Guard.auth` | A signed-in user |
| `[Guard.auth, Guard.manager]` | Managers and admins |
| `[Guard.auth, Guard.admin]` | Admins only |
| `[Guard.auth, Guard.platform]` | The platform admin only |
| `limit("name")` | A rate-limit bucket |

Rules:

- `group` takes one middleware or a list. The first one is the outermost.
- A route takes its own middleware after the action:
  `router.post("/login", [AuthController, "login"], loginLimit)`.
- Order matters only inside a file. Put a static path before its `:param` twin.

### 2. Middleware

The middleware is the class `Guard` in `app/xcore/auth/Guard.ts`.
The class `Auth` in `Auth.ts` beside it holds `login`, `logout`, `current` and the customer session.

`Auth.current(req)` finds who is asking:

1. It reads the `sid` cookie.
2. `SessionRepository.findValid` finds the session.
3. It loads the user. The user must be `active`.
4. It finds the shop: the session's `shop_id` while that shop belongs to the user's account, else the account's first shop.

The guards:

| Guard | What it does |
|---|---|
| `Guard.signedIn` | Stores `{ user, session, shop }` with `Context.set(req, …)`. Nobody signed in: a redirect to `/login` (302 for a GET, 303 for anything else). |
| `Guard.confirmed` | `signedIn`, and the email must be confirmed. Else the `Auth/Confirm` page (GET) or a bare 403. |
| `Guard.auth` | `confirmed`, plus what an add-on says about the plan (`Hooks.plan`) on the context. A cashier's JSON answer loses its cost values. |
| `Guard.maybeAuth` | Never redirects. It only exposes the session when there is one. |
| `Guard.manager` | Inside `auth`. Managers and admins. |
| `Guard.admin` | Inside `auth`. Admins only. |
| `Guard.platform` | Inside `auth`. The platform admin only (`ADMIN_EMAIL`). |
| `Guard.comeBack` | Outside `auth`, on a GET page. A guest goes to `/login`, and the page is remembered in a cookie. |

When `manager`, `admin` or `platform` refuses someone:

- A GET gets the `Errors/Forbidden` page with status 403.
- Anything else gets a bare 403.

### 3. Controller

A controller does this:

1. Reads `ctx(req)` (`app/xcore/http/Context.ts`).
2. Parses the body with `HttpRequest.body(req)` (`app/xcore/http/Request.ts`). It gives the JSON, or `{}`.
3. Validates.
4. Calls a service.
5. Answers with `inertia(...)`, `redirect(...)`, `back(req, fallback)` or `json(...)`.

Where the helpers are:

| Helper | File |
|---|---|
| `json()`, `HttpResponse.html()`, `HttpResponse.unprocessable()` (422 `{ errors }`), `HttpResponse.notFoundText()` | `app/xcore/http/Response.ts` |
| `HttpRequest.body(req)`, `HttpRequest.idOf(req)`, `HttpRequest.formOf(req)`, the class `Query` (a list page's query string) | `app/xcore/http/Request.ts` |
| `inertia()`, `redirect()`, `back()`, `Inertia.notFound(req)`, `Inertia.away(req, url)` | `app/xcore/view/Inertia.ts` |

### 4. Service and repository

- Services hold the business rules.
  They return Inertia-style error maps (`Record<string,string> | null`) or result objects.
- Repositories hold all SQL.
  They use tagged templates on `sql`.
  Work with several statements goes in `sql.begin(tx => …)`.

## File naming

Every backend file names its layer. So a path says what the file is.

```
app/controllers/Auth.Controller.ts       app/validators/Shop.Validator.ts
app/services/sales/Order.Service.ts      app/constants/Pagination.Constant.ts
app/repositories/User.Repository.ts      app/models/Order.ts            (row types keep plain names)
app/gateways/firebase/Firebase.Api.ts    app/mail/smtp/Smtp.Mailer.ts
                                         app/mail/Mailer.Registry.ts
```

Class names stay plain: `AuthController`, `OrderService`, `UserRepository`.
Only the file names carry the suffix.

Tests move into a `__tests__/` folder once a directory has more than one.

### `app/xcore/` and `app/helpers/`

`app/xcore/` holds **framework code only**.

- One folder per concern.
- One class per file.
- The file is named after its class.

Anything util-shaped lives in `app/helpers/` instead. Those files have no dependencies.

```
app/xcore/
  di.ts
  auth/        Auth Guard ApiGuard Account
  database/    Database MysqlDdl
  http/        Router Request Response Context Url Paginate RateLimit Compress Headers Outbound
  api/         ApiResponse OpenApi Mcp ApiCall
  view/        Inertia Edge Ssr Vite StoreView
  storage/     Storage OrderImages
  extensions/  ExtensionFiles ExtensionLoader ExtensionI18n
  hooks/       Hooks
  i18n/        I18n
  schedule/    Schedule

app/helpers/
  crypto.ts  csv.ts  html.ts  slug.ts  time.ts  json.ts  secretFields.ts  error.ts
  currency.ts  tax.ts  discount.ts  costs.ts  feed.ts  zip.ts  qr.ts  webauthn.ts
  color.ts  lock.ts  workers.ts  catalogVersion.ts  TtlCache.ts
  __tests__/
```

### Services are grouped like the sidebar

The folders follow the sections of `resources/js/layouts/AppLayout.vue`.
So "where does this live" has the same answer on both sides.

| Folder | Sidebar section | Services |
|---|---|---|
| `app/services/sales/` | Orders, Customers, Reports, and the storefront | `Order`, `Customer`, `Report`, `DailyReport`, `Coupon`, `CartPricer`, `Store`, `StoreView`, `StoreAuth`, `StoreReconcile`, `OrderMail`, `OrderAlert`, `Domain`, `PostalCode`, and the folders `store/` and `marketing/` |
| `app/services/catalog/` | Products, Stock, Categories | `Product`, `ProductCsv`, `Stock`, `Category` |
| `app/services/settings/` | Shops, Staff, Payments, email and sign-in | `Shop`, `User`, `SalesStaff`, `PaymentMethod`, `Mail`, `Auth`, `Passkey`, `Signup`, `Invite`, `LinkToken`, `Owner`, `ApiKey`, `OAuth`, `ExchangeRate`, `PlanLimit`, and the folder `extensions/` |
| `app/services/` (root) | Spans every group | `Search`, `Upload` |

Notes:

- `Store.Service` sits under **sales**, not settings.
  The sidebar's "Online Store" entry is the settings *page*.
  But the service is the storefront, its checkout and its fulfilment. Selling online is still selling.
- A service that grew past one file gets its own folder next to its siblings.
- Controllers, repositories and validators stay flat.
  There are fewer of them, and they already map 1:1 to a route group.

## Imports

Imports use path aliases. A `../..` in an import is a bug.
A file in the same directory stays relative: `./Sibling`.

| Alias | Points at |
|---|---|
| `@/*` | `resources/js/*` (the frontend) |
| `@config/*` | `config/*` |
| `@constants/*` | `app/constants/*` |
| `@controllers/*` | `app/controllers/*` |
| `@database/*` | `database/*` |
| `@emails/*` | `app/emails/*` |
| `@extensions/*` | `extensions/*` |
| `@gateways`, `@gateways/*` | `app/gateways` (the manual payment options and Firebase only. Payment providers are extensions.) |
| `@helpers/*` | `app/helpers/*` |
| `@i18n`, `@i18n/*` | `i18n` |
| `@jobs/*` | `app/jobs/*` |
| `@mail`, `@mail/*` | `app/mail` |
| `@models/*` | `app/models/*` |
| `@repositories/*` | `app/repositories/*` |
| `@resources/*` | `resources/*` |
| `@routes/*` | `routes/*` |
| `@services/*` | `app/services/*` |
| `@validators/*` | `app/validators/*` |
| `@xcore/*` | `app/xcore/*` |

The aliases are declared **twice**. Both lists must stay the same:

- `tsconfig.json` › `compilerOptions.paths`. Bun reads these at runtime, also in `bun build --compile`.
- `vite.config.ts` › `resolve.alias`. The browser code imports shared server code (validators, constants), so both Vite builds need them too.

## Facades and shared classes

Some classes grew too big for one file.
They were split, and the old name stayed as the way in.

### `StoreService`

`app/services/sales/Store.Service.ts` is a thin facade.
Its public methods are unchanged. They pass the call on to five services in `app/services/sales/store/`:

| Service | What it does |
|---|---|
| `StoreCatalogService` | The public catalog |
| `StoreSettingsService` | The `/online-store` settings and custom pages |
| `StorePaymentService` | Which payment options a shop offers |
| `StoreCheckoutService` | Checkout, coupon quote, pay, address lists |
| `StoreFulfillService` | The order, written once. Track. |

### `CartPricer`

`app/services/sales/CartPricer.Service.ts` turns cart lines into money.
The POS and the store both use it, for a checkout and for a coupon quote.

### `ExtensionService`

`app/services/settings/extensions/Extension.Service.ts` is a facade too.
The files are named `Extension.<Name>.ts`.

| Class | What it does |
|---|---|
| `ExtensionCatalog` | The code: built-ins, uploads, the global switch |
| `ExtensionSettings` | A shop's list and saved settings |
| `ExtensionRuntime` | What runs for a shop: pages, slots, payments, themes, guides, tools |
| `ExtensionRoutes` | `handle` |
| `ExtensionEvents` | `emit` |

### Controllers

| Controller | What it serves |
|---|---|
| `HomeController` | The page at `/`. On a store's host it is the store. On the main host a signed-in user goes to the POS, and everyone else goes to the sign-in. An add-on may put a front page there with `Hooks.frontPage`. |
| `StoreController` | The public store |
| `StoreAccountController` | The customer account |
| `StoreSettingsController` | The `/online-store` admin pages |

Code that several controllers share is in `app/controllers/support/`:

- `StorefrontSupport`: `find(req)` gives the shop of a public request.
  `open` / `openJson` / `openCustomer` give that, or the 404 answer.
- `ExtensionHandles`: the functions an extension route gets that have no API route.

The API controllers of one record type extend `ApiController` (`app/controllers/api/Api.Controller.ts`).
It answers 404 for a record of another shop, then 422 for a refused body.

### Shared small pieces

| Piece | Where |
|---|---|
| `Db.one()`, `Db.exists()`, `Db.nullsLast()` | `@xcore/database/Database` |
| `parseJson`, `safeJson` | `app/helpers/json.ts` |
| `openFields`, `maskFields` | `app/helpers/secretFields.ts` |
| `messageOf` | `app/helpers/error.ts` |
| The zod fields many forms share: `email`, `personName`, `hexColor`… | `app/validators/Fields.Validator.ts` |
| Shared time and validation literals | `app/constants/Time.Constant.ts`, `Validation.Constant.ts` |
| `HttpMailer`, the base of the HTTPS mail providers | `app/mail/Http.Mailer.ts` |
| `LinkEmail`, the base of the invite, confirm and reset emails | `app/emails/Link.Email.ts` |
| `UploadCleaner`, which deletes pictures nothing uses any more | `app/services/Upload.Service.ts` |
| `LinkTokenService`, the person an emailed link is for | `app/services/settings/LinkToken.Service.ts` |

## Add-ons

An add-on is extra code outside this app that changes it.
The open-source app runs with none.

An add-on may change the app only in these places:

- `Hooks` in `app/xcore/hooks/Hooks.ts`: `frontPage`, `docsPage`, `docs`, `plan`, `signedUp`, `signup`, `sitePaths`, `closedHosts`, `ssrPages`, `guides`.
- The DI container. It can put its own class in the place of a service.
- The router. It can add routes.
- `JobRegistry.add()`. It can add a background job.
- `extend()` of `@i18n`. It can add its own words.

Rules:

- Core code never imports from an add-on.
- The app leaves every hook at its default.
- Hooks are set before the server starts, never during a request.

## Constants (`app/constants/`)

One file per area: `<Area>.Constant.ts`.
They hold the literals someone would otherwise search for:

- page sizes
- TTLs
- cookie names
- allowlists
- provider endpoints
- catalogues (countries, timezones, payment icons, store templates, CSV columns)

A constant that derives a type keeps that type beside it: `ROLES` + `Role`, `STORE_TEMPLATES` + `StoreTemplate`.

These are **not** constants, and stay where they are used:

- `sql` tagged-template fragments, like `COLS` in `Shop.Repository.ts` and `stats` in `Customer.Repository.ts`. They are pieces of one query.
- Module-private helper functions.

## Dependency injection (`app/xcore/di.ts`)

Every controller, service and repository is a `@Service()` class.
Its collaborators arrive through the constructor.
Each one is a singleton for the whole container.

```ts
@Service()
export class CategoryService {
  constructor(private categories: CategoryRepository) {}
  list(shopId: number) { return this.categories.allForShop(shopId); }
}
```

Rules:

- **Import `@Service` from `app/xcore/di.ts`, never from `"typedi"`.**
  That module imports `reflect-metadata` first, which the decorators need.
  It also re-exports `Container` and `Inject`.
- Constructor types are read from `design:paramtypes`.
  So `tsconfig.json` needs `experimentalDecorators` and `emitDecoratorMetadata`. Both are on.
- **No circular imports between injected classes.**
  A cycle makes the emitted paramtype `undefined`, and `Container.get` throws at boot.
- Routes point at a class:
  `router.get("/login", [AuthController, "showLogin"])` and `router.resource("/products", ProductController)`.
  The router resolves the singleton and binds the method. So `this` works inside a handler.
- Code outside the container pulls what it needs with `Container.get(XRepository)`.
  Examples: `Auth` and `Guard` in `app/xcore/auth/`, the shared props in `app/xcore/view/Inertia.ts`, `database/seed.ts`.
- Repositories take `sql` from `app/xcore/database/Database.ts` directly. The connection is not injected.
- Every method carries a JSDoc block: a summary, `@param` and `@returns`.

### Helpers belong to their class

A helper that a class file needs is a method of that class, not a loose function.

- `#private` when only the class uses it.
- A public `static` when other files call it:
  `CartPricer.mergeItems`, `CartPricer.stockMessage`, `ReportService.resolveQuery`, `StoreViewService.storeSeo`.
- Only helpers shared by several areas stay exported functions in `app/helpers/`, like `discountAmount` in `@helpers/discount`.

### Mailers and gateways

- Mailers are classes: `SmtpMailer`, `ResendMailer` and `AzureMailer`, behind `MailerRegistry`.
  The two HTTPS ones extend `HttpMailer`.
- The manual payment options sit behind `GatewayRegistry`.
  Payment providers are extensions, not injected classes.
- Inject the registry. There is no module-level `GATEWAYS` or `MAILERS` object.

### In tests

Tests resolve a class the same way:

```ts
const { X: _X } = await import("./X");
const X = Container.get(_X);
```

## Inertia (`app/xcore/view/Inertia.ts`)

### Rendering

`inertia(req, component, props, status, view)`:

- An `X-Inertia` request gets JSON.
- A first load gets the full HTML, from Edge.
- `view` holds the `<title>` and extra `<head>` tags of a full load. Only a public page needs them.
- The asset version is the hash of the Vite manifest.
  A mismatch on a GET gives 409 with `X-Inertia-Location`. The client then reloads.
- A cashier's page never carries cost values. `withoutCosts` removes them.

### Shared props

Every page gets these:

| Prop | Value |
|---|---|
| `locale` | The language of the request |
| `auth.user` | `{ id, name, email, role, platform }`. `platform` is true for the platform admin. |
| `shop` | The active shop |
| `store_url` | The active shop's online store: its own domain, else its subdomain |
| `shops` | The account's shops, for the switcher |
| `low_stock` | The sidebar badge on Stock. 0 for a cashier. |
| `extension_ui` | The running extensions' sidebar pages and slot scripts |
| `plan` | What an add-on says about the account's plan. `null` = nothing. |
| `errors` | Default `{}` |

With nobody signed in, they are empty values.

### Errors and redirects

- After a failed POST the page is rendered again with `errors`.
  The URL stays on the referer.
  There is no flash layer and no redirect-back-with-errors.
- `redirect(to)` is always 303. Inertia needs that after PUT, PATCH and DELETE.
- `back(req, fallback)` redirects to the referer.
- A `Referer` is only ever used through `Url.samePath()`. A forged one can never move the browser off the site.
- `Inertia.away(req, url)` sends the browser to another site.

### Partial reloads

A partial reload is `router.reload({ only })`.
Its headers are `X-Inertia-Partial-Component` and `X-Inertia-Partial-Data` or `X-Inertia-Partial-Except`.

- It gets only the named props, plus `errors`.
- The browser keeps the rest.
- A prop may be a **function**. `Inertia.#resolve` calls it only when the prop is sent.
- All such functions run side by side.
- The shared props that read the database are such functions: `shops`, `low_stock`, `extension_ui`.

### The frontend entry

`resources/js/app.ts`:

- It resolves pages with `import.meta.glob("./Pages/**/*.vue")`.
- The glob is not eager. So Vite makes one chunk per page, and a visit downloads only the page it opens.
- It gives Inertia no `setup`. Inertia mounts the app itself.
- When the mount element says `data-server-rendered`, Inertia takes the page over.

The layout is `resources/js/layouts/AppLayout.vue`:
the sidebar nav filtered by role, the shop switcher, the user menu, and the mobile bottom bar.

### SSR

Server-side rendering is for public Inertia pages that an add-on brings.
The open-source app has none: `Hooks.ssrPages` is empty, so nothing is rendered on the server.
(The online store is not Inertia. It is always plain HTML from Edge.)

Why it exists: crawlers and link previews do not run the script.
With SSR the HTML holds the real text, in the language of the request.

How it works:

1. `resources/js/ssr.ts` is the server entry. It exports `render(page)`, the HTML for inside `<div id="app">`.
2. `vite build --ssr` bundles it to `build/ssr/ssr.js`. It is one file with nothing external.
3. `Ssr.render(page)` in `app/xcore/view/Ssr.ts` loads the bundle once and calls it.
   The path is `config/app.ts` › `ssrBundle` (env `SSR_BUNDLE`).
4. `inertia()` prints the HTML into the Edge shell on a full page load.

Rules:

- Only a page named in `Hooks.ssrPages` is rendered.
- It never breaks a page. With no bundle, or a render that throws, there is a log line, and the browser renders the page as before.
- Production only (`NODE_ENV=production`).
  In `bun run dev` Vite serves the source, so a built bundle would be older than the page.
- One render at a time. `render()` queues.
  Inertia keeps the current page in one place per process. Two renders at once could mix their language or user.
- A server-rendered page must not touch `window`, `document` or `localStorage` while it renders.
  Use them only in event handlers or `onMounted`.

## JSON endpoints (not Inertia)

| Endpoint | Answer | Used by |
|---|---|---|
| `POST /pos/checkout` | 201 `{order}` or 422 `{errors}` | `components/pos/CheckoutDialog.vue` |
| `POST /orders/:id/refund` (admin) | 201 `{refund}` or 422 | `Pages/Orders/Show.vue` |
| `GET /customers/search?q=` | `{customers}` | `components/pos/CustomerPicker.vue` |
| `POST /customers` with `Accept: application/json` | 201 `{customer}` or 422 `{errors}` | The quick-add in `CustomerPicker` |
| `GET /stock/movements?product_id=&variant_id=&page=` | `Paged<StockMovement>` | The history dialog of `Pages/Stock/Index.vue` |
| `POST /uploads` (multipart `file`, managers and admins) | 201 `{url}` or 422 | `lib/upload.ts` → `ImageUpload.vue` / `ImagesUpload.vue` |
| `GET /health` | `{status:"ok"}`, or 503 `{status:"error"}` | Health checks |

This table shows the main ones. It is not every JSON route.

## Conventions

### Money

- Integer cents everywhere: database, API and props.
- The UI formats with `money(cents, currency)` in `lib/format.ts`.
- It parses with `toCents()`.
- `fromCents()` prints a plain `12.34` for form inputs.

### Time

- The database stores UTC: `"YYYY-MM-DD HH:MM:SS"` text in SQLite, a `timestamp` in Postgres.
- Shop-local logic lives in `app/helpers/time.ts`:
  `inZone`, `zonedToUtc`, `ymd`, `dayRange`, `startOfToday`, `bucketKey`, `bucketKeys`, `dbDate`, `sqlStamp`.
- It uses `Intl` only. There is no time zone library.
- The UI renders with `fmtDate()` in the viewer's locale.

### Booleans and JSON from SQLite

- Booleans arrive as 0 or 1. Repositories normalise them (`!!r.active`, `!!r.tendered`…).
- JSON columns (`images`, `attributes`) are text. The repository parses them.

### Pagination (`app/xcore/http/Paginate.ts`)

- `Paginate.params(req, key)` reads `?page=` and `?per_page=`.
- With no `?per_page=`, it reads the `pp_<key>` cookie. `lib/fitPage.ts` sets that cookie from the viewport height.
- `per_page` is clamped to 5..100. The default is 20.
- Repositories return `Paginate.of(data, total, page, perPage)`.
  The shape is `{data, total, page, per_page, last_page}`.
- `Paginate.limit(page, perPage)` is the `limit … offset …` end of the query.
- Filters (`?q=`, `?method=`, `?status=`…) are server-side.
- The UI is `components/Pager.vue`.

### Per-shop scoping

- Every repository query for shop data takes `shopId` and filters on it.
  It uses `where shop_id = …`, or the product join.
- Never trust an id from the client without the shop filter.

### Deletes keep history

- Orders keep item names and prices.
- Payment methods are stored by name on orders.
- Deleting a customer nulls `orders.customer_id`.
- Users with activity can only be deactivated.

### Errors as props

- Validation and rule errors are `Record<string,string>`, keyed by field.
- Arrays use keys like `"variants.0.barcode"` and `"items.1.qty"`.
- A page-level message uses a pseudo field: `cart`, `shop`, `delete`, `void`, `user`.

### Theme

- Light, dark or system. The user picks it in the Theme submenu of the user menu in `AppLayout.vue`.
- `useColorMode()` (VueUse) toggles `.dark` on `<html>`.
- It remembers the choice in `localStorage` under `vueuse-color-mode`.
- An inline script in `resources/views/app.edge` applies it before first paint. So there is no flash.

### `ponytail:` comments

They mark a deliberate simplification and its upgrade path.

## Configuration (`config/`, `.env.example`)

The main variables. `.env.example` lists every one.

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | The server port |
| `NODE_ENV` | — | `production` = serve `public/build`, secure cookies. Inlined at compile time. |
| `VITE_URL` | `http://localhost:5173` | The dev asset server |
| `DB_CONNECTION` | `sqlite` | `sqlite`, `postgres` or `mysql` |
| `DB_FILE` | `./data/pos.db` | The SQLite path |
| `DATABASE_URL`, or `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE`. Also `DB_POOL_MAX`, `DB_IDLE_TIMEOUT`, `DB_CONNECT_TIMEOUT`. | — | Postgres and MySQL |
| `DB_ALLOW_PUBLIC_KEY_RETRIEVAL` | — | MySQL 8 without TLS: `1` lets the app ask for the server's public key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@sellrika.local` / `password` | The first-boot admin. Only used when `users` is empty. |
| `GA_ID` | — | The Google Analytics 4 id (`G-…`) of the main site. `app.edge` prints it for visitors only, never for a signed-in user. `app.ts` switches it off when someone signs in. Empty = off. A store uses `shops.ga_id`. |
| `STORAGE_DRIVER` | `local` | Where uploaded images go: `local`, `s3`, `azure` or `gcs`. One [flydrive](https://flydrive.dev) service each (`config/storage.ts`, `app/xcore/storage/Storage.ts`). Azure uses `flydrive-azure`. |
| `UPLOAD_DIR` | `storage` | The root of the `local` driver. Files sit at `<UPLOAD_DIR>/uploads/…`. Tests override it. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | For `s3`. The endpoint is for R2, MinIO or Spaces. |
| `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`, or `AZURE_STORAGE_ACCOUNT` + `AZURE_STORAGE_KEY` | — | For `azure` |
| `GCS_BUCKET`, `GCS_KEY_FILE` | — | For `gcs` |

## Build, compile, Docker

### `bun run build`

It runs three steps:

1. The client bundle, into `public/build` with `.vite/manifest.json`. `app/xcore/view/Vite.ts` reads the manifest once in production.
2. The server bundle, into `build/ssr/ssr.js` (`vite build --ssr`).
   It holds everything it imports (`ssr.noExternal`), so it needs no `node_modules` at runtime.
   It is server code, so it stays out of `public/`.
3. The built-in extensions, into `build/extensions`.

`BUILD_DIR` moves the client bundle. The build and the server both read it.

### Responses

- The router gzips every text-like body over 1 KB when the client accepts it.
  The code is `app/xcore/http/Compress.ts`. The types are `COMPRESSIBLE_TYPES` in `app/constants/Http.Constant.ts`.
  `Bun.serve` sends bodies as they are, so the app does this itself.
- `/build/*` and `/uploads/*` are sent with `cache-control: public, max-age=31536000, immutable` (`STATIC_CACHE_CONTROL`).
  Build files are content-hashed and uploads are named by UUID. So a URL never changes its bytes.
- The gzipped build files are kept in memory after the first request.

### `bun run compile`

It bundles the server into `compiled-server`.

- Every Edge template (the root view and the emails) is imported `with { type: "text" }`, so it is embedded.
- These are still read from disk, next to the binary:
  - `public/build`
  - `build/ssr/ssr.js` (the SSR bundle, loaded with `import()`)
  - `build/extensions`
  - `storage/uploads` (when `STORAGE_DRIVER=local`)

### `Dockerfile`

1. Build stage: `bun install`, `bun run build`, compile.
2. Runtime: `debian:bookworm-slim` with only the binary, `public/build`, `build/ssr` and `build/extensions`.

Volumes: `/app/data` (SQLite) and `/app/storage` (uploads and uploaded extensions).

`GET /health` is there for a health check.

## Frontend layout

```
resources/js/
  app.ts                 Inertia bootstrap
  ssr.ts                 the server entry of server-rendered pages
  types.ts               shared TS types (mirror of the server props)
  layouts/AppLayout.vue  sidebar and mobile nav, shop switcher, user menu
  Pages/<Area>/*.vue     Inertia pages
  components/ui/*        shadcn-vue primitives
  components/*.vue       shared pieces: CurrencySelect, TimezoneSelect, IconPicker, ColorPicker, CategoryDot, Pager, ReceiptSlip, ShopLogo, BackButton…
  components/pos/*       ProductCard, CartPanel, CheckoutDialog, CustomerPicker, PaymentMethodPicker, PaymentShow
  components/products/*  VariantsEditor, BundleItemsEditor, CategoryPicker, ImageUpload, ImagesUpload, ImageEditor, ShareDialog, UnitSelect
  store/                 `window.Store` and the checkout island of the online store
  lib/                   format (money, dates), auth, fitPage, orders (status badges), paymentIcons, upload, utils (cn)…
resources/css/app.css    Tailwind + shadcn theme + receipt print CSS
resources/views/app.edge root HTML
resources/views/emails/  outgoing email templates
resources/views/store/   shared store pages
resources/views/themes/  the store themes
```

The page areas under `Pages/`:
`ApiKeys`, `Auth`, `Categories`, `Coupons`, `Customers`, `Email`, `Errors`, `ExchangeRates`, `Extensions`, `Marketing`, `OAuth`, `OnlineStore`, `Orders`, `Owners`, `PaymentMethods`, `Pos`, `PostalCodes`, `Products`, `Reports`, `Settings`, `Shops`, `Stock`, `Users`.
