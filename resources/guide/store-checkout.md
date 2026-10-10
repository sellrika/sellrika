# Store checkout

This guide is about how buyers pay and get their order in the online store. You set it up in the sidebar under **Settings › Online Store**, on the tabs **Payments**, **Delivery** and **Authentication**.

## How to take online payments (Stripe, Omise, 2C2P, PayPal)

An online payment provider is an extension. You need an account with the provider and its keys.

1. Open **Settings › Online Store › Payments**.
2. Look at the list under **Payment extensions**. Each row shows a provider and a badge: **Not installed**, **Needs setup** or **Ready**.
3. Click **Configure** on the provider you want.
4. Fill in the keys from your provider account. The **Read more** link in the dialog opens the provider's help page.
   - Stripe: **Publishable key** (starts with `pk_`) and **Secret key** (starts with `sk_`).
   - Omise: **Public key** (starts with `pkey_`) and **Secret key** (starts with `skey_`).
   - 2C2P: **Environment** (**Production** or **Sandbox**), **Merchant ID** and **Secret key**.
   - PayPal: **Environment** (**Live** or **Sandbox**), **Client ID** and **Secret key**.
5. Keep the **Enabled** switch on and click **Save**. The badge changes to **Ready**.

You can also turn a provider on or off with the switch on its row. If the keys are missing, the dialog opens first.

The same list is on **Settings › Extensions**, with the same **Configure** dialog.

## How to offer cash on delivery

1. Open **Settings › Online Store › Payments**.
2. In the table **Manual option**, turn on the switch in the **Cash on delivery** row.
3. Click **Save settings**.

There is nothing else to set up.

## How to offer bank transfer

1. Open **Settings › Online Store › Payments**.
2. Click **Configure** in the **Bank transfer** row.
3. Type your **Bank details**: bank name, account name, account number. The buyer sees this text at the checkout and in the order email.
4. Click **Save**.
5. Turn on the switch in the **Bank transfer** row and click **Save settings**.

Bank transfer needs the bank details. Without them the page does not save and opens the dialog again.

## How to record the money for an unpaid order

Cash on delivery, bank transfer and "Send order" orders arrive unpaid. When the money comes in, record it.

1. Open **Sales › Orders** and open the order. It has the badge **Unpaid**.
2. Click **Record payment**.
3. Enter what the customer paid and confirm.

You can record a part of the amount now and the rest later.

## What happens when no payment option is on

If no payment extension is running and no manual option is on, the store has no checkout step.

- The button in the cart says **Send order**, not **Checkout**.
- The buyer is not asked for a name, an address or a payment.
- The order arrives at once as unpaid, with the payment method **Pay later**. There is no delivery fee on it.
- You record the money later on the order page (see above).

When you switch on any payment option, the button says **Checkout** again.

## How to set a delivery fee (shipping zones)

A zone is a group of countries with one delivery price. A new shop starts with one free zone for every country.

1. Open **Settings › Online Store › Delivery**.
2. Pick your shop's **Country**. The checkout starts with this country.
3. Under **Shipping zones**, click **Add zone**. To change a zone, click its pencil icon.
4. Type a **Zone name**, for example "Domestic".
5. Pick the **Countries**. Leave it empty for a rest-of-world zone. That zone covers every country no other zone lists.
6. Optional: pick **States / provinces** or **Cities** to make the zone smaller. Leave both empty for the whole country.
7. Type the **Delivery price**, for example 5 for $5. Type 0 for free delivery.
8. Click **Save zone**. The zone is saved at once and shows in the table.

To remove a zone, click its bin icon. It is removed at once.

Example: one zone "Bangkok" with the state Bangkok at $2, one zone "Thailand" with the country Thailand at $5, and one zone with no countries at $20. A buyer in Bangkok pays $2. A buyer elsewhere in Thailand pays $5. A buyer in any other country pays $20.

## How to give free delivery from an amount

1. Open **Settings › Online Store › Delivery**.
2. Click the pencil icon on the zone.
3. Type the amount in **Free delivery from**, for example 50 for $50. Leave it empty for no free delivery.
4. Click **Save zone**.

Orders in that zone with goods of $50 or more are then delivered free. The amount is counted before any discount code. The table shows the amount in the **Free from** column.

## How to let buyers pick up in store

1. Open **Settings › Online Store › Delivery**.
2. Turn on **Pick up in store**.
3. Click **Save delivery**.
4. Open the **Banner & contact** tab, fill in **Address** and click **Save settings**. The checkout shows this address as the place to collect the order.

At the checkout the buyer answers "How would you like to get it?" with **Delivery** or **Pick up in store**. With pick-up there is no delivery fee and no address is asked. Cash on delivery is shown as **Pay at pick-up**.

## How to use address lists at the checkout (guided addresses)

With address lists, the buyer picks the state and then the city from a list. The postal code fills in by itself.

1. Open **Settings › Online Store › Delivery**.
2. Turn **Address lists at the checkout** on or off.
3. Click **Save delivery**.

The lists work only for countries whose cities are downloaded. The platform admin downloads them on **Admin › Addresses**. For other countries the checkout shows plain text boxes. Turn the switch off if the list for your country is not good enough.

## How to let customers sign in (customer accounts)

Customers can sign in to see their past orders and keep their name, phone and delivery addresses. Sign-in runs through your own Firebase project. Firebase Authentication is free.

In the Firebase console (console.firebase.google.com):

1. Create a project.
2. On the project's home page, add a web app (the `</>` icon). Firebase shows a `firebaseConfig` block. Keep it open.
3. Open Build › Authentication, click Get started, and open the Sign-in method tab.
4. Enable each way of signing in you want: Email/Password, Google, Microsoft. Google needs a support email. Microsoft needs the client ID and secret of an app registered in Azure.
5. Open Authentication › Settings › Authorized domains. Add your store's address, and your own domain if you use one.

In Sellrika:

1. Open **Settings › Online Store › Authentication**.
2. Under **Firebase web app**, fill in the four values from the `firebaseConfig` block:
   - **Web API key** = `apiKey`
   - **Auth domain** = `authDomain`
   - **Project ID** = `projectId`
   - **App ID** = `appId`
3. Turn on the same ways of signing in: **Email & password**, **Google**, **Microsoft**.
4. Click **Save settings**.
5. Open the store. A **Sign in** button now shows in the header.

To switch customer accounts off, turn all three switches off and save.

## Good to know

- Only an admin can change these settings. Recording a payment on an order is open to every role.
- Only one online provider runs at a time. Switching one on switches the other off.
- The manual options can be on next to the online provider. The buyer then chooses under **Pay with**. The online provider is shown as "Credit card and other payment methods".
- With an online provider the button is **Pay**. With a manual option it is **Place order**, and the order arrives unpaid.
- Provider secret keys are stored safely and are never shown again. Leave a secret box blank to keep the saved key.
- If **Payment extensions** shows no provider, the platform admin has not offered one to your shop yet.
- Extension settings save at once from their own dialog. The manual options save with **Save settings**. Zones save with **Save zone**. The country, pick-up and address lists save with **Save delivery**.
- With no zones, nothing can be delivered. A country in no zone cannot order delivery. The buyer sees "We don't deliver to" and the place name.
- A place can be in one zone only. The most exact zone wins: a city zone beats a state zone, a state zone beats a country zone, a country zone beats the rest-of-world zone.
- Delivery is never taxed. Sales at the till have no delivery fee.
- A signed-in customer's checkout is filled in from the account. Their email cannot be changed there. Their saved addresses show under **Saved addresses**, and a new address is kept when **Save address for next order** is ticked.
- A customer who makes an account with email and password must click the link in Firebase's verification email before they can sign in.
- A customer finds their orders and addresses under **My account** in the store. An account can hold up to 10 addresses.
- If the sign-in window shows `auth/unauthorized-domain`, the store's address is missing in Firebase's Authorized domains. If it shows `auth/operation-not-allowed`, that way of signing in is off in Firebase.
- A buyer who pays online and closes the page before coming back still gets the order. The app asks the provider again within a few minutes.
