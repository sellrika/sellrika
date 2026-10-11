# Guide: get the Firebase keys for customer accounts

How a shop sets up its own Firebase project, so customers can sign in on its online store.

Customer sign-in on the online store runs through **the shop's own Firebase project**.
Firebase Authentication is free.
You need four values from the Firebase console.
You must also turn on each sign-in method you want to offer.
This takes about ten minutes.

Where the values go: **`/online-store` › Authentication** (admin only).

| Field in the app | Name in the Firebase console | Looks like |
|---|---|---|
| Web API key | `apiKey` | `AIzaSy…` |
| Auth domain | `authDomain` | `my-shop.firebaseapp.com` |
| Project ID | `projectId` | `my-shop` |
| App ID | `appId` | `1:123456789012:web:abc123def456` |

All four values are public. Firebase prints them in every customer's browser.

- You do not need a service account or a private key.
- Do not paste anything from **Service accounts**. The app never uses it.

## 1. Create a Firebase project

1. Open https://console.firebase.google.com and sign in with a Google account.
2. Click **Create a project** (or **Add project**).
3. Give it a name, for example your shop's name. Click **Continue**.
4. Google Analytics is not needed. You can switch it off.
5. Click **Create project**, then **Continue**.

## 2. Register a web app and copy the config

1. On the project's home page, click the **`</>`** (Web) icon under "Get started by adding Firebase to your app".
2. Type an app nickname, for example `Store`.
3. Leave **Firebase Hosting** unticked. Click **Register app**.
4. Firebase shows a code block with a `firebaseConfig` object. It looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy…",
     authDomain: "my-shop.firebaseapp.com",
     projectId: "my-shop",
     storageBucket: "my-shop.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123def456"
   };
   ```

5. Copy `apiKey`, `authDomain`, `projectId` and `appId` into the four fields on `/online-store` › Authentication.
   The other values (`storageBucket`, `messagingSenderId`) are not needed.
6. Click **Continue to console**.

Lost the block? Find it again:

1. Open **Project settings** (the gear icon next to "Project Overview").
2. Open **General** and scroll down to **Your apps**.
3. Pick the web app.
4. Open **SDK setup and configuration** › **Config**.

## 3. Turn on Authentication

1. In the left menu, click **Build** › **Authentication**.
2. Click **Get started**.
3. Open the **Sign-in method** tab.
4. Enable each provider you want to switch on in the app (see below).

### Email & password

1. Click **Email/Password**.
2. Switch **Enable** on. Click **Save**.
3. Leave **Email link (passwordless sign-in)** off. The app does not use it.

New accounts must verify their email before they can sign in.
Firebase sends that email itself.
You can change the wording under **Authentication › Templates**.

### Google

1. Click **Google**. Switch **Enable** on.
2. Pick a **Project support email** from the list.
3. Click **Save**. Nothing else is needed.

### Microsoft

Microsoft needs an app registered in Azure first.

1. Open https://portal.azure.com › **Microsoft Entra ID** › **App registrations** › **New registration**.
2. Name it.
3. Choose **Accounts in any organizational directory and personal Microsoft accounts**. Register it.
4. Copy the **Application (client) ID** from the Overview page.
5. Go to **Certificates & secrets** › **New client secret**.
6. Copy the secret **Value** right away. It is shown once.
7. Back in the Firebase console: **Sign-in method** › **Microsoft**. Switch **Enable** on. Paste the client ID and the secret.
8. Firebase shows a redirect URL like `https://my-shop.firebaseapp.com/__/auth/handler`. Copy it.
9. In Azure: **Authentication** › **Add a platform** › **Web**. Paste that URL as the redirect URI. Click **Configure**.
10. Click **Save** in Firebase.

## 4. Allow the store's domain

Firebase only lets a sign-in pop-up open from domains it knows.

1. Open **Authentication** › **Settings** tab › **Authorized domains** › **Add domain**.
2. Add the host your store runs on, for example `my-shop.shop.example.com`.
3. If the shop has its own domain, add that too.

`localhost` is already there for local testing.

## 5. Switch it on in the app

1. Open **`/online-store`** › **Authentication** as an admin.
2. Paste the four values from step 2.
3. Switch on the same providers you enabled in step 3.
4. Click **Save**. The save refuses a provider while any of the four fields is empty.
5. Open the store. A **Sign in** button now shows in the header.

## Check it works

1. Open the store in a private window and click **Sign in**.
2. Sign in with Google. Or create an email account and click the link in the verification email.
3. The header now shows your account. **My account** lists your orders.

## Common problems

| What you see | Cause | Fix |
|---|---|---|
| No **Sign in** button on the store | A field is empty or no provider is on | Fill all four fields and switch a provider on, then save |
| "This site is not on the Firebase project's authorised domains yet" (`auth/unauthorized-domain`) | The store's domain is not on Firebase's list | Step 4 |
| "This way of signing in is not switched on in Firebase yet" (`auth/operation-not-allowed`) | The provider is on in the app but off in Firebase | Step 3 |
| "Could not verify the sign-in — please try again" | The Web API key is wrong, or from another project | Copy `apiKey` again from step 2 |
| "Verify your email address first — we sent you a link" | The link in the verification email was not clicked | Click the link, or use **Send the link again** in the dialog |
| Microsoft says the reply URL does not match | The redirect URI in Azure differs from what Firebase shows | Step 3 › Microsoft › 8–9 |

Where the rules live in code: [features/online-store.md](../features/online-store.md) › Authentication.
