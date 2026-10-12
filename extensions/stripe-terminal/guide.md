# Stripe Terminal

Take card payments at the till with a Stripe card reader. The cashier picks **Card reader** in a pay dialog, the customer taps their card, and the sale is paid.

**Not yet tested on real hardware.** It was built and tested with Stripe's simulated reader only. If you have a reader, please try it with a small amount first and tell us how it went.

## Which readers work

- **BBPOS WisePOS E** and **Stripe Reader S700**. These readers have their own internet connection.
- The Bluetooth readers (Stripe Reader M2 and its like) do **not** work. They need a mobile app.
- Stripe Terminal is not sold in every country. Your Stripe account must be in a country that has it, and your shop's currency must be one the reader takes.

## Set it up

1. In your **Stripe Dashboard**, open **Terminal** and register your reader. Give it a name you will know ("Front till").
2. In the app, open **Settings › Extensions**.
3. On **Stripe Terminal**, press **Configure** and paste your Stripe **Secret key** (it starts with `sk_`).
4. Save, then switch the extension on.
5. A payment method named **Card reader** now shows on **Catalog › Payments**. You can rename it or change its icon and colour there.

You never type a reader ID. The app reads your readers from Stripe.

## Take a payment

1. On the Sell screen, ring up the sale and press **Charge**.
2. Pick **Card reader**. A box for the reader opens next to the dialog.
3. If you have more than one reader, pick the one at this till. The browser remembers it.
4. Press **Send to reader**. The reader shows the amount.
5. The customer taps, inserts or swipes their card.
6. The box shows **Approved** and the sale is completed by itself. You do not press the confirm button.

The confirm button stays off until the card is approved.

- **Card declined**: the box shows the reason. Press **Try again**, or pick another payment method.
- **Cancel** clears the reader.
- An **offline** reader is shown as off in the list. Switch it on and check its internet, then press **Look again**.

It works the same way in **Record payment** on an order and in the Restaurant's **Pay** dialog.

## When the money is taken

The reader first only **holds** the money on the card. The money is taken at the moment the order is saved. So there is never money without an order.

- If you close the dialog after the card was approved, the hold is let go.
- If the browser crashed, the hold ends by itself at Stripe after a few days. Nothing is taken.
- Taking the money can fail (no internet for a moment). The order page then shows a red **Card payment not captured** button. Open it and press **Try again**.

## Refunds

- A **refund** on the order page sends the same amount back to the card. A **void** sends back everything that is still on the card.
- An order paid with several card payments is refunded newest payment first.
- The **Card payment** button on the order page shows each card payment and what went back to it.
- A refund to the card can fail. The button then turns red and says **Card refund failed**. Open it to read the reason and press **Try again**.
- Some cards need the card present for a refund (Interac in Canada). Those refunds fail here. Give the money back another way, or refund it in your Stripe Dashboard with the card.
- An order that was not paid by card reader is left alone.

## Tips

- Each till keeps its own reader. Two tills can use two readers at the same time.
- One reader takes one payment at a time. A second **Send to reader** while it is busy is refused.
- Switching the extension off also switches the Card reader method off. Past orders keep its name.
- Test without a reader: use a test key (`sk_test_…`) and a simulated reader from the Stripe Dashboard.
