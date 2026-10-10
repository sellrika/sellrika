# Restaurant

The **Restaurant** extension adds tables, one bill per table and a kitchen screen.
Guests scan a QR code on their table, order from your online store, and every round goes on one bill.
It adds two pages to the sidebar under **Sales**: **Tables** and **Kitchen**. **Tables** takes the place of **Customers**.

## How to switch it on

1. Switch your online store on (**Online store › General**). Without it guests can not open the menu.
2. Open **Settings › Extensions** and switch **Restaurant** on.
3. Its settings have one choice: **Main button at checkout** is **Pay later** unless you pick **Pay now** (for a coffee shop, where guests pay at once).

Only an admin can do this.

## How to add or remove tables

1. Open **Tables** in the sidebar (Sales).
2. Under **Add tables** type `1-30` and press **Add** to add Table 1 to Table 30 at once. You can also type names, like `Terrace 1, Bar`.
3. To take a table away, click it and press **Remove table**, then **Remove**. Its QR code stops working. Its past orders stay.

Each table is a tile. A tile shows **Free** or **Open bill**. Use the **All**, **Open bill** and **Free** filters to find one.

## How guests order from their phone

1. When guests sit down, click their table on **Tables**. The panel on the right shows its bill and its QR code.
2. Press **Make QR code** (or **New QR code**). The QR code prints at once. Give it to the guests. **Print QR** prints the same code again.
3. A guest scans the code, picks food, opens the cart and presses **Send to kitchen**.
4. They can order again later: it joins the same bill. They pay at the counter when they are done.

## How staff order for a table

1. On **Tables** click the table and press **Add items**.
2. Pick the food and press **Add to order**. The first time it starts the table's bill, later it adds to it.
3. To tell the kitchen something about a dish, press the speech-bubble button on its cart line and type a note.

You can also start on the **Sell** screen: **Select table**, **Charge**, **Pay later**.

## How to use the Kitchen screen

1. The cook opens **Kitchen** in the sidebar (Sales).
2. Each order round is one ticket, oldest first.
3. Drag a dish to **Preparing** when cooking begins, then to **Done** when it is ready. On a tablet, use the **Start**, **Done** and **Back** buttons instead.

The page updates by itself.

## How to take dishes off a bill

1. Click the table and press the bin button next to each dish. Nothing changes yet.
2. Press **Save changes** to remove them, or **Undo**.
3. The kitchen gets a red banner and a red label on that dish. The cook presses **Got it** to clear it.

The last dish of a bill can not be removed. Void the order instead.

## How to move guests or join two tables

1. Click the guests' table and press **Move or join tables**.
2. Pick the new table and press **Move**.
3. If the new table already has a bill, the two bills become one (**Join**).

The first table becomes free. Dishes still cooking show the new table in the kitchen.

## How to take the money

1. When the guests are done, click the table and press **Pay**.
2. To give a discount, open **Discount** and pick a percent, type an amount, or type a discount code.
3. Type the amount received and press **Record**. Then press **Print receipt**.

Once the bill is paid, the table is free and its QR code stops working. The next guests need a new one.
Pressing **New QR code** also stops the old code at once.

## How to keep a product out of the kitchen (Send to kitchen)

Every product goes to the kitchen at first. Ready-made items (bottled drinks) need no cooking.

1. Open **Catalog › Products** and open the product.
2. In the side column, find the **Send to kitchen** card.
3. Switch it off. It is saved at once. Its orders then stay off the **Kitchen** page. They still go on the bill.

A new product must be saved first. Then the switch works.
An assistant reads the switch with the tool `restaurant_get_send_to_kitchen` and sets it with `restaurant_set_send_to_kitchen`.

## Good to know

- Every role can open **Tables** and **Kitchen**, take orders and take money.
- Only managers and admins can add or remove tables and change **Send to kitchen**.
- A table with an open bill can not be removed. Take the money first.
- The guests' **Send to kitchen** button writes an unpaid order. No payment is taken online.
