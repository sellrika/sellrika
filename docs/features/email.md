# Outgoing email (platform and each shop)

How the app sends email: the platform's setup, a shop's own setup, the email classes and the providers.

## The two setups

**The platform has one email setup.**

- The platform admin (the `ADMIN_EMAIL` user) sets it on the page **Outgoing Email**.
- The page is `/email`, in the sidebar under Admin. In ⌘K it is "Outgoing Email".
- Its sender is **one whole address**, like `DoNotReply@example.com`.

**A shop may also have its own setup**, for example its own SMTP account.

- Its admins set it on **Shop Email**, for the active shop.
- The page is `/shop-email`, in the sidebar under Settings. In ⌘K it is "Shop Email".
- Without one, the shop sends through the platform's setup.

## Where the code is

| What | Where |
|---|---|
| Providers | `app/mail/` |
| The rules | `app/services/settings/Mail.Service.ts` |
| Storage | `app/repositories/Setting.Repository.ts` |
| Validator | `app/validators/Mail.Validator.ts` |
| Controller | `app/controllers/Email.Controller.ts` |
| Page (both setups) | `resources/js/Pages/Email/Index.vue` |
| The email classes | `app/emails/` |
| Constants | `app/constants/Mail.Constant.ts` |

The controller's methods:

- `index`, `update`, `test` for the platform
- `shopIndex`, `shopUpdate`, `shopTest` for the shop

The page shows the sender, one card per provider, and the Send test dialog.
On the shop page the prop `shop_mail` is set.
It is not named `shop`, because `shop` is the shared prop the sidebar reads.

The table is `settings(key, value)`:

- key `mail` for the platform (migration 0031)
- key `mail:shop:<id>` for a shop

A shop's row needs no migration.
It is written on the shop's first save.
It is deleted with the shop (`ShopService.remove` → `MailService.forget`).

## Who sends from where

| Email | Shop has its own setup | Shop has none |
|---|---|---|
| A shop's email to its customers (order, shipped, abandoned cart, campaign) | the shop's setup, from its `from_email` | the platform's setup, from the platform's `from_email` |
| The app's own email (invite, sign-up confirmation, password reset, new-order alert, platform test) | — | the platform's setup, from the platform's `from_email` |

Rules:

- **Every setup has one whole sender address** (`from_email`).
  Every email through the platform's setup goes out from it: the shops' email and the app's own.
- There is no per-shop address (`<slug>@<domain>`).
  Some providers (Azure) send only from addresses set up on their side.
- The sender name is the shop's name, else `MAIL_SYSTEM_NAME` ("Sellrika").
  Azure ignores it and shows the display name of its MailFrom address.
- The platform's provider must be allowed to send from that address:
  SPF / DKIM, a verified domain on Resend, a MailFrom address on Azure.
- `MailService.ready(shopId)` = the shop's email can go out one way or the other.
  The marketing page, scheduling a campaign and the marketing sweep check it per shop.
  So a shop with its own setup sends even while the platform's is off.
- The shop page's test email goes out exactly like the shop's real email: through its own setup, else the platform's.
- Without its own setup, the shop page says which address the shop sends from now (`MailService.platformAddress`).

### A shop's setup may only reach a public host

Before each send through a shop's own setup, `MailService` asks the mailer for its host (`Mailer.host()`):

- the SMTP host
- the Azure endpoint, which must be https

`Outbound.isPublicHost()` refuses a private, loopback or unknown address.
The message is "That mail server address is not allowed. Use a public host name." (`server.mail_host_refused`).

A failed send through a shop's own setup shows fixed words (`server.mail_shop_send_failed`).
It never shows the server's reply. The reply goes to the log.

The platform's setup on `/email` is not checked and still shows the reply.
Only the platform admin sets it.

## What is stored

`settings.value` for the key `mail` is one JSON object:

```json
{ "driver": "resend", "from_email": "noreply@example.com",
  "credentials": { "smtp": { "host": "…", "port": "587", "username": "…", "password": "<encrypted>" },
                   "resend": { "api_key": "<encrypted>" } } }
```

- **Every provider's credentials are stored side by side.**
- `driver` says which one delivers. It is a mailer key from `MailerRegistry` (`app/mail/Mailer.Registry.ts`).
  `""` means outgoing email is switched off.
- The UI is one **Sender** card plus a card per provider with an Enabled/Disabled select.
- Switching one on switches the others off.
- Only the one that is on has to be complete.
- The credentials of the others survive switching back and forth.

Secrets:

- Secret fields are AES-256-GCM encrypted with `APP_KEY` (`app/helpers/crypto.ts`).
- They are never sent back to the browser. The UI only shows a "Saved" badge.
- A blank secret on save keeps the stored value.
- They are never logged.
- **Change `APP_KEY` and they must be typed in again.** `MailService.config()` then returns null.

The sender:

- The platform and a shop's own setup both store one whole `from_email`.
- An older platform row has `from_domain` instead.
  A domain there reads as `noreply@<domain>`. An address reads as it is. This lasts until the next save.
- **The sender name is not a setting.** The email class (`Mailable`) sets `fromShop`:
  - the shop, on email to its customers. Its name is the From name.
  - null, on email to the app's users. The name is `MAIL_SYSTEM_NAME` (`"Sellrika"`, `app/constants/Mail.Constant.ts`).

## Routes

- `/email` is in the `Guard.platform` group: the platform admin only.
- `/shop-email` is in the `Guard.admin` group: the admins of the active shop.

| Route | Body | Does |
|---|---|---|
| `GET /email`, `GET /shop-email` | — | The page. Props: `mail` (the stored settings, secrets blank), `mailers` (the provider catalogue), `shop_mail` (`{name, fallback}` on the shop page, null on the platform's). |
| `PUT /email` | `{driver, from_email, credentials: {driver: {field: value}}}` | Stores every provider at once. A blank secret keeps the stored one. The switched-on `driver` needs `from_email` and all its `required: true` fields. |
| `PUT /shop-email` | `{driver, from_email, credentials}` | The same for the active shop. The switched-on `driver` needs `from_email`. |
| `POST /email/test`, `POST /shop-email/test` | `{to}` | Sends one message right away. Rate-limit bucket `mailTest` (5 per hour). |

For the test, the UI asks for the address in a dialog. It is prefilled with the signed-in admin.
Any failure shows as the `to` error.

## What gets sent

**Every email has its own class in `app/emails/`** (`<Name>.Email.ts`, alias `@emails/*`).

Each one implements `Mailable` (`app/emails/types.ts`):

- `to`
- `fromShop`: the shop, or null = the app itself
- `build()`: subject, text and html

`MailService.send()` takes only a `Mailable`.
So all the wording lives in that folder. Services only decide *when* to send.

| Class | To | From | Sent by |
|---|---|---|---|
| `OrderEmail` (`Order.Email.ts`) | the buyer | the shop | `OrderMailService.sendOrderConfirmation`, called by the store's `fulfill` (`StoreFulfillService`) |
| `OrderShippedEmail` (`OrderShipped.Email.ts`, extends `OrderEmail`) | the buyer | the shop | `OrderMailService.sendShipped`, called by `OrderService.setFulfillment` |
| `OrderAlertEmail` (`OrderAlert.Email.ts`) | the shop's `alert_email` | the app | `OrderAlertService.notify`. The same text goes to Telegram: `OrderAlertEmail.text()`. |
| `InviteEmail` (`Invite.Email.ts`) | a new shop owner | the app | `InviteService.createShopFor`. The link to pick a name and password, valid 7 days. See [auth-and-users.md](auth-and-users.md) › Accounts. |
| `ResetEmail` (`Reset.Email.ts`) | anyone with an account | the app | `AuthService.forgot`. The `/reset-password/:token` link, valid 1 hour. See [auth-and-users.md](auth-and-users.md) › Forgot password. |
| `ConfirmEmail` (`Confirm.Email.ts`) | a self sign-up owner | the app | `SignupService.sendConfirmation`. The `/confirm/:token` link. See [auth-and-users.md](auth-and-users.md) › Self sign-up. |
| `AbandonedCartEmail` (`AbandonedCart.Email.ts`) | the buyer of an unfinished checkout | the shop | `MarketingService.abandoned` (the marketing sweep). See [marketing.md](marketing.md). |
| `CampaignEmail` (`Campaign.Email.ts`) | a picked customer | the shop | `CampaignService.sweep`, and "Send test to me". See [marketing.md](marketing.md). |
| `NoteEmail` (`Note.Email.ts`) | one customer of the shop | the shop | An extension's `mail.customer` (`ExtensionMail`): a subject and plain text, for example Loyalty's reward code. |
| `TestEmail` (`Test.Email.ts`) | whoever the admin types | the app, or the shop on the shop page | `EmailController` |

Shared layouts:

- The two marketing emails share `resources/views/emails/marketing.edge`.
  `marketingEmail()` in `app/emails/marketing.ts` renders it.
  They carry an unsubscribe link and the `List-Unsubscribe` + `List-Unsubscribe-Post` headers.
  `EmailContent.headers` / `MailMessage.headers` are passed through by the mailers.
- `InviteEmail`, `ConfirmEmail` and `ResetEmail` extend `LinkEmail` (`Link.Email.ts`).
  They share one layout with a link button: `resources/views/emails/link.edge`, rendered by `linkEmail()` in `app/emails/link.ts`.

A new email = a new class here + a call to `MailService.send(new XEmail(…))`.

### Online order confirmation

It is `OrderEmail`, sent by `app/services/sales/OrderMail.Service.ts`. That service also finds the support address.

The store's `fulfill` fires it right after a checkout turns into an order.
It goes to the address from the checkout form. The fallback is the gateway's record.

- **It goes out once.** Only the request that claimed the cart creates the order. So a refreshed `/done` page never emails twice.
- **It is not awaited.** A slow or broken mail server cannot hold up the customer's "thank you" page.
- Failures are logged (`[mail] order #…`). They are never shown to the buyer.
- With email off it is a silent no-op. The order is not affected either way.
- An order placed with a manual option (cash on delivery, bank transfer) gets the same email with other words:
  "We received your order. Payment: …", a "To pay by …" badge and the shop's bank details in a box.
  A paid order says "We got your payment" instead.
- Every order email names the order by its **public code** (`orders.reference`, for example "Order P8J4-MJSQ-4Z8T"). It never uses the sequential id.
- It links to the store's **Track your order** page (`…/track?code=…`).
  The address is `Url.storeOrigin(shop)`: the shop's own domain, else its subdomain `<slug>.<STORE_DOMAIN>`.

### Shipped notice

It is `OrderMailService.sendShipped`.

- `OrderService.setFulfillment` fires it once, when an online order is moved **to** `shipped`.
  Saving `shipped` again does not send it again.
- It goes to the attached customer's email.
- The subject is "Order <code> is on its way — <shop>".
- The tracking number is in the intro and shown as a badge. The same recap follows.
- It uses the same template, `resources/views/emails/order.edge`.
  It is one layout with different words via `hello` / `intro` / `payment` / `instructions` / `tracking`.
- It follows the same best-effort rules.

### The order template

- The footer names the shop's **support email** (`shops.support_email`, set on `/online-store` › Banner & contact).
  It falls back to the shop owner's account email (`shops.owner_id`).
- The footer always says the message is automated and not to reply. The From is a sending-only address.
- `new OrderEmail(to, shop, order, {buyer, support, instructions}).build()` gives the subject, text and html without sending.
  So it can be tested on its own.
- The HTML is an Edge template, `resources/views/emails/order.edge`.
  It is rendered through the shared instance in `app/xcore/view/Edge.ts`.
  It is imported `with { type: "text" }`, so it is embedded in the compiled binary.
- It uses a table layout and inline styles only. Mail clients drop `<style>` blocks and most modern CSS.
- Lines read "2 × Rattan Basket", with the unit price underneath when the quantity is above 1.

### Pictures travel inside the email (CID)

`build()` reads the pictures with `Storage.readBytes()` (`app/xcore/storage/Storage.ts`) and returns them in `inline`.
The mailer attaches them.

- The shop logo is `cid:logo@pos`.
- Each line's picture is `cid:item-<n>@pos`.

So they show without `APP_URL`, and the mail client loads nothing.

Each one is shrunk first to fit a box:

| Picture | Constant | Box |
|---|---|---|
| Line picture | `MAIL_ITEM_IMAGE_PX` | 112 px |
| Shop logo | `MAIL_LOGO_IMAGE_PX` | 80 px |

- The box is twice the shown size. The constants are in `app/constants/Mail.Constant.ts`.
- A PNG stays PNG, to keep transparency. Anything else becomes JPEG.
- A picture that cannot be read as an image is sent as it is.
- Only a file that is gone leaves a line without a picture.
- `Storage.shrink()` does the shrinking for both.

The line picture is `order_items.image`.
This is the order's own shrunk copy (`/uploads/<shop id>/orders/<uuid>.<ext>`, or an older `/uploads/order-…`), made when the order was placed.
So a later product picture change, or a deleted product picture, does not change old emails.
See [orders.md](orders.md).

## Sending from code

```ts
const error = await MailService.send(new InviteEmail(to, shop.name, link));  // null = sent
```

- `send()` never throws.
- It returns a reason the user can read.
- With no provider switched on, the reason is `"Email is not set up yet"`.
  So callers (order confirmations…) can simply skip when email is off.

The From header is `<shop name or MAIL_SYSTEM_NAME> <address>` (`MailService.senderName()`).
The address is as in **Who sends from where**.

The name is cleaned:

- It loses control characters, quotes and angle brackets.
- It is wrapped in double quotes when it has a comma, dot, `@` or another special character.

## Providers (`app/mail/`)

| Key | File |
|---|---|
| `smtp` | `smtp/Smtp.Mailer.ts` |
| `resend` | `resend/Resend.Mailer.ts` |
| `azure` | `azure/Azure.Mailer.ts` |

### `smtp`

- Raw SMTP on `Bun.connect`. No npm package and no `node:` imports.
- Implicit TLS on port 465. STARTTLS otherwise.
- `AUTH LOGIN` when a username is set.
- The body is always base64.
- One recipient, no pooling, no DKIM.
- Each round trip may take `SMTP_TIMEOUT_MS` (15 seconds).
- With inline images the body is `multipart/alternative`:
  text + `multipart/related` = html + one part per image (`Content-ID: <cid>`).

The SMTP card shows a warning (`Mailer.note`, `server.smtp_ports_note`):
many servers block ports 25, 465 and 587, so use Resend or Azure there.

### `resend`

- `POST https://api.resend.com/emails` with the API key as a bearer token.
  `RESEND_API_URL` points it at a stand-in in the e2e tests.
- Inline images go as `attachments` (`filename`, base64 `content`, `content_type`, `content_id`).
- On a `429` it waits `retry-after` and tries again, up to `RESEND_MAX_TRIES` = 3 times.

### `azure`

Azure Communication Services Email over HTTPS. It is for servers whose host blocks the SMTP ports.

- It has one field: the resource's **connection string** (`endpoint=…;accesskey=…`, on the Keys page of the resource).
- It calls `POST <endpoint>/emails:send?api-version=2025-09-01` (`AZURE_EMAIL_API_VERSION`).
- The call is signed with HMAC-SHA256:
  `x-ms-date`, `x-ms-content-sha256`, `Authorization: HMAC-SHA256 SignedHeaders=…&Signature=…`. The key is base64-decoded.
- Inline images go as `attachments` with `contentId`.
- A `202` = accepted. The app does not poll the operation.
- A `429` waits `retry-after`, up to `AZURE_MAX_TRIES` = 3 tries.

The sender on Azure:

- Azure sends only from a **MailFrom address** added to the domain. At first that is just `DoNotReply@<domain>`.
- Azure shows that address's own display name. So set the sender to that whole address.
- The portal may not let you change that display name. The Azure CLI does:

```sh
az communication email domain sender-username update \
  --resource-group <rg> --email-service-name <service> --domain-name <domain> \
  --sender-username DoNotReply --display-name "<your name>"
```

### Adding a provider

To add one (Postmark, SES, …):

1. Implement `Mailer` in `app/mail/<name>/<Name>.Mailer.ts`.
   Its API client lives in the same file: plain `fetch`, no npm deps.
   An HTTPS provider extends `HttpMailer` (`app/mail/Http.Mailer.ts`).
2. Inject it into `MailerRegistry`.

Storage, the settings UI, validation and sending follow automatically.

- `required` fields decide when the setup counts as configured.
- `secret` fields get encrypted.

## Tests

| File | What it checks |
|---|---|
| `app/services/settings/__tests__/Mail.Service.test.ts` | Storage, encryption, blank-keeps-secret, provider switching, `send()`, the sender addresses, a shop's own setup and the fallback |
| `app/mail/smtp/Smtp.Mailer.test.ts` | The SMTP dialogue against a fake server on a random port |
| `app/mail/resend/Resend.Mailer.test.ts` | A `429` is tried again, then the send gives up |
| `app/mail/azure/Azure.Mailer.test.ts` | The connection string, the signature, inline images and headers, a `429`, a refusal |
| `app/services/sales/__tests__/OrderMail.Service.test.ts` | The `OrderEmail` / `OrderShippedEmail` content, the support-address fallback, the do-not-reply line |
| `e2e/j-users.spec.ts` | The Outgoing Email page and the Shop Email page |
