# Auth, roles, accounts and staff

How people sign in, what each role may do, who owns which shops, and how staff and sales staff are managed.

## Where the code is

| What | Where |
|---|---|
| Routes for sign-in, sign-up and `/settings` | `routes/account.ts` |
| Routes for `/users`, `/sales-staff`, `/owners` | `routes/settings.ts` |
| Sessions (`Auth.login`, `Auth.logout`, `Auth.current`) | `app/xcore/auth/Auth.ts` |
| Route middleware (`Guard.auth`, `Guard.admin`…) | `app/xcore/auth/Guard.ts` |
| Account and rank checks (`Account.id`, `Account.atLeast`, `Account.isPlatformAdmin`) | `app/xcore/auth/Account.ts` |
| The request's user and shop (`ctx(req)`) | `app/xcore/http/Context.ts` |
| Controllers | `app/controllers/Auth.Controller.ts`, `User.Controller.ts`, `Passkey.Controller.ts`, `Owner.Controller.ts` |
| Sign-in, password, forgot password | `app/services/settings/Auth.Service.ts` |
| Staff rules | `app/services/settings/User.Service.ts` |
| Self sign-up | `app/services/settings/Signup.Service.ts` |
| Invitations | `app/services/settings/Invite.Service.ts`, `app/repositories/Invite.Repository.ts` |
| Passkeys | `app/services/settings/Passkey.Service.ts`, `app/helpers/webauthn.ts` |
| Sales staff | `app/services/settings/SalesStaff.Service.ts`, `app/repositories/SalesStaff.Repository.ts` |
| Repositories | `app/repositories/User.Repository.ts`, `Session.Repository.ts`, `Passkey.Repository.ts`, `Owner.Repository.ts` |
| Validators | `app/validators/Auth.Validator.ts`, `User.Validator.ts`, `Passkey.Validator.ts` |
| Constants | `app/constants/Auth.Constant.ts`, `User.Constant.ts`, `Security.Constant.ts` |
| Emails | `app/emails/Invite.Email.ts`, `Reset.Email.ts`, `Confirm.Email.ts` (layout `resources/views/emails/link.edge`) |
| Pages before the app | `resources/js/Pages/Auth/Login.vue`, `Register.vue`, `Invite.vue`, `Confirm.vue`, `Forgot.vue`, `Reset.vue` |
| Pages in the app | `Settings/Index.vue`, `Users/Index.vue`, `Users/SalesStaff.vue`, `Owners/*.vue`, `Errors/Forbidden.vue` |
| Browser helpers | `resources/js/lib/auth.ts` (`useAuth()`), `lib/passkey.ts`, `lib/google.ts`, `lib/password.ts` |

The pages before the app share one frame: `components/AuthShell.vue`.

- The brand panel is on the left. It shows on wide screens only and has fixed colours.
- The page's own content is on the right. It is light or dark like the app.

## Login and sessions

People sign in with email and password, or with a passkey, or with Google or Microsoft.

- The platform admin is seeded from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- The password is only read on that first boot. After that it lives in the database, and `/settings` changes it.
- People can create their own account only while self sign-up is on (see below).

### Sign in

`POST /login` calls `AuthService.attempt`. It answers one of three things:

| Answer | What the form shows |
|---|---|
| the user | signed in |
| `"disabled"` (the account is switched off) | "This account has been disabled" |
| `null` | "These credentials do not match our records" |

An unknown email is checked against a throwaway hash. So "no such user" and "wrong password" take the same time.

On success `Auth.login(req, user)`:

1. Drops the session the browser arrived with.
2. Creates a `sessions` row. Its id is a random token from `randomToken(32)`.
3. Sets `shop_id` to the first shop of the user's account.
4. Sets the cookie `sid`: `httpOnly`, `sameSite=lax`, `secure` in production, 30 days (`SESSION_TTL_DAYS`).
5. Redirects to `/pos`.

A guest who was sent to `/login` from another page (`Guard.comeBack`) goes back to that page instead.

### Who is signed in

`Auth.current` works in this order:

1. The cookie.
2. A valid session.
3. An active user. A switched-off user counts as signed out.
4. The shop. It is the session's shop, but only while that shop belongs to the user's account. Else it is the account's first shop.

### Other routes

- `POST /logout` deletes the session row and the cookie. It redirects to `/login`.
- `GET /login` while signed in redirects to `/pos`.
- `GET /` on the main host redirects a signed-in user to `/pos` and everyone else to `/login`.
  An add-on may put a front page there with `Hooks.frontPage` (`app/xcore/hooks/Hooks.ts`).
- The "Go home" button of the not-found page leads to `/pos`.

## Passkeys

Everyone may sign in with a passkey: admins, managers, cashiers and the platform admin.
A passkey is a fingerprint, a face or a screen lock instead of the password.
The password keeps working.

Files:

- `app/helpers/webauthn.ts`: the WebAuthn checks. There is no package. `node:crypto` checks the signature.
- `app/services/settings/Passkey.Service.ts`, `Passkey.Controller.ts`, `Passkey.Repository.ts`, `Passkey.Validator.ts`.
- Browser side: `resources/js/lib/passkey.ts`.
- Table `passkeys` (migration 0071).

### Add a passkey

On `/settings` › **Passkeys**. The user types a name and the current password.

1. `POST /settings/passkeys/options {current_password}` checks the password.
   It answers 422 with `errors` when the password is wrong, or when the user already has `PASSKEY_MAX` = 10 passkeys.
   Else it answers the options for `navigator.credentials.create`.
2. The device makes the passkey.
3. `POST /settings/passkeys {name, client_data, authenticator_data, public_key}` saves it.

`DELETE /settings/passkeys/:id` deletes one of your own.

The list shows the name, the date added and the last use. It never shows the key.

### Sign in with a passkey

On `/login` › **Use a passkey**. The button shows only where the browser has passkeys.

1. `POST /login/passkey/options` answers a challenge. No email is asked. The device offers the passkeys it holds for the site.
2. `POST /login/passkey {id, client_data, authenticator_data, signature}` calls `PasskeyService.login`.
3. The user gets the same session as with the password.

Every failure says the same: "This passkey did not work".
A switched-off account gets "This account has been disabled".

### What is checked

- The challenge is one the server made, for this purpose. A new passkey is bound to the user who asked.
- The challenge is not older than `PASSKEY_CHALLENGE_TTL_MS` (5 minutes).
- The challenge works once.
- The answer comes from the app's own origin (`Url.originOf(req)`). Set `APP_URL` in production.
- The answer comes from the app's hostname. This is the passkey's site, `rpId`.
- The device says the person was there **and** was verified (`userVerification: required`).
- The signature fits the stored key.
- A use counter that does not go up is refused.

### Limits and rules

- Challenges live in memory in `PasskeyService`, at most `PASSKEY_CHALLENGES_MAX`. This is fine for one server process.
- There is no attestation. Any device is accepted.
- A passkey belongs to the host it was made on. One made on `pos.example.com` does not work on another host.
- When the user changes their own password (they typed the current one), the passkeys stay.
- A **reset** by the emailed link deletes the user's passkeys.
- A new password set by **somebody else** on `/users` deletes the user's passkeys.
  The reason for both: whoever added a passkey before has no way back in.
- Deleting a user deletes their passkeys too.

Rate limits:

- The two options routes and the save sit in the `passkey` bucket.
- A failed `POST /login/passkey` uses the `login` budget, like a wrong password.

## Google and Microsoft sign-in

Staff can sign in on `/login` with **Continue with Google** and **Continue with Microsoft**.
Both go through the platform's own Firebase project.
The password and passkeys keep working.

The buttons on `/login` and `/register` are `components/ProviderButtons.vue`.

### On and off

- Google is on while `FIREBASE_API_KEY` is set.
- Microsoft also needs `FIREBASE_MICROSOFT=1`.
- The four `FIREBASE_*` values are the web config of the platform's Firebase project (`config/app.ts` › `firebase`). They are public values.
- A shop's online store has its own project (`shops.firebase_config`).

### How a sign-in works

1. **Browser**: `resources/js/lib/google.ts` loads the Firebase SDK on the first click. It opens the provider's pop-up and gets an ID token.
2. **Server**: `POST /login/google` or `POST /login/microsoft` (`AuthController`). Both use the login rate limit (`loginLimit`).
3. One rule decides: `AuthService.firebaseSignIn`. It asks `FirebaseApi.platformUser` about the token.

`firebaseSignIn` looks for the user in this order:

1. By the sign-in account itself: `users.firebase_uid` (migration 0087, unique).
2. By the email, but only when the provider **verified** the email.

It answers:

| Answer | Meaning |
|---|---|
| the user | signed in |
| `"disabled"` | the account is switched off |
| `"new"` | nobody has this sign-in account or its email |
| `null` | Firebase refuses the token, or the email belongs to an account this sign-in is not tied to |

### Verified emails

Firebase decides what "verified" means.

- Google emails are verified.
- Most Microsoft emails are not. Microsoft lets an account claim an email it never checked.

So an email that is not verified is never used to find a user.
Else a stranger could claim a staff member's email.

### Tying a sign-in account to a user

Every sign-in account has a fixed Firebase user id. It is kept in `users.firebase_uid`.
Nobody has to verify anything.

- **Sign-up** with an unverified email (most Microsoft accounts) ties the account.
  The steps are: Continue with Microsoft, then the shop, then in.
  The owner is confirmed at once, with no email. The next sign-in is one click.
- **Connect in settings**: `/settings` › **Microsoft account** (`components/MicrosoftConnect.vue`).
  It shows while Microsoft sign-in is on.
  It is for a user made with a password or Google, and for staff.
  1. The current password is checked first.
  2. Then the Microsoft pop-up opens.
  3. `POST /settings/microsoft {token, current_password}` (`passkey` bucket) calls `AuthService.connectProvider`.

  **Disconnect** is `DELETE /settings/microsoft`.
  One sign-in account ties to one user.
- An existing account is **never** connected by its email.
  Until it is connected in settings, the Microsoft button is refused and says so.
- The email on a Microsoft sign-up is only what Microsoft claims.
  Whoever really has that mailbox can take the account with "Forgot password".
  `resetPassword` clears `firebase_uid`. A sign-up take-over clears it too.
  The user connects it again in settings.

### More rules

- **Sign-in never makes an account.** `/login` only signs in.
- **No account yet, on `/login`**: `firebaseSignIn` answers `"new"`.
  While self sign-up is on, the login page keeps who signed in (`keepForSignup`, `sessionStorage`, read once) and opens `/register` at step 2, the shop.
  With sign-up off it is the usual refusal.
- **One Firebase user per email**: a Microsoft sign-in with an email that already signs in with Google is refused by Firebase (`auth/account-exists-with-different-credential`). The page says to use Google.
- **One answer**: every failure shows the same message. A switched-off account gets "disabled", like the password form.

### Sign-up with a provider

This works while self sign-up is on.

`/register` is two steps for everyone (`Auth/Register.vue`). The steps live in the browser only.

1. **Who you are.** The two buttons, or name + email + password and **Continue**.
   The password's length and the two password boxes are checked here.
2. **The first shop.** Name, currency and time zone. Who is signing up is shown above it. Then **Create account**.
   After a provider button the shop name starts as "<first name>'s Shop".

A server error on a box of step 1 brings the page back to step 1.

`POST /register/google` or `POST /register/microsoft` with `{token, shop_name, currency, timezone}` (in the `signup` bucket) calls `SignupService.registerProvider`:

- The name and email come from the provider.
- The owner is confirmed at once. There is no confirmation link, and outgoing email is not needed.
- The account gets a random password nobody knows. "Forgot password" sets a real one. A real one is needed to add a passkey.
- The taken-email rules are those of the password sign-up:
  an existing account and `ADMIN_EMAIL` are refused, and an unconfirmed sign-up with that email is taken over.

### Firebase console

- Switch the providers on under Authentication › Sign-in method.
- Add the app's host under Authentication › Settings › Authorized domains.

To show your own domain in the pop-up, set `FIREBASE_AUTH_DOMAIN` to a subdomain of yours, for example `auth.example.com`:

- The subdomain is a custom domain of the project's Firebase Hosting. That serves Firebase's `/__/auth/handler` page. No code of the app is involved.
- It must also be in Authorized domains.
- `https://auth.example.com/__/auth/handler` must be in the redirect URIs of the Google OAuth client and of the Microsoft (Azure) app.

### Tests

- `app/services/settings/__tests__/Auth.Service.test.ts` and `Signup.Service.test.ts`: the rules.
- `e2e/auth.spec.ts`: sign-in, both buttons.
- `e2e/r-signup.spec.ts`: sign-up.
- The e2e tests use a stand-in SDK (`fakeFirebase` in `e2e/helpers.ts`) and `e2e/fixtures/serve.ts` as Firebase.

## Forgot password

For everyone with an account: owners, managers and cashiers.
It needs outgoing email.

1. `/login` has a **Forgot password?** link under the password box. It opens `GET /forgot-password` (`Auth/Forgot.vue`).
2. `POST /forgot-password {email}` calls `AuthService.forgot`.
   - The page always says "Check your email", also for an unknown email. So nobody learns which emails have an account.
   - The email is sent after the answer. So the answer takes the same time.
   - While outgoing email is off the form says "We cannot send emails right now", for every email.
3. The email (`app/emails/Reset.Email.ts`, the link layout) holds `/reset-password/:token`. The link works for `RESET_TTL_HOURS` = 1 hour.
4. `GET /reset-password/:token` (`Auth/Reset.vue`) asks for the new password twice.
   A used or old link shows "This link does not work any more" and a button to ask for a new one.
5. `POST /reset-password/:token` calls `AuthService.resetPassword`:
   - the password is saved
   - the link stops working
   - **every device is signed out**
   - the user's passkeys and connected sign-in account are removed
   - the person is signed in

Rules:

- No link for an unknown email, a switched-off account, or a sign-up that was never confirmed. That person signs up again.
- One email per account every `RESET_WAIT_MINUTES` = 2 minutes (`InviteRepository.madeSince`). So a script cannot fill somebody's inbox.
- The token is a `user_invites` row, like an invitation's. Only its sha256 is stored.
- A user has one link at a time. So a new link ends the older one, and an open invitation too.
- A reset link also opens `/invite/:token`. That is fine: it is the same person, and that page sets a password too.
- Rate limits: `passwordForgot` (5 per 15 minutes) on the form, `passwordReset` (20 per 15 minutes) on the link's page.
- No migration. Texts: `forgot.*`, `reset.*`, `mail.reset_*`.

Tests: `app/services/settings/__tests__/Auth.Service.test.ts`, `e2e/r-signup.spec.ts`.

## Roles

- `users.role` is `admin`, `manager` or `cashier` (`ROLES` in `app/constants/User.Constant.ts`, most power first).
- `users.active` = false locks the account out. Its orders keep `user_id`.

### The middleware

| Middleware | Who gets through |
|---|---|
| `Guard.signedIn` | any signed-in user, confirmed or not |
| `Guard.confirmed` | a signed-in user with a confirmed email |
| `Guard.auth` | the same as `Guard.confirmed`. It also puts what `Hooks.plan` says on the context, for a banner. Nobody is locked out. |
| `Guard.manager` (inside `auth`) | managers and admins |
| `Guard.admin` (inside `auth`) | admins only |
| `Guard.platform` (inside `auth`) | the platform admin only |

When someone is refused:

- A `GET` gets the 403 page `Errors/Forbidden`.
- Anything else gets a bare 403.

`Account.atLeast(role, min)` in `app/xcore/auth/Account.ts` is the one rank check.
The search, the low-stock badge and `products.create()` for extensions use it.

A cashier's JSON answers lose their cost values (`Guard.auth`).

### What each role may do

| Role | May do |
|---|---|
| **Cashier** | Sell (`/pos`, checkout). Orders: read the list and the detail, print, set the delivery status, record a payment. Customers: full CRUD. Own settings. Switch shop. |
| **Manager** | Everything a cashier may, plus: products, stock, categories, uploads, payment methods, marketing, reports, and staff. For staff: **cashiers only** (see Staff management). |
| **Admin** | Everything, plus: shops CRUD, the online store settings, coupons, extensions, API keys, the shop's own email, refund and void, and making admins or managers. |

In the browser:

- `auth.user.role` is a shared Inertia prop.
- `AppLayout.vue` filters the nav by role (the `admin` and `manager` flags).
- `lib/search.ts` filters the ⌘K rows the same way (`forManagers()`).
- `useAuth()` gives `isAdmin` and `isManager`. `isManager` is true for admins too.

The server enforces the same split. Never rely on the UI alone.

## Accounts, owners and the platform admin

### Account

An account is an owner and their staff.

- `users.owner_id` = the owner a staff member works for. `null` = the user is an owner.
- `Account.id(user)` = `owner_id ?? id`.
- `shops.owner_id` = the account that owns the shop (migration 0052).

Everyone sees only their own account:

- the shop switcher and `/shops` (`ShopRepository.all`, `first`, `findOwned` with the owner id)
- `/users`
- ⌘K staff and shops
- the `staff.*` extension events (`emitAll(ownerId, …)`)

Another account's shop is a 404 on edit, update, delete and switch.
Another account's user is "User not found".

### The owner

The owner (`owner_id = null`) always stays an active admin.

- Nobody can demote, deactivate or delete them. The message is "The shop owner always stays an active admin".
- Their last shop cannot be deleted.
- Only the owner may edit the owner's row (email, password, name).
  Another admin gets "Only the shop owner can change the owner's account". So they cannot take over the owner's login.
- An email already in use is refused whatever its case. `emailTaken` compares lower-cased.

### The platform admin

The platform admin is the user whose email equals `ADMIN_EMAIL` (lower case).
`Account.isPlatformAdmin()` checks it. There is no database flag.
It also asks for an owner row (`owner_id` null) with the role `admin`.

They are also a normal owner of their own shops.

Only they get the `Guard.platform` routes:

| Page | Routes |
|---|---|
| Users `/owners` | see Users pages below |
| Outgoing Email `/email` | `GET`, `PUT`, `POST /email/test`. A shop's own email is `/shop-email`, for its admins. |
| Addresses `/postal-codes` | `GET`, `GET …/status`, `POST`, `POST …/cancel`, `DELETE …/:code`. The postal-code list is one for the whole platform. |
| Exchange rates `/exchange-rates` | `GET`, `PUT`, `POST …/refresh`. One rate table for every store. |
| Global Extensions `/admin/extensions` | the extension code of the whole platform |

Their sidebar links and ⌘K rows are hidden from everyone else.
The shared prop `auth.user.platform` hides those controls.

### A shop for a new person

Platform admin only.

1. `/shops/create` has an **Owner email** card.
2. A filled email calls `InviteService.createShopFor`. It makes:
   - a new owner (role admin, a random password nobody knows)
   - their shop
   - a `user_invites` row (the sha256 of the token, valid `INVITE_TTL_DAYS` = 7 days)
3. The invitation email goes through `MailService`.
4. `/shops` then shows the link with a **Copy** button. It also shows why the email failed, if it did (for example "Email is not set up yet").

Rules:

- An email already in use is refused.
- A plain owner who posts `owner_email` gets 403.

### Accepting an invitation

- `GET /invite/:token` shows `Auth/Invite.vue`: name, password, confirm.
  A used or expired link shows "This link does not work any more".
- `POST /invite/:token` sets the name and password, deletes the invitation and signs the person in. They land on `/pos`.
- Both routes sit in the `invite` rate-limit bucket.

### Users pages

`/owners`, sidebar Admin › Users. Platform admin only. Read-only, except for the campaign email limit.
The chain is `OwnerController` → `OwnerService` → `OwnerRepository`.

| Route | Page | What it shows |
|---|---|---|
| `GET /owners?q=&page=` | `Owners/Index.vue` | Every owner (`owner_id` null, never the online-store system user), newest first. Search by name or email. Per owner: the number of shops and staff, the last order in any of their shops, and an **Invited** badge while the invitation is still open. |
| `GET /owners/:id` | `Owners/Show.vue` | Their shops as cards (products, orders, sales in the shop's own currency, last order, online store on or off) and their staff. A staff member's id is a 404. |
| `GET /owners/:id/shops/:shop?preset=` | `Owners/Shop.vue` | One shop. See below. A shop of another owner is a 404. |
| `GET /owners/:id/shops/:shop/products?q=&page=` | `Owners/Products.vue` | Every product of that shop, read-only. Opened by **View all products** on the shop page. |

The **Campaign emails** card on `Owners/Show.vue`:

- It shows this month's campaign emails sent through the platform's email, and the owner's monthly limit.
- `PUT /owners/:id/campaign-limit {limit}` sets the limit. Empty = the default, `CAMPAIGN_EMAILS_PER_MONTH` = 1000. It is stored in `users.campaign_email_limit`.
- It is the only thing the admin changes on these pages.

The shop page `Owners/Shop.vue` shows:

- the shop's info
- all-time totals: products and how many are switched on, categories, customers, orders and how many are online, sales, refunds, first and last order
- the sales of a period from `ReportService.build`: net revenue, orders, average order, gross profit with the change against the previous period, a sales bar chart, top products, payment methods

Voided orders never count.

The products page is the same `ProductRepository.pageForShop` list the shop sees on `/products`:
photo, name, SKU / barcode, package and switched-off badges, categories, stock, and the price from the cheapest variant.
It is searched by name, SKU or barcode.

## Self sign-up

People can create their own account and first shop, without the platform admin.
It is **off** by default.

### The switch

- The platform admin turns it on or off on the Users page (`/owners`).
- It is in the dialog behind the gear button next to the search (`components/SignupSwitch.vue`).
- `PUT /owners/signup {enabled}` saves it. It is in the `Guard.platform` group, so others get 403.
- It is stored in `settings` under the key `signup` (`SIGNUP_SETTING_KEY`).
- `SignupService.enabled()` reads it.

### The page

`GET /register` shows `Auth/Register.vue`:

- name, email, password + confirm (minimum 8)
- the first shop's name
- currency (THB by default)
- time zone (the browser's zone by default)

`POST /register` calls `SignupService.register`. It makes:

- a new owner (role admin, `owner_id` null)
- their shop (`ShopService.create`, with the default payment methods)

Then the person is signed in and lands on `/pos`.

An add-on may add to the form with `Hooks.signup`: a note over the form, and a line that asks the person to agree to terms.
`Hooks.signedUp` is called once for every new owner.

### Email confirmation

- Sign-up is refused while outgoing email is off (`server.signup_needs_mail`). Nobody could confirm.
- `register` emails a link `/confirm/:token` (`SignupService.sendConfirmation` → `app/emails/Confirm.Email.ts`). It is valid for `INVITE_TTL_DAYS`.
- The owner is created with **`users.email_verified_at` null** (migration 0057).
  Everyone else is created confirmed: the seed, staff, invitations, older users.
- The link's token is a `user_invites` row, like an invitation's.
- A confirmation token never works as an invitation. `InviteService.invited` needs a confirmed user.
- An invitation token never works as a confirmation. `SignupService.confirm` needs an unconfirmed user.

Until the link is opened:

- `Guard.auth` shows `Auth/Confirm.vue` on every app page (GET, status 403).
- It answers 403 to everything else.
- The page says where the link went. It has **Resend email** and **Log out**.
- **Resend email** is `POST /confirm/resend` (`confirmResend` rate bucket). A new link replaces the old one.
- `/logout` and `/confirm/resend` use `Guard.signedIn`. So they work signed in, confirmed or not.

### Opening the link

`GET /confirm/:token` is a GET because it is opened from an email. The secret token guards it.

It sets `email_verified_at` and deletes the row, **only for the signed-in owner of the link** (`SignupService.confirm(token, userId)`).

Why: the link proves the mailbox and the session proves the password. Both must be the same person.
Without this, someone could sign up with another person's email, and a mail scanner that opens the link would confirm it.

| Who opens it | What happens |
|---|---|
| Signed out | The login page with "Sign in first. Then open the link in the email again". Nothing changes, whatever the link is. |
| Signed in, the link is theirs and valid | Confirmed. They go to `/pos`. |
| Signed in, the link is used, old or somebody else's | "This link no longer works" |
| Signed in and already confirmed (the link opened again) | They go to `/pos`. |

The link is built from `APP_URL` (`Url.originOf`).
Without it, the request's `Host` header is used, and anyone can fake that header.
So **production must set `APP_URL`**. Else a faked host could end up in the sign-up email.

### More rules

- While sign-up is off, `GET` and `POST /register` answer 404.
- A signed-in user on `/register` goes to `/pos`.
- The sign-up routes sit in the `signup` rate-limit bucket.
- An email already in use is refused.
- The `ADMIN_EMAIL` address is refused. Sign-up can never make a platform admin.
- The `ADMIN_EMAIL` address is also refused on `/users` (`UserService.create` and `update`), unless the edited user already holds it.
- `Account.isPlatformAdmin()` asks for an owner row (`owner_id` null).
  So a tenant can never make a platform admin, also not while no user row holds the address.
- `/login` shows a "Create an account" link only while sign-up is on.
  It is the `signup` prop from `AuthController.loginPage`. The login rate-limit page uses it too.

### An unconfirmed sign-up does not hold its email

Anyone could sign up with your email and never confirm it.

So when the email belongs to an owner who never confirmed, a new sign-up takes that account over (`SignupService.#takeOver`):

- the new name and password
- every session of the account signed out
- its one shop renamed, with the new currency and time zone
- a fresh link sent. The old link stops working.

The shop keeps its old slug.
A confirmed user's email stays refused.

## Settings (`/settings`)

One page for everyone. It has a section rail on the right:

- **Profile**
- **Printing**
- **Password**
- **Passkeys**
- **Microsoft account**, only while Microsoft sign-in is on

A section is deep-linkable with `?section=`. This is the same pattern as `/online-store`.

| Route | Body | Does |
|---|---|---|
| `PUT /settings/profile` | `{name}` | Renames the current user. |
| `PUT /settings/password` | `{current_password, password, password_confirmation}` | Checks the current password. Minimum 8 characters. Hashes the new one again. **Drops every other session** of that user (`SessionRepository.deleteOthers`). |

- **Printing** is the RawBT receipt toggle. See [pos-checkout.md](pos-checkout.md).
- **Passkeys**: the user's own passkeys, add and delete (see Passkeys above).
  Every render of the page carries `passkeys` (`AuthController.settingsPage`).
- The platform-wide outgoing email is not here. It has its own page `/email` (sidebar › Admin, platform admin only). See [email.md](email.md).

## Staff management (`/users`, managers and admins)

The page `Users/Index.vue` lists the account's owner and staff, without password hashes.
Each row has `activity` = orders rung up + voids + refunds + stock movements signed by the user.

### Add staff

- The form fills the password with a random 8-character one (`randomPassword()` in `resources/js/lib/password.ts`).
- It uses `crypto.getRandomValues`. It has no look-alike characters such as 0/O or 1/l/I.
- The password is shown as text with **Generate** and **Copy** buttons. So the admin can pass it on.

`POST /users {name, email, role, password}`:

- The password has a minimum of 8 characters.
- The email must be unique across the whole platform. It is the login.
- The new user joins the actor's account.

### Change staff

`PUT /users/:id {name, email, role, active, password?}`. An empty password keeps the old one.

Rules (`UserService.update`):

- You cannot demote or deactivate **yourself**.
- The **owner** cannot be demoted or deactivated by anyone ("The shop owner always stays an active admin"). So every account keeps one admin.
- A new password, or `active=false`, signs that user out everywhere (`deleteAllFor`).

### Managers

A manager may only add, change and delete **cashiers**, and may only give the Cashier role.
`UserService.#managerRefusal` answers "Managers can only add and change cashiers".

They still see every row.
The page greys out Edit, Active and Delete on admin and manager rows, and offers only the Cashier card.

### Delete staff

`DELETE /users/:id`:

- Not yourself.
- Not the owner.
- Only when `activity === 0`. Else the message says the user has sales history and to deactivate instead.
- The user's sessions, passkeys and API keys are dropped first.

Errors come back as Inertia props (`email`, `role`, `user`).

## Sales staff (`/users`, managers and admins)

Sales staff are the people who sell.
They are not users. They have no email and no password, and they can never sign in.

They belong to **one shop**.
The Staff page shows the sales staff of the active shop. Switch shop to see another shop's.

- Table `sales_staff` (migration 0072): `shop_id`, `name`, `commission`, `active`.
- `commission` is in hundredths of a percent: 0–10000 = 0%–100%.
- They are deleted with the shop.
- The Staff page has two tabs, **Staff** and **Sales staff**. The header's Add button follows the tab. `/users?tab=sales` opens the second tab.

### Routes

They are in the `Guard.manager` group. `UserController` handles them, always for the active shop.
They use `SalesStaffService` + `SalesStaffRepository`. The input is `SalesStaffInput`.

| Route | Does |
|---|---|
| `GET /sales-staff/:id` | the detail page |
| `POST /sales-staff` | add one |
| `PUT /sales-staff/:id` | change one |
| `DELETE /sales-staff/:id` | delete one |
| `POST /sales-staff/:id/pay` | pay the commission |

### At the POS

- The cashier may pick one in the checkout dialog. It is optional (`CheckoutInput.sales_staff_id`).
- `OrderService` checks they are active and belong to the shop. Then it saves `orders.sales_staff_id`.
- Nothing about the commission is saved on the order.
- `/orders?sales=<id>` only filters the order list by sales person. The numbers are on the sales person's own page.

### Detail page

`GET /sales-staff/:id?preset=&from=&to=` (`Users/SalesStaff.vue`). It opens from the name in the list.

The period filter is the one of `/reports` (`ReportService.resolveQuery`):
today, yesterday, 7 days, last week, this month, last month, this year, and custom From/To.
Days are the shop's days.

| On the page | What it is |
|---|---|
| **Sold** | The sum of `total − refunded` of their orders in the period. Voided orders are left out (`SalesStaffRepository.totals`). |
| **Commission** | Those sales × today's rate. |
| **Sales** | How many orders. |
| **Commission due** | What is not paid yet. It ignores the period (see below). |
| **Pay** button | Pays the commission. |
| **View orders** | Opens `/orders?sales=<id>`. |
| **Payment history** | The table of past payments. |

### Commission

The commission **due** is never stored. It is worked out each time it is shown:

1. The unpaid sales = the person's orders made after their last payment. Voided ones are left out.
2. `unpaid_sales` = the sum of `total − refunded` of those orders.
3. `due` = `unpaid_sales × commission ÷ 10000`, at **today's** rate.

Changing the rate changes what is due for every unpaid sale.

**Pay** is the Pay button on the list row or on the detail page. After a confirm it sends `POST /sales-staff/:id/pay`.

- The server works the amount out again.
- It writes one `sales_commissions` row. That row is the history: `amount`, `sales` (cents sold), `orders` (how many), `commission` (the rate paid at), `created_at` (when).
- With nothing due it is refused: "There is no commission to pay".

The **last payment date** is not a column.
It is the newest `sales_commissions.created_at` of that person.
So after a payment the amount due starts again from zero.

Known limits:

- A refund on a sale that was already paid does not take the commission back.
- Timestamps step by one second. A sale made in the very second of a payment is not counted.

### Deleting a sales person

Deleting one does two things, in one transaction:

- It deletes their payment history.
- It sets `orders.sales_staff_id` to null on their sales. The orders stay, with nobody named.

To keep the history, switch them off instead.
They leave the POS list, and old orders keep them.
