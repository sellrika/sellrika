# Sellrika

A point of sale with an online store, for small shops. Self-hosted.

- **Backend**: Bun only. `Bun.serve` routes and `Bun.sql`.
- **Frontend**: Inertia v3, Vue 3, Tailwind v4, shadcn-vue. Built by Vite.
- **Online store**: server-rendered Edge templates. No Inertia there.
- **Database**: SQLite, Postgres or MySQL.

This file is the short version. The detail is in `docs/` (start at `docs/README.md`) and in `.claude/skills`.
Keep it short: one or two lines per topic, then a link to the doc.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Bun server with hot reload (http://localhost:3000) and the Vite dev server (5173) |
| `bun run build` | Client bundle to `public/build`, the SSR bundle to `build/ssr`, the built-in extensions to `build/extensions` |
| `bun run start` | Production server. It serves `public/build`. |
| `bun run migrate` | Apply pending migrations. Up only. It also runs on boot. |
| `bun run seed` | Make the first admin and shop. It also runs on boot. |
| `bun run make:migration <name>` | New file in `database/migrations/`, registered in `migrations/index.ts` |
| `bun run make:extension <key>` | New folder `extensions/<key>/`. With `--custom`: `custom-extensions/<key>/`. |
| `bun run build:extension <key>` | Zip it to `extensions/<key>/dist/` |
| `bun run lint` | Biome check. `bun run format` fixes and formats. |
| `bun check` | Type check |
| `bun run test` | Unit tests of `app`, `resources` and `extensions`. Not plain `bun test`: that skips two of the folders. |
| `bun run test:e2e` | Build, then Playwright. One file: `bunx playwright test e2e/<file>.spec.ts` |
| `bun run compile` | One binary, `compiled-server`. No Bun needed to run it. |
| `bunx shadcn-vue@latest add <name>` | A UI component, into `resources/js/components/ui` |

## Done means

Every change ends with all of these:

1. `bun run lint && bun check && bun run test && bun run test:e2e` are green.
2. The feature doc in `docs/features/` is updated.
3. This file is updated, if a rule or an invariant below changed.

## Layout

A request goes down these layers. Each layer has one job.

| Layer | Folder | Job |
|---|---|---|
| Route | `routes/` | One route per line. It points at `[Controller, "method"]`. |
| Controller | `app/controllers/` | Read the request, call a service, answer |
| Validator | `app/validators/` | zod schemas. `validate()` turns problems into Inertia errors. |
| Service | `app/services/<group>/` | The business rules |
| Repository | `app/repositories/` | All SQL |
| Model | `app/models/` | Row types |

Other folders:

| Folder | Holds |
|---|---|
| `app/xcore/` | The mini-framework. Framework code only. One class per file. |
| `app/helpers/` | Small utilities with no dependencies. Anything util-shaped goes here, never in `xcore`. |
| `app/constants/` | Every literal worth finding. One `*.Constant.ts` file per area. |
| `app/emails/`, `app/mail/` | One class per email. One mailer per provider. |
| `app/gateways/` | The manual payment options and the Firebase client. Payment providers are extensions. |
| `app/jobs/` | The background jobs. One list in `Job.Registry.ts`. |
| `config/` | Everything read from the environment |
| `database/migrations/` | The migrations |
| `extensions/` | The built-in extensions, and `types.ts` for extension authors |
| `custom-extensions/` | Our own extensions, a git repository of its own (git ignores it here). Loaded like the built-in ones. |
| `i18n/` | The dictionaries: `en.ts` is the source, plus `de.ts` and `th.ts` |
| `resources/js/` | The staff app: `Pages/`, `components/`, `layouts/`, `lib/`, `types.ts` |
| `resources/js/store/` | `window.Store` and the checkout island of the online store |
| `resources/views/` | Edge templates: `app.edge`, `themes/<name>/`, `store/`, `emails/` |
| `resources/guide/` | How-to texts for shop owners, read by AI assistants |
| `e2e/` | Playwright specs. They run under Node, so no Bun globals there. |

More: `docs/architecture.md`, `docs/database.md`, `docs/testing.md`.

## Code rules

**Structure**

- Controllers, services and repositories are `@Service()` classes, wired through the constructor.
- Import `Service` and `Container` from `app/xcore/di.ts`, never from `"typedi"`.
- No circular imports between injected classes.
- Services are grouped like the sidebar: `sales/`, `catalog/`, `settings/`. A service that grows past one file gets its own folder.
- File names carry their layer: `Order.Service.ts`, `User.Repository.ts`, `Shop.Validator.ts`. Class names stay plain: `OrderService`.
- Imports use path aliases, never `../..`. A file in the same folder stays `./Sibling`.
- A new alias goes in `tsconfig.json` › `paths` **and** in `vite.config.ts` › `resolve.alias`.
- Constants live in `app/constants/`, never inline in a service or a controller.
- Every method has a JSDoc block.
- Tests sit in a `__tests__/` folder once a folder has more than one. A lone test file stays next to its module.

**Bun**

- Bun APIs only on the backend. No express, no pg, no node-only packages.
- Use a Bun built-in when one exists. Where there is none, keep the `node:` import and say why in a comment.
- `experimentalDecorators` and `emitDecoratorMetadata` stay on in `tsconfig.json`. The DI reads constructor types from them.
- `process.env.NODE_ENV` is inlined at compile time. Always compile with `NODE_ENV=production`.

**Database**

- A migration must run on SQLite, Postgres and MySQL. Use `ID_PK` and `text` / `integer` / `timestamp` / `boolean`. One column per line.
- No `returning` and no `on conflict` in a query. Use `Db.insert`, `update`, `delete`, `upsert`, `insertOnce`.
- More MySQL rules: `docs/database.md` › MySQL.

**Tests**

- All unit tests share one process. Never call `sql.close()` in a test file.
- Use a temp `DB_FILE` and `UPLOAD_DIR`. Migrate only `if (!migrated)`.
- Each e2e spec gets its own production server and its own throwaway database.

**Frontend**

- Every back arrow is `components/BackButton.vue`. Never a plain `<Link>`.
- Every icon-only button has a tooltip: `components/WithTooltip.vue`. Never a `title` attribute.
- Every pay dialog draws its method buttons with `components/pos/PaymentMethodPicker.vue`. What all pay dialogs should have goes in that picker.
- `resources/js/types.ts` mirrors the server's props. Change both.
- A page prop must not have the name of a shared prop. It would replace it in the layout.

## Invariants

These hold everywhere. A change that breaks one is a bug.

**Shops and people**

- Almost everything belongs to a shop: categories, products, orders, customers, payment methods, store settings. The active shop is on the session.
- Every user belongs to one account: `Account.id(user)`. People see only their own account's shops and staff.
- Roles are `admin`, `manager`, `cashier`. Enforce them with `Guard.manager` / `Guard.admin` on the route. Never only in the UI.
- The platform admin is the user whose email is `ADMIN_EMAIL`. There is no database flag. Only they change platform settings, behind `Guard.platform`.
- Nobody can demote, switch off or delete themselves or a shop's owner.

**Money and time**

- Money is integer cents, everywhere.
- A checkout reads prices and costs again from the database. It never trusts the request.
- `total = subtotal − discount`. The discount is worked out again on the server.
- Tax has one rule: `taxAmount()` and `taxLabel()` in `app/helpers/tax.ts`. Delivery is never taxed.
- Database times are UTC. `shops.timezone` decides "today" and the report buckets.
- Shown money drops a `.00` ($18, $18.23). Machine values keep two decimals.

**Stock**

- Stock is a ledger. Every change is a `stock_movements` row, written through `StockRepository.move(tx, …)`. It refuses a negative count.
- `products.stock` and `product_variants.stock` are running totals. The product form never edits them. The `/stock` page does.
- A checkout checks stock first, and again inside the transaction.

**Orders**

- `orders.payment_method` stores the method's **name**, so history survives a rename. The tax label is frozen the same way.
- An order line keeps its own copy of the product picture. Order pictures are never deleted.
- A void puts stock back and is left out of every report.
- There is no way to delete one order. Orders go only when their whole shop is deleted.

**Uploads**

- Product pictures are always our own uploads. A link or a base64 picture is copied into storage on save.
- A picture nothing uses any more is deleted from storage. `UploadRepository.inUse` knows every place that stores a path.

**Security**

- Cookies are `sameSite=lax`. That is the CSRF defence. So a route that changes something is never a `GET`.
- An endpoint that can be abused sits in a `RateLimit.middleware()` group.
- List inputs have a maximum.
- `X-Forwarded-*` is trusted only when `TRUST_PROXY=1`.
- Secrets are stored encrypted with `APP_KEY`. They never go to the browser.
- The public store payload never carries costs or credentials.
- More: `docs/security.md` and the `security` skill.

**Languages**

- Every text a person reads goes through `t("area.key")`. zod messages are keys too.
- `i18n/en.ts` is the source. The other files must have the same keys.
- Code shared by browser and server returns keys. It never imports `@xcore/i18n/I18n`.

**Background work**

- There are no webhooks. Jobs ask the outside service again: `Schedule.cron()` is the only background primitive.
- An email or an extension event is fired after the write. It is never awaited and never throws.

## Features

One line each. The doc has the routes, the columns and the edge cases.

| Feature | In short | Doc |
|---|---|---|
| Shops | Per-shop data, currency, timezone, tax, the shop switcher | `docs/features/shops.md` |
| Sign-in and users | Roles, accounts, the platform admin, invites, sign-up, passkeys, Google and Microsoft sign-in, sales staff and commission | `docs/features/auth-and-users.md` |
| Products | Prices, variants, pictures and the image editor, packages (`kind = bundle`), CSV import and export | `docs/features/products.md` |
| Stock | The ledger and the `/stock` page | `docs/features/stock.md` |
| Sell screen | The cart, the checkout dialog, Pay later, receipts, the customer screen | `docs/features/pos-checkout.md` |
| Orders | Statuses, payments, open orders, delivery steps, refunds, void, history | `docs/features/orders.md` |
| Payment methods | Per shop. A method may have a picture. An extension may add one. | `docs/features/payment-methods.md` |
| Customers | Per shop. Phone is unique per shop. Several addresses each. | `docs/features/customers.md` |
| Coupons | One code per order. Every rule is `CouponService.resolve`. | `docs/features/coupons.md` |
| Reports | Sales reports and the daily report to chat | `docs/features/reports.md` |
| Marketing | Abandoned-cart email, campaigns, unsubscribe | `docs/features/marketing.md` |
| Email | The platform's setup, a shop's own setup, one class per email | `docs/features/email.md` |
| Online store | One store per shop, found by host. Catalog, checkout, delivery zones, customer accounts, currencies, custom domains. | `docs/features/online-store.md` |
| Store themes | Edge themes, `window.Store`, a shop's own colours and font | `docs/features/store-themes.md` |
| Store SEO | Head tags, sitemap, robots, the product feed | `docs/features/store-seo.md` |
| Extensions | Add-ons in TypeScript: events, routes, pages, slots, data, payment providers, themes | `docs/features/extensions.md` |
| REST API and MCP | `/api/v1` with a key per shop, the OpenAPI file, the MCP server, OAuth sign-in | `docs/features/api.md` |
| Search | The ⌘K palette | `docs/features/search.md` |
| Languages | English, German, Thai. A shop picks its store's languages. | `docs/features/i18n.md` |

Guides: `docs/guides/custom-domain.md`, `docs/guides/firebase-setup.md`, `docs/guides/kiosk-mode.md`, `docs/guides/hooks.md`.

## Things that are easy to get wrong

- **The online store is found only by host**: the shop's own domain, or `<slug>.<STORE_DOMAIN>`. There is no `/store/<slug>` page.
- **Payment providers are extensions**, never built in: `extensions/stripe`, `omise`, `2c2p`, `paypal`. Only one runs per shop. Cash on delivery and bank transfer are built in (`app/gateways/manual/`).
- **An online order is created once**, by `StoreService.fulfill`. `StoreReconcileService` asks the provider again about every checkout with no order yet.
- **Delivery has one rule**: `deliveryZone()` and `deliveryFee()` in `app/validators/StoreCustomer.Validator.ts`. The checkout page and the server share it.
- **Store currencies are display only.** Checkout, orders, emails and reports stay in `shops.currency`.
- **Extensions never get raw SQL.** They keep data in `ctx.data`. They get the REST API as functions, built from the same routes.
- **An extension runs** only when it is in the catalog, enabled for all shops, installed, enabled by the shop, and every required field is filled.
- **Built-in extensions** are read raw in development and from `build/extensions` in production. `bunx playwright test <file>` does not build: run `bun run build` first after a change.
- **An extension's store pages** (manifest `storefront.path`) are served by the last route, `GET /*`. Every route of the app wins over it. The page is drawn by `ctx.storefront.page()`, which always cleans the body.
- **Rich text never holds picture data.** A picture is uploaded first; the text keeps its `/uploads/…` path or an https link. On a store page it is loaded from the app's own host (`Url.uploadsIn`), never the store's.
- **A new extension event** needs `EXTENSION_EVENTS`, `ExtensionEvents`, `extensions/types.ts` and the `emit()` call. A new slot needs `EXTENSION_SLOTS`, an `<ExtensionSlot>` and `SlotContexts`.
- **An API route carries its own docs.** `routes/api.ts` registers both. The OpenAPI file, the MCP tools and the extension functions are all built from it.
- **An API key is shown once.** Only its SHA-256 is stored.
- **`PlanLimitService` is the one place that may refuse a new record** for a limit. In this app it never refuses.
- **Something country-specific is an extension**, not core. Add a general hook to the core first.
- **A changed screen needs its guide changed**: `resources/guide/<topic>.md`, or the extension's own `guide.md`.

## Add-ons

An add-on is extra code outside this app that changes it. The app runs fine without one.

- An add-on may change the app only through `Hooks` (`app/xcore/hooks/Hooks.ts`), the DI container, the router, `JobRegistry.add()` and `extend()` of `@i18n`.
- Core code never imports from an add-on.
- More: `docs/architecture.md` › Add-ons. How to write one: `docs/guides/hooks.md`.

## Skills

They are in `.claude/skills`. Load the one that fits before you start.

| Skill | Use it for |
|---|---|
| `new-feature` | Any add, build or implement request. It points at the others. |
| `backend` | Routes, controllers, services, repositories, validators, migrations |
| `frontend` | Pages, components, layouts, `lib/` |
| `unit-test`, `e2e-test` | Tests |
| `security` | Any route, sign-in, upload, outgoing request, job, money or delete change |
| `comments` | Any comment or JSDoc block |
| `online-store` | The public store: themes, `window.Store`, checkout, SEO |
| `new-language` | Add a language to the app |
| `new-extension` | Write an extension |
| `extension-event`, `extension-slot` | Add an event or a slot for extensions |
