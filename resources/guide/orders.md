# Orders

The **Orders** page lists every sale of your shop: sales from the till and orders from your online store. Open it in the sidebar: Sales › **Orders**. Every role can open it.

At the top you see three numbers: **Today's revenue**, **Today's orders** and **Avg. order**.

## How to find an order

1. Type in the search box at the top. You can search by order code, by item name or by customer name.
2. Or use the filters under the numbers:
   - **Any source** / **POS** / **Online**: where the order was made.
   - The status list: **All**, **Completed**, **Unpaid**, **Refunded**, **Voided**.
   - **Any payment**: choose one payment method.
   - **Any cashier**: choose the staff member who made the sale.
   - **Any sales staff**: choose the sales person named on the sale. This list only shows when your shop has sales staff.
   - **Any stage** and the delivery statuses (for example **New**, **Shipped**): for online orders. These are hidden when you choose **POS**.
3. Click a row to open the order.

**Unpaid** shows every order that is not paid in full, also the partly paid ones. **Refunded** shows fully and partly refunded orders. If nothing matches, click **Clear filters**.

## How to read the order page

- The title is the order code, for example "Order # P8J4-MJSQ-4Z8T". Your customer sees the same code.
- Under the title: the date, who made the sale, the payment method, and **Unpaid** or **Partly paid** when money is missing.
- The table lists the items. Under it are the totals: **Paid**, then **Still due** or **Change**. After a refund you also see **Refunded** and **Net**.
- On the side: **Delivery** (online orders only), **Customer** and **Refunds**.

## How to record a payment

Use this when money comes in for an unpaid order: cash on delivery, a bank transfer, or a **Pay later** sale.

1. Open the order.
2. Click **Record payment**.
3. Pick the **Payment method**, for example Cash or Card.
4. Check **Amount received**. It is filled with the amount that is still due. Type a smaller amount if the customer pays only a part.
5. For a cash method, you can tap **Exact** or one of the note buttons. When the customer gives more than what is due, the dialog shows the **Change** to give back.
6. Pick the **Sales staff** if the shop has sales staff. This is optional.
7. Click **Record**. The button shows the amount, for example **Record $18**.

Only a cash method takes more than what is still due. The button is gone when the order is paid in full.

## How to refund an order

Only admins can refund.

1. Open the order and click **Refund**.
2. If the customer returns items, use **+** and **−** to set how many of each item come back. This step is optional.
3. Leave **Put returned items back into stock** ticked if the items can be sold again. Untick it if they are damaged.
4. Check **Amount to refund**. It is filled from the items you picked. You can type another amount.
5. Write a **Reason** if you want.
6. Click **Refund**. The button shows the amount, for example **Refund $5**.

To give everything back, click **Refund everything** first. It picks every item and the full amount.

The order then shows **Partly refunded** or **Refunded**. Each refund is listed in the **Refunds** box with its amount, items, reason and who did it.

## How to void an order

Only admins can void. Use it for a sale that should not have happened: wrong items, a test, a duplicate.

1. Open the order and click **Void**.
2. Write a **Reason** if you want.
3. Click **Void order**. Click **Keep order** to cancel.

All items go back into stock. The order no longer counts in sales totals and reports. This can not be undone.

## How to update the delivery of an online order

1. Open the order. Find the **Delivery** box.
2. Choose the new step in **Status**.
3. Type the **Tracking number** if you have one. A link also works.
4. Click **Save delivery status**.

When you move an order to **Shipped**, the customer gets an email with the tracking number. This email goes out once. You can also move an order back to an earlier step.

## How to change the delivery steps of your shop

Only admins can do this.

1. On the **Orders** page, click the gear button next to the search box.
2. The **Delivery statuses** window opens. Then:
   - Rename a status: type the new name in its box.
   - Move a status: drag it by the handle on its left.
   - Change the color: click the color button of the status.
   - Add one: click **Add status** and type a name.
   - Remove one: click its trash icon.
   - Go back to the built-in list: click **Reset to default**.
3. Click **Save**.

## How to add items to an unpaid order

You can change an order as long as it is not paid in full.

1. Open the order and click **Add items**.
2. The **Sell** screen opens. A bar at the top says "Adding items to order # …".
3. Add the products to the cart.
4. Click **Add to order** at the bottom of the cart.
5. You are back on the order. The new items and the new total are there.

To go back without adding anything, click **Back to the order**.

## How to remove items from an unpaid order

1. Open the order.
2. Click the trash icon on a line. Each click takes one unit off.
3. A bar under the items says how many items will be removed. Nothing is changed yet.
4. Click **Save changes** to remove them. Click **Undo** to keep the order as it was.

The removed items go back into stock.

## How to see what changed on an order

Open the order and scroll down to **History**. Each row is one change: **Date**, **What changed** (**Items added** or **Items removed**), **Items**, the order **Before** and **After**, and **By** (who did it). The table only shows after the first change.

## How to print the receipt again

Open the order and click **Print**.

## Good to know

- Admins, managers and cashiers can open orders, record payments, update the delivery, add items and remove items.
- Only admins can refund, void, and change the delivery steps.
- You can only refund money that was really paid. For an order with no payment yet, use **Void**.
- A refund can not be more than the amount that is left after earlier refunds.
- A void can not be undone. An order that already has a refund can not be voided.
- A voided order stays in the list, crossed out, but it does not count in any total.
- An unpaid order still counts as a sale in the reports.
- The last item of an order can not be removed. Void the order instead.
- After removing items, the order can not cost less than what is already paid.
- When you add items to an order, the cart has no customer and no discount. Your unfinished sale on the **Sell** screen is not touched.
- Sales from the till have no **Delivery** box. Only online orders have a delivery status.
- **New**, **Shipped** and **Delivered** can be renamed and moved, but not removed. A shop can have at most 12 statuses.
- You can not remove a status while orders are still at it. Move those orders to another status first.
- The order keeps the name of the payment method as it was at the sale. Renaming or deleting a method later does not change old orders.
