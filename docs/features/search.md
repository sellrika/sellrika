# Global search (⌘K)

How the command palette of the staff app works: what it finds, where its lists are, and how to add a record type.

The palette searches the whole staff app:

- pages
- settings sections
- actions
- the active shop's records

## How people use it

| Action | How |
|---|---|
| Open | The **Search** box at the top of the sidebar, the magnifier in the mobile header, or ⌘K / Ctrl+K |
| Close | Esc, or a click outside |
| Move | ↑ / ↓ move through the rows |
| Pick | Enter picks the pointed row. When none is pointed, it picks the first. |

## The package

The palette is built on [`@bilions/search-js`](https://github.com/necessarylion/search-js).

- It is a modal with no framework: the input, the result list, the recent picks in `localStorage`, and the keyboard shortcut.
- It is re-skinned with the app's tokens in `resources/css/app.css` › "⌘K palette".
- It is click-only. So ↑ / ↓ / Enter are the app's own: `keyboardNavigation()` in `lib/search.ts`.
- That function keeps those keys away from the package's own keyup listener. So the list does not re-render in the middle of a move.

## Where the code is

| What | Where |
|---|---|
| The client lists and `useGlobalSearch()` | `resources/js/lib/search.ts` |
| Where it is mounted (once) | `resources/js/layouts/AppLayout.vue` |
| The route `GET /search?q=` | `routes/account.ts` |
| The controller | `app/controllers/Search.Controller.ts` |
| The server list (`providers`) | `app/services/Search.Service.ts` |
| The queries | `app/repositories/Search.Repository.ts` |
| `SEARCH_PER_GROUP` | `app/constants/Pagination.Constant.ts` |
| The hit types in the browser | `resources/js/types.ts` |

`SearchService` sits at the root of `app/services/`. It spans every group of the sidebar.

## The client lists (`resources/js/lib/search.ts`)

### `pages()`

Every page, settings section and action, one line each.

- It is built on each search, not once at load. So the titles come out in the page's language through `t()`.
- Matching is in the browser. Every word typed must appear in the title, the description or the keywords.

The fields of a row:

| Field | What |
|---|---|
| `title` | The name of the row. |
| `href` | Where the action goes: a page, or a POST route. `{shop}` in it becomes the active shop's id. |
| `description` | Shown under the title. It doubles as the group name ("Page · …", "Settings · Online store › Delivery", "Action · …"). |
| `keywords` | Extra words that should find the row. They are English, with a few German words. |
| `action` | A key of `ACTIONS`. |
| `admin` | Only admins see the row. |
| `manager` | Only managers and admins see the row. |
| `platform` | Only the platform admin (`ADMIN_EMAIL`) sees the row. |

A cashier sees the rows without `admin` or `manager`.

### `RECORDS`

How each record type from the server is shown, and what picking one does.
One entry per type: `label` (a dictionary key) and `action`.

### `ACTIONS`

What a picked row does, **by name**.

| Name | What it does |
|---|---|
| `visit` | An Inertia visit to `href`. |
| `post` | An Inertia POST to `href`. "Log out" and switching shops use it. |

Why by name:

- search-js keeps the recent picks in `localStorage`.
- So a row must be plain data. It names its action. It does not carry a function.
- A new kind of action (open a dialog, download, copy…) = one more entry here, and rows that use its name.

## The server side

The route is `GET /search?q=`.

- It needs a signed-in user. Every role may call it.
- It is in the `search` rate bucket.
- The flow is `SearchController` → `SearchService.search(shop, user, q)` → `SearchRepository`.

**The server list** is `SearchService`'s `providers`. There is one line per record type: `key`, `role` (the least role that may open that type) and `find`.

Rules:

- A cashier gets `orders`, `customers` and `shops`.
- A manager also gets `products`, `categories` and `staff`.
- An admin gets everything.
- Up to `SEARCH_PER_GROUP` (5) hits per type.
- Types with no hit are left out.
- A blank query answers `{}`.
- The query is cut to 100 characters.

### The hit shape

`SearchHit` is `{ id, title, subtitle, href, amount? }`. It is mirrored in `resources/js/types.ts`.

- `amount` is cents. The page formats it in the shop's currency.
- The type name is added by the client (`RECORDS[key].label`).
- Titles and subtitles are text people typed. The client escapes them (`escapeHtml`), because search-js writes them as HTML.

## What is found

| Type | Who | Matched on | Leads to |
|---|---|---|---|
| orders | everyone | number (`12` / `#12`), public code (`P8J4-MJSQ-4Z8T`, any case or dashes), customer name | `/orders/:id` |
| customers | everyone | name, phone, email | `/customers/:id` |
| products | manager | name, SKU, barcode (its own or a variant's) | `/products/:id/edit` |
| coupons | admin | code, description | `/coupons/:id` |
| categories | manager | name | `/categories` |
| staff | manager | name, email | `/users` |
| shops | everyone | name | `POST /shops/:id/switch`. It switches to that shop. |

Staff and shops are searched across the whole account, not only the active shop.
The other types are searched in the active shop.

## Adding a record type

1. **Query.** Add a query in `SearchRepository` that returns `SearchHit[]`.
   Scope it to the shop, unless the table is account-wide. Bind the `limit`.
2. **Server list.** Add one line to `SearchService`'s `providers`, with the least `role` that may open that page.
   Add its key to `SearchResults` on the server and in `types.ts`.
3. **Client list.** Add one line to `RECORDS` in `lib/search.ts` (label, action).

## Tests

`e2e/k-catalog.spec.ts` › "global search" checks:

- ⌘K and the sidebar box
- a product by SKU
- a settings section
- recent picks
- Esc
