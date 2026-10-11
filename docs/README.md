# Sellrika docs

Docs for people who work on the code.
Start here, then open the page for the area you are working on.

## The app as a whole

| Page | What it covers |
|---|---|
| [architecture.md](architecture.md) | The stack, the request flow, the folders, and the rules every layer follows |
| [database.md](database.md) | The database engines, the rules for migrations and queries, and every table |
| [security.md](security.md) | What the app defends against, where each defence is in the code, and what the person who runs the server must do |
| [testing.md](testing.md) | The unit tests, the browser tests, what each test file covers, and what CI runs |

## Features

### Selling

| Page | What it covers |
|---|---|
| [features/pos-checkout.md](features/pos-checkout.md) | The Sell screen: search and scan, the cart, discounts, the checkout, the receipt, the customer screen |
| [features/orders.md](features/orders.md) | The order list and the order page, statuses, payments, refunds, void, open orders, tax |
| [features/customers.md](features/customers.md) | Customers per shop, their addresses, search from the checkout, purchase history |
| [features/payment-methods.md](features/payment-methods.md) | Payment methods per shop, their pictures, the method picker in every pay dialog |
| [features/coupons.md](features/coupons.md) | Discount codes: types, dates, limits, product and customer scope, the online checkout and the till |
| [features/reports.md](features/reports.md) | The sales and profit report, its periods, and the daily report |
| [features/marketing.md](features/marketing.md) | Email campaigns, the abandoned-cart email and unsubscribe |

### Catalog

| Page | What it covers |
|---|---|
| [features/products.md](features/products.md) | Products, variants, packages, categories, barcodes, pictures and the CSV import |
| [features/stock.md](features/stock.md) | Stock as a ledger: movements, adjustments and the low-stock list |

### Online store

| Page | What it covers |
|---|---|
| [features/online-store.md](features/online-store.md) | The public store of a shop: its address, the catalog, the checkout, payments, delivery, customer accounts, currencies |
| [features/store-themes.md](features/store-themes.md) | The theme contract: the Edge theme folders, the data every template gets, `window.Store`, the checkout island |
| [features/store-seo.md](features/store-seo.md) | How the store gets found: head tags, product pages, `sitemap.xml`, `robots.txt`, the product feed |

### Settings and platform

| Page | What it covers |
|---|---|
| [features/shops.md](features/shops.md) | Several shops per account, the active shop, currency, time zone, logo |
| [features/auth-and-users.md](features/auth-and-users.md) | Sign-in, sessions, roles, staff, sales staff, passkeys, sign-up, the platform admin |
| [features/email.md](features/email.md) | Outgoing email: the providers, the platform's setup and a shop's own, every email the app sends |
| [features/extensions.md](features/extensions.md) | Extensions: the catalog, the manifest, events, slots, and the built-in ones |
| [features/api.md](features/api.md) | The REST API, API keys, the OpenAPI file and the MCP server |
| [features/search.md](features/search.md) | The global search (⌘K): the client list of pages and the server search of records |
| [features/i18n.md](features/i18n.md) | Languages: the one dictionary, how the language is picked, `t()` on the server and in pages |

## Guides

| Page | What it covers |
|---|---|
| [guides/custom-domain.md](guides/custom-domain.md) | Let a shop use its own domain: the server setup, what the shop owner does, how to fix a domain that stays pending |
| [guides/firebase-setup.md](guides/firebase-setup.md) | Turn on customer sign-in for a store: the Firebase project, step by step |
| [guides/kiosk-mode.md](guides/kiosk-mode.md) | Start Chrome in kiosk mode for a till or a kitchen screen |

## The app in one minute

- **Backend**: Bun only (`Bun.serve` routes and `Bun.sql`). The entry is `app/server.ts`: migrate, seed, serve.
- **Frontend**: Inertia v3, Vue 3, Tailwind v4 and shadcn-vue, built by Vite. One Vue file per page in `resources/js/Pages/`.
- **The online store** is not Inertia. It is plain HTML from Edge themes in `resources/views/themes/`.
- **Layers**: `routes/<area>.ts` → `app/controllers` → `app/services` (the rules) → `app/repositories` (the SQL).
  `app/models` holds the row types. `app/validators` holds the zod schemas.
- **Everything belongs to a shop**: categories, products, orders, customers, payment methods. The active shop is on the session.
- **Three roles**: `admin`, `manager` and `cashier`. The `Guard` middleware enforces them. The UI only hides what you cannot use.
- **Money is integer cents.** Timestamps are stored in UTC. "Today" and the report periods use the shop's time zone.
- **Stock is a ledger.** Every change is a `stock_movements` row, written through `StockRepository.move()`.

## Where to look

| I want to | Go to |
|---|---|
| Add a route | The file of its area in `routes/` (`sales.ts`, `catalog.ts`, `settings.ts`, `account.ts`, `storefront.ts`, `files.ts`, `api.ts`) |
| Add a page | `resources/js/Pages/<Area>/<Name>.vue` and a controller method that calls `inertia(req, "<Area>/<Name>", props)` |
| Add a table or a column | `bun run make:migration <name>`, then edit the new file in `database/migrations/` |
| Check input | A zod schema in `app/validators/`, run through `validate()` |
| Page a list | `Paginate` in `app/xcore/http/Paginate.ts`. In the UI: `components/Pager.vue` |
| Add a UI component | `bunx shadcn-vue@latest add <name>`. It goes to `resources/js/components/ui/` |
| Format money or dates | `resources/js/lib/format.ts` |

## Rules for these docs

- One page per feature, in `docs/features/`.
- When behaviour changes, update the page in the same pull request.
- Write short sentences. Use lists and tables.
- Name the file and the function, so a reader can find the code.
