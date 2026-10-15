# Store themes (Edge)

How a theme of the online store is built: its files, the variables it gets, `window.Store` and the CSS it must set.

The public online store is rendered on the server with Edge.

- The backend builds the data for each page.
- Each theme owns its HTML (`.edge` files), its plain CSS and its own `script.js`.
- Only two things are shared by every theme: the payment pages (checkout and done) and the headless helper `window.Store`.

## Where the code is

| What | Where |
|---|---|
| Shared templates | `resources/views/store/` |
| Built-in themes | `resources/views/themes/<name>/` (`classic`, `minimal`, `boutique`, `noir`, `soft`, `lumen`) |
| Template registry and the page renderer | `app/xcore/view/StoreView.ts` |
| The variables, the theme and the shop's own look | `app/services/sales/StoreView.Service.ts` |
| Page names, fonts, theme constants | `app/constants/Store.Constant.ts` |
| `window.Store` and the checkout island | `resources/js/store/` |
| The types of `window.Store` | `resources/js/store/types.ts` |
| The checkout island's CSS | `resources/css/store-island.css` |
| An example extension theme | `extensions/aurora/` |

The Boutique theme is shown to shops under the name "Sunday".

## Files

```
resources/views/
  store/                      shared by every theme. A theme never copies these
    document.edge             the only <html>: head (SEO), theme CSS, the page, data island, scripts
    checkout.edge, done.edge  the payment pages (a Vue island mounts inside them)
    extension.edge            a page an extension draws by itself, inside the theme's layout
    index.ts                  imports the shared .edge files as text
    partials/head.edge        title, canonical, og/twitter, JSON-LD, GA/Pixel
    partials/order.edge       optional order card (status steps, tracking, lines, totals)
    partials/address.edge     optional address fields (the island makes State → City lists)
  themes/<name>/              one folder per built-in theme
    index.ts                  imports every .edge file as text (so they are inside the compiled binary)
    layout.edge               header + footer around every page (a component with a `main` slot)
    home.edge  product.edge  page.edge  track.edge  account.edge  order.edge  unsubscribe.edge  not-found.edge
    <own partials>.edge       e.g. card.edge, included as @include('themes/<name>/card')
    style.css                 plain CSS (no Tailwind). It must set the --store-* variables below
    script.js                 plain browser JS for the theme's own UI (cart drawer, product sheet, sign-in, …)
```

Notes:

- The track and order pages may `@include` `store/partials/order`.
- The account page may `@include` `store/partials/address`.
- The pages a theme must have are `STORE_THEME_PAGES`: `layout`, `home`, `product`, `page`, `track`, `account`, `order`, `unsubscribe`, `not-found`.

### Extension themes

An extension theme has the same pages in its views folder (manifest `theme.views`).

- They are registered as `ext/<key>/<file>`. A partial is included as `@include('ext/<key>/card')`.
- Its CSS and script are named by the manifest (`theme.css`, `theme.script`). Aurora keeps them under `assets/`.
- The shop's pick is stored as `ext:<key>` (`STORE_THEME_PREFIX`).
- When the extension is not running, the store uses Classic.
- When an extension theme throws, the error is logged and the page is drawn again with Classic.

## How a page is put together

`store/document.edge` includes the page. That is `themes/<name>/home`, or `store/checkout` for a shared page.

Every page wraps itself in the theme layout:

```edge
@component(theme.layout, { search: true })
  <h1>{{ t('store.everything_in_shop') }}</h1>
  …
@end
```

- The layout prints the page with `{{{ await $slots.main() }}}` between its header and footer.
- `search` (default `true`) says whether the header shows the product search.
- The account, order, checkout and done pages pass `false`.
- Edge tags (`@if`, `@each`, `@include`, `@component`, `@end`) must stand on their own line.

## Variables

### Shared

Every template sees these, the layout too. They are set with `renderer.share()`.
`StoreViewService.context()` builds them.

| Name | What |
|---|---|
| `store` | The shop. See the list below. |
| `theme` | `{ name, layout, assets, config, scheme, featured, classes }`. `config` = the extension's field values (`{}` for built-in themes). `classes` = the `<html>` classes of the shop's own look. |
| `pageName` | `home`, `product`, `page`, `track`, `account`, `order`, `unsubscribe`, `not-found`, `checkout`, `done` |
| `locale` | The page language. |
| `t(key, params?)` | Translated text. The theme's own words come first, then the app's. |
| `price(cents)` | Money in the visitor's display currency. It is converted on the server. |
| `money(cents, code?)` | Money in a currency, with no conversion. Orders keep the shop's currency. |
| `orderStatus(key)` | The name of an order status or delivery step (`completed`, `voided`, a shop's own step…) in the visitor's language. The shop's own step names win. |
| `url` | The links. See below. |
| `asset(path)` | The URL of a file in the theme folder. For an extension theme: a file under its assets address. |
| `discountPct(p)` | The "−20%" number, or null. |
| `date(iso)` | A short date and time in the page language, on the shop's clock. |

**`store`** holds:

- `name`, `slug`, `base`, `logo`, `currency`
- `display`, `currencies` (the currency switcher)
- `languages` (the footer language switcher offers only these)
- `pages[{ slug, title }]` (the footer page links). The shop's own pages come first. Then the links its extensions add: their `slug` is a path, like `/blog`. `url.page(slug)` gives the right address for both.
- `payments`, `payment_label`
- `login`, `customer`
- `country`, `pickup`, `guided_address`, `delivery_zones`
- `tax_rate`, `tax_label`, `tax_included`
- `banner`, `banner_type`
- `phone`, `address`, `hours`, `facebook`, `instagram`, `viber`, `whatsapp`
- `fulfillment_steps` = the delivery step keys in the shop's order (the progress bar). `orderStatus()` names them.
- `powered` = the link of a "Powered by" line under the page. It is `""` in the open-source app, because `PlanLimitService.isFree` is always false there. `store/document.edge` prints the line, so a theme does nothing.

**`url`** is built from `store.base`. That is always `""`: every store sits at the root of its host.

- `home`
- `product(p)`
- `page(slug)`
- `checkout`
- `track`
- `account`
- `order(ref)`
- `catalog({ q, category, sort, stock, page })`

### Per page

Only the page template sees these, and what it `@include`s.
Pass what the layout needs as component props.

| Page | Variables |
|---|---|
| home | `catalog { data, total, page, per_page, last_page }`, `counts` (product count per category id, `all` = every product), `featured[]`, `categories[{ id, name, color, count }]`, `filters { q, category, sort, stock }`, `sorts[{ value, label }]`, `pager { prev, next, pages[{ n, url, current }] }` |
| product | `product`, `related[]`, `gallery[]` (image URLs), `range { min, max }` or null |
| page | `title`, `body` (sanitised HTML, print with `{{{ }}}`), `css` (safe to print inside `<style>`), `back { title, url }` (the page's own back link, for a page an extension brings; null = lead back to the shop) |
| track | `query { code, contact }`, `order` (with `instructions`) or null, `error` or null |
| account | `orders` (paged) or null, `states` (for the address fields), `errors {}`, `old {}` (posted values after an error), `tab`, `saved` (true right after the details form was saved: say "Saved") |
| order | `order` (with `instructions`) |
| unsubscribe | `email`, `done`, `action` (the form URL) |
| not-found | none |

### Printing

- Print text with `{{ }}`. It is escaped.
- Use `{{{ }}}` only for `product.description`, `body` and `await $slots.main()`.

## Forms that work without JavaScript

**Catalog**

- Search, sort, in-stock, category and paging: `<form method="get" action="{{ url.home }}">` with `q`, `sort`, `stock`, `category`.
- The pager and the category pills are plain links (`url.catalog(...)`).

**Currency and language**

- Currency: `<form method="post" action="/currency">` with `<select name="currency" aria-label="{{ t('store_ui.currency') }}">`.
- Language: `<form method="post" action="/lang">` with `locale`.
- The theme script submits on change. Put a submit button in `<noscript>`.

**Track and unsubscribe**

- Track: `POST {{ url.track }}` with `code`, `contact`.
- Unsubscribe: `POST {{ action }}`.

**Account**

| Form | Action |
|---|---|
| Name and phone | `POST {{ url.account }}` |
| Add an address | `POST {{ url.account }}/addresses` |
| Edit an address | `POST {{ url.account }}/addresses/<id>` |
| Remove an address | `POST {{ url.account }}/addresses/<id>/delete` |
| Sign out | `POST {{ url.account }}/logout` |

When the customer is signed in, keep an empty `<div data-account-extra></div>` above the tabs.
A running extension may draw into it. Loyalty Points shows the customer's points and reward codes there.

**What needs JavaScript**

The cart, the sign-in and the checkout need JavaScript. The cart lives in the browser.

## window.Store

It is loaded on every store page, before the theme script.
It has no HTML and no CSS.
The types are in `resources/js/store/types.ts`.

### Data and helpers

- `Store.data` is the data island: `store`, `locale`, `strings`, `products`, `page`, `extensions`. After an abandoned-cart link it also holds `restore`.
- `Store.t(key, params?)`
- `Store.money(cents)` = money in the display currency.
- `Store.moneyIn(cents, code)` = money in a given currency, no conversion.
- `Store.product(id)`
- `Store.discountPct(p)`
- `Store.url` = `{ base, product(slug), checkout, account }`
- `Store.swatch(value)` = a CSS colour for an attribute value that names one ("Red", "#0af"), else null.
- `Store.loadScript(src)`

### Cart

`Store.cart` has:

- `lines()`, `count()`, `subtotal()`
- `add(product, variant, choices, qty, note)`
- `setQty(key, n)`, `remove(key)`
- `replace(lines)`, `clear()`

The cart is kept in `localStorage["store-cart:<slug>"] = { at, lines }` for 24 hours.
The checkout reads it, so never change its shape without the checkout.

### Picker

`Store.picker(product, preset)` holds the option rules:

- attribute groups
- sold-out values
- package slots
- stock left
- "only N left" errors
- add to cart

The theme draws the buttons.

**Custom request.** When `product.custom_request` is not null, `pick.asksNote` is true. Then:

1. Draw a `required` textarea. Label `pick.noteLabel`, `maxlength` `pick.noteMax`, value `pick.note`.
2. On `oninput`, call `pick.setNote()`. It needs no redraw.
3. Call the textarea's `reportValidity()` before `addToCart`.
4. When a cart line is edited, pass `note: line.note` in the preset.
5. Show `line.note` in the cart drawer.

A card's quick-add must open the picker for such a product.

### Checkout

`Store.checkout()` is what the cart's main button calls.

| Store | What it does |
|---|---|
| Takes payments | Opens the checkout page. |
| No payment option (`store.payments` empty) | Sends the cart as an unpaid order and goes to its thank-you page. |

- It resolves with the reason when that fails. Show it, for example in `[data-cart-error]`. Else it resolves with null.
- In the layout, name the button `store.payments.length ? t('store.checkout') : t('store.send_order')`.
- Print the "Secure payment by …" line only while `store.payments.length`.

### Extension scripts

`Store.data.extensions` = the scripts of the shop's running extensions (slot `store.page`).

- `window.Store` loads them itself. A theme does nothing.
- One of them may replace `Store.checkout`. The Restaurant extension sends the cart to a table's bill.
- So always call `Store.checkout()` at click time. Never keep a copy of it.

### Sign-in

`Store.auth` has `providers()`, `signIn(provider, creds)`, `signUp`, `resetPassword` and `resendVerification`.
On success the page reloads signed in.

### Events on `document`

| Event | When |
|---|---|
| `store:cart` | After every cart change. Detail: `{ lines, count, subtotal, added }`. |
| `store:login` | Something asks the theme to open its sign-in dialog. |

## The theme script

- Plain JS, no imports, wrapped in an IIFE.
- It is loaded as `type="module"` after `window.Store`. So it runs after the page is parsed, in strict mode.
- Use `Store.t()` for every text. The data island already holds the store's words with the theme's own merged in.
- It finds its own markup and adds the interactive parts. Use `data-*` hooks of the theme's choosing.
- Use `<dialog>` for the cart drawer, the product sheet and the sign-in dialog.

Keep these accessible names. The e2e tests use them.

| Control | Accessible name |
|---|---|
| cart button | "Open cart" (`t('store_ui.open_cart')`), shows the count |
| add button | starts with "Add to cart" (`t('store_ui.add_to_cart')`) |
| cart line qty | "Increase <name>", "Decrease <name>", "Remove <name>" |
| drawer button | "Checkout" |
| product sheet | a dialog named after the product |
| sign-in | button "Sign in". The dialog is named "Sign in". |
| currency | combobox "Currency" |
| sort | combobox "Sort products". Checkbox "In stock". |
| pager | "Previous page", "Next page", text "1 / 2" |

`data-*` attributes the tests read:

- `data-tracking`
- `data-tax`
- `data-due`
- `data-order-code`
- `data-payment-instructions`
- `data-line-image`
- `data-currency-note`
- `data-free-delivery`
- `data-coupon-applied`
- `data-discount`
- `data-coupon-code`

## CSS variables

Two rules first:

- Style your own classes, not bare `button` / `input` / `select` elements.
  A bare element rule would also hit the shared checkout island (`.store-island`) and fight its reset.
- Never name a theme class like a Tailwind utility (`grid`, `block`, `flex`, `hidden`, `container`, `border`, …).
  The island uses those classes inside the page. A theme rule for them breaks the checkout.

Every theme sets these on `:root`. The shared checkout and done pages take their look from them.

| Variable | What |
|---|---|
| `--store-bg`, `--store-fg` | page background and text |
| `--store-surface` | cards, dialogs |
| `--store-muted` | secondary text |
| `--store-line` | borders and dividers |
| `--store-accent`, `--store-on-accent` | main buttons |
| `--store-danger` | errors |
| `--store-radius`, `--store-button-radius` | corner radius of cards and inputs, and of buttons |
| `--store-font`, `--store-font-heading` | fonts |
| `--store-button-case`, `--store-button-tracking` | `none` or `uppercase`, and the letter spacing on buttons |
| `--store-input-bg` | text field background |
| `--store-control-height` | height of the island's text fields, pickers and the Apply button (default 32px). Match the theme's own fields. |

### The shop's own colours and font

A shop may change the colours and the font of a built-in theme.
The place is `/online-store` › Template › the gear on a template's card.
See [online-store.md](online-store.md) › Templates.

`StoreViewService.lookStyle()` builds one `<style>`. It is printed after the theme's stylesheet, so it wins.
The values are checked again there: a colour must be `#rrggbb` (`HEX_COLOR`) and a font a key of `STORE_FONTS`.

| What the shop picked | What the page gets |
|---|---|
| Primary | `--store-accent` + `--store-on-accent` (black or white, whichever reads best) on `:root`, and the class `theme-primary` on `<html>` |
| Secondary | `--theme-secondary` + `--theme-on-secondary` on `:root`, and the class `theme-secondary` on `<html>` |
| Background | `--store-bg`, and the class `theme-background`. In a theme that follows the device, like Minimal, it is only for the light look: `:root:not(.dark)`. |
| Text | `--store-fg`. Like the background, only for the light look in a theme that follows the device. |
| Small text | `--store-muted`. With only a text colour picked, it is a softer shade of that colour. |
| Card background | `--store-surface`, and the class `theme-surface`. Only for the light look in a theme that follows the device. |
| Card text | `--theme-on-surface` on `:root`, and the class `theme-surface-text`. With only a card background picked, it is black or white, whichever reads best. |
| Footer background | `--theme-footer` on `:root`, and the class `theme-footer` |
| Footer text | `--theme-on-footer` on `:root`, and the class `theme-footer-text`. With only a footer background picked, it is black or white, whichever reads best. |
| Font | `--store-font` and `--store-font-heading`, plus a `<link>` to `resources/css/store-fonts/<key>.css` when the font is self-hosted |

So a theme must do five things.

**1. Primary**

- Draw the main buttons with `--store-accent` / `--store-on-accent`. Never use a fixed colour.
- A gradient made from it goes in a `.theme-primary { … }` block (Lumen).

**2. Secondary**

- Decide what the theme's second colour is, and read `--theme-secondary` there.
- Classic, Minimal and Noir use `--ink: var(--theme-secondary, var(--store-fg))` for their solid blocks: the banner, a picked chip or option, a hovered button.
- Soft (sage), Sunday (peach-amber) and Lumen (violet text and tints) re-mix their own colours in a `.theme-secondary { … }` block with `color-mix()`.

**3. Background**

- Draw the page with `--store-bg`.
- A theme with a fixed gradient replaces it in a `.theme-background body { … }` rule (Lumen).
- Cards, lines and text keep the theme's own colours. So the shop should stay in the theme's light or dark family. The dialog says so.

**4. Footer**

- Name the footer classes `foot`, `foot-name`, `foot-head`, `foot-copy` and `langs`. Noir puts `n-` in front.
- Keep the `.theme-footer` / `.theme-footer-text` block at the end of `style.css`.
- The background is `--theme-footer`. Every footer text is mixed from `--theme-on-footer`.
- A footer never takes its own background from `--store-fg`. Else the shop's text colour would move it.

**5. Cards**

- Draw cards, boxes and panels with `--store-surface`.
- Keep the `:where(.theme-surface-text) …` rule at the end of `style.css`.
- That rule lists every selector that has that background. It gives each one `--store-fg` / `--store-muted` from `--theme-on-surface`, so all text inside follows.
- `:where()` keeps the rule as weak as the box's own class. So a picked or dark state still wins.
- A new box drawn in `--store-surface` must be added to that list.
- Lumen also re-mixes its glass from `--store-surface` in `.theme-surface`.
- Minimal draws no cards. There the two colours show only on the shared checkout and order pages. The island reads `--theme-on-surface` for its card text.

More rules:

- Every footer text is exactly `--theme-on-footer`, never a softer shade.
- A theme's own extra greys (`--faint`, `--dim`) keep their colour.
- Small labels in a theme's `--mono` font keep that font.
