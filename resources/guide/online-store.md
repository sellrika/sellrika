# Online store setup

The online store is a public web page where people buy this shop's products. You set it up in the sidebar under **Settings › Online Store**. The page has a list of tabs named **Manage**: **General**, **Template**, **Banner & contact**, **Delivery**, **Languages**, **Currencies**, **Payments**, **Authentication**, **Alerts** and **Pages**.

This guide covers the store's address, look, texts, languages, currencies, analytics, alerts and order tracking. Payments, delivery and customer sign-in are in the guide "Store checkout".

## How to switch the store on

1. Open **Settings › Online Store**. The **General** tab opens first.
2. In the **Public storefront** box, turn on the switch next to **Store is off**. The label changes to **Store is live**.
3. Click **Save settings**.
4. Click the open-link icon next to **Store URL** to see your store.

To close the store, turn the switch off and click **Save settings**. Visitors then see a "not found" page.

## How to change the store's address (free subdomain)

Every store has a free address. It is made of a short name and a fixed ending, for example `my-shop.shop.sellrika.com`.

1. Open **Settings › Online Store › General**.
2. Type the short name in the **Store URL** box. The full address is shown under the box.
3. Click **Save settings**.

Rules for the short name:

- Lowercase letters, numbers and dashes only.
- 3 to 50 characters.
- No other shop may use the same name.
- Some names are kept for the system (for example `www`, `mail`, `shop`). The page says "This name is kept for the system. Pick another one."

Use the copy icon next to the box to copy the store link.

## How to use your own domain

You can open the store on a domain you own, like `shop.example.com` or `example.com`. The free address keeps working too.

1. Open **Settings › Online Store › General**.
2. Type your domain in **Custom domain (optional)**. Type only the name, for example `shop.example.com`.
3. Click **Save settings**. A box appears with the status **Waiting for DNS** and a table of DNS records.
4. Open the website where you bought the domain. Go to its DNS settings.
5. Add the records from the table. Copy each **Value** with the copy icon next to it.
   - For a subdomain like `shop.example.com`: add the **CNAME** record.
   - For a root domain like `example.com`: add the **A** record.
   - Always add the **TXT** record. Its name starts with `_sellrika.` followed by your domain. It proves the domain is yours. The store does not go live without it.
6. Come back to the page and click **Check now**.
7. When the status shows **Live**, the store opens on your domain. SSL (https) is set up for you.

If the status stays **Waiting for DNS**:

- Read the line under the table. It says what your domain points at now, or "Your domain does not point anywhere yet."
- Delete any other A or AAAA record with the same name.
- On Cloudflare, set the record to "DNS only" (grey cloud).
- To use `www` too, add the same record for `www`.
- A DNS change can take a few hours. The app checks again every 5 minutes, so you do not have to click **Check now** each time.

## How to pick a template

A template is the look of the store.

1. Open **Settings › Online Store › Template**.
2. Click one of the looks: **Editorial**, **Minimal**, **Soft**, **Sunday**, **Noir** or **Lumen**. A short line under each name says how it looks.
3. Click **Save settings**.

You can switch any time. Your products, pages and settings stay the same. The checkout page keeps working with every template.

## How to change a template's colors and font

Each built-in template can use your own colors and font.

1. Open **Settings › Online Store › Template**.
2. Click the small settings button in the corner of a template's card. A box named **Customize** and the template's name opens.
3. Under **Brand colors**, pick a **Primary color**. It is the color of the main buttons, also on the checkout page.
4. Pick a **Secondary color**. It is the template's second color: highlights, badges and picked options.
5. Under **Page**, pick a **Background color**. It is the page behind everything.
6. Pick a **Text color**. It is the color of the words on the page. Pick one that is easy to read on your background.
7. Pick a **Small text color**. It is the color of hints, labels and other small text. If you leave it empty, it is a softer shade of the text color.
8. Under **Cards**, pick a **Card background**. It is the color of product cards, boxes and panels.
9. Pick a **Card text**. It is the color of the words on cards.
10. Under **Footer**, pick a **Footer background**. The footer is the block at the bottom of every page.
11. Pick a **Footer text**. It is the color of the words and links in the footer.
12. Pick a **Font** from the list.
13. Click **Save**. It is saved at once. You do not need **Save settings**.

- Leave a box empty to keep the template's own color or font. **Clear** empties one color.
- **Reset** empties everything. Then click **Save**.
- Each template keeps its own colors and font. A changed template shows **Customized** on its card.
- The text on a button turns black or white by itself, so it stays easy to read. So do the card text and the footer text while their boxes are empty.
- The **Minimal** template has no cards. There the card colors show only on the checkout and order pages.

## How to show an announcement banner

The banner is one short line above the store's header. Use it for a sale, a holiday closure or free delivery.

1. Open **Settings › Online Store › Banner & contact**.
2. Type the line in **Banner text** (up to 200 characters).
3. Pick a **Banner type**: **Info**, **Success**, **Warning** or **Danger**. The type sets the colour.
4. Click **Save settings**.

To remove the banner, clear **Banner text** and save.

## How to add contact details

Contact details are shown in the store's footer. Every field is optional. An empty field is not shown.

1. Open **Settings › Online Store › Banner & contact**.
2. In the **Contact** box, fill in what you want:
   - **Support email**: printed on order emails so customers know where to write. Empty means the owner's account email.
   - **Phone**, **Address** and **Opening hours**.
   - **Facebook** and **Instagram**: the full link, starting with `https://`.
   - **Viber** and **WhatsApp**: a phone number with the country code.
3. Click **Save settings**.

## How to choose the store's languages

1. Open **Settings › Online Store › Languages**.
2. Turn on the switch for each language the store offers: **English**, **Deutsch**, **ไทย**.
3. Click **Make default** next to the language a visitor gets when their own language is not offered. It gets the **Default** badge.
4. Click **Save languages**.

Visitors change the language with the switcher in the store's footer. If you offer only one language, the switcher is hidden.

## How to show prices in other currencies

1. Open **Settings › Online Store › Currencies**.
2. Pick a currency in the list and click **Add currency**.
3. Each currency row shows the automatic rate, like "Automatic: 1 USD = 0.92 EUR".
   - Leave the rate box blank to use the automatic rate.
   - Type your own rate to fix it.
4. Click **Save currencies**.

Visitors then pick a currency in the **Currency** list in the store's header. To remove a currency, click the bin icon on its row and save.

## How to connect Google Analytics or Meta Pixel

1. Open **Settings › Online Store › General** and find the **Analytics** box.
2. For Google Analytics, paste your GA4 measurement ID in **Google Analytics**. It looks like `G-XXXXXXXXXX`. You find it in Google Analytics under Admin › Data streams.
3. For Meta, paste the dataset (pixel) ID in **Meta Pixel**. It is a number. You find it in Meta Events Manager.
4. Click **Save settings**.

Both are optional. Leave a box blank to keep that one off.

## How to get the store into Google

1. Open **Settings › Online Store › General** and find the **Google Search Console** box.
2. In Google Search Console, add your store's address as a "URL prefix" property and choose the HTML tag method.
3. Paste the tag in **Verification (optional)** and click **Save settings**.
4. Go back to Search Console and press Verify.
5. Copy the link under **Sitemap** and submit it in Search Console under Sitemaps.

## How to show your products on Google Shopping, Facebook, Instagram and TikTok

1. Open **Settings › Online Store › General** and find the **Product feed** box.
2. Copy the link in it.
3. Add the link as a data feed in Google Merchant Center, Meta Commerce Manager or your TikTok catalog.

You do this once. They read the link again by themselves, so prices and stock stay up to date.
A product with no picture is left out.

## How to get an alert for each new online order

1. Open **Settings › Online Store › Alerts**.
2. For email: type the address in **Alert email**.
3. For Telegram:
   - Create a bot with @BotFather in Telegram. Paste its token in **Telegram bot token**.
   - Send the bot any message, or add it to a group.
   - Type that chat's ID in **Telegram chat ID**. The bot @userinfobot tells you your own ID.
4. Click **Save settings**.

You can use email, Telegram, or both. Leave a field blank to keep that channel off. The alert shows the order code, the total, whether it is paid, the items and the delivery details.

## How buyers track an order

Every online order has an order code, like `P8J4-MJSQ-4Z8T`. The buyer sees it on the thank-you page and in the order emails.

1. The buyer clicks **Track order** in the store's footer.
2. They type the **Order code** and the **Email or phone number** they ordered with.
3. They click **Find my order**.

The page shows if the order is paid, the delivery progress, the tracking number, the items and the delivery address.

To update what the buyer sees:

1. Open **Sales › Orders** and open the order.
2. In the **Delivery** box, pick the **Status** and, if you have one, type the **Tracking number**.
3. Click **Save delivery status**. Marking an order shipped emails the customer, with the tracking number.

## Good to know

- Only an admin can open **Settings › Online Store**. Managers and cashiers do not see it.
- The settings are per shop. Switch to the right shop before you change them.
- **Save settings** saves the General, Template, Banner & contact, Payments, Authentication and Alerts tabs together. Delivery, Languages and Currencies each have their own save button.
- The store address is never shown on the main Sellrika site. Each store opens only on its own address.
- A custom domain that is still **Waiting for DNS** is not reserved. Once it is **Live**, no other shop can use it.
- Other currencies are for display only. The checkout, the payment, the orders and the emails always stay in the shop's own currency. The checkout shows a note like "About £9. You pay in USD."
- A currency with no automatic rate and no rate of your own is not offered to visitors. You can add up to 20 currencies.
- The Telegram bot token is stored safely and is never shown again. Leave the box blank to keep the saved one.
- Email alerts and order emails are sent only when email is set up for the shop (**Settings › Shop Email**) or for the platform.
- Sales made at the till (the Sell screen) send no alert. Alerts are for online orders only.
- Tracking never shows which part was wrong. If the code or the email/phone does not match, the buyer only sees that the order could not be found.
- Custom pages, like About us or Terms of Use, are made on the **Pages** tab with **New page**. Each page gets a link in the store's footer.
