# Reports

The **Reports** page shows how the active shop is selling: money, orders, profit, tax and refunds for a period you pick. It is in the sidebar under **Sales**.

## How to pick a period

1. Open **Sales › Reports**. It starts with **This month**.
2. Click one of the period tabs at the top:
   - **Today** and **Yesterday**
   - **7 days**: today and the 6 days before it
   - **Last week**: Monday to Sunday of the week before this one
   - **This month** and **Last month**
   - **This year**
   - **Custom**: your own dates
3. The dates of the period are shown under the page title.

On a phone the tabs are two select boxes instead.

## How to use your own dates

1. Click **Custom**.
2. Pick the first day in **From** and the last day in **To**. Both days are included. You can not pick a day in the future.
3. Click **Apply**.

## How to group the sales chart

1. Next to the period tabs, click **Day**, **Week** or **Month**.
2. The **Sales** chart then shows one bar for each day, week or month.

The app picks a group for you when you change the period: days for a short period, weeks for more than 31 days, months for more than 120 days. Weeks start on Monday.

## What each number means

The eight cards at the top are the totals of the period.

- **Net revenue**: the sales of the period minus the refunds of the period.
- **Orders**: how many orders were made.
- **Avg. order**: the sales divided by the number of orders.
- **Items sold**: how many units were sold.
- **Gross profit**: net revenue, minus what the sold products cost you, minus the tax. Under it you see the margin, for example "32% margin". This is the profit as a part of net revenue.
- **Discounts**: the total of all discounts given.
- **Tax collected**: the tax on the orders of the period.
- **Refunds**: the money given back in the period.

Under each number there is a small line such as "▲ 12% vs previous period". It compares with the period of the same length right before. "— no previous data" means there is nothing to compare with.

## How profit is worked out

1. The app takes the net revenue.
2. It takes away the cost of the sold products. The cost is the **Purchase price** of the product at the time of the sale.
3. It takes away the tax. The tax is not your money.
4. What is left is the **Gross profit**.

If a product was sold without a purchase price, its cost counts as zero. The card then warns you: "… lines have no purchase price — profit is understated." Set the **Purchase price** on your products to get a true profit.

When refunded items are put back in stock, their cost is taken out of the costs again.

## How to read the charts and lists

1. **Sales** shows the sales of each day, week or month as bars. Refunds are shown in red. Point at a bar to see the sales, the refunds and the orders.
2. **Busiest hours** shows at which hours of the day the shop sells most. Point at an hour to see its sales and orders.
3. **Top products** lists the 10 products that sold the most units, with how many were sold and how many were returned.
4. **Sales by cashier** shows the orders and sales of each staff member, with their share of the total.
5. **Sales by payment method** shows the same for each payment method.
6. **Sales by category** shows the units sold and the sales of each category.
7. **Top customers** lists the 10 customers who spent the most. Click a name to open the customer.

The stock line under the cards shows **Tracked**, **Low stock** and **Out of stock** as they are now. Click **Open Stock** to see the low items.

## How to get a daily report in your chat

The app can post the sales of the day to Slack, Discord, LINE or Telegram once a day.

1. First set up the chat. An admin opens **Settings › Extensions**, switches on **Chat alerts** and fills in at least one channel (Slack, Discord, LINE or Telegram). Telegram needs both the bot token and the chat ID.
2. Open **Sales › Reports**.
3. Click the gear button next to the page title. The **Daily report** box opens.
4. Switch on **Send a daily report**.
5. Pick the **Time**. It starts at 22:00 (10 PM). The time is on the shop's clock.
6. Under **Send to**, tick the channels that should get the report. Only the channels filled in Chat alerts are shown.
7. Click **Save**.

The report has the sales, the number of orders, the refunds, the net revenue, the gross profit, the 5 top products and the payment methods of the day, up to the time you picked.

- "No channel is set up yet" means Chat alerts is off or has no channel. Do step 1 first.
- If you save after today's time has passed, the first report comes tomorrow.
- A sale made after the report time is not in that day's report. Pick a time after you close.
- To stop it, switch **Send a daily report** off and click **Save**.

## Which orders are left out

- **Voided orders are left out of everything.** They do not count as orders, sales, profit or tax.
- Refunded orders stay in. The sale counts on the day of the sale. The refund counts on the day of the refund.
- Example: a $50 sale in May is refunded in June. May keeps the $50 sale. June shows a $50 refund.
- **Top customers** leaves out sales that have no saved customer.

## The shop's time zone

- The report uses the time zone of the shop, not of your computer.
- "Today" starts and ends at midnight on the shop's clock. The **Busiest hours** chart uses the shop's clock too.
- The time zone is set on the shop's own edit page, in the field **Time zone**. To get there, click the shop name at the top of the sidebar and then **Manage shops…**.
- Each shop has its own report. To see another shop, switch the shop at the top of the sidebar.

## Good to know

- Admins and managers can open the Reports page. Cashiers can not.
- The delivery fee of an online order counts as sales and as profit.
- **Tax collected** counts the tax of every order that is not voided. A refund does not lower it.
- A product in several categories is counted in each of them. So the categories can add up to more than the total sales. Products with no category are shown as "Uncategorised".
- Refunds lower **Net revenue** but not the bars of the sale day.
- Money is shown like $18 or $18.23, in the shop's currency.
- The page has no export button. The numbers are for reading on screen, or in your chat with the daily report.
