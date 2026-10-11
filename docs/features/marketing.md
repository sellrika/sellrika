# Marketing (per shop)

The abandoned-cart email and email campaigns of a shop, and how people unsubscribe.

## Overview

There is one page, **Marketing** (`/marketing`, sidebar › Sales).
It is for managers and admins (`Guard.manager`).

It has two parts:

- the **abandoned-cart email**
- **email campaigns**

Both send only:

- while outgoing email is set up ([email.md](email.md))
- for a shop whose online store is on. The emails link to the store.

There is **no newsletter sign-up** anywhere. No popup, no form, no checkbox.
A campaign goes to existing customers of the shop that the owner picks by hand.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/sales.ts` (staff), `routes/storefront.ts` (restore link, unsubscribe) |
| Controller | `app/controllers/Marketing.Controller.ts` |
| Services | `app/services/sales/marketing/Marketing.Service.ts`, `Campaign.Service.ts` |
| Repositories | `app/repositories/Marketing.Repository.ts`, `Campaign.Repository.ts`, `EmailQueue.Repository.ts`, `StoreCart.Repository.ts` |
| Validator | `app/validators/Marketing.Validator.ts` |
| Model | `app/models/Campaign.ts` |
| Emails | `app/emails/AbandonedCart.Email.ts`, `Campaign.Email.ts`, `marketing.ts`, `pictures.ts` |
| Email template | `resources/views/emails/marketing.edge` |
| Constants | `app/constants/Marketing.Constant.ts`, `Mail.Constant.ts` |
| The monthly limit | `app/services/settings/PlanLimit.Service.ts` |
| Pages | `resources/js/Pages/Marketing/Index.vue`, `Campaign.vue` |
| Unsubscribe page | each theme's `unsubscribe.edge` |
| Migrations | `0061_marketing`, `0069_email_queue` |

## Abandoned-cart email

A buyer starts the online checkout, types their email, and never finishes.
Some hours later they get **one** email with their cart and a **Complete your order** button.

### Settings

Per shop, on `/marketing`:

- a switch, off by default
- a delay of 1, 4, 12 or 24 hours (`ABANDONED_CART_DELAYS`, `app/constants/Marketing.Constant.ts`)

`PUT /marketing/abandoned` saves them (`AbandonedInput`).
They are stored in `shops.abandoned_cart` + `shops.abandoned_cart_hours`.

### Which carts

A `store_carts` row is due when all of this is true:

- It has no order (`order_id is null`).
- It has a buyer email in `payload.customer.email`.
- It is older than the delay.
- It is not more than a day past the delay (`ABANDONED_CART_LATE_MS`).
- It was not reminded yet (`reminded_at is null`).

A cart for a manual payment (cash on delivery, bank transfer) becomes an order at once.
So it is never a candidate.

### Which carts are skipped

- The same email placed an order in the shop since the cart was made.
  Orders are joined to customers by email. Voided orders do not count.
- The email is unsubscribed.
- A newer checkout by the same email exists. Only the newest cart is emailed.

### Sent once

`StoreCartRepository.remind()` sets `reminded_at` and a random `restore_token`, with `where reminded_at is null`.
This is an atomic claim. So two sweeps never both send.

A failed send is not retried.

### The email

`app/emails/AbandonedCart.Email.ts`, template `resources/views/emails/marketing.edge`.

- It is from the shop's name.
- It is in the buyer's language (`payload.locale`). The fallback is the shop's first store language.
- The shop logo and each line's picture are inside the email (CID).
- It has the lines, the total, the button, and the unsubscribe footer + headers.

### The restore link

`GET /cart/<token>` on the store's host. The link is built with `Url.storeOrigin(shop)`.

1. It renders the checkout page with the cart's lines (the `restore` prop).
2. The checkout island (`resources/js/store/islands/Checkout.vue`) puts them into the browser cart (`store-cart:<slug>`).
3. It moves on to the plain `…/checkout` URL. So a reload does not restore again.

Rules:

- It changes nothing on the server.
- Prices and stock are checked again at the checkout.
- An unknown or expired link goes to the store.
- Package lines come back without their slot choices. The snapshot does not keep them.

### Cart lifetime

- Carts without an order live **7 days** (`STORE_CART_TTL_MS`). So the link still works a few days after the email.
- The gateway re-check (`StoreCartRepository.due()`, the reconcile sweep) only looks at carts younger than **1 day** (`STORE_RECONCILE_WINDOW_MS`).

## Campaigns

### The `campaigns` table

One row per campaign, per shop.

| Column | What it holds |
|---|---|
| `subject` | The subject |
| `body` | Rich text. It uses the same `RichText.vue` editor as product descriptions. It is sanitised on save by `sanitizeHtml()`. |
| `product_ids` | Up to `CAMPAIGN_MAX_PRODUCTS` = 6. Shown as cards with picture, name, price and a link to the product page. |
| `customer_ids` | Up to `CAMPAIGN_MAX_RECIPIENTS` = 5000 |
| `status` | `draft`, `scheduled`, `sending` or `sent` |
| `send_at` | UTC. null = a draft. |
| `sent` / `failed` | The counts |
| `created_by` | The user who made it |

### Pictures

Every picture travels inside the email (CID). So a picture deleted later never shows broken.

This covers:

- the shop logo
- the product cards
- each `<img>` in the body: the app's `/uploads/…` files, and `https://` links, which are downloaded

Rules:

- Each is shrunk to `MAIL_ITEM_IMAGE_PX` = 112 px, like the line pictures of the order email.
- A picture that cannot be read is removed from the email.
- `CampaignEmail.parts()` does this **once per send**. Every recipient's email shares the result.
- Each link is read once.
- Only the first `MAIL_BODY_PICTURES_MAX` = 20 different pictures of the body are read.
- No picture is started after `MAIL_BODY_PICTURES_MS` = 30 s. The rest are removed.

So one campaign cannot hold the shared sweep.

### Recipients

Recipients are existing customers of the shop who have an email.

- The picker is server-paged: `GET /marketing/customers?q=&page=`, 20 a page (`CAMPAIGN_PICKER_PER_PAGE`), with search.
- **Select all** uses `?all=1`. It answers the ids of every matching customer who may get email.
- **Clear** empties the pick.
- Unsubscribed customers are shown but cannot be picked. They are skipped at send time too.

### Pages

- `/marketing` = the campaign list.
  - A **Settings** button, in front of New campaign, opens the abandoned-cart switch and delay in a dialog.
  - The list shows subject, status, recipients, sent / failed and date. A sent campaign's row is greyed.
- `/marketing/campaigns/create` and `/marketing/campaigns/:id` = the form.
  - A draft or scheduled campaign can be edited.
  - A sending or sent one is read-only. It lists its recipients with sent / failed.

### Actions

All of them are POST / PUT / DELETE.

| Action | Route | Notes |
|---|---|---|
| Save | `POST /marketing/campaigns`, `PUT /marketing/campaigns/:id` | |
| **Schedule** | `POST /marketing/campaigns/:id/schedule` | With a date + time on the shop's clock (`shops.timezone`). It must be in the future. |
| **Send now** | the same route with `now: true` | Due now. |
| **Cancel schedule** | `POST /marketing/campaigns/:id/cancel` | Back to a draft. |
| **Send test to me** | `POST /marketing/campaigns/:id/test` | To the signed-in user. Rate bucket `marketingTest`. |
| Delete | `DELETE /marketing/campaigns/:id` | Never while sending. |

Schedule and Send now need:

- saved changes
- at least one recipient
- the store on
- email set up

### Sending

The sweep picks campaigns that are scheduled and due, or still `sending` (after a crash).

1. It claims a scheduled campaign atomically (scheduled → sending).
2. In one transaction, it **books** a `campaign_sends` row per recipient.
   The row is unique per `(campaign_id, customer_id)`, so nobody is booked twice.
3. In the same transaction it puts each one in the **email queue**: `email_queue`, kind `campaign` (`CampaignRepository.enqueue`).
4. An unsubscribed customer is booked with the reason and not queued.
5. The workers send the queued emails (see below).
6. At the end the campaign is `sent`. The counts are taken from the `campaign_sends` rows. Its queue rows are deleted.

The queue is in the database.
After a restart the next sweep finds the campaign still `sending` and sends what still waits.

One campaign gets `MARKETING_SHOP_BUDGET_MS` = 30 s per run of the sweep.
What is left goes out in the next runs. The campaign stays `sending` until then.
So a shop with a slow mail server does not hold the others.

### Workers

`EMAIL_WORKERS` = 5 emails of one campaign go out at the same time (`workers()` in `app/helpers/workers.ts`).

Each worker:

1. Takes the next waiting row (`EmailQueueRepository.take`: queued → sending). This is atomic, so two workers never get the same row.
2. Sends it.
3. Writes the result on its `campaign_sends` row.
4. Deletes the queue row.

Rules:

- A row still `sending` after a crash may have gone out. So it is never sent again. That person counts as failed.
- A worker takes one email off the monthly limit before it sends. It gives it back when the send fails.
  So workers side by side never go past the limit.
- Resend allows 10 requests a second per account.
  On a `429` the Resend mailer waits `retry-after` and tries again, up to `RESEND_MAX_TRIES` = 3 times.

### One at a time per account

While a campaign of the account is `sending`:

- **Send now** is refused (`marketing.busy`).
- A due scheduled campaign stays scheduled. `CampaignRepository.claim` refuses it until the other one is sent.

This also keeps the monthly limit count exact.

### Monthly limit

This limit protects the platform's email.

- An email sent through the **platform's** email counts toward the account's monthly limit (`campaign_sends.platform`).
- Abandoned-cart emails through the platform's email count too.
  Their count is kept in `settings` under the key `reminders:<owner id>:<YYYY-MM>` (`REMINDER_COUNT_KEY`).
- The limit is for all the account's shops together, per UTC calendar month.
- The limit is `users.campaign_email_limit` on the owner. The platform admin sets it on `/owners/:id`.
  Else it is `CAMPAIGN_EMAILS_PER_MONTH` = 1000.
- A shop with its own **Shop Email** has no limit.
- The platform admin's account has no limit.

When nothing is left:

- Schedule and Send now are refused (`marketing.limit_reached`).
- A campaign that hits the limit while sending marks the rest failed with "Monthly limit reached".

`PlanLimitService.campaignEmails()` and `campaignEmailsLeft()` are the one rule.

`PlanLimitService.campaignError(shop)` is also asked before a campaign is scheduled or sent.
In the open-source app it never refuses. An add-on may put its own class in its place in the DI container.

### The campaign email

`app/emails/Campaign.Email.ts`, the same template.

- It is from the shop's name.
- It has the owner's subject and text, the product cards, the logo and the footer.
- The frame texts are in the shop's default store language (`shop.languages[0]`).

## Unsubscribe (shared)

### Where it is stored

It is stored in **`email_unsubscribes`** `(shop_id, email)`, not on `customers`.
An abandoned-cart buyer often has no customer row. So one small table covers both kinds of email.

Customers show **Unsubscribed** on `/customers` and on the customer page. This is a join by lower-case email.

### The link

- The link is `…/unsubscribe/<token>`.
- The token is the email (base64url) plus an HMAC-SHA256 of shop id + email, keyed by `APP_KEY`.
- `unsubscribeToken()` / `readUnsubscribeToken()` in `app/helpers/crypto.ts` make and read it.
- There is no row per link.

### The page

- `GET /unsubscribe/<token>` on the store's host only asks: "Unsubscribe from <shop> emails?".
  The link is built with `Url.storeOrigin(shop)`.
- Its button POSTs to the same URL. The rate bucket is `storeUnsubscribe`.
- The page is `noindex`.
- A broken link says so.

### Headers

Every marketing email carries:

- `List-Unsubscribe: <link>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058)

So a mail app can unsubscribe with one POST to the same URL.
The mailers pass `headers` through.

Order emails are not marketing. They are always sent.

## The sweep

`MarketingService.run()` is the cron job `marketing`.

- It runs every minute (`MARKETING_CRON`, `app/jobs/Job.Registry.ts`), and once on boot.
- It does abandoned carts first, then `CampaignService.sweep()`.
- A shop whose email is off is skipped. Its carts and campaigns wait.
- One shop gets `MARKETING_SHOP_BUDGET_MS` = 30 s for its abandoned-cart emails per run.

It logs:

- `[abandoned-cart] cart #… (shop): reminder sent`
- `[campaign] #… (shop): N email(s) sent, now finished`

## Tests

| File | What it checks |
|---|---|
| `app/services/sales/__tests__/Marketing.Service.test.ts` | The token and the validators. The abandoned-cart sweep: due once, too early, ordered, unsubscribed, older duplicate, restore. The reconcile window. The campaign sweep: two sweeps at once, unsubscribed skipped, a crash never re-sends. The monthly limit: per owner, own email not counted, back to the default. One campaign at a time per account. |
| The same file › the email queue | Queued rows survive a restart and go out. A cut-off one is never re-sent. Nobody is queued twice. A finished campaign leaves nothing queued. |
| `app/helpers/__tests__/workers.test.ts` | Every item once. Never more than 5 at the same time. One error does not stop the others. |
| `app/mail/resend/Resend.Mailer.test.ts` | A `429` is tried again, then the send gives up. |
| `e2e/marketing.spec.ts` | Guest redirect. Abandoned-cart settings. A campaign from draft to scheduled and back. Send test to me → the unsubscribe page → done. The restore link refills the cart. |
