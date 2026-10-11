# Products, variants, categories, images

Everything about the catalog: products, their variants, packages, categories, pictures, uploads and the CSV import and export.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/catalog.ts` (products, categories), `routes/files.ts` (uploads) |
| Controllers | `app/controllers/Product.Controller.ts`, `Category.Controller.ts`, `Upload.Controller.ts` |
| Product service (barcode checks, package validation and guards, `components`) | `app/services/catalog/Product.Service.ts` |
| Category service | `app/services/catalog/Category.Service.ts` |
| CSV service | `app/services/catalog/ProductCsv.Service.ts` |
| Product repository | `app/repositories/Product.Repository.ts` |
| Category repository | `app/repositories/Category.Repository.ts` |
| Validators | `app/validators/Product.Validator.ts`, `Category.Validator.ts` |
| Constants | `app/constants/Product.Constant.ts`, `app/constants/Storage.Constant.ts` |
| Uploads | `app/xcore/storage/Storage.ts` |
| Pages | `resources/js/Pages/Products/Index.vue`, `Products/Form.vue` (create and edit), `Categories/Index.vue` |

Methods of `ProductRepository` worth knowing: `allForShop`, `pageForShop`, `find`, `priceLine`, `barcodeOwner`, `usedInBundles`, `component`, `setFeatured`, `setActive`, `create` and `update` (with `syncRelations`), `delete`.

### Components

| Component | What it is |
|---|---|
| `RichText.vue` | The description editor |
| `products/VariantsEditor.vue` | The variant table |
| `products/BundleItemsEditor.vue` | The contents of a package |
| `products/CategoryPicker.vue` | The category picker |
| `products/ImageUpload.vue` | One picture |
| `products/ImagesUpload.vue` | A gallery |
| `products/ImageEditor.vue` | The square crop dialog |
| `products/ShareDialog.vue` | The share link |
| `products/UnitSelect.vue` | The sale unit combobox |
| `ProductExtra.vue` | The "Additional data" list |
| `CategoryDot.vue`, `ColorPicker.vue` | Category colour |

Browser helpers: `lib/upload.ts`, `lib/bundles.ts`, `lib/share.ts`, `lib/removeBackground.ts`, `vendor/bg0/`.

## The product model

### Prices

| Field | Meaning |
|---|---|
| `price` | The base price, in cents |
| `purchase_price` | The cost, in cents or null |
| `original_price` | The "was" price, in cents or null |

`original_price` is for display only. It is never charged.

- The storefront strikes it through and shows a `-N%` badge when it is above the shown price.
- The percent comes from `discountPct()` (`StoreViewService.discountPct` on the server, `resources/js/store/money.ts` in the browser).
- It is on the product only. There are no sale prices per variant.

### Codes

| Field | Meaning |
|---|---|
| `sku` | An optional merchant code. Free text, at most 64 characters. |
| `barcode` | See Barcodes below |

About `sku`:

- There is no uniqueness check.
- It is searchable and shown in the list.
- It goes out and comes back through CSV.
- With variants it lives per variant, like barcodes.

### Size and unit

| Field | Meaning |
|---|---|
| `amount` | How much one unit holds. A number or null. 50 for "50 g". |
| `unit` | The sale unit. Free text, at most 20 characters, or null. |

- `packSize()` in `lib/format.ts` joins the two.
- The product list, the POS tile and the store product page and dialog show it next to the name.
- An extension slot may fill `amount`.
- The `UnitSelect.vue` combobox offers a list (pcs, kg, m, …) plus "Use “…”" for a custom one.
- The unit shows after the count in the product list.

### Additional data (`extra`)

Free title and value rows, stored as a JSON array `[{ title, value }]`.

- A title has at most 100 characters. A value has at most 2000.
- At most 50 rows.
- Rows with no title are dropped on save.
- It is the form's third tab, **Additional data**.
- It shows as a title and value list right before the description in every product detail:
  the POS product sheet (`components/ProductExtra.vue`) and the store's product page (`StoreProduct.extra`, printed by the theme's `product.edge`).
- An extension slot may fill it.

### Stock

`track_stock`, `stock` and `low_stock_at`. See [stock.md](stock.md).

### Relations

- Many **categories**, through `product_categories`.
- Many **variants**.

## Pictures

`images` is a JSON array.

- At most 10.
- The first one is the cover.
- Each stored entry is one of the app's own uploads: `/uploads/<shop id>/products/<uuid>.<ext>`.

### A product never keeps another site's link

The input may carry:

- an `/uploads/…` path
- an `https://` link
- a base64 picture: a `data:image/…;base64,` URI, or plain base64

Base64 is for the API and the MCP tools. They have the file but no link.

The rules in `app/xcore/storage/Storage.ts`:

| Function | Does |
|---|---|
| `Storage.isImageUrl()` | The input rule |
| `Storage.isImageData()` | Is it a base64 picture? |
| `Storage.storeImageFromData()` | Stores a base64 picture |
| `Storage.storeImageFromUrl()` | Downloads and stores a link |

Every save copies each link or base64 picture into storage first. This goes for the form and for an extension's `products.create()`.

- `ProductService.copyImages` does it.
- It runs last, after every other check.
- The same link twice is downloaded once.
- A link that cannot be fetched refuses the save. The error is `<error>: <link>` on `images` or `variants`.
- An older product that still holds a link gets it copied on its next save.

### The image editor

A link typed into the form's **Link** tile opens the editor like a picked file.
Every picked file opens `ImageEditor.vue` first.

What the editor has:

- A fixed **1:1** crop. There is no free crop, because the POS grid, the product page and every store template tile are square.
- Drag to move.
- A slider to zoom. It goes down to "the whole photo fits", on white.
- Flip horizontal and vertical.
- Rotate ±90°.
- Padding on every side, up to 20 %.
- A background colour behind the photo and in the padding. Swatches: none (transparent, for png), white (the default), light gray, cream, black, or any colour.
- **Remove background**. See below.
- Undo and redo.
- **Discard** drops the file.
- **Save** uploads a 1200×1200 webp.

Editing a picture the list already has:

- Clicking it (`Edit image N`) opens the same editor.
- **Save** puts the new upload in its place.
- An upload is read from `/uploads/…`.
- An https link is read through `POST /uploads/link`, because most sites do not let the browser read their pictures.

`POST /uploads/link`:

- For managers and admins. It sits in the `upload` rate bucket.
- `Storage.fetchImage()` does the work: https only, a 10 s timeout, a 5 MB cap.
- The bytes must look like an image.
- Nothing is stored.

### Pictures are deleted when removed

A picture file is deleted from storage when a product stops using it. This happens when:

- an image is removed from the product, or the product is saved with fewer images
- a variant's image is removed or changed, or the variant is removed
- an upload inside the description is removed
- the product is deleted (all its pictures and its variants' pictures)

How:

1. `ProductService.update` and `remove` compare the pictures before and after.
2. They call `dropPictures()` **after** the database change is saved.
3. The save does not wait for it. The clean-ups run one after the other in the background.
4. `picturesDropped()` waits for them. It is for tests.
5. A failure there is logged. It never breaks the save.

A file is only deleted when nothing else uses it. `UploadRepository.inUse(url)` looks in **every shop**:

- `products.images` and `product_variants.images`. It matches the quoted path, so `/uploads/a.jpg` never matches `/uploads/a.jpg2`.
- `products.description`
- `shops.logo`
- `store_pages.body` and `.css`
- `shop_extensions.config` (image fields)
- `settings.value`
- `payment_methods.image`
- `categories.image`
- `order_items.image`
- `store_carts.payload` of checkouts still being paid

`Storage.delete()` in `app/xcore/storage/Storage.ts` removes the file. It refuses order pictures outright.

## Description (rich text)

The product form edits the description with `components/RichText.vue`.

- It is a `contenteditable` box plus a toolbar.
- The toolbar has: text style (Normal, H1, H2, H3), bold, italic, underline, strike, bullet and numbered list, indent and outdent, insert table.
- It is built on `document.execCommand`. It uses formatting commands only. Nothing touches the clipboard or `designMode`.
- There is no editor dependency.

It stores HTML. So:

### It is sanitised

- `ProductService.create` and `update` run it through `sanitizeHtml` (`app/helpers/html.ts`).
- This is the same allowlist the store-page builder uses.
- It is the only door product writes go through. The CSV import goes through it too.
- At most 200 000 characters (`ProductInput`). That is enough for a supplier feed that pastes a whole leaflet.

### Where it shows

- It renders as HTML with the shared `.rich-html` styles in `resources/css/app.css`.
- Places: the POS variant sheet (`Pos/Index.vue`) and the store's product pages in the themes. Store pages reuse the same class.

### Where markup cannot render

It is flattened first:

- `plain()` in `lib/format.ts`, for the one-line preview in the product list
- `stripTags()` in `app/helpers/html.ts`, for the storefront's product JSON-LD

### Sections

Sections fold and unfold, like the parts of a leaflet ("Areas of application", "Side effects", …).

- The toolbar's **Insert section** drops a native `<details open><summary>Section title</summary><p></p></details>` after the block the caret is in. It selects the title.
- While the caret is in a section, a strip offers:
  - `Section +`: another one after it
  - `Open by default`: toggles `open`
  - `Delete section`
- What the editor shows is what the storefront shows.
- The reader folds and unfolds by clicking the title. No script is needed.
- `details` and `summary` are on the sanitiser's allowlist.
- `.rich-html` styles them as an accordion: divider lines, and a plus on the right that turns into a minus when open.
- An extension may write sections straight into `description`.

### Tables

`execCommand` has no table commands. So tables are plain DOM edits on the cell the caret is in.

- Insert drops a 2×2 table (a header row and a body row) *after* the block the caret is in.
  Inserting at the caret would split that block and leave, for example, an empty bullet behind.
- A second toolbar strip shows while the caret is in a cell: `Row +/−`, `Column +/−`, `Delete table`.
- A delete moves the caret to a cell that is still there. So the strip does not blink out.
- Removing the last row or column drops the whole table.
- `Column +` keeps each row's own cell type: `th` in the header, `td` below.
- These DOM edits sit outside the browser's own undo stack. If that starts to hurt, the upgrade path is tiptap.

Cell borders:

- They are mixed from `currentColor`: `color-mix(in oklab, currentColor 30%, transparent)`.
- They are **not** made from `--border`. The store templates paint their own surfaces without touching the app tokens, so the token grey came out invisible on Boutique and Market.
- `l-store.spec.ts` guards this. It checks that the border colour changes when the template does.

### Old plain text

Plain-text descriptions written before this, and CSV imports, still render.
The containers keep `whitespace-pre-line`, so their line breaks survive.

## Variants

Table `product_variants`. A variant has its own:

- `name`
- `price`
- `purchase_price`. null = the product's cost is used at checkout.
- `attributes`, like `{ "Color": "Red", "Size": "M" }`, or null
- `barcode`
- `images`
- `stock`
- `position` = the order in the form

### Rules

- A product **with variants must be sold as a variant**. `priceLine` returns null for the bare product.
- The product's own `stock` is forced to 0.
- The product's own barcode is ignored and cleared in validation. `barcodeErrors` skips it.

### Quick generate

In `VariantsEditor.vue`:

1. Name option groups, like Color: Red, Blue and Size: S, M.
2. Every combination becomes a variant row named like `Red / S`, with `attributes` set.
3. The price defaults to the base price.

The POS uses `attributes` to show a guided picker (pick Color, then pick Size) when every variant has them. Else it shows a plain list.

### On update

- Variants are **upserted by id**. So ids that past orders point at survive.
- Variants missing from the form are deleted, together with their stock movements.

### Option groups

The option groups (`attributes`) are managed in an **Option groups** panel above the variant table.

- A group is one of the rows' attribute keys, or a group added with **Add group**.
- Every group lists its values as chips.
- Add a value with the "Add value ↵" input. Remove one with ×.
- Removing a value untags the rows that had it.
- Removing a group untags every row.

Each row tags itself with one dropdown per group (`Variant <Group>`).

- The values are limited to the group's chips. So the storefront's guided picker always matches.
- A row with no name, or one that still carries the name its tags made, is named from its tags ("Red / M").
- A row with no tags saves `attributes: null`.

### Duplicate

Each variant row has a **Duplicate** button, next to Remove. It inserts a copy right under the row:

- the same price, cost, attributes, SKU and images
- the name with "(copy)" at the end
- the barcode cleared, because it must stay unique
- no id, so it is saved as a new variant

## Display order

Every product list is ordered `featured desc, updated_at desc, id desc`. That goes for the admin `/products`, the POS grid and the storefront.

So pinned products come first. The rest are newest-edited first.

- `featured` is a Switch on the product form. It is also a star button in front of each row's image on the list.
- The star calls `POST /products/:id/featured` → `ProductRepository.setFeatured` → `back()`.
- It does **not** touch `updated_at`, on purpose. Pinning is not an edit.
- `updated_at` is written by `create` and `update` only.
- `/stock` adjustments and CSV imports of other products leave a product where it is.
- SQLite's `current_timestamp` only ticks by the second. That is why `id desc` breaks ties.

## Barcodes

- Optional. At most 64 characters.
- **Unique per shop across products and variants.** `barcodeOwner` checks both. The database unique index only covers `products`.
- A duplicate inside the same form gives "Duplicate barcode in this product".
- The POS search matches a barcode exactly and adds the unit straight to the cart.

## Categories

Table `categories`: `name`, `color` (`#rrggbb` or null), `position`, `image`.

### The picture

- A category has one picture. It is always one of the app's own uploads, in the shop's `categories` folder. null = none. (Migration 0086.)
- The input takes the picture like a product does: an `/uploads/…` path, an `https://` link or base64 (`Storage.isImageUrl()`).
- `CategoryService.copyImage` stores a link or base64 before the save. The form and the API both call it.
- A failed copy refuses the save, with an error on `image`.
- A picture that is replaced or removed, or the picture of a deleted category, is deleted from storage once nothing uses it (`UploadRepository.inUse`).
- The picture shows on the `/categories` list only. The POS and the store do not use it yet.

### The page

- Add and edit are one dialog on `/categories`: the **Add category** button, or a row's pencil. It works like the payment methods page.
- It uses the product uploader (`ImagesUpload.vue`, `max` 1, `folder="categories"`). So a picked file or a pasted link opens `ImageEditor.vue` first.
- Managers and admins may add, edit and delete.
- Deleting a category removes its `product_categories` links only.
- The list includes `product_count`.

## Packages (bundles)

A **package** is a product row with `kind = 'bundle'`. It is a recipe, not a thing on a shelf.

Example: "Pen — 1 dozen" costs $28 and contains 12 × Pen. The customer picks Red or Blue at the till. Selling one takes 12 off that colour.

- A package has **no variants, no stock and no purchase price of its own**. `ProductService` blanks them on every write (`#clean`).
- A package **cannot contain another package**.

### Contents

Table `bundle_items`. One row per *slot*: `bundle_id`, `product_id`, `qty`, `variant_ids`.

- `variant_ids` is a JSON `number[]`. It is null when the component has no variants.
- One allowed variant = fixed.
- Two or more = a question asked at sale time.

### Computed availability

`ProductRepository.withBundles` fills each slot's `options`: `{variant_id, name, price, stock}`.
`stock` is null when the component is not tracked.

It also works out the package's own `track_stock` and `stock`:

1. A slot can fill the `max` over its options of `⌊stock ÷ qty⌋` packages.
2. The package is as available as its scarcest slot.
3. Untracked components never limit it.

So everything after this works on packages without knowing they exist: the POS grid badges, the cart caps, the storefront's `sold_out`, the cart restore.

Packages own no stock. So:

- They **never appear on `/stock`**.
- They are **skipped by the CSV export**. The format has no row shape for a recipe.

### Validation

`ProductService.bundleErrors` checks, with these Inertia error keys:

| Rule | Error key |
|---|---|
| At least one slot | `bundle_items` |
| Each component is an `item` product of this shop. Else: "That product no longer exists" or "A package can't contain another package". | `bundle_items.N.product_id` |
| A component with variants needs a non-empty `variant_ids`, and every id belongs to it | `bundle_items.N.variant_ids` |

The same slot may appear more than once, on purpose.
"6 × Mug (Red or Green)" twice lets the customer take 6 red **and** 6 green. There is one answer per slot.

### Guards

The recipe must keep pointing at real units.

- **Deleting a component.** `DELETE /products/:id` of a product inside a package is refused.
  `ProductService.remove` returns `“Pen” is used in package “Pen — 1 dozen” — remove it there first`.
  The controller renders `Products/Index` again with `errors.product`. The page shows it as a `toast.error`.
- **Dropping a variant.** `PUT /products/:id` that drops a variant a slot still points at gives `errors.variants` (`ProductService.variantErrors`). It shows at the top of the Variants card.
- **Deleting the package itself** just deletes its `bundle_items`. The components are untouched.

### Selling

The checkout payload carries `choices` per line. The order line remembers what was picked.
See [pos-checkout.md](pos-checkout.md) and [stock.md](stock.md).

### The form

The product form has these tabs:

- **General**: details, pricing, inventory, images
- **Variants**. It is named **Contents** while the package switch is on.
- **Additional data**

A failed save jumps to the tab that holds the first error.

The package switch is "This is a package of other products" (`aria-label` "Package"). When it is on:

- It hides the Purchase price field, the Inventory card and the Variants card.
- It shows a **Contents** card (`products/BundleItemsEditor.vue`).

In the Contents card:

1. Search the shop's ordinary products. They come from the `components` prop of `GET /products/create` and `GET /products/:id/edit`.
2. Click one to add a row.
3. Set the quantity.
4. Toggle the allowed-variant pills. With 2 or more selected, a "Customer picks one" badge shows.
5. Read the summary line: *Contents value $30.00 · Package price $28.00 · Save $2.00 (7%) · ≈ $2.33 each*.
   The per-unit figure shows only when every row is the same product.

On `/products`, a package shows a "Package" badge and the recipe in words: "12 × Pen (Red or Blue) · 1 × Notebook".

The browser helpers are in `lib/bundles.ts`: `hasChoices`, `availableFor`, `optionLeft`, `lineKey`, `chosenNames`, `contentsLabel`, `contentsOf`.
The POS, the storefront and the admin list share them.

## Endpoints

All product, category and upload routes are for **managers and admins**.

### `GET /products?q=&category=&page=&per_page=`

The list, paged.

- `q` matches a part of the name, the SKU or the barcode, on the product and its variants.
- `category` = one category id. It is the header's select box. "All categories" = 0.

The **Sold** column:

- Every row carries `sold` = the units sold on orders that were not voided.
- Only this list counts it. The POS grid does not.
- It is counted for the products of the page only.
- It is joined for the whole shop only when the list is sorted by it.

Sorting:

- `sort` is one of `PRODUCT_SORTS`: `name`, `category`, `active`, `stock`, `price`, `sold`.
- `dir` is `asc` or `desc`.
- It replaces the normal order (featured first, then the most recently edited).
- The column titles are `components/SortButton.vue`. Click: A→Z or low→high, then the other way, then back.
- Category sorts by the first category name A–Z.
- Stock sorts by the product's total, or its variants' total.
- Price sorts by the lowest price.
- No category and untracked stock always go last.

### `POST /products/:id/featured`

JSON `{ featured }`. The list's star. It redirects back.

### `POST /products/:id/active`

JSON `{ active }`. The list's Active switch. It redirects back.

### `POST /products/categories`

The list's bulk action.

1. Tick products. There is a box per row. The header box ticks every row on the page. The ticks survive paging.
2. **Add to categories**, in the bar above the table, opens a dialog of the shop's categories.

- `ProductCategoriesInput` = `product_ids` (at most `PRODUCT_BULK_MAX` = 500) and `category_ids`.
- `ProductRepository.addCategories` links only the shop's own products and categories.
- It keeps the links a product already has. Nothing is removed. `updated_at` stays.
- One `product.updated` event is fired per product.

### The form routes

`GET /products/create`, `POST /products`, `GET /products/:id/edit`, `PUT /products/:id`, `DELETE /products/:id`.

- The form payload is `ProductInput`: `category_ids`, `variants[]` with an optional `id`, `kind`, `bundle_items[]`.
- The form pages also get a `components` prop = every `kind = 'item'` product of the shop. That is what a package may contain.
- A new product first asks `ProductService.limitErrors`. In the open-source app `PlanLimitService` never limits. An add-on may put its own rules there.

**Saving keeps you on the form**

- `POST /products` redirects to the new product's edit page.
- `PUT /products/:id` goes `back()`.
- The page toasts "Product created" or "Product updated". On failure it toasts the first validation message (`Products/Form.vue`).
- The create sends `preserveState: "errors"`. The edit page is the same component, so it must mount again to read the new product.
  Else the title stays "New product" and a second save creates the product again.

**Delete**

- It removes the product, its variants, category links, package slots and stock movements.
- **Order lines keep their snapshot.** `product_id` stays but is not joined.
- It is refused when another product's package contains it. See Packages above.

### CSV routes

- `GET /products/export`: download the whole catalogue as CSV.
- `POST /products/import`: import a CSV. Multipart field `file`, at most 2 MB (`CSV_MAX_BYTES`).
  It answers with the product list plus an `import_result: { created, errors[] }` prop. See below.

## Uploads

### `POST /uploads`

Multipart fields `file`, `folder` and an optional `shop`. The answer is `{ url }`.

**Folder layout**: `/uploads/<shop id>/<folder>/<uuid>.<ext>`

- `folder` is one of `UPLOAD_FOLDERS`: `products`, `logo`, `pages`, `extensions`, `payments`, `categories`, `orders`.
- `orders` is written only by the checkout.
- The shop is the active one. Or it is `shop`, when that is another shop of the same account (a logo on that shop's edit page).
- The browser helper is `uploadImage(file, folder, shop?)` in `lib/upload.ts`.
- A picture copied from an https link goes to `products`.
- Older files keep their flat `/uploads/<uuid>.<ext>` path and still work.

**Checks**

- `Storage.ts` reads the magic bytes. Only png, jpg, gif, webp and avif pass.
  AVIF = an ISO-BMFF `ftyp` box with the brand `avif` or `avis`.
- At most 5 MB (`MAX_UPLOAD_BYTES`).
- Validators only accept URLs that match `Storage.isUploadUrl`: `/uploads/<digits>/<a-z>/<word>.<ext>`, or the older `/uploads/<word>.<ext>`.

**Storage drivers**

- The file is written through the storage driver (`drive.use().put`, flydrive).
- `STORAGE_DRIVER` = `local` | `s3` | `azure` | `gcs`. For `local`, the root is `UPLOAD_DIR` (default `storage`).
  See [architecture.md](../architecture.md) › Environment.
- **The driver key is the URL path without its first `/`**, like `uploads/12/products/….png`. It is the same on every driver.
  So a driver switch only needs the files copied as they are.

**Serving**

`/uploads/…` is served by `Storage.read()`:

1. The local folder first. That covers files from before a driver switch. It is zero-copy for `local`.
2. Then the driver.
3. Always with the immutable cache header.

### Every upload is made ready to store

`Storage.compress()` in `app/xcore/storage/Storage.ts` does it. It runs for the upload route and for a picture copied from an `https://` link (the form, the API, MCP, extensions).

- The picture becomes a **WebP** with at most `UPLOAD_IMAGE_PX` = 1600 px on its longest side.
- A photo (JPG, AVIF, a big WebP) is written at quality `UPLOAD_WEBP_QUALITY` = 90.
- A PNG is written lossless. So a logo or a QR code keeps every pixel and its transparency.

Kept as it arrived:

- a GIF, because it may move
- a WebP that is small enough. This is what the image editor sends. There is no second lossy pass.
- a picture that cannot be opened
- a picture that would not get smaller

It is not cropped. Only the image editor makes the square.
Order thumbnails (the `orders` folder) are not touched.

### Very large pictures

- A picture that claims more than `MAX_IMAGE_PIXELS` = 50 million pixels is never opened (`Bun.Image` › `maxPixels`, in `compress` and `shrink`).
- It is stored as it is, at most 5 MB.
- `Storage.shrink` keeps a transparent WebP as PNG. So an email thumbnail of a logo has no black background.

## Custom request

Columns `products.custom_request` and `custom_request_label` (migration 0070).

On the product form it is a card under the Details card, with a switch and a "Question to the buyer" box.

When it is on:

- The online store's picker shows a required text box with that question. With no question it says "Your request". An example is the name to engrave.
- The text has at most `CUSTOM_REQUEST_MAX` = 1000 characters (`app/constants/Product.Constant.ts`).

What happens to the text:

1. It rides on the cart line (`StoreCartLine.note`). Two different notes = two lines (`noteKey()`).
2. `StoreCheckoutService.priceCart` checks it again. A missing note is refused with the product's name. A note on a product that asks for none is dropped.
3. It lands on `order_items.note`.

Where it shows: the cart drawer, the checkout summary, `/done`, the track and account order pages, the staff order page ("Buyer's request"), and the order and alert emails.

Other rules:

- The POS never asks.
- The fields are optional on save. So the CSV import and extensions keep what is stored.

## Active / inactive

`products.active` (default true, migration 0051).

### What off means

- The product is hidden from the POS grid (`pageForShop(…, { active: true })`).
- It is hidden from the online store. `StoreService.catalog` filters it. So the catalog, the product page, the related products and the sitemap all drop it.
- It is refused at both checkouts. `priceLine` returns null.
- It stays on the admin `/products` list, greyed out.

### A package with a switched-off product inside

It is treated the same way:

- hidden from the POS (a `not exists` on `bundle_items` in `pageForShop`)
- hidden from the store (`onSale` in `app/services/sales/store/StoreCatalog.Service.ts`, from `BundleItem.active`)
- refused by `bundleLine`

It comes back by itself once the component is switched on again. The package's own switch is left alone.

On the `/products` list such a package is greyed out like a switched-off product, with the line "Not sold: a product inside is switched off".

The package form's Contents tab (`components/products/BundleItemsEditor.vue`) shows each product inside with its picture and its name as a link. The link opens a new tab, so the form keeps its changes. A switched-off one gets an "Inactive" badge and a line saying the package is not sold.

### Where it is set

- The Active switch on the form.
- The Active switch on each list row (the column where Featured used to be).
- Like `featured`, the list toggle does not touch `updated_at`.

## Remove background

A button in `ImageEditor.vue` cuts the product out of its photo **in the browser**.
No photo leaves the browser. There is no cost per photo.

### The engine

- bg0's browser package (Apache-2.0), copied into `resources/js/vendor/bg0/`.
- Its README lists the source commit and the few `pos:` changes: no iOS path, the lite model only, `@ts-nocheck` for this app's stricter tsconfig.
- It runs `studioludens/birefnet-lite-512` (MIT, pinned revision, about 98 MB) through transformers.js 4.3.0.

### The device

- WebGPU when the GPU has fp16 shaders. Else the CPU (WASM, about 15 s).
- The 512px export is on purpose. The 1024px one needs more storage buffers per shader than many GPUs allow ("Too many storage buffers in shader. Current: 11, Max is 10").
- A failed WebGPU run makes this device use the CPU from then on. See the worker below.

### The Web Worker

It runs in a **Web Worker** (`lib/removeBackground.worker.ts`).
Starting the model is seconds of heavy work. On the page itself it froze everything.

- bg0's canvases come from its `createCanvas()` (a `pos:` change). It uses OffscreenCanvas in the worker.
- `lib/removeBackground.ts` is the page side. It starts the worker, sends the photo as an ImageBitmap and passes the progress back.
- A failed run closes the worker. After one failed run, transformers.js fails every later run in it.
- A WebGPU failure sets `localStorage` `remove-bg:cpu`. A new worker retries on the CPU at once. The worker hides `navigator.gpu`.
- In dev the worker script is on Vite's port. So it is started from a small blob that imports it.

### The runtime files

- The worker points the ONNX runtime at this app's own `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` (27 MB, `/build/assets`). It is never a CDN.
- `onnxruntime-web` is a dev dependency, pinned to the exact version transformers.js uses.
- The photo is passed as a PNG. bg0 reads PNG, JPEG and WebP only.

### Loading the model

- The image editor starts loading the model when it opens, not the product form (`preloadBackgroundModel()`, when the page is idle).
- It is skipped in automated browsers. So e2e runs never download it.
- The browser keeps the model in its Cache Storage.

### The cut-out

- The cut-out is an undo step (`Edit.cutout`). The background swatches then fill in behind the product.
- It is **trimmed to the product**. See-through edges are dropped (`TRIM_ALPHA`).
- It is shown centred at 80 % of the square (`CUTOUT_START`).
- Its zoom may go down to 20 % of "fits the square" (`CUTOUT_MIN`). So the product can be made smaller and moved anywhere.
- A photo still always covers the square.

### While it works

- A scan line and a shimmer run over the photo, with the progress on a chip.
- When done, the old photo is wiped away top to bottom (`.magic-*` in `resources/css/app.css`).
- There is no animation with `prefers-reduced-motion`.

### Align center

The button next to it moves the image back to the middle. Zoom and padding stay. It is one undo step.

A failure shows "Couldn't remove the background …" and keeps the photo.

### Shadow

A slider. 0 = off. It is one undo step, as `Edit.shadow`.

- The model drops the photo's own shadow with the background. So the editor draws a new one under a cut-out, whether the photo had one or not.
- It is a soft dark oval where the product stands, plus a soft shadow in the product's own shape (`shadowBlur` / `shadowOffsetY`). Both are sized by `SHADOW`.
- The slider is off until the background is removed. On a whole photo it would only be a box behind the picture.

### Layout

The preview is on the left. Every tool is in one column on the right. The preview is at most `min(22rem, 55vh)`. On a phone they are stacked.

### Not used, and why

| Option | Why not |
|---|---|
| `@imgly/background-removal` | AGPL |
| The 1024px BiRefNet_lite export | The GPU limit above |
| The full 473 MB BiRefNet | Too big for product photos |

## Share link

While the shop's online store is on (`online_enabled` and `slug`), each active product has a Share button:

- an icon on its `/products` row
- a "Share" button on its edit form

Both open `products/ShareDialog.vue`. It shows:

- The product page link, with a Copy button.
- One button per network: Facebook, X, WhatsApp, Telegram, LINE, Viber. These are plain share URLs. No API keys.
- "More apps…" = `navigator.share()`, where the device has it.

The link:

- `productUrl(shop, slug, storeUrl)` in `lib/share.ts` builds it: `<store_url>/p/<slug>`.
- The shared Inertia prop `store_url` is the active shop's `Url.storeOrigin`: its own domain, else `https://<slug>.<STORE_DOMAIN>`.

Other details:

- Each network's link carries `utm_source=<network>&utm_medium=social`. So the shop's GA4 shows where visits came from.
- The preview picture and text come from the product page's `og:*` tags.
- Nothing is stored. There is no server route.

## CSV import and export

The format is "Universal POS Product CSV v1".

- The buttons are on `/products`, for managers and admins.
- Code: `app/services/catalog/ProductCsv.Service.ts`, plus the RFC-4180 parser and writer in `app/helpers/csv.ts`.

It is a vendor-neutral format, made to go to and from other POS software.

### The header

In this exact order:

`name, sku, price, barcode, currency, cost, category, brand, unit, tax_rate, price_includes_tax, track_stock, stock_quantity, low_stock_threshold, variant_group, variant_name, additional_barcodes, supplier, supplier_sku, description, active`

### Rows

- **One row per sellable unit.**
- A product with variants exports one row per variant. The rows share a `variant_group` (`<slug>-<id>`) and carry a `variant_name`.
- A product without variants leaves both empty.

### Values

- Prices and costs are decimals (`4.50`). They are converted to and from integer cents.
- Barcodes are plain strings. So leading zeros survive (good for GTIN, EAN, UPC).
- `sku` goes out and comes back with the product's or variant's `sku` column.
- When a unit has no SKU, the export uses a generated `P<id>` or `P<id>-<variantId>`. So the column is never empty. The spec needs one.
- Fields this POS does not have export as empty values and are ignored on import: `brand`, `tax_*`, `additional_barcodes`, `supplier*`, `active`.
- Unknown columns are ignored too.

### Import

The import only creates. It never updates a product.

- The header must contain at least `name` and `price`.
- At most 5000 rows (`CSV_MAX_ROWS`).
- Rows grouped by `variant_group` become one product with variants.
- `category` is matched without case. For `A > B` the deepest part is used. A missing category is created.
- `track_stock` defaults to true when `stock_quantity` is set.
- Imported stock lands in `stock_movements`, like any form edit.
- A `currency` different from the shop's stops the whole import. The prices would be wrong.
- Any other bad row or group is skipped and reported (`Row N: …`). The rest import.
- Barcode uniqueness goes through the normal `barcodeErrors` check.
- `PlanLimitService.productsLeft` is asked row by row. In the open-source app it has no end.

### The UI

- A hidden file input posts through Inertia `forceFormData`.
- The answer's `import_result` prop drives a success toast.
- It also drives an error panel that can be closed. The panel lists the skipped rows (the first 20).

## Stock and the product form

The form never edits counts. They are set and adjusted on `/stock`.

- `stock` (on the product and on `variants[].stock`) is **optional** in `ProductInput`.
- The form leaves it out. The repository then keeps the current count.
- New products and variants start at 0.
- The CSV import still passes counts.
- Those go through `#formMovement` as an `adjustment` with the reason "Set on product form", in the name of the importing user.
- So the ledger always sums to the number on hand.
