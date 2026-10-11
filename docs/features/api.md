# REST API (`/api/v1`), API keys and the MCP server

How a shop's own programs and AI assistants read and change its data: the keys, the routes, the errors, the OpenAPI file, the MCP server and its OAuth sign-in.

A shop's programs call the API over HTTP with an **API key**.

The API is a thin layer.
Every route calls the same validators and services as the app's pages.
So a rule lives in one place.

## Where the code is

| What | Where |
|---|---|
| Every API route, each registered **together with its docs** by `api(method, path, action, doc)` | `routes/api.ts` |
| One small JSON controller per area | `app/controllers/api/<Name>.Api.Controller.ts` |
| The base class of the controllers of one record type | `app/controllers/api/Api.Controller.ts` (`ApiController`) |
| The key middleware | `app/xcore/auth/ApiGuard.ts` |
| The one error shape and the small answer helpers | `app/xcore/api/ApiResponse.ts` |
| `apiDocs` (the registry) and `OpenApi.build()` (the OpenAPI 3.1 file) | `app/xcore/api/OpenApi.ts` |
| Routes → MCP tools, JSON-RPC helpers | `app/xcore/api/Mcp.ts` |
| `POST /mcp` | `app/controllers/api/Mcp.Api.Controller.ts` |
| The routes as functions for extensions | `app/xcore/api/ApiCall.ts` |
| Query string schemas | `app/validators/ApiQuery.Validator.ts` |
| The answers (`ApiSchemas`, the "Models" of the docs) | `app/validators/ApiResponse.Validator.ts` |
| The OpenAPI file's route | `app/controllers/api/Docs.Api.Controller.ts` |
| The prefix, the key prefix and limits, the title, intro text and tags of the docs | `app/constants/Api.Constant.ts` |
| OAuth sign-in | `app/controllers/OAuth.Controller.ts`, `app/services/settings/OAuth.Service.ts`, `app/constants/OAuth.Constant.ts` |

The controllers are: `Product`, `Order`, `Coupon`, `Stock`, `Category`, `PaymentMethod`, `Staff`, `SalesStaff`, `Marketing`, `Report`, `Me`, `Guide`, `Docs`, `Mcp`.

`ApiController` gives the controllers of one record type two answers, in this order:

1. 404 for a record of another shop.
2. 422 for a refused body.

`ApiGuard` has three parts:

- `ApiGuard.key`: a Bearer key becomes `ctx(req)`.
- `ApiGuard.mcpKey`: the same for `/mcp`. The key may be in `X-API-Key` or in `Authorization: Bearer`.
- `ApiGuard.role(min)`: the least role a route needs.

`ApiResponse` has `error`, `invalid`, `notFound`, `created`, `deleted` and `query`.
`HttpRequest.idOf` is in `app/xcore/http/Request.ts`.

The keys have their own files:

- `app/services/settings/ApiKey.Service.ts`
- `app/repositories/ApiKey.Repository.ts`
- `app/models/ApiKey.ts`
- `app/validators/ApiKey.Validator.ts`
- `app/controllers/ApiKey.Controller.ts`
- `resources/js/Pages/ApiKeys/Index.vue`

The table is `api_keys` (migration 0073). See [database.md](../database.md).

## Keys

The page is `/api-keys`. Only admins open it. It is under Settings › **MCP & API keys**.

### What a key is

- A key works in **one shop**: the active shop when it was made.
- A key **acts as the admin who made it**. That user is the cashier on an order the key creates, and the name on a stock movement.
- A key has a **role**: `admin`, `manager` or `cashier`. That is the most it may do.
- The role in force is the lower of two: the key's role, and its maker's role today. So a demoted maker's keys lose power with them.

### When a key stops working

- It is deleted.
- Its maker is switched off or deleted. Their keys are deleted with them.
- The shop leaves the maker's account.

### The key is shown once

- A key is `srk_` + 32 random bytes (base64url).
- Only its SHA-256 (`key_hash`) and its last 4 characters are stored.
- `POST /api-keys` answers JSON `{ key, token }` with `Cache-Control: no-store`.
- The page keeps the key only inside the open dialog. It is never a page prop, because Inertia keeps page props in the browser history.

### Limits

- At most `API_KEY_MAX` = 20 keys per shop.
- `last_used_at` is written at most once a minute per key.

### The page

A slim card on top says where AI assistants connect.

- `mcp_url` = the shop's free address + `/mcp`, with a copy button.
- While the shop's online store is off, it is the app's origin + `/mcp`. The proxy does not route the shop's host then.
- The app's own address is not shown while the shop has one.
- **How to connect** is a native `<details>`, closed at first. It holds the text and the Claude Code command.
- The command holds `srk_…`, never a real key.
- The docs link on the page is `Hooks.docs.api`. Its default is `DOCS_URL` (`https://developer.sellrika.com`). An add-on may set it.

## A call

```
GET /api/v1/products?per_page=5
Authorization: Bearer srk_…
```

- **Only the header counts.** Cookies are never read on `/api/v1`. So a browser session can not call the API, and there is no CSRF risk.
- Bodies are JSON.
- Money is whole cents.
- Times are UTC. Days (`YYYY-MM-DD`) are on the shop's clock.
- An edit (`PUT`) takes the whole record, the same fields as a create.

### Lists

- Lists are paged with `?page=&per_page=`.
- The default is `API_PER_PAGE` = 20. The most is 100.
- The answer is `{ data, total, page, per_page, last_page }`.
- A wrong query value is a 422. It is never silently replaced.
- One exception: the report's period. It is read by `ReportService.resolveQuery`, like the Reports page.

## Errors

There is one shape:

`{ "error": { "type", "message", "fields"? } }`

| Status | `type` | When |
|---|---|---|
| 401 | `unauthorized` | no key, or a wrong one |
| 403 | `forbidden` | the key's role is below the route's |
| 404 | `not_found` | no such record in this shop, or no such route under `/api/v1` |
| 422 | `validation_error` | refused input. `fields` = one message per field, in the request's language |
| 429 | `rate_limited` | too many calls. `Retry-After` says how long |
| 500 | `server_error` | a handler threw (logged with `[api]`) |

## Routes and roles

The roles mirror the app's pages. The role is the least role a key needs.

| Area | Routes | Role |
|---|---|---|
| Account | `GET /me` | cashier |
| Products | `GET, POST /products`, `GET, PUT, DELETE /products/:id` | manager |
| Categories | `GET, POST /categories`, `GET, PUT, DELETE /categories/:id` | manager |
| Stock | `GET /stock`, `GET /stock/summary`, `GET /stock/movements`, `POST /stock/adjustments` | manager |
| Orders | `GET, POST /orders`, `GET /orders/:id`, `POST /orders/:id/payments`, `PUT /orders/:id/fulfillment` | cashier |
| Open orders | `POST /orders/:id/items`, `POST /orders/:id/items/remove`, `PUT /orders/:id/discount` | cashier |
| Orders | `POST /orders/:id/refunds`, `POST /orders/:id/void` | admin |
| Coupons | `GET, POST /coupons`, `GET, PUT, DELETE /coupons/:id`, `GET /coupons/:id/redemptions` | admin |
| Payment methods | `GET, POST /payment-methods`, `GET, PUT, DELETE /payment-methods/:id` | manager |
| Staff | `GET /staff` (read only) | manager |
| Sales staff | `GET, POST /sales-staff`, `GET, PUT, DELETE /sales-staff/:id`, `POST /sales-staff/:id/pay` | manager |
| Marketing | `GET, PUT /marketing/abandoned-cart`, `GET, POST /marketing/campaigns`, `GET, PUT, DELETE /marketing/campaigns/:id`, `POST …/:id/schedule`, `POST …/:id/cancel` | manager |
| Reports | `GET /reports` | manager |

A category's `image` is an `https://` link, base64 or an `/uploads/…` path, like a product's `images`.

A cashier key never reads cost values.
`purchase_price` and a line's `cost` are `null` in its answers, in the API and in MCP.

### Open orders

`POST /orders` is one route for two cases (`OrderCreateInput`):

| Body | Result |
|---|---|
| With `paid` | A sale, like the POS checkout. |
| Without `paid` (or `paid: 0`) | An unpaid order, to be paid later. |

While an order is not paid in full:

- `POST /orders/:id/items` adds lines.
- `POST /orders/:id/items/remove` takes units off.
- A line may carry a `note`.
- `GET /orders/:id` carries `history`: `changed`, `before` and `after` per change.

`POST /orders/:id/payments` also takes these, all optional:

- `payment_method`: the name of one of the shop's methods. It is kept on the order.
- `tendered`: the cash handed over when `amount` pays the order off. The rest is the order's change.
- `sales_staff_id`

`PUT /orders/:id/discount` (`OrderDiscountInput`) sets the discount of a till order that is not paid in full.

- Send `discount_type` + `discount_value`, or `coupon`.
- Send neither to take the discount off.
- Tax and total are worked out again.
- The total never goes below what is paid.
- The code's use is recorded, and the old one is given back.

The MCP tools for these are `create_order`, `add_items_to_order`, `remove_items_from_order` and `set_discount_of_order`.

### The routes as functions for extensions

Every route is also a function in an extension's route and listener context (`products.create`, `orders.pay`…).

- They are built from the same route list as the MCP tools: `ApiCall.functions` in `app/xcore/api/ApiCall.ts`.
- `api()` in `routes/api.ts` asks for the function's name (`fn`) with the docs. So a new route can not ship without one.
- More in [extensions.md](extensions.md).

### Deliberate limits

- **No order delete.** After `POST /orders`, an order is paid, moved along, refunded or voided.
- **Staff is read only.** A leaked key must not be able to make itself a login. `UserService` already holds the rules if a create or an edit is ever needed.
- **`schedule` with `now: true` needs an admin key.** It sends real email at once.
- **No customers, shops, online-store settings or uploads yet.**
- **A product picture** is given as an `https://` link or as base64.
  - Base64 is a `data:image/…;base64,` URI or plain base64, 5 MB at most.
  - The whole request is 8 MB at most (`MAX_REQUEST_BODY_BYTES`).
  - `ProductService.copyImages` saves both into the app's storage.
- **CORS headers only for the docs host** (`DEVELOPER_DOMAIN`, below). A browser app on any other origin can not call the API.

## Rate limits

They are in `app/constants/Security.Constant.ts`.

| Bucket | Limit | Counted |
|---|---|---|
| `api` | 600 calls per minute | **Per key**, inside `ApiGuard.key`. Not per IP. |
| `apiAuth` | 30 calls with a missing or wrong key per 10 minutes | **Per IP**. A good call costs nothing. |
| `oauth` | 600 calls per 10 minutes | Per IP, on the public OAuth endpoints. |

## The OpenAPI file

`GET /api/v1/openapi.json` is public.

- `OpenApi.build()` makes it from `apiDocs`.
- It is built once per origin and kept in memory (`DocsApiController`, at most `OPENAPI_CACHE_MAX` = 50 origins).
- A route is added with `api(...)`. That registers the handler **and** pushes its `ApiDoc`: tag, summary, role, `query`, `body`, `example`, `answer`.
- So a route can not exist without docs.

What the file is made from:

- **Request bodies and query strings** are the zod validators themselves, through `z.toJSONSchema()` (`OpenApi.schemaOf`).
- **Answers** are the zod schemas of `ApiSchemas`.
- `app/controllers/api/Api.test.ts` parses every real answer with them. So the docs fail a test before they drift.
- **The docs text is English only.** It is a reference for programmers. Error messages follow the request's language.

The open-source app has no page that shows the file.
An add-on may bring one (see below).

## The docs host (`DEVELOPER_DOMAIN`)

Set `DEVELOPER_DOMAIN` (for example `developer.example.com`) to give the developer docs a host of their own.
Only that exact host counts. There is no `www.` form.

What the open-source app does with it:

- **The page at `/`.** `developerHome` in `routes/api.ts` is wrapped around the `/` route.
  On the docs host it shows `Hooks.docsPage`, when an add-on set one.
  With no add-on, the host gets the app's normal `/`.
- **The API does not move.** The OpenAPI file's server and the MCP address are the app's own (`Url.appOrigin()` = `APP_URL`).
- **CORS, for that host only.** A docs page runs in the reader's browser on the docs host and calls the API on the app's host.
  - So `/api/v1/*` answers `Access-Control-Allow-Origin` when the `Origin` is exactly the docs host. Never `*`.
  - Each API path also answers `OPTIONS` (the preflight).
  - No cookie is allowed across. The API reads only the key header.
  - `/mcp` has no CORS.
- **Helpers** in `app/xcore/http/Url.ts`: `Url.developerOrigin()`, `Url.isDeveloperHost(req)`, `Url.appOrigin()`.
- **Scheme.** A `localhost` docs host takes the scheme and port of the app (dev: `developer.localhost` → `http://developer.localhost:3000`). A real one is always `https`.
- **Slugs.** `developer` and `developers` are reserved shop slugs.
- **Proxy.** The app does not write this host into the Traefik file. That file holds store domains only. Point the host at the app in your proxy yourself.

Hooks an add-on may set (`app/xcore/hooks/Hooks.ts`):

| Hook | What |
|---|---|
| `Hooks.docsPage` | The page at `/` of the docs host. |
| `Hooks.docs` | Where the app's links to the developer docs lead: `api` and `extensions`. Default `DOCS_URL`. |
| `Hooks.guides` | More topics for the user guide (below). |

## MCP server (`POST /mcp`)

The same API as **tools for AI assistants** (Model Context Protocol).
It uses **the same key and the same roles**.

### Addresses

There are two addresses per shop:

- the app's own host: `https://example.com/mcp`
- the shop's host: `https://<slug>.<STORE_DOMAIN>/mcp`, or its live custom domain

Why two:

- Assistants like Claude take each address only once.
- So a person with several shops adds each shop by its own address.

Rules:

- On a shop's host only **that shop's keys** work. A key of another shop gets the same 401 as a wrong key (`McpApiController.handle`, `findByHost`).
- The proxy routes a shop's host only while its online store is on.
- So the keys page shows the shop's address only then. It shows the main one only when there is no shop address.

### The endpoint

- One endpoint, MCP "Streamable HTTP".
- It answers plain JSON. There is no stream and no session.
- `GET` and `DELETE` answer 405.
- Methods: `initialize`, `ping`, `tools/list`, `tools/call`, and notifications (202).
- No resources, prompts or sampling.
- `initialize` picks the version from `MCP_PROTOCOL_VERSIONS`: the client's own when known, else the newest.

### One tool per API route

The tools are built from the same `ApiDoc` the OpenAPI file is built from (`Mcp.buildTools` in `app/xcore/api/Mcp.ts`).
So a new API route is a new tool, with nothing to write twice.

- **Name.** It comes from the summary: "Create a product" → `create_product` (`Mcp.toolName`). A reworded summary renames the tool, so the test pins the names.
- **Arguments.** The path's `:id`, the query string and the body's fields, side by side. Two parts with the same argument name make the server refuse to build the tools.
- **Annotations.** Read only for a `GET`. Destructive for a `DELETE`.
- **Destructive tools.** A tool that takes money, stock or emails for good is listed with `destructiveHint: true`, and so is every delete. A client then asks the person first. These are: refund, void, record payment, adjust stock, schedule a campaign. It is `destructive: true` on the route's docs in `routes/api.ts`.

### A tool with no API route

`mcpTool(...)` in `routes/api.ts` adds a tool the same way, with two differences:

- Its handler is on no path (`router.handler()`, kept on the doc as `mcpOnly`).
- `OpenApi.build()` leaves it out.

Today there is one: `read_user_guide`.

### Tools of extensions

A running extension's manifest `tools` add one tool per entry, after the API's own (`ExtensionService.tools(shopId)`).

- The name is `<key>_<name>`, with the key's dashes as underscores (`Mcp.extensionToolName`).
- A tool points at one of the extension's staff routes, like `route: "POST /products/:id/kitchen"`.
- Its arguments are the path's `:name` parts plus the manifest's `input` (JSON Schema per argument).
- The rest of the arguments is the JSON body. For a `GET` or `DELETE` it is the query string.
- The controller checks the tool's `role`. Then it runs the route through `ExtensionController.run`. That is the same handler as `/ext/<key>/…`, as the key's user.
- A name the API already has is left out.
- So the tool list is **per shop**.
- These tools are not in the REST API or the OpenAPI file.

### Listing and calling

- `tools/list` shows only the tools the key's role may call.
- `tools/call` turns the arguments into the API call. It sends it through **that route's own handler** behind its role check (`ApiDoc.run`), as the caller the request's key already stands for.
- The key is checked once, by `ApiGuard.mcpKey`.
- So the role, the validation and the errors are the API's own.
- The answer is the API's JSON as text, with `isError` for a status of 400 and up.

### Rate limit

- A tool call takes **one** hit of the key's `api` rate limit: the MCP request. The API call inside it is not counted again.
- A list of messages holds at most `MCP_BATCH_MAX` = 20. More is a JSON-RPC error (400).
- Every tool call after the first of a request takes one more hit. So a list is never cheaper than the same calls one by one.
- A call that no longer fits is answered as a tool error (`rate_limited`).

### Logo

- `initialize` answers `serverInfo.title` (`MCP_SERVER_TITLE`) and `serverInfo.icons`.
- The icons are the app's own: `<APP_URL>/android-chrome-192x192.png` and `…-512x512.png`. They are served on every host.
- A client that looks up the host's icon by itself finds `/favicon.ico`, a real ICO file of the same logo.

### The key header

- **The key goes in `X-API-Key`** (`MCP_KEY_HEADER`): the key alone, no `Bearer`.
- `Authorization: Bearer <key>` opens `/mcp` too. It is what a client sends after the OAuth sign-in below.
- A 401 from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="<host>/.well-known/oauth-protected-resource"` (`ApiGuard.mcpRefused`). So a client finds the sign-in by itself.

### Connecting

With a key, from any client that can send a header:

```
claude mcp add --transport http sellrika https://<host>/mcp --header "X-API-Key: srk_…"
```

With OAuth, give the client only the address (a hosted connector works the same way):

```
claude mcp add --transport http sellrika https://<host>/mcp
```

## OAuth 2.0 sign-in

The code is in `OAuthController`, `OAuthService` and `OAuth.Constant.ts`.

The sign-in hands out **an ordinary API key** as the access token.
So the key's rules are the only rules: its shop, its role, its rate limit, and the delete button on `/api-keys`.
There is no table, no migration and no package.

| Step | Route | What it does |
|---|---|---|
| Find | `GET /.well-known/oauth-protected-resource` (also with `/mcp` after it) | Every host. It names this host's MCP address and the sign-in server. That server is always the app's own host (`Url.appOrigin()`), because the staff session lives there. |
| Find | `GET /.well-known/oauth-authorization-server` | The endpoints. PKCE `S256` only, `authorization_code` only, no client secret. |
| Register | `POST /oauth/register` | Nothing is stored. The `client_id` is the client's name and redirect addresses, signed with `APP_KEY` (`signed()` in `app/helpers/crypto.ts`). A redirect address must be `https`, or `http` on the person's own computer (`localhost`, `127.0.0.1`, `[::1]`). |
| Ask | `GET /oauth/authorize` | The consent page `Pages/OAuth/Authorize.vue`, admins only. It shows the client's name, the shop, a role picker (none picked at first) and, in a box of its own, the host the code goes to. It is always shown. A wrong client or redirect address is an error on the page. The person is never sent to an address that was not checked. |
| Allow | `POST /oauth/authorize` | JSON `{ url }` = the redirect address with a one-time code and the client's `state`. The page sends the browser there itself (`form-action 'self'` stops a form). Cancel goes back with `error=access_denied`. |
| Swap | `POST /oauth/token` | It checks the code (once, `OAUTH_CODE_TTL_MS` = 1 minute), the client, the redirect address and the PKCE secret. It also checks that the admin is still an admin of the shop. Then `ApiKeyService.create` makes the key, named `<client> (<redirect host>)`. The answer is `{ access_token, token_type }`, never cached. |

More rules:

- **Which shop.** The client's `resource` names the MCP address.
  - A shop's own host means that shop, and only when it is in the admin's account (`OAuthService.shopFor`).
  - Any other address means the admin's active shop.
- **A guest** is sent to `/login` by `Guard.comeBack`. It remembers the page in the `next` cookie (`__Host-next` in production, 10 minutes).
  `AuthController.signedIn` then goes back to it. Only a path on this site is taken (`Url.samePath`).
- **Codes** are kept in memory (at most `OAUTH_CODES_MAX`), like the passkey challenges. That is fine for one process.
- **The token does not run out.** There is no refresh token. The admin stops a client by deleting its key.
- **Each new sign-in makes a new key.** A shop holds `API_KEY_MAX` = 20. The consent page says so when it is full.
- **The public endpoints answer any origin** (CORS `*`). They take no cookie and no key. They sit in the `oauth` rate bucket.
- **Not there yet:** app-link redirect addresses (`cursor://…`), Client ID Metadata Documents, short-lived tokens.
- It was checked by hand against the official client (`@modelcontextprotocol/sdk`, protocol 2025-11-25). The client is not a dependency.

## User guide (MCP tool `read_user_guide`)

Help texts for the people who use the app.
So an AI assistant can answer "how do I refund an order?".

It is **MCP only**. The API has no `/guide` route, and the OpenAPI file does not show it (`mcpTool` in `routes/api.ts`).

### Topics

- One topic = one file: `resources/guide/<topic>.md`.
- The first line is the title (`# Title`).
- The texts are English only. The assistant answers in the person's language.
- The topics are `GUIDE_TOPICS` (`app/constants/Guide.Constant.ts`).
- `resources/guide/index.ts` imports each file as text. So they are bundled into the compiled binary.

### The answer

- The tool answers `{ topic, title, text, topics }` (`GuideApiController.show`).
- Without `topic` it is the `overview`. That text says what each topic covers.
- An unknown topic is refused (`isError`).
- Every role may read it.
- `MCP_INSTRUCTIONS` tells the assistant to call `read_user_guide` for a how-to question.

### Topics from other places

- **Extensions.** A running extension with a manifest `guide` (a `.md` file in its folder) adds one topic named by its key (`ExtensionService.guides(shopId)`). It is listed after the app's own.
- **Add-ons.** `Hooks.guides` adds topics for every shop. A topic there wins over an extension keyed the same.
- A topic of the app wins over both.
- So `topic` is a plain string, not an enum, and the list is per shop.
- What an extension explains lives in its own guide, never in `resources/guide/`. The Restaurant's is `extensions/restaurant/guide.md`.

### A new topic

1. Add the name to `GUIDE_TOPICS`.
2. Write the file.
3. Add the import in `resources/guide/index.ts`.
4. Add a line to `overview.md`.

TypeScript refuses a name without a file.

### Writing rules

- Write steps for a shop owner, not a developer.
- Name buttons and pages as the English UI shows them (`i18n/en.ts`).
- No routes, table names or code.
- When a screen changes, change its guide in the same PR.

## Adding a route

1. **Controller.** Add a method on the area's `*.Api.Controller.ts`:
   `ctx(req)` → `validate` / `ApiResponse.query` → the service → `json` / `ApiResponse.created` / `.deleted` / `.invalid` / `.notFound`.
   Put no rule in the controller. Put it in the service.
2. **Route.** In `routes/api.ts`:
   `api("post", "/things", [ThingApiController, "store"], { fn, tag, summary, role, body, example, answer, status })`.
   A new kind of answer needs a schema in `ApiSchemas`.
3. **Test.** Extend `app/controllers/api/Api.test.ts`: call the route, and `matches("Thing", body)`.

## Tests

| File | What it checks |
|---|---|
| `app/services/settings/__tests__/ApiKey.Service.test.ts` | The key is stored as a hash. Wrong keys. The role cap. A demoted, switched-off or deleted maker. A shop that left the account. `last_used_at`. The limit. |
| `app/controllers/api/Api.test.ts` | Every area through the real router handlers: 401 / 403 / 404 / 422. Each answer parsed with its `ApiSchemas` model. The OpenAPI file checked against the registered routes. The MCP server: versions, notifications, batches, the tool list per role, the pinned tool names, calls and refusals. |
| `app/services/settings/__tests__/OAuth.Service.test.ts` | The code is swapped once for a key of the right shop and role. Refused: a wrong PKCE secret, redirect address or client, an old code, a demoted admin, a forged `client_id`, a bad redirect address, a shop of another account, a shop with all its keys. |
| `e2e/w-api.spec.ts` | The key dialog (shown once, not in the page or the history). Calls with the key. Admins only. CORS for the docs host and for no other site. The whole OAuth sign-in: guest → sign in → consent → code → key → `/mcp`. |
