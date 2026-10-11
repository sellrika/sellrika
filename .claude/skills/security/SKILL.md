---
name: security
description: Security rules for writing code in this POS. Use whenever a task takes input from a person or another system, adds or changes a route, a sign-in step, a role check, an upload, an outgoing request (fetch, SMTP, webhook), a background job, a cache, money or stock, coupons, an extension, or deletes data. Also use for a security review of a change.
---

# Security rules

The app is one process for every shop, and anyone can open a shop. So a shop's admin is **not** trusted: treat a tenant like a stranger with an account.
Each rule names the helper that already does the job — use it, do not write a second one.

## Before you write

Ask these about the change. One "yes" means the matching rule below applies.

- Does it take text, a file, an id, a URL or a host name from a person or an API caller?
- Does it add a route, or change who may call one?
- Does it make the server connect somewhere (fetch, SMTP, a webhook)?
- Does it run in a shared job, or keep something in memory?
- Does it change money, stock, a coupon count or an order?
- Does it add a table, or delete data?

## Input

- **Validate with zod** in `app/validators`, with a length limit on every string and a size limit on every list. A query string of the API is zod too (`ApiQuery.Validator.ts`).
- **HTML from a person goes through `sanitizeHtml`** (`app/helpers/html.ts`) on save. A new tag is added to `ALLOWED_TAGS` only when its inside is parsed as tags. A tag whose inside is read as text belongs in `RAW_TEXT_TAGS`. Never unwrap what you did not read.
- **Text from a record is text.** Vue's `{{ }}` escapes it. `v-html`, `innerHTML`, a library that writes HTML (the ⌘K search: `escapeHtml` in `resources/js/lib/search.ts`) and a raw Edge output (`{{{ }}}`) do not: escape first, or do not use them.
- **A path part is never an object key** without `Object.hasOwn(record, key)`. `__proto__` is a valid path part.
- **A path is never rebuilt from a URL.** A URL drops `..` and `//`. Match the text you were given, and refuse an empty part.
- **Uploads** go through `Storage.storeImage` / `storeImageFromUrl` only: the bytes are sniffed, the picture is re-written (`Storage.compress`) and a decode has a pixel limit (`MAX_IMAGE_PIXELS`).

## Who is asking

- **Every route sits in a guard group**: `Guard.auth` / `manager` / `admin` / `platform`, or `ApiGuard.key` + `ApiGuard.role`. The UI hiding a button is not a check.
- **No state-changing route is a `GET`.** The origin check (`Url.foreign`, in the router) covers every other method. A route that must take a request from another site is added to `ORIGIN_FREE_PATHS` with a reason, and then needs its own proof (a key, a token).
- **Read a JSON body with `HttpRequest.body`**, never `req.json()` in a controller: it reads JSON only for `application/json`.
- **A privilege never hangs on a field a user can edit.** The platform admin is `Account.isPlatformAdmin()`. Reserved addresses (`ADMIN_EMAIL`, `STORE_SYSTEM_EMAIL`) are refused wherever an email is saved.
- **Nothing typed is proof.** An email, a phone number or a domain counts only after its owner proved it: a signed-in session, an opened link **by the signed-in owner**, a DNS record. A guest's typed value never joins, reads or uses up another person's record.
- **One answer for a stranger.** A check that a stranger can call (a coupon, a login, a reset) gives the same answer whether the email, the code or the account exists.
- **A reset closes every way in**: sessions and passkeys (and think about API keys).

## What goes out

- **A role decides the fields, not only the page.** Cost fields (`MANAGER_ONLY_FIELDS`) are removed for cashiers by `app/helpers/costs.ts` in `Inertia.render`, `Guard.auth` and `ApiGuard.role`. A new field only managers may read is added to that list.
- **Every query names the shop** (`shop_id = ${shopId}`), also a join and a "is it used elsewhere" lookup. Return early when the record is not in the active shop, before any message is built from it.
- **The public store payload never carries costs, credentials or another shop's data.**
- **A remote error text is not shown to a tenant** when the remote host was picked by them. Show fixed words, log the real text.

## The server calls out

- **A URL or host a tenant typed is never passed to plain `fetch` or `Bun.connect`.**
  - Download: `Outbound.fetch` (https, public addresses, redirects checked, size limit).
  - Send: `Outbound.send` (extensions get it as `ctx.outbound`).
  - A host only: `Outbound.isPublicHost`.
- **A manifest `starts_with` must end the host**: `https://hooks.slack.com/`, never `https://hooks.slack`.
- **A password only travels encrypted.** No `AUTH` before TLS.

## Limits

- **Everything that grows has a limit**: messages in one request, rows in a list, entries in a cache (`Map`), downloads in a loop, emails per month.
- **An endpoint that costs something** (an email, a provider call, a disk write) sits in a `limit("<bucket>")` group (`app/constants/Security.Constant.ts`).
- **A count that must survive a restart lives in the database**, not in memory (`settings` row, or a table).
- **A shared job gives each shop a time limit** (`MARKETING_SHOP_BUDGET_MS`). What is left waits for the next run. One shop's slow server must not hold the others.
- **A job stops asking** once the answer is final (a failed payment is parked, not asked about every minute).

## Money, stock, coupons

- **One SQL statement changes the value and checks the rule**: `update … set paid = paid + x where … and paid + x <= total` through `Db.update()`, which says if a row matched. Never write a total that was read earlier. No row back = refused.
- **Stock moves only through `StockRepository.move`.** An unpaid order never sells what is not there. Add units up per product before the stock check.
- **A hold and a payment page end together.** A new gateway honours `CheckoutArgs.expires_at`, or checks before it takes the money (`getPayment(…, { capture })`).
- **After the order is written, nothing may fail the checkout.** Later steps are logged (`#quietly`), or the cart is released and a reload writes a second order.

## Data

- **A new table with a `shop_id` is added to `ShopRepository.#drop`** (a test fails when it is missing), children first.
- **Secrets are encrypted with `APP_KEY`** (`encrypt` / `secretFields`) and never sent back to the page, only whether each is set.
- **Production never starts with a default password or a missing secret.**

## Before you finish

- One test per rule you touched: the refused case, not only the happy path.
- When a rule here changed, change this file.
- When you leave a known gap, mark it with a `ponytail:` note in the code and name it in the pull request. Never leave it silent.
