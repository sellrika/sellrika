# Settings

This guide covers your shops, tax, payment methods for the till, the shop's email, extensions, keys for AI assistants, and your own profile.
Most pages are in the sidebar under **Settings**. Your own profile is in the user menu: press your name at the bottom of the sidebar.

## How to switch shop

1. Press the shop name at the top of the sidebar.
2. Under **Switch shop**, press the shop you want.
3. The app opens the **Sell** screen of that shop.

On a phone, press the round button with your initials at the top right. The shops are under **Switch shop**.

## How to add a new shop

1. Press the shop name at the top of the sidebar, then **Manage shops…**.
2. Press **New shop**.
3. Type the **Name**.
4. Click the square next to the name to add a logo. This is optional.
5. Pick the **Currency** the shop sells in, and the **Time zone**.
6. Press **Create shop**.

A new shop starts with three payment methods: Cash, Card and Other.

## How to change a shop's name, logo, currency or time zone

1. Press the shop name at the top of the sidebar, then **Manage shops…**.
2. Press **Edit** on the shop.
3. Change the **Name**, the **Currency** or the **Time zone**.
4. To change the logo, click the square with the logo and pick a picture. To take it away, press **Remove**.
5. Press **Save**.

The currency formats every price. The time zone decides what "today" is on Orders and in Reports.

## How to set Tax / VAT

1. Press the shop name at the top of the sidebar, then **Manage shops…**.
2. Press **Edit** on the shop and go to the **Tax / VAT** card.
3. Type the **Tax rate** in percent. 0 means no tax line.
4. Type the **Tax label**, for example VAT, GST or Sales tax. This is how the line reads on receipts.
5. Set **Prices include tax**. On: the tax is shown as a part of the price and the total does not change. Off: the tax is added on top of the total.
6. Press **Save**.

## How to delete a shop

1. Press the shop name at the top of the sidebar, then **Manage shops…**.
2. Press the bin button on the shop.
3. Press **Delete** to confirm.

## How to add a payment method for the till

These are the ways a customer pays at the till, like Cash or Card. The page is in the sidebar under **Catalog › Payments**.

1. Open **Catalog › Payments**.
2. Press **Add payment method**.
3. Type the **Name**, for example PromptPay.
4. Pick an **Icon** and a **Color** if you want. The badge next to the title shows how it will look.
5. Switch on **Ask for the amount given** if the cashier should type the money received. The till then shows the change. Leave it off when the customer pays the exact amount.
6. To show a picture to the customer, for example a QR code to pay, press **Upload picture**. The customer screen shows it while you take the money with this method.
7. Press **Add**.

## How to change, switch off or delete a payment method

1. Open **Catalog › Payments**.
2. To change it, press the pencil button on its row. Change the name, icon, colour, **Ask for the amount given** or the picture. Press **Save**.
3. To take the picture off, press the pencil button, then **Remove** next to the picture, then **Save**.
4. To switch it off, turn off its switch on the row. It no longer shows at the till. Old orders still show it.
5. To delete it, press the bin button and then **Delete**.

## How to set up Shop Email

A shop can send its email through its own mail account. Without it, the shop's email goes out through Sellrika's email.

1. Open **Settings › Shop Email**.
2. Under **Sender**, type the **From address**. Customers see this address as the sender.
3. Pick one provider card: **SMTP**, **Resend** or **Azure Communication Services**.
4. Fill in its fields. SMTP asks for **Host**, **Port**, **Username** and **Password**. Resend asks for an **API key**. Azure asks for a **Connection string**.
5. In that card, set the delivery box to **Enabled**.
6. Press **Save email settings**.
7. To check it, press **Send test**, type an address in **To**, and press **Send test**.

## How to switch on and set up an extension

Extensions are add-ons for a shop, for example a payment provider for the online store.

1. Open **Settings › Extensions**.
2. Find the extension in the list. The **Status** column shows **Ready** or **Needs setup**.
3. Turn on the switch in the **Enabled** column.
4. If the extension still needs settings, its dialog opens. Fill in the fields and press **Save**.
5. To change the settings later, press **Configure** on its row, change the fields and press **Save**.
6. To switch it off, turn the same switch off.

## Where an extension's own guide is

An extension can bring its own guide. It is a topic of this guide, named like the extension (for example `restaurant`).
The topic is there only while the shop runs the extension. The list of topics shows it.

## How to make an MCP & API key

A key lets an AI assistant or your own program read and change one shop.

1. Switch to the shop the key is for.
2. Open **Settings › MCP & API keys**.
3. Press **Create key**.
4. Type a **Name**, so you know later what the key is for.
5. Pick the **Role**. **Admin**: everything, with refunds and coupons. **Manager**: products, stock, reports and marketing. **Cashier**: create and read orders.
6. Press **Create key**.
7. The dialog **Your new key** shows the key. Press **Copy** and keep it in a safe place.
8. Press **Done**.

The key is shown only once. If you lose it, delete it and make a new one.

## How to connect an AI assistant

There are two ways. Both start the same:

1. Open **Settings › MCP & API keys**.
2. In the **MCP server** box, press the copy button to copy the server address.
3. Press **How to connect** to see an example for each way.

### Way 1: sign in (no key needed)

Use this when your assistant can sign in by itself.

1. Add the server address to your assistant.
2. The assistant opens a Sellrika page. Sign in if it asks.
3. Check the assistant's name and the shop.
4. Pick the **Role**, then press **Allow**.

The assistant now shows as a key on **Settings › MCP & API keys**. Delete that key to stop it. Only an admin can allow an assistant.

### Way 2: with a key

Use this when your assistant cannot sign in.

1. Create a key (see above).
2. Add the server address to your assistant, with your key in the `X-API-Key` header. Put only the key there, with no `Bearer` in front.

## How to delete a key

1. Open **Settings › MCP & API keys**.
2. Press the bin button on the key's row.
3. Press **Delete** to confirm. Programs that use the key stop working at once.

## How to change your name or password

1. Press your name at the bottom of the sidebar, then **Settings**.
2. For the name: open **Profile**, type the new **Name** and press **Save name**.
3. For the password: open **Password**. Type the **Current password**, the **New password** and **Confirm new password**. Press **Update password**.

## How to add a passkey

A passkey lets you sign in with your fingerprint, face or screen lock. Your password keeps working.

1. Press your name at the bottom of the sidebar, then **Settings**.
2. Open **Passkeys**.
3. Type a **Passkey name**, for example "My laptop".
4. Type **Your current password**.
5. Press **Add a passkey** and follow the steps your device shows.

Next time, press **Use a passkey** on the sign-in page. To remove a passkey, press the bin button next to it.

## How to change the language or the colours

1. Press your name at the bottom of the sidebar.
2. Press **Language** and pick **English**, **Deutsch** or **ไทย**.
3. Press **Theme** and pick **Light**, **Dark** or **System**.

## How to reset a forgotten password

1. On the sign-in page, press **Forgot password?**.
2. Type the **Email** of your account and press **Send the link**.
3. Open the email and press the link. The link works for 1 hour.
4. Type the **New password** and **Confirm new password**.
5. Press **Save and sign in**.

## Good to know

- **Who may do what**: only admins can add, change or delete shops, and open **Shop Email**, **Extensions** and **MCP & API keys**. Managers and admins can open **Payments**. Every role can switch shop and change their own profile.
- Deleting a shop removes the shop and everything in it. It can not be undone.
- You can not delete your last shop. You can not delete a shop that still has products. Delete or move its products first.
- **Tax**: the tax is worked out on the goods after any discount. Delivery is not taxed. Old orders keep the tax they were made with.
- **Payment methods**: keep at least one. An order keeps the name of its payment method, so a rename or a delete does not change old sales. Payments for the online store are set up under **Online Store › Payments**.
- **Shop Email**: only one provider delivers at a time. Passwords and keys are never shown again. Leave such a box blank to keep the saved value.
- **Extensions**: the list shows only the extensions Sellrika offers to your shop. An extension is set up per shop.
- Only one payment extension can be on at a time. Switching one on switches the other off.
- **Keys**: a key works in one shop only. A shop can have at most 20 keys.
- A key can never do more than the person who made it. It stops working when that person is deactivated or deleted.
- **Password**: at least 8 characters. Changing it logs out your other devices.
- **Passkeys**: you can keep up to 10.
- **Receipt printing**: under **Settings › Printing** in the user menu you can switch on **Print straight to a thermal printer** and pick the **Paper width**. This is for this device only.
- **Forgot password**: after the new password is saved, every device is signed out and you are signed in. You can ask for a new link every 2 minutes.
