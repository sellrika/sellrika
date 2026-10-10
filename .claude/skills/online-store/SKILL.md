---
name: online-store
description: Work on the public storefront of this POS — the Edge store themes (resources/views/themes/*), the shared store templates (resources/views/store), window.Store and the checkout island (resources/js/store), StoreController/StoreViewService/StoreService, SEO head tags/JSON-LD, product pages + slugs, sitemap/robots, payment gateways. Use when a task touches resources/views/themes, resources/views/store, resources/js/store, resources/css/store-island.css, app/controllers/Store.Controller.ts (or StoreAccount / StoreSettings / Home.Controller.ts, app/controllers/support/Storefront.Support.ts), app/services/sales/Store.Service.ts, app/services/sales/store/*, app/services/sales/StoreView.Service.ts, app/xcore/view/StoreView.ts, app/gateways, or anything about SEO / social sharing of the store.
---

# Online store

Read first: one whole built-in theme (`resources/views/themes/classic/`: its pages, `style.css`, `script.js`) and
`resources/js/store/types.ts` (what `window.Store` offers a theme). This skill is the map + the rules.

## Map
- `routes/storefront.ts` — public routes live in the `Guard.maybeAuth` group, **once**, at the root (`/`, `/p/:product`,
  `/pages/:page`, `/checkout`, `/done`, `/track`, `/account…`). A store is found **only by host**
  (`ShopRepository.findByHost`): its custom domain, else its subdomain `<slug>.<STORE_DOMAIN>` (`Url.slugOfHost` in
  `app/xcore/http/Url.ts`; dev `http://main-shop.localhost:3000`). There is no `/store/<slug>` page. Only an extension's
  public routes and files keep `/store/:slug/ext/:key/*`. `/sitemap.xml` (the store's own on its host; on the main host
  only the pages an add-on names in `Hooks.sitePaths`), `/robots.txt`. Slugs in `RESERVED_SLUGS` are refused.
- `app/controllers/Store.Controller.ts` — the public pages and the checkout. Each action gets its `Storefront`
  (shop, `base`, `url`, customer, theme, currencies, display) from `StorefrontSupport`
  (`app/controllers/support/Storefront.Support.ts`: `find(req)`, or `open` / `openJson` / `openCustomer` = that or
  the 404 answer), builds its data and calls `this.view.render(req, s, page, props, StoreViewService.storeSeo(...))`;
  `#catalogSeo()`/`#productSeo()`/`#productLd()` are here. `StoreAccount.Controller.ts` = the customer account pages,
  `StoreSettings.Controller.ts` = the admin `/online-store` settings + page CRUD, `Home.Controller.ts` = the page at `/`
  (the store on a store's host, else the way into the app).
- `app/services/sales/StoreView.Service.ts` — `StoreViewService`: picks the theme (`theme(shop)`, built-in or
  `ext:<key>`), builds the variables every template gets (`context()`: `store`, `theme`, `t`, `price`, `money`, `url`,
  `asset`, `date`…), the data island, the script tags, and renders. `pubShop`/`pubOrder`/`pubCustomer`/`pubAddress` and
  `storeSeo()` are statics of this class (`StoreViewService.pubShop(...)`). An extension theme that throws is logged and the page is drawn with Classic.
- `app/xcore/view/StoreView.ts` — mechanics: registers the shared + built-in theme templates (imported as text, so they are
  inside the compiled binary), `StoreView.useExtensionTheme()` for extension themes, `StoreView.render()`, `safeJson()`.
  `app/xcore/view/Vite.ts` — `Vite.tags()` / `Vite.resolver()` (the built file URLs, read from `app.buildDir`).
- `app/services/sales/Store.Service.ts` — a thin facade over the five services in `app/services/sales/store/`
  (`StoreCatalogService`, `StoreSettingsService`, `StorePaymentService`, `StoreCheckoutService`,
  `StoreFulfillService`); a cart is priced by `CartPricer`. `catalog()` / `browse()` (the public `StoreProduct` shape, incl. `slug`, `kind`,
  `bundle_items`), settings per shop, `checkout()` → gateway session or tokenize payload, `pay()` → charge the nonce,
  `fulfill()` → order exactly once (a pending QR comes back with its code).
- Payment providers are extensions (`extensions/stripe`, `omise`, `2c2p`, `paypal` — contract in `extensions/types.ts` ›
  Payment gateways); `app/gateways/` keeps only the built-in manual options (`manual/`,
  `Gateway.Registry.ts`) and `firebase/`.
- `resources/views/store/` — shared by every theme: `document.edge` (the only `<html>`: head, theme CSS, the
  page, the data island, scripts), `checkout.edge` + `done.edge` (the payment pages), `partials/head.edge` (SEO,
  GA/Pixel), `partials/order.edge` (order card), `partials/address.edge` (address boxes);
  `index.ts` lists them.
- `resources/views/themes/<name>/` — one folder per built-in theme (`classic` is the reference; `minimal`, `boutique`,
  `noir`, `soft`, `lumen`): `layout.edge` + one `.edge` per page of `STORE_THEME_PAGES`, own partials, `style.css`
  (plain CSS), `script.js` (plain JS: cart drawer, product sheet, picker, sign-in, share), `index.ts` (imports the `.edge`
  files as text). `resources/views/themes/index.ts` lists the themes.
- `resources/js/store/` — the browser side. `index.ts` = `window.Store` (headless: `cart.ts`, `picker.ts`, `auth.ts`,
  `money.ts`, types in `types.ts`). `checkout.ts` = the **checkout island**, a client-only Vue app that mounts
  `islands/Checkout.vue` on `#store-checkout`, `islands/Done.vue` on `#store-done` and `AddressFields` on
  `[data-store-address]` (account page); its CSS is `resources/css/store-island.css` (Tailwind theme + utilities, no preflight;
  the shadcn tokens read the theme's `--store-*` variables). `checkout-api.ts` = the checkout / coupon / payment-script calls.
- `resources/js/components/store/` — only what the island and the staff app still use: `AddressFields`,
  `CountrySelect`, `OptionSelect`, `StoreImage`.
- `vite.config.ts` — inputs: the staff app, `resources/js/store/index.ts`, `resources/js/store/checkout.ts`, and a glob of
  every `resources/views/themes/*/{style.css,script.js}`. Output dir = `BUILD_DIR` (default `public/build`).

## Rules
- **Every theme implements every page.** A new page = a name in `STORE_THEME_PAGES` + `StorePageName` (server and
  `resources/js/store/types.ts`) + a `<page>.edge` in all six theme folders (and their `index.ts`) + the extension themes
  (`extensions/aurora/views/`). Checkout and done are shared: never copy them into a theme.
- **Every page wraps itself in the layout**: `@component(theme.layout, { search: true }) … @end`. Edge tags stand on their
  own line. Print text with `{{ }}`; `{{{ }}}` only for sanitised HTML (`product.description`, `body`), `$slots.main()`
  and `json(...)`.
- **Theme CSS**: style the theme's own classes, never bare `button` / `input` / `select`, and **never name a theme class
  like a Tailwind utility** (`grid`, `flex`, `block`, `hidden`, `container`, `border`, …) — the checkout island uses those
  classes inside the page and a theme rule breaks it. Every theme sets all `--store-*` variables on `:root`.
- **Theme script**: plain JS in an IIFE, no imports, every text through `Store.t()`, all rules through `window.Store`
  (cart, picker, auth). Keep the accessible names and `data-*` hooks the Classic theme has — the e2e tests use them.
- **Works without JavaScript**: search, sort, "In stock", category, paging, currency, language, track, unsubscribe and the
  account forms are plain `GET`/`POST` forms and links. Only the cart, sign-in and checkout need JS.
- **Paging/filters are server-side**: `?q=`, `?category=`, `?sort=`, `?stock=1`, `?page=` on the catalog URL
  (`StoreService.browse`, 12 per page). Build links with `url.catalog({...})`. Never filter or slice the catalog in the browser.
- **Links**: build every href/fetch from `url.*` in templates and `Store.url` in scripts (from `store.base`, always `""` —
  every store sits at the root of its host); absolute URLs on the server come from `s.url` (or `Url.storeOrigin(shop)` in
  emails), never from `req.url` alone.
- **Product cards are `<a href>` links** (crawlable) with `aria-label` = the product name and `data-product` = its id; the
  theme script opens its sheet on a plain click, a modifier-click and sold-out cards follow the link.
- **Never leak**: purchase prices/costs, gateway credentials, other shops' data. `StoreViewService.pubShop`/`catalog()` are the only
  shapes the public pages receive; add fields there deliberately. The data island is printed with `safeJson()`.
- **Money** is integer cents. Templates use `price(cents)` (display currency, converted on the server) and `money(cents)`
  (shop currency); scripts use `Store.money()`; JSON-LD/meta go through `decimal()` in the controller.
- **SEO head** for every public page: `StoreViewService.storeSeo(shop, {url, title, desc, …})` passed to `this.view.render` — canonical
  = the page's own absolute URL; crawlable pages go into `StoreController.sitemap`; personal pages are `noindex`.
- **Slugs**: `shops.slug` (settings) and `products.slug` (auto from the name in `ProductRepository.create/update`,
  unique per shop) — URLs use slugs, never ids.
- **Dev**: `bun run dev` serves the store the same way as production; Edge recompiles templates on every request, so a
  `.edge` edit shows on reload. Theme CSS/JS come from the Vite dev server.

## Tests to extend
- `app/xcore/view/__tests__/store.test.ts` — the document: head, page in the layout, data island, escaping.
- `resources/js/store/__tests__/` — `window.Store`: cart, picker, money/urls (`bun test ./resources`).
- `app/services/sales/__tests__/Store.Service.test.ts` — catalog/settings/checkout/fulfil (fake payment extensions).
- `app/services/settings/__tests__/Extension.Service.test.ts` — extension themes (the picker lists it, the page carries it).
- `app/services/catalog/__tests__/Product.Service.test.ts` — product slugs.
- `e2e/l-store.spec.ts` — the visitor flow at `storeOf(spec)` = `http://main-shop.localhost:<port>` (`e2e/tmp.ts`) (browse, product page, cart, no-gateway guard, template switch, accounts,
  extension theme); `e2e/t-currencies.spec.ts`, `e2e/p-i18n.spec.ts`, `e2e/marketing.spec.ts`,
  `e2e/n-packages.spec.ts` also use the storefront.
- Verify with `bun run lint && bunx tsc --noEmit -p . && bun run test && bun run test:e2e`. Run `bun run build` before
  `bunx playwright test <spec>` after a theme / `resources/js/store` change — the e2e servers serve the built files.
  To run a test server next to another one without overwriting its build, build with `BUILD_DIR=<dir> bun run build`
  and start the server with the same `BUILD_DIR`.
