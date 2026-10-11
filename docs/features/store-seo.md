# Store SEO

How a shop's online store gets into search results, share cards and shopping catalogs.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/storefront.ts` |
| Pages, sitemap, robots, product feed | `app/controllers/Store.Controller.ts` |
| Head data (`storeSeo()`) and rendering (`render()`) | `app/services/sales/StoreView.Service.ts` |
| The `<html>` document | `resources/views/store/document.edge` |
| The head tags | `resources/views/store/partials/head.edge` |
| The product feed builder | `app/helpers/feed.ts` |
| The product page of a theme | `resources/views/themes/<name>/product.edge` |

## Server-side rendering

Every store page is plain HTML. Edge prints it on the server.

- There is no Vue, no Inertia and no SSR bundle on these pages.
- The page works without JavaScript.
- `curl http://main-shop.localhost:3000/` returns the whole storefront: names, prices, images and links.

How a page is made:

1. The controller builds the data.
2. It calls `StoreViewService.render()`.
3. That renders `store/document.edge`, the only file with an `<html>` tag.
4. The document includes the page of the shop's theme.

The browser scripts (`window.Store`, the checkout island, the theme's `script.js`) only add the interactive parts on top.

In dev, the templates are compiled again on every request, so an edit shows on reload.
In production they are cached (`Edge.create({ cache: app.isProd })`).

## Head tags

`head.edge` prints the head of every store page.
The data comes from `StoreViewService.storeSeo(shop, { url, title, desc, image?, type?, meta?, ld?, noindex? })`.

It prints:

- `<title>` and the canonical link
- the meta description
- Open Graph tags: `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`
- a Twitter card
- the Google verification tag
- `noindex`, when the page asks for it
- extra `<meta property>` tags, like the product price
- JSON-LD, when the page has some
- the GA4 and Meta Pixel loaders, when the shop set them

Rules:

- JSON is printed through `safeJson()`. It escapes `<`, so the JSON cannot close its `<script>` tag.
- A custom page's canonical points at itself. Its description is the page text.
- These pages are `noindex`: checkout, thank-you, track, account, unsubscribe and a search result (`?q=`).
- Set `APP_URL` in production. Then the absolute URLs in the tags are right.
- Upload URLs are site-relative. They are made absolute against the store's URL.

## Product pages

Google indexes URLs. So every product has its own page: `<store>/p/<product-slug>`.

Example: `https://corner-coffee.example.com/p/corner-mug`

`StoreController.product` renders the theme's `product.edge` with `product`, `related`, `gallery` and `range`.

### What the page shows

- A gallery with a thumbnail strip. `gallery` = the product's photos, then every variant's.
- The name, the price and the "was" price.
- The option picker and "Add to cart". The theme script draws them from `Store.picker()`.
- The description and the package contents.
- A **Related products** grid.

### Related products

`StoreService.related` picks up to `STORE_RELATED` (4) other products, in this order:

1. Products that share a category come first.
2. In stock comes before sold out.
3. Newest comes first.

They are the same `<a href>` cards as on the catalog.

### The slug

`products.slug` is `slugify(name)`, made unique per shop.

| Case | Slug |
|---|---|
| First product named "Corner Mug" | `corner-mug` |
| A second one with the same name | `corner-mug-2` |
| A name with no latin letters | `p-<id>` |

`ProductRepository` writes it on create and update.
So a rename moves the page, and the sitemap picks up the new URL.

### The head of a product page

`#productSeo` builds it:

- **Title**: `Name · Shop`.
- **Description**: the plain product text, cut short. With no text: "Name — $price at Shop".
- **Open Graph**: `og:type=product` with the first image.
- **Price tags**: `product:price:amount` and `product:price:currency`. Facebook, WhatsApp and Pinterest read them for the share card.
- **Twitter card**: `summary_large_image` when the product has a picture.
- **JSON-LD**: a Product node from `#productLd`.

### The Product JSON-LD

- Name, URL, description and images.
- One `Offer`. When variant prices differ: an `AggregateOffer` with the low and high price.
- `InStock` or `OutOfStock`.
- `image` = the shop logo when the product has no picture. This is the same fallback as `og:image`.
- `brand` = the "Additional data" row titled Brand or Marke.
- `shippingDetails` on the `Offer`: one per delivery zone that names whole countries (`#shippingLd`).
  Rest-of-world, state and city zones are left out.

Not there yet: return policy, GTIN and review data.

### Catalog pages

- The description lists the first product names.
- The JSON-LD is an `ItemList` of the same Product objects.
- Product cards in every theme are real `<a href>` links. Crawlers find the pages without JavaScript.
- A plain click opens the theme's product sheet. A modifier-click or a sold-out card follows the link.
- The sheet links to the product page, for sharing.
- A page past the first carries `?page=N` in its canonical.
- The pager's Previous and Next are real links, so crawlers walk every page.

## Sitemap

`GET /sitemap.xml` answers by host.

| Host | What it lists |
|---|---|
| A store's host (its subdomain or its own domain) | That shop's store, the catalog pages past the first (`?page=N`), the product pages and the custom pages |
| The main host | The paths in `Hooks.sitePaths`. This list is empty in the open-source app. An add-on may fill it. |

The answer is cached for one hour: `Cache-Control: public, max-age=3600` (`SEO_CACHE_CONTROL`).

In production, set `APP_URL` (or `TRUST_PROXY=1`). Else the links say `http`.

## robots.txt

`GET /robots.txt`:

- allows everything
- disallows `/login`, `/checkout`, `/done`, `/track` and `/account`
- names the sitemap

A host in `Hooks.closedHosts` is closed to every crawler (`Disallow: /`).
The list is empty in the open-source app.

It has the same one-hour cache as the sitemap.

## How a shop gets into Google

The owner does this once. No code is needed.

1. In Google Search Console, add the store URL as a **URL-prefix** property.
   A *Domain* property only offers DNS verification.
2. Pick the **HTML tag** method.
3. Paste the tag into **Online Store › General › Google Search Console**.
4. Press Verify in Search Console.
5. Submit `<store url>/sitemap.xml` under Sitemaps.

How it works:

- The tag is saved in `shops.google_site_verification`. `OnlineStoreInput` keeps only its `content`.
- `head.edge` prints `<meta name="google-site-verification">` on every store page, so Verify passes.
- Google then crawls the product pages. The JSON-LD makes them eligible for price and stock rich results.

The app does not submit the sitemap by itself:

- Google's sitemap "ping" address is gone since 2023.
- The Search Console API needs a verified owner.

## Product feed

`GET /feed.xml` on a store's host is that shop's product feed.
On the main host it answers not found.

These read it on a schedule:

- Google Merchant Center
- Meta Commerce Manager (Facebook and Instagram shops)
- TikTok catalogs

The format is RSS 2.0 with Google's `g:` tags.

### How it is built

1. `StoreController.feed` reads `StoreService.catalog`. This is the same cached list the sitemap uses.
2. It hands the list to `productFeed()` in `app/helpers/feed.ts`. That function is the one rule.

### What one item holds

There is one item per product.

| Tag | Value |
|---|---|
| `g:id` | The product id |
| `g:title` | The name, at most 150 characters |
| `g:description` | The description as plain text, at most 5000 characters. With no description: the name. |
| `g:link` | The product page |
| `g:image_link` | The first picture |
| `g:additional_image_link` | Up to 10 more pictures |
| `g:availability` | `in_stock` or `out_of_stock`, from `sold_out` |
| `g:price` | The price in the shop's currency, like `18.00 USD`. For a reduced product: the "was" price. |
| `g:sale_price` | The price now. Only for a reduced product. |
| `g:condition` | Always `new` |
| `g:brand` | The "Additional data" row titled Brand or Marke |
| `g:identifier_exists` | `no`, when the product names no brand |

### Rules

- A product with no picture is left out. Google, Facebook and TikTok refuse one.
- A product that is switched off is left out. It is not in the catalog.
- A product with variants is one item at its lowest price. There is no `g:item_group_id` yet.
- The feed never carries costs.
- The answer has the same one-hour cache as the sitemap.

### Where the owner finds the link

**Online Store › General › Product feed** shows the link with a copy button.
The owner adds it once as a data feed. The platforms read it again by themselves.

### Tests

- `app/helpers/__tests__/feed.test.ts` checks the XML.
- `e2e/l-store.spec.ts` checks the answer on a store's host, the 404 on the main host and the link on the page.

## Title and favicon

The browser tab belongs to the shop.

- The favicon is the shop logo. With no logo it is the app's own icon (`DEFAULT_FAVICON`).
- The page title is the whole `seo.title`, like `Terms of Use · Main Shop`. Nothing is added after it.

## Adding a public page

1. **Route.** Add it once in `routes/storefront.ts`, inside the `Guard.maybeAuth` group, as `/<path>`.
   The store is found by its host.
2. **Shop.** In the controller, get the storefront with `this.site.open(req)`.
   Build links from `s.base`. It is always `""`.
3. **Render.** Call `this.view.render(req, s, "<page>", props, seo)`.
   Build `seo` with `StoreViewService.storeSeo(shop, { url, title, desc, … })`.
   - The canonical must be the page's own absolute URL.
   - A personal page passes `noindex: true`.
4. **Page name.** Add it to:
   - `STORE_THEME_PAGES` in `app/constants/Store.Constant.ts`
   - `StorePageName` in `StoreView.Service.ts`
   - its mirror in `resources/js/store/types.ts`
5. **Templates.** Write `<page>.edge` in:
   - every theme folder, `resources/views/themes/<name>/`, plus its `index.ts`
   - the extension themes, `extensions/aurora/views/`

   Each page wraps itself in `@component(theme.layout) … @end`.

   A page that is the same for every theme, like checkout and done, goes in `resources/views/store/`.
   List it in `resources/views/store/index.ts`.
6. **Sitemap.** If the page should be crawled, add its URL in `StoreController.sitemap`.
7. **Tests.**
   - `app/xcore/view/__tests__/store.test.ts` for the rendering.
   - `e2e/l-store.spec.ts` for the page as a logged-out visitor: its head tags and its sitemap entry.
