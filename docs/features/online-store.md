# Online store

How a shop sells its products on a public web page: the settings, the public pages, the checkout and the payment.

- Visitors need no login.
- The buyer pays through the shop's own payment gateway. A gateway is an extension. Stripe, Omise, 2C2P and PayPal ship in `extensions/`.
- Or the buyer orders with a built-in manual option (cash on delivery, bank transfer) and pays later.

## Where the code is

| What | Where |
|---|---|
| Public routes | `routes/storefront.ts` |
| Settings routes (`/online-store`) | `routes/sales.ts` |
| Platform routes (`/postal-codes`, `/exchange-rates`) | `routes/settings.ts` |
| Public pages, checkout, track | `app/controllers/Store.Controller.ts` |
| Customer account pages | `app/controllers/StoreAccount.Controller.ts` |
| Settings pages | `app/controllers/StoreSettings.Controller.ts` |
| Finding the shop of a request | `app/controllers/support/Storefront.Support.ts` |
| The facade the controllers call | `app/services/sales/Store.Service.ts` |
| Catalog, settings, payment, checkout, fulfill | `app/services/sales/store/` |
| Rendering and the public data shapes | `app/services/sales/StoreView.Service.ts` |
| Customer sign-in | `app/services/sales/StoreAuth.Service.ts` |
| Custom domains | `app/services/sales/Domain.Service.ts` |
| Cities and postal codes | `app/services/sales/PostalCode.Service.ts` |
| The payment sweep | `app/services/sales/StoreReconcile.Service.ts` |
| New-order alerts | `app/services/sales/OrderAlert.Service.ts` |
| Delivery rules and the checkout's zod schemas | `app/validators/StoreCustomer.Validator.ts` |
| Settings validators | `app/validators/Store.Validator.ts` |
| Constants | `app/constants/Store.Constant.ts` |
| Manual payment options | `app/gateways/manual/` |
| Themes | `resources/views/themes/<key>/` |
| Shared store pages | `resources/views/store/` |
| `window.Store` and the checkout island | `resources/js/store/` |
| The settings screen | `resources/js/Pages/OnlineStore/Index.vue` |

## Setup (admin)

The settings are on `/online-store`. Only an admin sees it. It is for the active shop.

The screen has a section rail on the right. A section can be opened by link with `?section=`:

| Section | `?section=` |
|---|---|
| General | `general` |
| Template | `template` |
| Banner & contact | `content` |
| Delivery | `delivery` |
| Languages | `languages` |
| Currencies | `currencies` |
| Payments | `payments` |
| Authentication | `accounts` |
| Alerts | `alerts` |
| Pages | `pages` |

### Enable

While the store is off, the public page answers not found (404).

### Store URL

Every store is served **only by host**, at the root of that host.

- Its free subdomain is `<slug>.<STORE_DOMAIN>`.
- `STORE_DOMAIN` defaults to `localhost`. So in dev a store is at `http://main-shop.localhost:3000`.
- With `STORE_DOMAIN=shop.example.com` a store is at `https://corner-coffee.shop.example.com`.
- Or it is the shop's custom domain (see below).
- There is no `/store/<slug>` page on the main host. Only extension files and extension public routes keep the `/store/<slug>/ext/<key>/…` path.

How the shop is found:

- `ShopRepository.findByHost(host)` looks for the custom domain first.
- Else it takes the slug with `Url.slugOfHost(host)` and finds the shop by slug.

How the store's address is built, for emails and links (`Url.storeOrigin(shop)` in `app/xcore/http/Url.ts`):

| Case | Address |
|---|---|
| The shop has its own domain | `https://<domain>` |
| A real store domain | `https://<slug>.<STORE_DOMAIN>`, always `https` with no port |
| A `localhost` store domain (dev) | The subdomain with the scheme and port of `APP_URL`, or of this server |

What `/` shows:

- On a store's host: the store.
- On the host of a store that is off, or on an unknown subdomain: not found. It never shows the app's own page.
- On the main host: a signed-in user goes to `/pos`. Everyone else goes to `/login`. An add-on may put a front page there with `Hooks.frontPage` (`app/xcore/hooks/Hooks.ts`).

The form shows the slug box with the store domain as a suffix.
The suffix comes from `settings.subdomain_url`. That is the store address with `{slug}` in place of the slug.

**Pictures always load from `APP_URL`.**

- `Url.upload(path)` turns a `/uploads/…` path into `<APP_URL>/uploads/…`.
- It is used for product pictures and order line pictures on every store page (`StoreCatalogService`, `StoreViewService.pubOrder`).
- So a CDN cache in front of the app's host also works for a shop on its own domain.
- With no `APP_URL` the path stays relative.

### Slugs

- A slug is lowercase `a-z0-9-`, 3 to 50 characters.
- It is unique across shops (`shops.slug`).
- Migration 0018 filled it from the shop name. A new shop gets one automatically.

**Reserved slugs.** `RESERVED_SLUGS` in `app/constants/Store.Constant.ts` holds names a shop may not take: `www`, `pos`, `app`, `api`, `admin`, `mail`, `smtp`, `ftp`, `shop`, `store`, `cdn`, `billing`, `checkout`, `account` and more.

- The form refuses them (`validation.slug_reserved`).
- `ShopService.uniqueSlug` skips them. A shop named "Mail" gets `mail-2`.
- Migration 0068 renamed existing reserved slugs to `<slug>-shop`.

**Renames are limited.** An account may change a store address `SLUG_CHANGES_PER_WEEK` (3) times a week, for all its shops together.

- The reason: each new address needs a new SSL certificate.
- The times are kept in `settings` under `slug_renames:<owner id>` (`SLUG_RENAMES_KEY`).
- The limit is off when `STORE_WILDCARD_RESOLVER` is set. One wildcard certificate then covers every store.

**Certificates.** `DomainService.run()` also writes every **open** store's `<slug>.<STORE_DOMAIN>` into the Traefik file.

- Without `STORE_WILDCARD_RESOLVER`, each open store gets its own Let's Encrypt certificate. Let's Encrypt allows 50 new certificates a week for the whole domain.
- With `STORE_WILDCARD_RESOLVER` (a DNS-challenge resolver), one router and one wildcard certificate serve them all.
- The free addresses need a wildcard DNS record `*.<STORE_DOMAIN>` that points at the server.

### Custom domain

Optional. It is on the General tab. It is saved in `shops.domain`.

- It is unique across shops.
- When a request's `Host` matches it, that shop's store is served at the **root** of the domain. The paths are the same as on the subdomain: `/`, `/pages/<page>`, `POST /checkout`, `/done`.
- `X-Forwarded-Host` is used only when `TRUST_PROXY=1`.
- A shop set to `example.com` also answers on `www.example.com`.
- Whatever the admin pastes (scheme, `www.`, port, path) is trimmed to the bare hostname on save.
- The subdomain keeps working next to the domain.

**Managed domains** (only while `DOMAIN_CNAME` is set):

`shops.domain_status` is `pending` or `live` (migration 0067). A new or changed domain starts as `pending`. It waits for its DNS.

`DomainService.run()` checks every shop's domain. It runs:

- from the cron `domains`, every 5 minutes (`DOMAIN_CRON`)
- right after a save that changes the domain
- on **Check now** = `POST /online-store/domain/check` (admin)

The rules:

| Case | Result |
|---|---|
| Every address of the domain is `DOMAIN_CNAME`'s, **and** its TXT record `_sellrika.<domain>` holds the shop's `domainToken()` | The domain goes live. The TXT record is the proof that the domain is theirs. |
| A live domain still points here | It stays live. The TXT record is not asked again. |
| A domain moved away | It goes back to pending. |
| The lookup failed | A live domain stays live. |

Then it writes **all** live hostnames into Traefik's dynamic-config file (`TRAEFIK_FILE`).

- `www.<domain>` is added when it points here too.
- The file is JSON inside a `.yaml` file.
- Each host gets its own router. So each gets its own Let's Encrypt certificate.
- The file is built again from the database on each run. So it needs no backup.

Who owns a domain:

- While domains are managed, only a **live** domain blocks another shop.
- A pending domain is taken over by the shop that saves it.

What the General tab shows:

- The records to add: a CNAME to `DOMAIN_CNAME`, or an A record to its IPv4, plus the TXT record.
- What the domain points at now, and a few tips.
- A "Live" badge once it is live.

Without `DOMAIN_CNAME` the merchant sets up DNS and SSL alone.

Server setup and troubleshooting: [guides/custom-domain.md](../guides/custom-domain.md).

### Sitemap

The link is shown under the domain, with a copy button.

- It is the shop's own `https://<slug>.<STORE_DOMAIN>/sitemap.xml`.
- Once a domain is set it is `https://<custom domain>/sitemap.xml`.
- The owner submits this link once in Google Search Console.

### Google Search Console card

The owner pastes the HTML-tag token from Search Console. It may be the whole `<meta>` tag or only its content.
Every store page prints it. So the owner can verify the property and then submit the sitemap.
See [store-seo.md](store-seo.md).

### Analytics card (General)

- `shops.ga_id` is a GA4 measurement id (`G-…`). It is upper-cased on save.
- `shops.meta_pixel_id` is digits only.
- Blank means off.

`resources/views/store/partials/head.edge` prints both loaders on **every** store page:

- the gtag.js loader (`gtag("config", id)`)
- the Meta Pixel base code (`fbq("init")` and `fbq("track","PageView")`)

Notes:

- The `noindex` pages (checkout, thank-you, track) get them too. So a conversion is not lost.
- Every store page is a normal page load. So each one counts as one page view.
- There are no purchase or add-to-cart events yet. Add them in a theme script or in the checkout island when someone needs funnels.

### Alerts

The owner gets a "new order" message the moment an online order is written.

- It is fired once from `StoreService.fulfill`, together with the buyer's confirmation.
- It is never awaited.
- `OrderAlertService.notify()` in `app/services/sales/OrderAlert.Service.ts` builds one plain text.
- The text holds: the code, the total, paid or **UNPAID — method**, the lines, the delivery note, and the `/orders/:id` link when `APP_URL` is set.

Where it goes:

| Channel | Settings | How |
|---|---|---|
| Email | `shops.alert_email` | Through `MailService`. A silent no-op while email is off. |
| Telegram | `shops.telegram_bot_token` and `shops.telegram_chat_id` | One Bot API `sendMessage` call (`TELEGRAM_API`). |

Telegram rules:

- The bot token comes from @BotFather.
- It is encrypted with `APP_KEY` and never shown again.
- A blank token on save keeps the stored one.
- The chat id is the owner's chat or a group.
- A chat id without a stored token is refused.

Failures are logged, never thrown. POS sales send no alert.

### Template

One of the registered storefront looks. See [Templates](#templates).

### Delivery

It has its own form: `PUT /online-store/delivery`.

`StoreSettingsController.delivery` → `StoreDeliveryInput` → `StoreService.updateDelivery` → `ShopRepository.updateDelivery`.
The values are sent to the page on `settings`, next to the others.

| Setting | Meaning |
|---|---|
| `shops.country` | Where the shop is. A name from `app/constants/Country.Constant.ts`, or null = not set. The checkout starts with this country. It is offered first for postal codes. |
| `shops.delivery_zones` | The shipping zones (migration 0045). See below. |
| `pickup` | Bool. The buyer may collect in store. |
| `guided_address` | Bool, default true. State → City **lists** at the checkout, when the country's postal codes are downloaded. Off = plain text boxes. This is for countries whose GeoNames records are poor, like Myanmar. |

#### Delivery zones

`shops.delivery_zones` is JSON: `[{name, countries: string[], states: string[], cities: string[], fee, free_delivery_min}]`. At most 50 zones.

| Field | Meaning |
|---|---|
| `countries` | Country names. `[]` = **rest of world**: every country no other zone lists. |
| `states` | Narrows the zone to those states or provinces (for example all of Bangkok). They are GeoNames admin1 names. They are matched to the state the buyer picks or types, in any case. |
| `cities` | Narrows the zone to those cities. |
| `states` and `cities` both `[]` | The whole country. |
| `fee` | Cents. |
| `free_delivery_min` | Cents or null. Goods at or above this amount ship free inside the zone. The amount is counted before any discount code. |

The validator refuses a place in two zones:

- only one rest-of-world zone
- a country in only one whole-country zone
- a state or a city only once per country

The error is on `delivery_zones.<i>`.

A new shop starts with one zone: `Everywhere` (rest of world, fee 0).
**No zones = nothing is delivered.**

#### The delivery page

- A **table** of zones: Zone / Countries / Area / Price / Free from, with Edit and Remove. Area is the cities, else the states, else "Whole country".
- A **dialog** to add or edit one: name, Countries, States, Cities, price, threshold.
- Countries, States and Cities are `components/ChipPicker.vue` chips.
- The states come from `GET /online-store/delivery/places?…&of=states` = `PostalCodeRepository.regions`.
- The dialog's Save saves the whole form at once. So the table always shows what is saved.
- The outer "Save delivery" button is for the country, pick-up and the lists.

#### What the checkout charges

All four functions are in `app/validators/StoreCustomer.Validator.ts`.
They are the one rule. The checkout page's live total and the server (`StoreService.checkout` and `quote`) share them.

**`deliveryZone(zones, {country, state, city})`** picks the most specific zone that lists the address:

1. A zone that names the city.
2. A zone that names the state.
3. A zone that names the country.
4. Rest of world.

Among equals, the first listed wins.

**`deliveryFee(shop, {country, state, city}, subtotal)`**:

- 0 from the zone's threshold
- else the zone's fee
- null when no zone fits

**`deliveryCountries(zones)`** = what the checkout's country box offers:

- null = every country, when a rest-of-world zone exists
- one country = the box is locked to it
- A country outside the list can still arrive: remembered, or filled in after the box mounted. `AddressFields.deliverable()` switches it to the shop's own country when the shop delivers there, else to the first one. It also clears the state and city that no longer fit.

**`undeliverable(zones, to)`** = the field to flag and the message:

| Case | Field | Message |
|---|---|---|
| No zone names the country | `customer.country` | "We don't deliver to <country>" |
| The country has only state or city zones, and no zone names that state | `customer.state` | |
| Else | `customer.city` | "We don't deliver to <city>" |

#### Pick up in store

- The checkout offers "Pick up in store" next to "Delivery".
- The address is not asked (`StorePickupCustomerInput`: name, phone, email only).
- The fee is 0.
- The order note reads `Pick up in store: name · phone`.
- It adds `Pick up at: <shop address>` when the shop has an address (Banner & contact). The address is frozen on the order. So the email, `/done`, track and the staff page all show where to collect it.
- The shop address from Banner & contact is shown at the checkout.
- Cash on delivery is shown and saved as **Pay at pick-up** (`store.pay_at_pickup`, on `orders.payment_method`).
- The unpaid confirmation email says the order will be ready to pick up, not on its way.
- `pickup: true` from a store that does not offer it is ignored. The order is priced as a delivery.

A free-delivery coupon on an order that already ships free is refused: "Delivery is already free for this order".

### Cities & postal codes

This is its own page: `/postal-codes`.

- Only the platform admin sees it (`Guard.platform`).
- The sidebar shows it as **Addresses** under Admin. The page is titled **Cities**, because not every country has postal codes.
- It is one list for the whole platform. Every shop's checkout and account address form use it.

#### Where the data comes from

The GeoNames dumps (CC BY 4.0), downloaded into the global table `postal_codes` (migration 0044: `country`, `postal_code`, `place`, `admin1`, `admin2`) by `PostalCodeService` (`app/services/sales/`).

| File | What |
|---|---|
| `export/zip/<ISO>.zip` | One country's postal codes |
| `export/zip/allCountries.zip` | All countries |
| `export/dump/<ISO>.zip` | The place-name dump of one country |
| `export/dump/admin1CodesASCII.txt` | Turns an admin1 code into the state name |

The base URLs are `app.geonames` in `config/app.ts` (env `GEONAMES_ZIP_URL` and `GEONAMES_DUMP_URL`).
The e2e run points them at `e2e/fixtures/geonames`.

**A country with no postal-code file (like Myanmar) falls back to the place-name dump** (`dumpParser` in `PostalCode.Service.ts`):

- It takes every populated place: feature class `P`.
- It leaves out abandoned, destroyed and historical places, and sections of another place (`DUMP_SKIP`).
- Each row has `postal_code = ""`.
- So the checkout still offers State → City (unless `guided_address` is off).
- The code box stays blank and editable.
- City zones match on the typed or picked name.

#### The page

- An **Add cities** button at the end of the header row opens a dialog.
- The dialog has a country picker (the active shop's country first) and **Download**.
- It also has **All countries** (20 MB).
- Below is the table of downloaded countries: places, updated, **Re-download**, **Remove**.

#### Routes

| Route | What |
|---|---|
| `POST /postal-codes` | Starts a run. Body `{scope: "country", country: <name or ISO code>}` or `{scope: "all"}`. |
| `GET /postal-codes/status` | The `PostalStatus` the page polls every 1.5 s for its progress bar, plus `countries`. |
| `POST /postal-codes/cancel` | `PostalCodeService.cancel`. Gives the run up at once. |
| `DELETE /postal-codes/:code` | `PostalCodeService.remove`. That country's rows and date go. 422 while a run is on. |

#### A run

- It runs in the **background**. `start()` returns at once.
- Only one run at a time.
- The status goes `downloading` (bytes) → `importing` (characters of the file) → `ready` or `failed` with the reason.
- A run **replaces** what it covers: that country's rows, or the whole table.
- It streams the file a line at a time, in transactions of `POSTAL_BATCH` (5,000) rows, with a yield between them. So memory stays flat and the app stays served.
- The zip is opened by `app/helpers/zip.ts`. It is our own reader. It uses `node:zlib` for the raw deflate.
- `updated_at` per country is kept in `settings` key `postal_codes` = `{ last, updated }`.

When a run fails:

- A country GeoNames does not cover (its HEAD answers 404 for both files) ends as failed with: "GeoNames has no cities or postal codes for X yet — addresses and city prices work by typed city names instead". Nothing else changes. The checkout keeps its text boxes. The zones' cities take typed names.
- A run with no progress for `POSTAL_STALL_MS` (5 minutes) is given up as failed.
- **Cancel** under the progress bar stops it at once. Use it for a run stuck at "Saving… 100%", for example after a dev-server reload. The run stops at its next step. Rows it saved stay.
- A poll that fails is shown as a failure. It does not freeze the bar. This happens when the server restarted during a run, which loses the in-memory job.
- Job failures are logged as `[postal-codes]`.

#### City zones match on the postal code

At the checkout, `StoreCheckoutService.deliveryTo` does this. `checkout` and the coupon `quote` both use it.

1. The buyer's postal code is looked up in the list (`PostalCodeRepository.placesOf`).
2. The place it names is what `deliveryZone()` matches against the zones' cities.
3. A code that covers several places takes the one a zone lists.
4. A code the list does not know (no download, a typo) falls back to the typed city name.

**The postal code is optional** at the checkout (`StoreCustomerInput`).

- Countries GeoNames has no codes for (like Myanmar) check out with a blank one.
- The city name alone prices delivery.
- The order note then ends `City, State` with no code.

#### The Cities field of a zone

It is `components/ChipPicker.vue` in `find` mode.

1. On open it shows the first `CITY_PAGE` (20) downloaded cities of the zone's countries, A–Z.
2. The request is `GET /online-store/delivery/places?countries=…&countries=…&q=`. The `countries` name is repeated. None = every downloaded country. The answer is `{places, more}`.
3. Then the server searches what is typed. While `more` is true it says "Showing the first 20 — keep typing".
4. "Add “…”" adds a name that is not on the list.
5. The chosen cities sit on the field as removable badges.

The Countries field is the same component in `options` mode, over `Country.Constant`.

### Banner & contact

**Support email**: `shops.support_email` (migration 0032). It is printed on order emails. Blank = the owner's account email. See [email.md](email.md).

**Banner** (migration 0038): `shops.banner` is one announcement line, at most 200 characters.

- Every template prints it as a strip above its header (each theme's `layout.edge`).
- Blank = no strip.

**Banner tone**: `shops.banner_type` (migration 0039, `STORE_BANNER_TYPES`).

| Tone | Look |
|---|---|
| `info` | The template's own colours |
| `success` | A fixed green, with a matching icon |
| `warning` | A fixed amber, with a matching icon |
| `danger` | A fixed red, with a matching icon |

**Contact details**: each theme's footer (in its `layout.edge`) shows only the fields that are filled in.

| Field | Rule |
|---|---|
| `phone` | A `tel:` link |
| `address`, `hours` | Free text. Line breaks are kept. |
| `facebook`, `instagram` | Must be full `https://` URLs. Shown as plain text links. |
| `viber`, `whatsapp` | Typed as a phone number. Stored as digits with the country code. The links are `viber://chat?number=+…` and `https://wa.me/…`. |

All of them are on `StoreViewService.pubShop`. So every public page has them.

### Payments

Payments are per shop. They are in the Payments section of the rail.

#### The online provider is an extension

No provider is built in. See [extensions.md](extensions.md).

The repo ships four in `extensions/`:

| Extension | Mode |
|---|---|
| Stripe | hosted |
| 2C2P | hosted |
| PayPal | hosted |
| Omise | tokenize |

How a shop sets one up:

1. The extension must be in the platform's catalog and switched on for all shops.
2. On `/extensions` the admin fills in the keys in its dialog.
3. The admin switches it on.

About the keys:

- The manifest's `fields` are the credentials. All are required.
- Secrets are AES-256-GCM encrypted with `APP_KEY`. They are never shown again.
- `starts_with` gives the early check, like "keys start with pk_".
- A field with `options` is a dropdown, for the production or sandbox host.

**One provider per shop.**

- Switching one on switches the other off (`ExtensionService.save`).
- An upload alone never switches one on.

`ExtensionService.onlinePayment(shopId)` gives the one that is running (installed + enabled + ready): `{ ext, config, payment }`.

- `payment` is the manifest's `payment` block (`mode`, `public_field`, `script`) and the module's `payment` export.
- The manifest `name` is the label. It is stored on `orders.payment_method`. It is shown in the cart's "Secure payment by …" line.

How each shipped provider talks to its API is documented in each extension's `index.ts`: Stripe's one-off coupon, 2C2P's HS256 JWT API and POST return, PayPal's capture on return, Omise's pre-built form and capability list.

#### The manual options stay built in

They are in `app/gateways/manual/`. Each is a `ManualGateway`. `GatewayRegistry` lists them.

| Option | Key | Setup |
|---|---|---|
| Cash on delivery | `cod` | Nothing to set up |
| Bank transfer | `bank_transfer` | One multiline "Bank details" field. The buyer is shown it. |

- The bank details are stored in `shops.payment_credentials` as `{ bank_transfer: { instructions } }`.
- Any number of manual options can be on next to the provider (`shops.manual_gateways`, a comma list).
- Each switched-on option has to be complete.
- The buyer picks one at the checkout. The order is written **unpaid** right away. See [Buying flow](#buying-flow-public-no-auth).

#### The Payments section

- One table row per manual option: an Enabled `<Switch>` and a Configure dialog built from its fields.
- The dialog's **Save** and the page's **Save settings** both send the whole form.
- A "… is required" error opens the dialog again.
- Then the shop's payment extensions: icon, name, Ready or Needs setup.
- Each extension has its own Enabled switch and **Configure** dialog. It is the same `components/extensions/ExtensionConfigDialog.vue` that the `/extensions` page uses.
- An extension is saved at once with `PUT /extensions/:key`, not with **Save settings**.
- Switching one on switches the other off.
- Switching on one that is not set up yet opens the dialog first.
- The description still links to `/extensions`.

Without a provider and without a manual option, customers can browse. The cart's button is then **Send order** (see [Buying flow](#buying-flow-public-no-auth)). A checkout request is refused with the `cart` error "This store doesn't accept online payments yet" (`store_server.payments_off`, `StorePaymentService.paymentsOff()`).

Migration 0050 moved the old `shops.payment_gateway` and the providers' keys from `shops.payment_credentials` into `shop_extensions` rows. The field names are the same. So the saved keys work again once the matching extension is switched on.

### Store pages

A shop may have any number of custom pages: About us, Terms of Use, FAQ and so on.

- They are built in a GrapesJS drag-and-drop editor (`OnlineStore/PageEditor.vue`).
- The routes are `/online-store/pages/create` and `/online-store/pages/:id/edit` (admin).
- A page is a row in `store_pages`: `shop_id`, `slug` (unique per shop), `title`, `body` (HTML), `css`.
- The public page is at `<store>/pages/<page>`.
- Every page gets a storefront footer link (`store.pages`).
- Migration 0023 moved the older Terms and Privacy text into pages.

Safety:

- The body is sanitised on save by `app/helpers/html.ts`: allowlisted tags, no scripts, no iframes, no event handlers, safe URL schemes only.
- This is needed because the theme's `page.edge` prints the body unescaped (`{{{ body }}}`).
- The page CSS goes into a `<style>` tag. Any `</style` in it is made harmless first.

## Languages

A shop picks which of the app's languages (`LOCALES` in `i18n/index.ts`) its online store offers.
The admin app is not affected.

- **Column**: `shops.languages` is a comma list, like `en,de`. The first is the default. Migration 0060 gave every shop `en,de`.
- `shopLocales()` in `i18n/index.ts` reads it. Unknown codes are dropped. It is never empty.
- **Settings**: `/online-store?section=languages` (admin, its own form). A switch per language and "Make default".
- `PUT /online-store/languages` (`StoreLanguagesInput`: at least one, only `LOCALES`, repeats dropped) → `StoreService.updateLanguages`.

**Which language a visitor gets.** `StorefrontSupport.find()` calls `I18n.narrow(I18n.localeOf(req, shop.languages))`. `ExtensionController.storeRoute` does the same for `/store/<slug>/ext/…`.

1. The `lang` cookie, when the shop offers that language.
2. Else the best `Accept-Language` match among the shop's languages.
3. Else the shop's default.

Everything after it follows that language:

- the server-rendered page and `<html lang>`
- `t()` in templates, services and validators
- the words in the data island (`Store.t()` in the browser)
- the checkout snapshot's `payload.locale`. This is the language of the buyer's order emails.

**Switcher**: each theme's footer (`layout.edge`) lists `store.languages` only. It is a plain `POST /lang` form. It is left out when the shop offers one language.

## Currencies (display only)

A shop may show its store prices in other currencies too.

**Display only.** These all stay in `shops.currency`:

- the checkout and the payment
- the order and the emails
- the order, track and account pages
- the reports
- SEO (JSON-LD, `product:price`)

### Automatic rates, for the whole platform

`ExchangeRateService` (`app/services/settings/ExchangeRate.Service.ts`) fetches one table.

- The address is `app.exchangeRatesUrl` = `EXCHANGE_RATES_URL`. The default is `https://open.er-api.com/v6/latest/USD`. It needs no key.
- In tests the e2e fixture server answers.
- The table is kept in `settings` key `exchange_rates`: `{base, rates, fetched_at, tried_at, error}`.
- A failed fetch keeps the old table and records `error`.
- How often = `settings` key `exchange_rates_schedule`. `RATE_SCHEDULES`: off | 30m | 1h | 6h | 12h | 1d. The default is 1d.
- The `exchange-rates` cron (`RATES_CRON`, every minute, and once on boot) calls `run()`. It fetches when the last try is older than the schedule.

### The platform page

`/exchange-rates` (sidebar Admin › Exchange rates, `Guard.platform` group, `CurrencyController`).

- It shows the table. The table can be filtered.
- Its **Settings** button is in front of the filter. It opens a dialog with:
  - the schedule (`PUT /exchange-rates`, `RateScheduleInput`)
  - **Refresh now** (`POST /exchange-rates/refresh`)
  - when it was last updated, or why it failed

### Per shop

`shops.currencies` is JSON `[{code, rate}]` (migration 0063).

- `rate` is the shop's own rate: 1 of the shop's currency = `rate` of `code`.
- `null` = automatic.

`/online-store?section=currencies` (admin, its own form):

- Add a currency (`CurrencySelect`).
- Each row shows the automatic rate and takes an override.
- `PUT /online-store/currencies` (`StoreCurrenciesInput`) → `StoreService.updateCurrencies`.
- Rules: known ISO codes, rate > 0 or null, at most `STORE_CURRENCIES_MAX` (20), repeats dropped. The shop's own currency is dropped.

### Which rate is used

`storeCurrencies()` in `app/helpers/currency.ts` is the one rule. It is shared with the browser.

1. The manual rate.
2. Else the cross rate from the table (`crossRate`).
3. Else the currency is **left out**.

`ExchangeRateService.forShop()` gives `store.currencies`. The shop's own currency is first, at rate 1. It is `[]` when there is nothing to switch to.

### The visitor's pick

- A "Currency" dropdown in every theme's header (`layout.edge`) lists `store.currencies`. It is left out when the list is `[]`.
- It is a plain form: `POST /currency` (public, like `/lang`).
- It sets the `currency` cookie (`CURRENCY_COOKIE`, 1 year) and sends the visitor back.
- The theme script submits it on change.
- `StorefrontSupport.find()` turns the cookie into `store.display` (`{code, rate}`). Null = the shop's own. A code the shop does not offer is ignored.
- So the server already prints converted prices.

### Showing a price

| Where | Call | What it does |
|---|---|---|
| Template | `price(cents)` (`StoreViewService.context`) | Converts with `convertCents` = `round(cents × rate)`. Formats in `display.code` with `formatMoney()` (`app/helpers/currency.ts`). |
| Browser | `Store.money(cents)` | The same, in the cart drawer and the product sheet. |
| Template | `money(cents)` | Formats in the shop's currency. No conversion. |
| Browser | `Store.moneyIn(cents, code)` | Formats in the given currency. No conversion. |

### Checkout

Every amount is in the shop's currency.
When `store.display` is set, a note under the total says "About £9. You pay in USD." (`[data-currency-note]`).

## Authentication (customers sign in with email / Google / Microsoft)

Customers may sign in to a shop's store. Then they can:

- see their past orders, with status, tracking and lines
- keep their name, phone and delivery addresses
- get the checkout prefilled

Sign-in runs through the **shop's own Firebase project** (Firebase Authentication, free tier). Nothing else is needed on the server.

Shop-owner walkthrough: [guides/firebase-setup.md](../guides/firebase-setup.md).

### Setup

`/online-store` › Authentication (admin). It is saved with the main settings form (migration 0046).

- One switch per provider: `shops.customer_logins`, a comma list of `CUSTOMER_LOGINS` = `email` (email + password), `google`, `microsoft`.
- The Firebase **web app config**: `shops.firebase_config`, JSON `{api_key, auth_domain, project_id, app_id}`. This is the `firebaseConfig` block from Project settings › Your apps.
- Every value is public. So nothing is encrypted.
- The same providers must be enabled in the Firebase console (Authentication › Sign-in method).
- The store's domain must be added under Authorised domains.

Rules of `updateSettings`:

- It keeps a half-filled config while every provider is off.
- It refuses a provider without a whole config (`firebase.<field>` errors).

What the pages get:

- `StoreAuthService.logins(shop)` = `{providers, firebase}` when accounts are on and the config is whole. Else null. It is on every public page as `store.login`.
- `store.customer` = `{name, email, phone, addresses}` of whoever is signed in. Null for a guest.

### Sign-in in the browser

- Each theme's header has a "Sign in" button next to the cart button. It is left out while `store.login` is null.
- It opens the theme's own sign-in `<dialog>`. The theme's `script.js` draws it.
- A `store:login` event on `document` opens it from anywhere. The checkout island fires it for its "Sign in" link.

The rules live in `Store.auth` (`resources/js/store/auth.ts`):

1. It loads the Firebase **compat** SDK from gstatic on the first click (`FIREBASE_SDK_VERSION`).
2. It runs the Google or Microsoft pop-up, or the email form: sign in, create an account, forgot password. The emails are Firebase's own.
3. It sends `POST …/account/login {token}` with the ID token.
4. It reloads the page.

Creating an email account sends Firebase's verification link and stops there.
The server refuses unverified emails. The answer has `unverified: true`. The dialog then offers "Send the link again".

### Sign-in on the server

`POST /account/login` on the store's host (`storeLogin` rate bucket).

1. `lookup(apiKey, idToken)` in `app/gateways/firebase/Firebase.Api.ts` asks Identity Toolkit's `accounts:lookup` with the shop's web API key.
   - A token of another project is refused there.
   - There is no JWT code and no service account.
   - The env `FIREBASE_LOOKUP_URL` overrides the host. The e2e run points it at its fixture server.
2. `StoreAuthService.login` finds the customer by `customers.firebase_uid`.
3. Else it **claims the shop's customer record with that verified email**. So a buyer's earlier guest orders show up.
4. Else it creates one. The name is the account's display name, else the email.
5. `Auth.customerLogin()` in `app/xcore/auth/Auth.ts` sets the **`csid`** cookie.

About the cookie:

- It is a `customer_sessions` row: customer, shop, 30 days (`CUSTOMER_SESSION_TTL_DAYS`).
- It is httpOnly and sameSite lax.
- It is a different cookie from the staff `sid`.
- A session only counts on the shop it was made on.
- `POST …/account/logout` drops it.

### Account pages

They are public routes. They are `noindex` and `Disallow`ed in robots.txt.

`GET …/account?page=&tab=` renders the theme's `account.edge`.

- A guest gets the sign-in prompt.
- A customer gets three tabs.

| Tab | What |
|---|---|
| **Your details** | `POST …/account`. `StoreProfileInput` = the checkout's name and phone rules. The phone is unique per shop. |
| **Delivery address** | A list of `customer_addresses` rows. Several per account. Each has a `label` and the receiver's `phone`. |
| **Your orders** | `OrderRepository.forCustomer`, `ACCOUNT_ORDERS_PER_PAGE` = 10, newest first. One line each, with its stage. |

Address routes:

| Route | What |
|---|---|
| `POST …/account/addresses` | Add |
| `POST …/account/addresses/:id` | Edit |
| `POST …/account/addresses/:id/delete` | Remove |

- `StoreAddressInput` = the checkout's address and phone rules.
- `ACCOUNT_ADDRESSES_MAX` = 10.
- Edit and remove only reach the customer's own rows.

These are plain HTML forms:

- Success = a 303 back to the tab.
- An error = the page again, with `errors` and the posted values in `old`.
- The address boxes are `store/partials/address.edge`.
- The checkout island turns them into the same guided State → City lists as the checkout (`[data-store-address]`).

One order:

- The orders link to `GET …/account/orders/:reference` → the theme's `order.edge`.
- It uses `OrderRepository.byReference`. It shows the order only when `orders.customer_id` is theirs.
- It may `@include('store/partials/order')`. This is the same order card the Track page can use.

A guest who hits a mutation or an order page is sent to `…/account`.

Every payload is `StoreViewService.pubOrder` or `pubCustomer`. They carry no costs, no ids and no notes. A saved address keeps its id, because the account edits and removes it by that.

### Checkout while signed in

The checkout island is `resources/js/store/islands/Checkout.vue`.

- On mount it prefills name, phone, email and the **first saved address** from `store.customer`.
- The device's `store-customer:<slug>` copy is neither read nor written while signed in.
- It lists every saved address above the boxes ("Saved addresses"). One tap fills them and the phone.

Who the order belongs to:

- `StoreController.checkout` passes the signed-in customer to `StoreService.checkout(…, customerId)`.
- That freezes `customer_id` on the cart snapshot.
- So `fulfill` writes the order **to that account**.
- A guest is still matched by email or phone, as before.
- **But a guest is never matched to a customer with a store account** (`firebase_uid` set). That order gets no customer. So a stranger who types someone's email cannot put orders in their account history.

The email:

- The **email box is read-only** while signed in.
- `StoreController.accountEmail()` puts the account's email into the checkout and coupon requests.
- So a changed request cannot use another address: not for the confirmation, not for customer-only codes, not for per-customer limits.

Saving the address:

- A delivery address that is new to the account is added to it after the order (`CustomerAddressRepository.remember`).
- Same street, city, country and postal code = already there.
- A full list is left as it is.
- The checkout shows a **Save address for next order** box. It is on by default. It is `save_address` on the checkout body, frozen on the cart snapshot.
- A guest sees the "Remembered on this device" note in its place.

### Tests

- `app/services/sales/__tests__/StoreAuth.Service.test.ts`:
  - settings rules
  - login: claim by verified email, create, refuse unverified, no email, forged, offline, accounts off
  - addresses: add, edit and remove reach only their own, the cap, remembered after an order unless `save_address` is off
  - orders are theirs alone
  - sessions
- `e2e/l-store-checkout.spec.ts` has two tests. They use a stubbed Firebase SDK in the page. The fixture server verifies the token.
  - Test 1: the admin switches, sign-in and a wrong password, the earlier guest order on the account, the three tabs, add / edit / remove address, the checkout prefilled, the one-tap swap, the save box, a manual order that lands the typed address on the account, localStorage untouched, sign-out.
  - Test 2: the guest's account page, create-account with the password twice and the inbox notice, forgot password.

## SEO, server rendering, product pages, sitemap

Every store page is plain HTML. Edge prints it on the server. There is no Vue, no Inertia and no SSR bundle.

See [store-seo.md](store-seo.md) for:

- the head tags every public page gets
- the per-product pages (`<store>/p/<product-slug>`, `products.slug`)
- `sitemap.xml` and `robots.txt`
- how to get the products into Google

How the pages are put together: [store-themes.md](store-themes.md).

### Behind a reverse proxy

- Set `APP_URL`, for example `https://pos.example.com`. Then the gateway's success and cancel URLs are built correctly. Without it the request's origin is used.
- On a store's host the request's own origin always wins (`X-Forwarded-Proto` + `X-Forwarded-Host`). `APP_URL` would point at the wrong host.

### How a request becomes a page

1. `StorefrontSupport.find(req)` resolves every public request to `{ shop, base, url, customer, theme, currencies, display }`. The type is `Storefront` in `app/services/sales/StoreView.Service.ts`.
2. `base` is the link prefix. It is always `""` now, because every store sits at the root of its host.
3. It reaches the templates as `store.base` and the `url` helpers. It reaches the browser as `Store.url`. Every storefront link and `fetch` is built from it.
4. The controller calls `StoreViewService.render(req, s, page, props, seo)`. That prints the theme's page inside `store/document.edge`.

## Buying flow (public, no auth)

### What every theme shows around the pages

- Only categories that contain products are offered as filters: `categories[{ id, name, color, count }]`. The counts are from the whole catalog.
- `store.payment_label` is the name for the cart's "Secure payment by Stripe" line:
  - the running gateway extension's name
  - else the first manual option's label
  - else "card", while payments are off
- Each theme's footer (`layout.edge`) shows:
  - a brand column: logo, name, address, hours
  - a **Contact** column: phone and social links, only when set (see Setup)
  - an **Information** column: a link per custom store page (`store.pages`) and the **Track order** link (`…/track`)
  - a "© Year Shop name" line under them
- An announcement strip (`store.banner`) sits above every theme's header when set.

**The catalog cache.**

- The public catalog of a shop is kept in memory for 30 seconds (`STORE_CATALOG_TTL_MS`, `StoreCatalogService.catalog`).
- A change to its products, categories or stock drops it at once.
- That is `catalogChanged()` in `app/helpers/catalogVersion.ts`. The product, category and stock repositories call it.

### No payment option = "Send order"

A shop has no payment option at all when no payment extension is running and no manual option is on. Then `store.payments` is empty.

- The cart's button says **Send order**. There is no checkout step.
- `Store.checkout()` posts the cart to `POST /checkout/send`.
- The body is `StoreSendInput` = the lines only.
- The limits are the `storeCheckout` bucket plus the small `storeManualOrder` budget.

`StoreService.send` then:

1. Prices the cart from the DB.
2. Snapshots it with `gateway: "direct"` (`STORE_DIRECT`).
3. Writes the order at once through the same `fulfill`.

The order is:

- **unpaid**, with `payment_method` "Pay later"
- `fulfillment` "new"
- with no name, no address, no delivery fee and no code
- with the shop's tax
- owned by the signed-in customer, when there is one

After that:

- The buyer lands on `/done?sid=direct_…`.
- Staff record the money on `/orders/:id`.
- A refusal (sold out, rate limit) is shown under the button (`[data-cart-error]`).
- Once any payment option is on, the button is **Checkout** again and `/checkout/send` answers 422.
- The `/checkout` page still opens by its URL. It still says the store takes no payments.

### Step 1: the catalog

`GET /` on the store's host renders the theme's `home.edge` with **one server-side page** of the public catalog (`StoreService.browse`).

| Query | Meaning |
|---|---|
| `?q=` | Name search |
| `?category=` | One category |
| `?page=` | The page. 12 per page (`STORE_PER_PAGE`). It is clamped to the last page. |
| `?sort=` | `featured` (default: featured first, then last updated), `newest` (highest id), `price_asc`, `price_desc` by the shown price. `STORE_SORTS`. |
| `?stock=1` | Hides sold-out products |

`StoreService.catalog` is the full public shape: no purchase prices, `sold_out` flags, stock counts only when stock is tracked.

**The URL is the state.**

- Search, sort and "In stock" are a plain `GET` form.
- The category pills and the pager are plain links (`url.catalog({...})`, `pager.prev/next/pages`).
- So pages are linkable, reload-safe, crawlable and work without JavaScript.

**Packages.** `StoreProduct` also carries `kind` and `bundle_items`. So packages sell online exactly like in the POS.

- `Store.picker(product)` (`resources/js/store/picker.ts`) gives the theme one choice row per slot, plus the "In this package" list.
- A package's `stock` and `sold_out` come from the components. See [products.md](products.md).
- Component *costs* never reach the catalog. They are read on the server in `priceLine`.

**Product cards.**

- They are real `<a href>` links to the product page.
- The theme script turns a plain click into its product sheet (a `<dialog>`).
- A modifier-click, a sold-out card, or a product that is not in the page's data follows the link.
- Adding a unit does **not** open the cart drawer. It closes the sheet and pops the header badge. The theme listens to `store:cart` with `added`.
- The drawer opens only from the cart button, or after "Update line" on a line that was reopened from the drawer.

**The cart.** It lives in `Store.cart` (`resources/js/store/cart.ts`).

- It is in localStorage under `store-cart:<slug>`, for 24 hours.
- On load it is re-synced against the products on the current page.
- A line whose product is not on this page is kept as saved. The checkout prices from the DB again anyway.
- Quantities are capped at tracked stock.
- A package line whose choices no longer resolve is dropped.
- Another tab's change is picked up through the `storage` event.

### Step 2: the checkout page

The drawer's **Checkout** button opens `GET /checkout` (`noindex`).

This page is shared by every theme:

- `resources/views/store/checkout.edge` inside the theme's layout
- with the **checkout island**: a small client-only Vue app (`resources/js/store/checkout.ts` → `islands/Checkout.vue`)
- It takes its look from the theme's `--store-*` CSS variables.

#### What it asks

- name, phone number, email
- "How would you like to get it?": Delivery or Pick up in store. Only when the shop offers pick-up. Pick-up hides the address block.
- the delivery address, as a proper form

#### The address: State / Province first, then City

**With lists.** When the shop keeps `guided_address` on and the country's postal codes are downloaded, both are searchable lists (`components/store/OptionSelect.vue`).

- `GET …/address?country=&state=&q=` → `StoreService.address` → `{states, cities: [{place, postal_code}], more}` (`storeAddress` rate bucket).
- The shop country's `states` come with the page.
- The City list is **server-searched** (`remote`): first the first `CITY_PAGE` (20) cities A–Z. Then every keystroke asks again with `q` while `more` is true. A state can hold hundreds of cities.
- Picking a city fills the postal code with its lowest one. The box is read-only then.

**Without lists.** A country that is not downloaded, or a shop with the lists switched off, gets plain text boxes:

- address line 1
- address line 2 (the only optional address line)
- city
- state / province
- country
- postal code (optional)

The country box is a searchable combobox (`components/store/CountrySelect.vue`): flag, name, dial code. Its data is `app/constants/Country.Constant.ts`, a plain module. So server validation and the browser share it. The country name is what is stored.

#### Validation

- The server validates per field (`StoreCheckoutInput`): required, length limits, phone format, email, and the country must be one of the list's names.
- The same zod schema (`app/validators/StoreCustomer.Validator.ts`) runs in the page on Pay, then live on every change.
- The page shows inline messages, `aria-invalid` borders, and focuses the first invalid field.
- The form is `novalidate`. There are no browser bubbles.
- All this happens before anything is posted.

#### Remembering the buyer

- A guest's details are saved in `localStorage` per shop (`store-customer:<slug>`) before paying. So the next order is prefilled.
- It is per shop on purpose. One shop's address must never fill another shop's checkout.
- A signed-in customer's details are neither read from nor written to the device. Their account is the source.

#### Pay with

`store.payments` lists the ways to pay:

1. The online provider first. It is always labelled "Credit card and other payment methods" (`store_server.online_payment_label`). A buyer does not know what Stripe, 2C2P or Omise are.
2. Then the manual options, each with its `instructions`.

When there is more than one, the summary starts with a **Pay with** radio list.

- The chosen manual option shows its bank details right there.
- The button then reads **Place order** instead of **Pay**.

#### The request: `POST /checkout`

JSON `{items, customer, payment, coupon}`:

| Field | Value |
|---|---|
| `items` | Each `{product_id, variant_id, qty, choices}`. `choices` maps a package's slot id to the chosen variant. |
| `customer` | `{name, phone, email, address_1, address_2, city, state, country, postal_code}` |
| `payment` | `""` for the online provider, or a manual key the shop switched on. Anything else → "That payment option isn't available". |
| `coupon` | A discount code or `""` |
| `pickup` | `true` for pick up in store. Only when `shops.pickup`. |
| `save_address` | For a signed-in customer: keep the address on the account. |

About the code: the summary's **Discount code** box asks `POST …/checkout/coupon` what a code takes off. The checkout applies it again from scratch. See [coupons.md](coupons.md).

It is validated by `StoreCheckoutInput`. Field errors come back as `customer.<field>`. A dead code comes back as `coupon`.

#### What the server does

1. It prices everything from the DB again.
2. It works out the **delivery fee** from the address and the goods: `deliveryFee(shop, {country, state, city}, subtotal)`. See [Delivery](#delivery).
   - Pick up in store costs 0 and needs no address. The controller then validates the body with `StorePickupCheckoutInput`.
   - An address no zone covers comes back as `errors["customer.country"]` "We don't deliver to <country>". It is `customer.state` or `customer.city` when only state or city zones name the country.
   - This happens before any gateway is touched.
3. It checks stock.
4. It snapshots the priced cart **and the buyer** into `store_carts`.
5. It asks the shop's online gateway extension for a hosted checkout: `payment.createCheckout(config, args)`.
   - The email is passed along. Stripe prefills it.
   - A non-zero fee is sent as one extra "Delivery" line after the products.
   - Stripe uses plain fetch. `stripeAmount` in `extensions/stripe/index.ts` converts zero-decimal and three-decimal currencies.
6. It returns `{url}`. The browser leaves for the gateway.

Errors come back as `{errors}` with 422: credentials missing, an item vanished, not enough stock.

#### Tokenising gateways (Omise)

They have no hosted page. So the same call answers this instead:

`{tokenize: {gateway, public_key, amount, currency, ref, methods, script}}`

| Field | Meaning |
|---|---|
| `script` | The extension's browser script, `/store/<slug>/ext/<key>/assets/…`. It is loaded with a dynamic `import()` and called as a `PaymentScript`. The core knows nothing about omise.js. |
| `ref` | Our own random session key for the snapshot row |
| `amount` | Already in the provider's smallest unit |
| `methods` | The *other* payment methods this merchant's account offers |

**Where `methods` comes from** (`extensions/omise/index.ts`):

- Omise's Capability API, `GET /capability`, with the public key. It is capped at 5 seconds (`CAPABILITY_TIMEOUT_MS`).
- It keeps every name the account enables that the pre-built form can finish alone (`FORM_METHODS`).
- The card is left out. It is the form's default tab.
- `installment_kbank`, `installment_bay` and the like become the single `installment` tab.
- Anything the form cannot finish alone is dropped: `internet_banking_*`, `truemoney`, `econtext`, `atome`, `points_citi`, `barcode_alipay` and the like.
- A capability call that fails returns `[]`. It never blocks the checkout.

**The form** (`extensions/omise/assets/checkout.ts`):

- The script loads `https://cdn.omise.co/omise.js` on demand. Only a Pay click gets there.
- It opens **Omise's own pre-built modal with its defaults**: its frame, its close icon, no style overrides.
- It calls `OmiseCard.configure({publicKey, otherPaymentMethods: methods, onCreateTokenSuccess, onFormClosed})`.
- Then `OmiseCard.open({amount, currency, frameLabel: <shop>, submitLabel: "Pay"})`.
- `otherPaymentMethods` is left out when the list is empty.
- Closing the modal only releases the Pay button.
- Failures land in the checkout page's usual error slot.

**The charge**:

1. `onCreateTokenSuccess(nonce)` gets a `tokn_…` card token or a `src_…` source.
2. It POSTs it to `POST /checkout/pay` `{ref, token}`.
3. That endpoint charges it on the server: the extension's `charge` → Omise `POST /charges` with `return_uri = …/done?sid=<ref>`.
4. It stores the charge id **and any QR code** in the snapshot.
5. It answers `{url, qr}`. The browser always goes to `url`.

| Method kind | `url` | What happens |
|---|---|---|
| Redirect and app-redirect (3-D Secure cards, wallets) | Omise's `authorize_uri` | The buyer authorises there and comes back to `/done`. |
| QR (PromptPay and the like, Omise flow `offline`) | `/done` itself | There is nothing to redirect to. The charge carries `source.scannable_code.image.download_uri`. `pay` keeps it on the snapshot (`payload.qr`). So `/done` can show it with no extra route. |

The card never touches this app. The amount always comes from the snapshot.

#### Manual options

`payment: "cod"` or `"bank_transfer"` skips the provider entirely.

- The snapshot is keyed by our own `<key>_<uuid>` ref, with `payload.gateway = key`.
- The same `fulfill` runs at once.
- It writes the order **unpaid**: `paid = 0`, `payment_status = unpaid`, `payment_method` = the option's label.
- Stock is taken. The buyer is attached and emailed.
- The browser is sent to `…/done?sid=<ref>`.
- That page says "Order received" with the bank details, instead of "Thank you".

### Step 3: back from the gateway

The gateway redirects to `GET /done?sid=<session>`.

- Each gateway appends its own `sid` to the success URL. Tokenising ones use our `ref`.
- 2C2P brings the buyer back with a POST. `POST /done` sends it on to the GET.

The server:

1. Verifies the payment with the extension's `getPayment`. It uses the snapshot's `charge_id` when there is one.
2. Turns the snapshot into a normal order **exactly once**. The cart row is claimed atomically with `order_id = 0`. So double visits and refreshes show the same order.

The shared `store/done.edge` page (the island's `islands/Done.vue`) shows the receipt.
Like the checkout page, it renders inside the shop's theme layout, with its header and footer.

The three states:

| State | What the page shows |
|---|---|
| Paid | The receipt |
| Not paid yet | "Payment pending". Or "Scan to pay" with the QR code (about 240 px), when the snapshot carries one. |
| Can never succeed | "Payment failed" with the provider's reason, and **Try again** back to `/checkout` |

While waiting:

- The page quietly asks the server again every 4 seconds: `fetch(location.href)` with `Accept: application/json`. `done()` answers JSON then.
- So it turns into the receipt on its own.
- A QR buyer never leaves this page.
- A buyer back from a redirect is often a moment earlier than the gateway's own bookkeeping.

A failed payment:

- `getPayment` reports `failed` with the provider's `reason`.
- Omise: `status` `failed`, `expired` or `reversed`, or any `failure_code`.
- Stripe: an expired session.
- The cart is still in `localStorage`, so **Try again** works.
- The page stops polling.
- Nothing is ever recorded for it.

### Step 4: the confirmation email

The buyer gets an order confirmation email.

- It is sent once and not awaited.
- It only goes out when a provider is switched on in the shop's own **Shop Email** (`/shop-email`) or in the platform's **Outgoing Email** (`/email`).

See [email.md](email.md).

### Step 5: track your order

`GET …/track?code=P8J4-MJSQ-4Z8T` renders the theme's `track.edge`.

- It is `noindex`.
- It is linked from every theme footer, the thank-you page and the emails.

It asks for two things:

- The **public order code** (`orders.reference`). It is random, never the sequential id. So orders cannot be enumerated. See [orders.md](orders.md).
- The email or phone the order was placed with.

`POST …/track`:

- `TrackInput` normalises the code. Case and dashes do not matter.
- It is rate-limited by the `storeTrack` bucket.
- It renders the same page with the order when `OrderRepository.findForBuyer` finds that code in this shop *and* the attached customer's email or phone matches.
  - The email is compared case-insensitively.
  - The phone is compared by digits, with at least 6 of them.
- Else it shows one vague "couldn't find" line. It never says which half was wrong.

The page shows:

- the payment line: paid / to pay by … with the bank details / cancelled / refunded
- the delivery progress: the shop's delivery steps (`store.fulfillment_steps`, built-in `new → packing → shipped → delivered`). It is hidden for voided orders.
- the tracking number
- the items and the delivery address

The public order shape (`StoreViewService.pubOrder` in `StoreView.Service.ts`) never carries costs or internal ids.

### The cart snapshot and the order

The cart snapshot carries:

- `subtotal`
- `discount` + `coupon`, when a code was applied ([coupons.md](coupons.md))
- `delivery_fee`, already waived by a free-delivery code
- `tax` + `tax_rate` / `tax_label` / `tax_included`: the shop's tax line ([shops.md](shops.md) › Tax). A tax added on top is also sent to the hosted gateway as its own line.
- `total = subtotal − discount + (tax unless included) + delivery_fee`

So the order matches what the gateway charged.
`orders.delivery_fee` is the fee. It is 0 on POS orders, and 0 for snapshots taken before migration 0030.

The resulting order is a regular order:

- `payment_method` = the gateway label ("Stripe").
- It is paid in full. Or `payment_status = unpaid` for a manual option, until the shop records the money on `/orders/:id`.
- `fulfillment = new`. So it shows under **Online** on `/orders` and walks new → packing → shipped → delivered there ([orders.md](orders.md)).
- Stock is taken through the `stock_movements` ledger.
- It is visible in `/orders` and all reports.

The "cashier" is a hidden, deactivated **Online Store** user (`STORE_SYSTEM_EMAIL`). It cannot log in. It shows up in the by-cashier report.

The buyer:

1. The buyer typed on the checkout page is matched to an existing customer of the shop by email.
2. Then by phone.
3. Else a new customer (name, phone, email) is created.

The gateway's record is only a fallback.

The order's `note` says where to deliver: `Deliver to: name · phone`, then the address lines, `city, state postal` and the country. It is shown on the order page and printed on the receipt.

### Edge cases

- **Sold out between paying and returning** (a rare race): the paid order is still recorded, without taking stock. So no paid order is ever lost. Fix the count with an adjustment.
- **Abandoned carts** (`store_carts` rows without an order) are dropped after 7 days (`STORE_CART_TTL_MS`, `purgeStale`). They live a week for the abandoned-cart email.

### No gateway webhooks

This is on purpose. A webhook sent while the server is down is lost, and not every gateway sends it again.

Instead the server **pulls**: `StoreReconcileService.run()` in `app/services/sales/StoreReconcile.Service.ts`.

- It is a `Bun.cron` job, registered by `Schedule.cron()` (`app/xcore/schedule/Schedule.ts`) from `app/jobs/Job.Registry.ts`.
- `STORE_RECONCILE_CRON` = every minute, plus one run on boot.
- It sweeps `store_carts` rows that were handed to a gateway and have no order yet.
- It only looks at carts younger than a day (`STORE_RECONCILE_WINDOW_MS`).
- It calls the same `fulfill` the `/done` page uses.
- It looks at `STORE_RECONCILE_WORKERS` (5) carts at the same time.

| Answer | What happens |
|---|---|
| Paid | The order is created once. The buyer gets the confirmation email. This is their receipt, because they never saw the thank-you page. |
| Still pending | `checks`++ and `next_check_at` = now + 2^checks minutes, capped at an hour (`STORE_RECONCILE_MAX_WAIT_MS`). |
| Failed | Left alone, until `purgeStale` drops it after 7 days. |
| The gateway cannot be reached | Counts as pending. |

Logs:

- Every outcome is logged under `[store-reconcile]`: cart, session, shop → paid / still pending and the next look / failed.
- A sweep with nothing due logs nothing of its own. Only the `Schedule.cron()` wrapper logs its `run (cron …)` and `done in N ms` pair. So a schedule that stopped firing is visible by its silence.

So a buyer who pays and then loses the connection, closes the tab, or reaches the server while it is down still ends up with an order. It takes a couple of minutes after the server is back.

### Marketing links

See [marketing.md](marketing.md). They are at the root of the store's host. The links are built with `Url.storeOrigin`.

**`GET …/cart/<token>`** is the abandoned-cart email's **Complete your order** link.

- It renders the checkout page with `restore` in the data island: the cart's product and variant ids, names, pictures, prices and quantities.
- `window.Store` puts them into the browser cart and changes the address to `…/checkout`. So a reload does not restore again.
- It changes nothing on the server.
- An unknown or expired token redirects to the store.

**`GET …/unsubscribe/<token>`** renders the theme's `unsubscribe.edge` (`noindex`).

- It asks "Unsubscribe from <shop> emails?".
- Its button `POST`s to the same URL (`storeUnsubscribe` rate bucket).
- That POST is also the one-click POST of `List-Unsubscribe-Post`.

## Templates

Six are shipped. The keys are stable. They are what `shops.online_template` stores. The labels are the names shown in the picker.

| Key | Label | Look |
|---|---|---|
| `classic` | **Editorial** | Warm paper, Instrument Serif display, index grid |
| `minimal` | **Minimal** | Airy, monochrome. It follows the device's light / dark setting. |
| `soft` | **Soft** | Rounded cards, pill nav, sage accent |
| `boutique` | **Sunday** | Peach-amber gradients, big rounded shapes |
| `noir` | **Noir** | Near-black, electric lime, edge-to-edge grid. The only dark one. |
| `lumen` | **Lumen** | Lavender-grey, frosted-glass cards, violet accent, filter row |

### What a template is

Each one is a folder of Edge templates, plain CSS and one browser script: `resources/views/themes/<key>/`.

- `layout.edge` plus one `.edge` per page in `STORE_THEME_PAGES`
- its own partials
- `style.css` and `script.js`
- an `index.ts` that imports the `.edge` files as text. So they are inside the compiled binary.

Also:

- The fonts are self-hosted through `@fontsource` imports in each theme's `style.css`.
- `vite.config.ts` finds every theme's `style.css` and `script.js` with a glob and builds them next to the app. So they are served from `/build/*`.

The **checkout** and **thank-you** pages are not in a theme.

- They are shared: `resources/views/store/checkout.edge`, `done.edge` and the checkout island.
- They render inside the theme's layout.
- They take the theme's look from the `--store-*` CSS variables every theme sets.

### The shop's own look

Admin only. Built-in templates only.

The gear button on a template's card opens `components/store/ThemeConfigDialog.vue`:

| Section | Options |
|---|---|
| **Brand colors** | Primary color, Secondary color |
| **Page** | Background color, Text color, Small text color |
| **Cards** | Card background, Card text |
| **Footer** | Footer background, Footer text |
| **Font** | One font |

- The options scroll inside the dialog. Its buttons stay in view.
- Each option may stay empty. Empty = the template's own.
- **Reset** empties all of them.

Saving:

- It saves at once with `PUT /online-store/theme`.
- `StoreThemeInput`: `template` + `primary` / `secondary` / `background` / `text` / `muted` / `surface` / `surface_text` / `footer` / `footer_text` as `#rrggbb` + `font` = a key of `STORE_FONTS`.
- → `StoreSettingsService.updateTheme` → `shops.theme_config` (migration 0085).
- The JSON is `{ <template>: { primary, secondary, background, text, muted, surface, surface_text, footer, footer_text, font } }`.

Rules:

- The look is kept **per template**. So switching the template never carries colours over.
- A template with a look shows **Customized** on its card.
- The storefront prints it with `StoreViewService.lookStyle()`. Colours and font are checked again there, because they go into a `<style>`.
- What each template does with the two brand colours is in [store-themes.md](store-themes.md) › The shop's own colours and font.

Fonts (`STORE_FONTS`):

- They are the ones already self-hosted through `@fontsource`. Each has one small file in `resources/css/store-fonts/`. Only the picked one is loaded.
- Plus System UI and Georgia.
- A new font = its `@fontsource` package, a file there, and a line in `STORE_FONTS`.

An extension theme has its own settings (`fields`) instead.

### The theme contract

It is in [store-themes.md](store-themes.md):

- the files
- every variable a template gets
- the forms that work without JavaScript
- `window.Store`
- the accessible names and `data-*` hooks the tests use
- the CSS variables

Classic is the reference theme. Copy it to start a new one.

### Adding a template

1. Copy `resources/views/themes/classic/` to `resources/views/themes/<key>/`.
   Change the markup, the CSS and the drawing parts of `script.js`.
   Keep every page of `STORE_THEME_PAGES`, the accessible names and the `data-*` hooks.
2. Add the folder's `index.ts` to `resources/views/themes/index.ts`.
3. In `app/constants/Store.Constant.ts`:
   - add the key to `STORE_TEMPLATES`
   - add its label, description key, colour scheme, `featured` count and `colors` to `STORE_TEMPLATE_INFO`

`scheme`:

| Value | Meaning |
|---|---|
| `light` / `dark` | Pins `<html class>` for a hard-coded palette. Noir is `dark`. |
| `auto` | Follows the visitor's device. Minimal is `auto`. |

The `/online-store` › Template picker is built from `STORE_TEMPLATE_INFO`.

## Themes — a template an extension brings

A shop is not limited to the six. An extension may carry its own look.

- It has a `theme` block in its manifest.
- It uses the same Edge folder format as a built-in theme: every page of `STORE_THEME_PAGES` in its `views` folder, its own CSS and script under `assets/`.
- The example is `extensions/aurora`.
- An upload that misses a page is refused.

How it is picked and loaded:

1. `ExtensionService.themes(shopId)` lists the running ones for the picker on `/online-store` › Template.
2. Picking one saves `shops.online_template` as **`ext:<key>`** (`STORE_THEME_PREFIX`). The validator accepts it next to `STORE_TEMPLATES`.
3. `StoreViewService.theme(shop)` asks `ExtensionService.storeTheme(shop)`.
4. That registers the extension's templates as `ext/<key>/<file>` (`StoreView.useExtensionTheme()` in `app/xcore/view/StoreView.ts`).
5. It returns them with the stylesheet, the script, the scheme, the extension's dictionary and its non-secret settings (`theme.config`).

**Words.** `t()` in a template (and `Store.t()` in the browser) looks in the theme's dictionary first, then in the app's.

- So a theme's `i18n/<locale>.ts` can rename any storefront text: its own pages *and* the shared checkout.
- `"store.add_to_cart": "Book"` renames the button everywhere at once.

**Trust.** Edge expressions run on the server, like the extension's own module. Only the platform admin adds extensions.

**Fallback.**

- A theme that is switched off or removed falls back to Classic.
- A theme that throws while a page renders is logged (`[store] theme …`). That page is drawn again with Classic.
- A storefront never breaks because of its look.

## Payment gateways — adding one

Write an extension. See [extensions.md](extensions.md).

It needs:

- a manifest `payment` block
- `fields` = the credentials
- for hosted: `export const payment` with `createCheckout` / `getPayment` / `returnId?`
- for tokenize: `amount` / `methods?` / `charge` / `getPayment`, plus a browser `script`

The shipped ones in `extensions/stripe`, `omise`, `2c2p` and `paypal` are the examples.
The manual options are core code (`app/gateways/manual/`).

The core is generic. All of these work from the manifest and the `payment` export:

- credential storage and encryption
- the `/extensions` dialog
- checkout and `/done`
- the reconcile sweep
- order attribution

## Tests

| File | What it checks |
|---|---|
| `app/services/sales/__tests__/Domain.Service.test.ts` | Managed domains: DNS → pending / live, the Traefik file built again from the database, a missing mount, saving the settings. |
| `app/services/sales/__tests__/Store.Service.test.ts` | See below. |
| `app/services/sales/__tests__/StoreReconcile.Service.test.ts` | The pull sweep: paid → order once, pending back-off, failed. |
| `app/services/sales/__tests__/PostalCode.Service.test.ts` | Cities and postal codes. |
| `app/xcore/view/__tests__/store.test.ts` | The store document: the head, the page inside the theme layout, the scripts, the data island (valid JSON, no raw `<`), JSON-LD that cannot close its tag, `noindex` only when asked, a product name with HTML printed escaped. |
| `app/xcore/http/__tests__/url.test.ts` | `Url.slugOfHost` (one label under `STORE_DOMAIN` is a slug) and `Url.storeOrigin`. |
| `resources/js/store/__tests__/cart.test.ts` | Stock caps, events, storage, the 24 h expiry, re-sync, another tab. |
| `resources/js/store/__tests__/picker.test.ts` | Guided options, editing a line, plain list, package slots. |
| `resources/js/store/__tests__/store.test.ts` | Money with and without a display currency, `t`, urls, the cart event. |
| `app/services/sales/__tests__/Order.Service.test.ts` | Record payment (partial → paid, caps), refunds capped at what came in, delivery stages, the shipped email once. |
| `app/services/sales/__tests__/OrderMail.Service.test.ts` | The unpaid confirmation and the shipped notice. |
| `extensions/<key>/<key>.test.ts` (stripe, omise, 2c2p, paypal) | Each gateway against a stubbed `fetch`: amount conversion, the request it sends, the paid / pending / failed mapping, 2C2P's JWT. |
| `app/services/settings/__tests__/Extension.Service.test.ts` | The payment rules of `ExtensionService` (one online gateway on at a time, an upload never switches one on, a hosted manifest without a `payment` export is refused) and the theme shape. |
| `app/helpers/__tests__/crypto.test.ts` | Encrypt / decrypt roundtrip, `slugify`. |
| `app/services/catalog/__tests__/Product.Service.test.ts` | Product slugs: unique per shop, non-latin fallback, rename. |

`Store.Service.test.ts` covers:

- the catalog shape
- settings: slug and domain uniqueness, the rename limit, and the payments rules (all saved at once, encryption at rest, a blank secret keeps the stored one, prefix and completeness checks, `""` = off)
- the checkout session: DB pricing, the stock guard
- fulfilment: idempotency, the stock ledger, customer creation, the stock race
- the tokenize path: the `tokenize` payload with the script URL, `pay` → charge, redirect vs. QR vs. direct, the QR kept and handed back while pending, pending / paid / failed fulfilment
- these use **fake payment extensions**, uploaded as zips and driven through `globalThis.__pay`
- the manual options: `paymentOptions`, a bank-transfer checkout → unpaid order + email with the details, `track` by email / phone
- `paymentLabel`

End-to-end. The store is at `storeOf(spec)` = `http://main-shop.localhost:<port>` (`e2e/tmp.ts`).

| File | What it checks |
|---|---|
| `e2e/l-store.spec.ts` | Enable and slug validation (reserved slugs too), public browsing, cart persistence, the no-gateway guard, delivery zones and pick-up, the product page (buy from it, share meta, sitemap), template switching, 404 when disabled, store pages, server paging + search + sort + "In stock" in the URL, the catalog without JavaScript, banner and contact. |
| `e2e/l-store-checkout.spec.ts` | Payment extensions (one online provider at a time), the manual-payment flow end to end (bank transfer → "Order received" → Online / Unpaid → Record payment → Shipped + tracking → the buyer finds it on Track), the custom request, coupons, the guided address, customer accounts, an extension theme. |
| `e2e/x-send-order.spec.ts` | "Send order" in a store with no payment option. |
| `e2e/t-currencies.spec.ts` | The currency dropdown. |
| `e2e/p-i18n.spec.ts` | The footer language switch. |
| `e2e/marketing.spec.ts` | The restore link and unsubscribe. |
| `e2e/n-packages.spec.ts` | A package on the storefront. |
