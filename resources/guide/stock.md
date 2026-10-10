# Stock

The **Stock** page shows how many of each product you have, and lets you change the counts. It is in the sidebar under **Catalog**.

## How to start counting a product

A product is on the Stock page only when it tracks stock.

1. Open **Catalog › Products** and open the product.
2. In the **Inventory** box, switch on **Track stock**.
3. Type a number in **Low-stock alert at**. The product is marked as low when its count is at or below this number.
4. Click **Save product**.
5. Open **Catalog › Stock**. The product is now in the list. A new product starts with a count of 0. Add your real count there (see "How to receive stock").

A product with variants has one line for each variant. Each variant has its own count.

## How to see the counts

1. Open **Catalog › Stock**.
2. The three cards at the top show **Tracked units**, **Low stock** and **Out of stock**. Click a card to show only those lines.
3. You can also use the tabs **All**, **Low** and **Out**.
4. Use the search box (**Search by name or barcode**) to find one item.
5. In the list, **In stock** is the count now. **Alert at** is the low-stock number of the product.

## How to find low stock

1. Open **Catalog › Stock**.
2. Click the **Low** tab or the **Low stock** card.
3. Lines with a **Low** badge are at or below their alert number. Lines with an **Out of stock** badge are at zero.

**Low** also includes the items that are out of stock. The **Reports** page shows the same three numbers and an **Open Stock** button.

## How to receive stock

Use this when a delivery arrives.

1. Open **Catalog › Stock** and find the item.
2. Click **Adjust**. The **Adjust stock** window opens.
3. Keep the **Add** tab.
4. Type how many arrived in **Quantity**. The line under the box shows the old and the new count, for example "12 → 20".
5. Keep **Stock received** in **Reason**.
6. Optional: write a **Note**, for example the delivery number.
7. Click **Save adjustment**.

## How to take stock out

Use this for damaged or lost items.

1. Click **Adjust** on the item.
2. Click the **Remove** tab.
3. Type how many to take out in **Quantity**.
4. Pick **Damaged / lost** (or **Other**) in **Reason**.
5. Click **Save adjustment**.

You can not take out more than you have. The app then says "Only … in stock".

## How to correct a count

Use this after you count the shelf and the number in the app is wrong.

1. Click **Adjust** on the item.
2. Click the **Set count** tab.
3. Type the real number in **New count**.
4. Pick **Count correction** in **Reason**.
5. Optional: write in **Note** who counted.
6. Click **Save adjustment**.

## How to read the movement history

Every change of a count is saved as one line in the history.

1. Open **Catalog › Stock** and find the item.
2. Click **History**. The **Stock history** panel opens. The newest line is first.
3. Each line shows the type, the date, the reason and the change (for example +8 or −2).
4. The type is one of: **sale**, **refund**, **void** or **adjustment**.
5. A line from an order has a link to that order. A line made by a person shows their name.
6. Click **Load more** to see older lines.

## What changes the count without you

- A sale takes the sold quantity out.
- A refund puts the items back, but only when the refund is made with restock.
- A voided order puts its items back.
- Removing an item from an unpaid order puts it back.

A count never goes below zero. The Sell screen and the online store do not sell more than the count.

## Why the product form does not change counts

The product form only switches **Track stock** on or off and sets the alert number. It has no box for the count.

This is on purpose. Every change of a count must be a line in the history, with a reason and the name of the person. So all changes are made on the Stock page with **Adjust**. Then the history always adds up to the count you see.

One exception: a CSV import on the Products page can set a starting count for the new products it adds. This is saved in the history as an adjustment too.

## How packages get their availability

A package (a product made of other products) has no stock of its own. It is never on the Stock page.

- The app works out how many packages can be made from the products inside it.
- Example: a package holds 12 pens. You have 30 pens. So 2 packages can be sold.
- When a package has several products inside, the one that runs out first sets the limit.
- A product inside that does not track stock never limits the package.
- When a package is sold, the count of each product inside goes down. In the history of the pen you see −12. There is no history for the package itself.

## Good to know

- Admins and managers can use the Stock page. Cashiers can not.
- Only products with **Track stock** on are in the list. Switch it off and the product leaves the Stock page.
- A history line can not be edited or deleted. To fix a mistake, make a new adjustment.
- Always pick the right **Reason**. The window starts with **Stock received** every time.
- The reasons are **Stock received**, **Count correction**, **Damaged / lost** and **Other**.
- Variants use the alert number of their product.
- Deleting a product also deletes its stock history.
