# Security

What the app defends against, where each defence lives in the code, and what is left to the person who runs the server.

The numbers live in `app/constants/Security.Constant.ts`.

## Where the code is

| What | Where |
|---|---|
| Rate limits, input bounds, response headers | `app/constants/Security.Constant.ts` |
| Sessions and sign-in | `app/xcore/auth/Auth.ts`, `app/services/settings/Auth.Service.ts` |
| Route middleware (who may call a route) | `app/xcore/auth/Guard.ts`, `app/xcore/auth/ApiGuard.ts` |
| The origin check, hosts, the client IP | `app/xcore/http/Url.ts` |
| The rate limiter | `app/xcore/http/RateLimit.ts` |
| Requests the server sends out | `app/xcore/http/Outbound.ts` |
| The response headers | `app/xcore/http/Headers.ts` |
| Encryption and signing | `app/helpers/crypto.ts` |
| The HTML cleaner | `app/helpers/html.ts` |
| Hiding cost values from cashiers | `app/helpers/costs.ts` |

## Settings a real server needs

| Variable | Why it matters |
|---|---|
| `APP_KEY` | It encrypts payment and mail credentials in the database (AES-256-GCM, `app/helpers/crypto.ts`). With no key, those settings refuse to save. If you change it, the saved secrets can not be read any more. They must be typed in again. |
| `APP_URL` | The public base URL. Without it, links handed to a payment gateway are built from the request's own `Host` header. A client controls that header. In production the server logs a warning on boot when it is not set. |
| `TRUST_PROXY=1` | Set it **only** when a reverse proxy really ends the connection. It makes `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` believed. Without it, anyone could claim any IP (and get past the rate limits) or any hostname. |
| `NODE_ENV=production` | It turns on `secure` session cookies and HSTS. It is inlined at compile time, so always run `bun run compile` with it set. |
| `ADMIN_PASSWORD` | The first admin's password. The default in `.env.example` is `password`. Change it on the first sign-in of any real server. |

About `TRUST_PROXY`:

- The client IP is the **last** `X-Forwarded-For` entry. That is the one the proxy adds.
- So put exactly one proxy in front. Or make the outer proxy replace the header.

## Sign-in and sessions

### Passwords

- Passwords are hashed with `Bun.password` (argon2id).
- The minimum is 8 characters.
- An unknown email still costs one argon2 verify, against a decoy hash (`AuthService`). So the answer time does not tell which accounts exist.

### The session cookie

- The cookie is `sid`. Its value is 32 random bytes.
- It is `httpOnly`, `sameSite=lax`, `path=/`, and `secure` in production.
- Signing in **deletes the session the browser arrived with**. So there is no session fixation.
- Changing a password signs out every other device.
- Switching a user off, or deleting one, signs them out everywhere.
- Expired sessions are deleted on boot (`SessionRepository.purgeExpired`).

### CSRF: two defences

**1. `sameSite=lax`.**

- A cross-site `POST`, `PUT` or `DELETE` never carries the cookie.
- No route that changes something is a `GET`.
- `strict` is not used. It would break the return from a payment gateway, which is a top-level `GET` from the provider.

**2. The origin check** (`Url.foreign()`, run by the router on every route).

- It looks at every request that is not `GET`, `HEAD` or `OPTIONS`.
- The request is refused with 403 when its `Origin` host is not the host it was sent to.
- It is also refused when `Sec-Fetch-Site` says it comes from another origin.
- It does not matter whether a session cookie is there. A sign-in needs no cookie, and a form on another site must not sign the visitor in to somebody else's account (login CSRF).
- So a page on a store host can not act on the staff host.

The paths in `ORIGIN_FREE_PATHS` are left out. They are meant to be called from somewhere else:

| Path | Why it is open |
|---|---|
| `/api` | It uses a Bearer key. The docs host may call it by CORS. |
| `/mcp` | It uses a key header. |
| `/oauth/token` | An MCP client calls it. It needs a one-time code and its PKCE secret. |
| `/oauth/register` | An MCP client calls it. It stores nothing. |
| `/done` | A payment provider sends the buyer back with a form POST. |
| `/unsubscribe` | The one-click POST of a mail app. |

`/oauth/authorize` is **not** in the list. It acts for the signed-in admin.

### Other rules

- `POST /done` on a store's host changes nothing. It only sends the browser to the `GET`. The `GET` checks the payment with the provider before anything is written.
- `HttpRequest.body()` reads JSON only when the content type is `application/json`. A page on another site can send `text/plain` without a preflight. That body is read as empty.

### Store subdomains are the same site

Every store's free address is `<slug>.<STORE_DOMAIN>`.
When `STORE_DOMAIN` is under the app's own domain, the browser treats a store and the app as the *same site*.

What that means:

- `sameSite=lax` does not stop a request that a store page sends to the app's host.
- A store page may set cookies for the parent domain.

Why it is safe today:

- The origin check above refuses such a request.
- No store page runs a script the platform did not add. Themes are added by the platform admin only.
- Every text a merchant types is cleaned or escaped.

The rule: before merchants may add their own scripts, stores must move to a separate domain.

## API keys (`/api/v1`)

Details: [features/api.md](features/api.md).

### The key

- A key is `srk_` + 32 random bytes.
- Only its SHA-256 is stored (`api_keys.key_hash`). 256 random bits need no slow password hash. A slow hash would make every API call slow.
- The key is shown once, in the answer to `POST /api-keys`. That answer is JSON with `Cache-Control: no-store`.
- It is never a page prop. Inertia keeps page props in the browser history.

### How it is read

- The API reads **only** `Authorization: Bearer …`.
- The MCP server reads `X-API-Key: …` or a Bearer key.
- A cookie is never read. So a browser session can not call the API.
- So `sameSite` and CSRF do not matter there. A store page can not reach the API with the staff cookie.

### What a key may do

- A key acts as the admin who made it, in one shop.
- It has at most the key's role: the lower of the key's role and the maker's role today.
- It stops when the maker is switched off or deleted.
- It stops when the shop leaves the maker's account.
- Only admins make and delete keys.
- Staff accounts are read only over the API.
- "Send a campaign now" needs an admin key.

### The MCP server

- `POST /mcp` takes the same key.
- It holds no rules. A tool call is sent through the API route's own handler, with the caller's key. So the role check and the validation run again there.
- A tool that is left out of a key's tool list is still refused by the route.
- On a shop's own host, the MCP server takes only that shop's keys. Another shop's key gets a 401.

### CORS

- With `DEVELOPER_DOMAIN` set, `/api/v1/*` allows the docs host as an `Origin`. So "Test Request" in the docs can call the API.
- The origin is matched as a whole string. It is never `*`. No credentials are allowed.
- This is safe because the API ignores cookies. A page on that host can only use a key the reader types in.
- A browser app on any other origin still can not call the API.

## Who may do what

- `Guard.auth` finds the user and the shop from the cookie. A switched-off account resolves to nothing.
- `Guard.confirmed` is a signed-in user whose email is confirmed. `Guard.auth` builds on it.
- `Guard.manager`, `Guard.admin` and `Guard.platform` gate the routes in `routes/*.ts`. A role is never checked only in the UI.
- Nobody is locked out over a plan in `Guard.auth`. An add-on may say something about the plan through `Hooks.plan` (`app/xcore/hooks/Hooks.ts`). That only rides on the context, for a banner.
- Every repository query for shop data filters on `shop_id`. So an id from the client can not reach another shop's rows.
- You can not demote, switch off or delete yourself.
- Nobody can demote, switch off or delete the shop owner.

## Rate limiting

The code is `app/xcore/http/RateLimit.ts`. The buckets are `RATE_LIMITS`.

How it works:

- It is a fixed window per client IP, per bucket.
- A hit is *taken* before the handler runs, in the same step as the check (`RateLimit.take()`). So a burst of parallel requests can not all pass before one is counted.
- A bucket can give the hit back for an answer that does not count (`RateLimit.refund()`).
- `login` counts only failures. So a shop whose staff sign in all morning never runs out.

| Bucket | Limit | What it guards |
|---|---|---|
| `login` | 10 per 15 min | Failed sign-ins. The argon2 verify is the costly part, so this stops guessing and CPU overload. |
| `passwordForgot` | 5 per 15 min | "Forgot password". Each one may send an email. The form answers the same for every email. |
| `passwordReset` | 20 per 15 min | The "forgot password" links. A script would guess tokens. |
| `invite` | 20 per 15 min | Invitation links. A script would guess tokens. |
| `signup` | 20 per 15 min | Self sign-up. Each one hashes a password and creates an account and a shop. |
| `confirmResend` | 5 per 15 min | "Resend the confirmation email". Each one sends an email. |
| `passkey` | 30 per 10 min | Passkey challenges (each one is kept in memory for 5 minutes) and adding a passkey (an argon2 verify of the current password). A failed passkey sign-in is counted in `login`. |
| `storeCheckout` | 20 per 10 min | The public checkout. It prices a whole cart and calls the payment provider. |
| `storePay` | 20 per 10 min | Charging a card token at the public checkout. |
| `storeManualOrder` | 5 per hour | An unpaid online order (cash on delivery, bank transfer). It takes stock and emails the buyer with no payment at all. It is taken in `StoreController.checkout` when a manual option is picked, and given back when no order is written. |
| `storeCoupon` | 30 per 10 min | Public discount code checks. A script would try thousands. |
| `storeAddress` | 120 per min | Address lookups at the checkout. It is not a bulk export of the list. |
| `storeDone` | 40 per min | The "thank you" page. Each hit asks the payment provider. |
| `storeTrack` | 30 per 10 min | The public "track my order" lookup. The order code plus the buyer's email or phone is the whole proof, so this stops guessing. |
| `storeLogin` | 20 per 10 min | The store's customer sign-in. Every call asks Firebase to check a token. |
| `storeUnsubscribe` | 20 per 10 min | The store's unsubscribe button. A script would try tokens. |
| `storeExtension` | 120 per min | Public routes an extension adds to the store (`/store/:slug/ext/:key/*`). |
| `marketingTest` | 10 per 10 min | "Send test to me" on a campaign. Each one sends an email. |
| `upload` | 60 per 10 min | Image uploads of 5 MB each. |
| `mailTest` | 5 per hour | "Send a test email". It is the one endpoint that makes the server mail any address. |
| `search` | 120 per min | Type-ahead lookups. It keeps the customer list from being a free scraping API. |
| `api` | 600 per min | The REST API. It is counted **per key**, not per IP. It is enough for a sync job and stops a loop gone wrong. |
| `apiAuth` | 30 per 10 min | API calls with a missing or wrong key, per IP. Only failures count. Each one is a database lookup. |
| `oauth` | 600 per 10 min | The public OAuth endpoints of the MCP server, per IP. An assistant's own servers call them for all of its users, so the limit is wide. |

ponytail: the counters are an in-process `Map`. That is right for the single container the app ships as. Behind several instances, each one keeps its own count. Move the counters to the database or Redis if that day comes.

## Input

- All SQL goes through `Bun.sql` tagged templates. `db.unsafe` is used only for migrations (`database/` and `MysqlDdl`, which turns the migrations' SQL into MySQL's).
- Every request body is parsed by a zod schema (`app/validators`).
- `maxRequestBodySize` caps every request at `MAX_REQUEST_BODY_BYTES` (8 MB).
- Prices, costs and discounts are always read again and worked out on the server. The client's numbers are never trusted.
- The online checkout reads the amount from the stored cart snapshot, never from the browser.

List inputs are bounded. Each cart line costs a database round trip, so an unbounded list is a denial of service.

| Constant | Value | What it bounds |
|---|---|---|
| `MAX_CART_ITEMS` | 100 | The lines of one cart |
| `MAX_REFUND_ITEMS` | 200 | The lines of one refund |
| `MAX_LINE_QTY` | 10,000 | The quantity on one line |
| `MAX_PAID_CENTS` | 1,000,000,000 | The "amount paid" a till can enter, in cents |
| `MAX_COUPON_SCOPE` | 200 | The products or categories of one discount code |
| `MAX_COUPON_EMAILS` | 500 | The emails of one customer-only code |

Uploads:

- The type is read from the file's first bytes, never from the client's MIME type.
- The cap is 5 MB (`MAX_UPLOAD_BYTES`).
- The file is stored under a generated UUID name.
- Static routes reject any name that contains `/`.
- `URL` normalises `../` before routing. `URL.pathname` and `Bun.file` do not decode `%2e`. So there is no path traversal.

## Output

### Pictures

- An uploaded picture is written again as a WebP of at most 1600 px (`Storage.compress`).
- A picture that claims more than `MAX_IMAGE_PIXELS` (50 million pixels) is never opened. So a tiny file with a huge canvas costs no memory.
- See [features/products.md](features/products.md).

### HTML a merchant writes

Store pages and product descriptions are cleaned on save with an allowlist (`app/helpers/html.ts`).

- `script`, `iframe`, `form` and `svg` are dropped with their content.
- `on*` attributes are removed.
- `href` and `src` must be `http(s):`, `mailto:`, `tel:`, a root-relative path, or a fragment.
- Tags whose inside the parser reads as text are dropped with their content too. They are `RAW_TEXT_TAGS`: `xmp`, `textarea`, `title`, `noembed`, `noframes`, `plaintext`.
- The cleaner runs again on its own output until nothing changes, at most `SANITIZE_PASSES` (5) times. It gives `""` when the text never settles.
- Migration 0081 runs the cleaner over the values that were already saved.

### Other output

- The ⌘K search writes a row's title and description as HTML (`search-js`). So `recordEntries()` escapes every text that comes from a record (`escapeHtml` in `resources/js/lib/search.ts`).
- The Inertia page payload is JSON with `<` escaped before it goes into `<script>`.
- The public store payload never carries costs, credentials or internal ids.

### Response headers

Every response carries `SECURITY_HEADERS`. The router sets them itself, so a new route can not forget them.

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` |

- `Cross-Origin-Opener-Policy` is not `same-origin`. The store's Google or Microsoft sign-in pop-up must report back to the page. Else Firebase says the pop-up was closed.
- HSTS (`HSTS_HEADER`) is added over HTTPS in production.

`Access-Control-*` headers are sent in two places only:

- `/api/v1/*`, for the docs host alone (see [CORS](#cors) above).
- The public OAuth endpoints of the MCP server (`OAUTH_CORS_HEADERS`). Any origin may read them. They take no cookie and no key.

Every other browser call is same-origin, also on a store with its own domain.

## Redirects and host headers

- `back(req)` and the Inertia URL both run the `Referer` through `Url.samePath()` (`app/xcore/http/Url.ts`). It keeps the path and drops the origin. So a forged `Referer` can not become an open redirect.
- `Url.originOf()` prefers `APP_URL`.
- `X-Forwarded-*` is read only when `TRUST_PROXY` is set.
- A shop that answers on its own domain uses `Url.requestOrigin()`. That is safe because the hostname was just matched against `shops.domain`.

## OAuth sign-in of the MCP server

- The access token is an ordinary API key. So everything above holds for it.
- Only an **admin** can allow a client, on a consent page that is always shown. Anyone can register a client, so a client is never trusted.
- A `client_id` is the client's own data signed with `APP_KEY`.
- A redirect address is matched exactly against the signed list.
- A redirect address must be `https`, or `http` on the person's own computer. It is never `javascript:` or `data:`.
- A wrong client or address is shown as an error. The person is not redirected.
- PKCE `S256` is required.
- A code works once, for one minute. A failed swap uses it up too.
- The swap checks again that the admin is still an admin of the shop.
- The remembered page of a guest (the `next` cookie) is only ever a path on this site (`Url.samePath`).
- In production the cookie is named `__Host-next`. So a page on a store subdomain can not plant one.
- `POST /oauth/authorize` sits in the `oauth` limit too. Each call keeps a code in memory for a minute.

**Consent phishing** is the risk that stays.
A stranger registers a client named like a real assistant and sends an admin the link.
So the consent page:

- shows the host the code goes to, in a box of its own, with a warning
- picks no role by itself (Allow waits for one)
- names the key `<client> (<that host>)` on `/api-keys`

## Known gaps

- **A sign-up with Microsoft does not prove the email.**
  - Firebase does not call most Microsoft emails verified. Nobody is asked to confirm one.
  - Such an account signs in only by its own sign-in account (`users.firebase_uid`), never by the email. So it can not reach an existing user.
  - But a stranger can sign up first with an email that is not theirs. They get an empty account of their own with that email on it.
  - The mailbox's owner takes the account with "Forgot password". That cuts the stranger's sign-in account off.
  - A user ties a Microsoft account to an existing account only from inside it: `/settings` › Microsoft account, with the current password.
- **OAuth keys do not run out.** A client keeps its key until an admin deletes it on `/api-keys`.
  ponytail: add a token table with an expiry and refresh tokens when short-lived tokens are wanted.
- **CSP has no `script-src`.** The root view carries an inline theme script and an inline page-JSON block. Vite adds its own scripts in dev.
  ponytail: pass a nonce through `inertia.ts` and `app.edge`, then tighten to `script-src 'self' 'nonce-…'`.
- **No account lockout.** Rate limiting is per IP on purpose. A lock per account would let anyone lock a real cashier out by guessing at their email.
- **Rate-limit counters are per process.** See [Rate limiting](#rate-limiting).
- **An admin can XSS their own store's visitors** if the cleaner is ever bypassed. Admins write the HTML that public visitors see. The cleaner is the trust boundary. `app/helpers/__tests__/html.test.ts` guards it.
- **No audit log.** Who did what can be read from `orders`, `refunds` and `stock_movements`. Settings changes are not recorded.
- **Store subdomains are the same site as the app.** See [Store subdomains are the same site](#store-subdomains-are-the-same-site).

## Requests the server sends out

### Links the server fetches

A product picture by link, a picture in a campaign email and an extension zip by URL all go through `Outbound.fetch()` (`app/xcore/http/Outbound.ts`).

- Only `https://`.
- The host must resolve to **public** addresses only. Loopback, private, link-local (cloud metadata), carrier NAT and reserved ranges are refused.
- Redirects are followed by hand. Each hop is checked again. There are at most 3.
- The body is read with a byte cap. So a reply with no `content-length` can not fill the memory.
- A refused host looks like any failed link.

ponytail: `fetch()` resolves the name again. A DNS server that answers differently the second time can still get through.

### Other outgoing requests

- **Extension install by URL** (`POST /admin/extensions` with `url`, platform admin only). The download goes through `Outbound.fetch()`. It is capped at `MAX_EXTENSION_ZIP_BYTES` (5 MB) and `EXTENSION_FETCH_TIMEOUT_MS` (15 s).
- **Extension webhooks** go through `Outbound.send()`. Every listener and route gets it as `ctx.outbound`.
  - http or https.
  - No user name in the link.
  - Public addresses only.
  - A redirect is never followed.
  - The Slack and Discord fields of Chat alerts must start with the full host (`https://hooks.slack.com/`, `https://discord.com/api/webhooks/`). So a prefix can not name another host.
  - The Telegram bot token of Chat alerts goes in the path of `https://api.telegram.org/bot<token>/sendMessage`. A token that is not `<digits>:<letters>` is refused before the request. Errors name only the host, never the token.
- **A shop's own mail server** (`/shop-email`). The host must resolve to public addresses only (`Outbound.isPublicHost()`). A failed send shows fixed words, not the server's reply. See [features/email.md](features/email.md).
- **SMTP**. A password is sent only over an encrypted channel.
  - A server on another machine with no STARTTLS (and not port 465) is refused with `server.smtp_needs_tls` before `AUTH`.
  - Only a server on this same machine (`localhost`, `127.x`, `::1`) may take the password in the clear.
  - A relay with no user name is not affected.

## Other guards

### Accounts and roles

- **Cost fields.** `purchase_price` and `cost` (`MANAGER_ONLY_FIELDS`) are null in every answer to a role below manager. That covers Inertia page props (`Inertia.render`), JSON of the staff routes (`Guard.auth`), and the API and MCP for a cashier key (`ApiGuard.role`). All go through `app/helpers/costs.ts`.
- **Reserved emails.** Nobody may hold `ADMIN_EMAIL` or the online store's system address (`STORE_SYSTEM_EMAIL`). Both are refused in `UserRepository.emailTaken` and at sign-up, also before those users exist.
- **Passkeys** are deleted on a password reset, and when somebody else sets the password. See [features/auth-and-users.md](features/auth-and-users.md).
- **Search picks** (⌘K) belong to one user. The list is emptied when another user opens the palette on the same browser.

### Shops and their data

- **Shop delete** removes every table with a `shop_id`, the campaign rows and their queued emails included. A test reads the schema and fails when a new table is missing from `ShopRepository.#drop`.
- **Tenant checks on deletes.** `product_variants`, `bundle_items` and `product_categories` carry no `shop_id`. So `ProductRepository.delete` and `CategoryRepository.delete` first check that the parent row belongs to the shop, and stop when it does not.
- **`DELETE /products/:id`** of a product that is not in the active shop does nothing and says nothing. `usedInBundles` only reads the caller's shop.
- **Custom domains.** While the app manages domains, only a live (proved) domain is served. The app's own hosts can not be saved as one. See [guides/custom-domain.md](guides/custom-domain.md).
- **Store address renames.** At most `SLUG_CHANGES_PER_WEEK` (3) per account per week, all its shops together. Each rename needs a new certificate.
  - The times are kept in `settings` (`slug_renames:<owner id>`). So a restart does not forget them.
  - The lasting fix is one wildcard certificate for `*.<STORE_DOMAIN>`. With `STORE_WILDCARD_RESOLVER` set, the app writes one router for every free address. A rename then needs no certificate, and this limit is not applied.
  - See [guides/custom-domain.md](guides/custom-domain.md) › Wildcard certificate.

### Money and orders

- **Refunds and voids** check and write in one statement (`OrderRepository.refund` / `void`). `refunded + amount <= paid − change` and `status = 'completed'` sit in the `update … where`. So two at once can not both pass and put stock back twice.
- **Record payment** adds the money in one SQL statement on the row as it is (`OrderRepository.addPayment`). It refuses a payment that no longer fits. So two payments at once can not close an order with money still due, or lose one.
- **Stock at the online checkout.**
  - Lines of one product with different notes are added up before the stock check.
  - An **unpaid** order (cash on delivery, bank transfer, Send order) is refused when the stock ran out.
  - Only an order that is already paid is written without taking stock.
- **After an online order is written**, a later step that fails (the coupon use, the saved address) is logged. It never fails the checkout. Else the cart would be released and a reload would write a second order.
- **Reconcile.** A checkout the provider calls failed is put past the sweep's window. So the provider is not asked about it every minute for a day.
- **Guest orders.** A typed phone number never joins the customer record of a person with another email (`StoreFulfillService.#orderCustomer`). The guest gets a record of their own, without the phone.
- **Store sign-in** refuses an email whose lower-case form differs from its plain A–Z lower-case form (a look-alike letter such as the Kelvin sign). So it can not claim the record of the plain address.

### Coupons

- A customer-only code answers "sign in" to every email that is not proved. So it does not tell who is on its list.
- A proved customer's per-customer limit counts only the orders on their own record and their own open checkouts (`store_carts.coupon_customer_id`, migration 0082). So a guest who types that email can not use the limit up or hold it.
- **A late payment can not pass a usage limit.**
  - A checkout that holds a code tells a hosted gateway when to stop taking money (`CheckoutArgs.expires_at` = the end of the hold). Stripe uses it.
  - A card charge checks the hold first (`CouponService.stillHeld`).
  - A gateway that takes the money when the buyer comes back (PayPal) is told not to, once the hold is over (`getPayment(…, { capture: false })`).

### Marketing

- Abandoned-cart emails through the platform's email count in the account's monthly campaign-email limit (`PlanLimitService.countReminder`).
- The count is kept in `settings` as `reminders:<owner id>:<YYYY-MM>`. So it outlives the carts.
- One shop gets `MARKETING_SHOP_BUDGET_MS` (30 s) per run for its reminders. Every campaign gets the same. The rest stays queued for the next run. So a slow mail server can not hold the other shops.

### Extensions and MCP

- `products.create()` on a staff route throws for a cashier.
- `/ext/<key>/assets/*` serves only the logo, unless the extension runs for the shop.
- Zip entry names with a control character, a backslash, a leading `/`, a drive letter or a `..` part are refused.
- Unpacking stops at `MAX_EXTENSION_UNPACKED_BYTES` (20 MB) while inflating.
- **MCP extension tools.** The filled path is handed to the extension as it is. It is never read back from a URL. So a path argument `..` can not reach another route.
- **MCP tools that take money, stock or emails for good** carry `destructiveHint`, like every `DELETE`. They are the routes with `destructive: true` in their docs: refund, void, record payment, adjust stock, schedule a campaign.
- **Restaurant kitchen route.** Only a line that is an own key of the order's kitchen record is changed (never `__proto__`).

### Files

- **`GET /build/*`.** A path with an empty part (`//`) is a 404, so each file has one spelling. The gzip cache keeps at most `COMPRESS_CACHE_MAX` (1000) files.
- **CSV export** puts a `'` before a text cell that starts with `=`, `+`, `-`, `@`, tab or CR. So a spreadsheet does not run it as a formula. The import takes it off again (`guardCell` / `unguardCell` in `app/helpers/csv.ts`).
