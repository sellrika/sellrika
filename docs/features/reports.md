# Reports

The sales report of a shop, and the daily report it can post to a chat. For managers and admins.

## Where the code is

| What | Where |
|---|---|
| Routes | `routes/sales.ts` |
| Controller (`GET /reports?preset=&from=&to=&by=`) | `app/controllers/Report.Controller.ts` |
| Service (`resolveQuery`, `build`, `summarize`) | `app/services/sales/Report.Service.ts` |
| Repository | `app/repositories/Report.Repository.ts` |
| Stock counts | `StockRepository.summary` |
| Dates and buckets | `app/helpers/time.ts` |
| Constants | `app/constants/Report.Constant.ts` |
| Page | `resources/js/Pages/Reports/Index.vue` |

## The page

`Reports/Index.vue` draws its charts as inline SVG. It has tabs for the preset and the bucket.

**Top row**

- Sales (bars) and Busiest hours (a line) sit side by side.
- Hovering a bar or an hour shows its values in `components/ChartTip.vue`.

**Breakdowns**

The breakdowns are lists of `components/BreakdownRow.vue`.

- Left: Top products, with the picture and the sold / returned count.
- Right: three share cards, stacked. Each has its total in the header.
  1. Cashiers (a pie)
  2. Payment methods (a doughnut)
  3. Categories (a doughnut)
- Then Top customers: initials, order count, and the name links to `/customers/:id`.

**The pie and the doughnuts**

They are `components/ShareChart.vue`.

- One CSS `conic-gradient`.
- One colour per row. The colour shows as a dot on the row.
- The cashier, payment and category rows are one compact line each: dot, name, order count, share, amount.
  For a category the count is units sold.
- Hovering a slice shows its sales, orders and share.

## The query

`ReportService.resolveQuery(searchParams, tz)` turns the query string into a date range on the shop's clock.

### `preset`

One of `REPORT_PRESETS`:

`today`, `yesterday`, `7d`, `last_week`, `this_month`, `last_month`, `this_year`, `custom`

- The default is `this_month`.
- `custom` needs a valid `from ≤ to`, both as `YYYY-MM-DD`. Else it falls back to `this_month`.
- Presets that depend on today use the **shop's** clock (`inZone`).
- `last_week` is Monday to Sunday of the week before this one.
- The sales person page (`/sales-staff/:id`) uses the same periods.

### `by`

One of `day`, `week`, `month`.

When it is left out, it is picked from the length of the range:

| Range | Bucket |
|---|---|
| More than 120 days (`MONTH_BUCKET_DAYS`) | month |
| More than 31 days (`WEEK_BUCKET_DAYS`) | week |
| Else | day |

Weeks start on Monday.

### The range in the database

- The range is turned into UTC instants with `dayRange(tz, from, to)`. The end is exclusive.
- They are compared against `created_at` through `sqlStamp`.

## What `build` returns

```
query, summary, previous, series[], hours[24],
top_products[], top_customers[], by_method[], by_cashier[], by_category[],
stock { tracked, low, out }, today
```

### `previous`

- The period of the same length right before this one. It is for "vs previous".
- It is summed in the database by `ReportRepository.totals`. No row per order is read.

### `summary`

Built by `summarize`.

| Field | Meaning |
|---|---|
| `orders` | The number of orders |
| `items` | The number of items |
| `gross` | Sum of `subtotal` |
| `discounts` | Sum of the discounts |
| `tax` | Sum of `orders.tax`. Collected on top or inside the price alike. A refund does not scale it back. |
| `sales` | Sum of `total` |
| `refunds` | Sum of `refunds.amount` in the period, **by refund date** |
| `revenue` | `sales − refunds` |
| `cogs` | Sum of item cost × qty, for lines with a cost. Minus the `cogs_back` of restocked returns. |
| `profit` | `revenue − cogs − tax` |
| `margin` | Percent of revenue, 1 decimal. null when revenue ≤ 0. |
| `avg_order` | The average order |
| `no_cost_lines` | Lines sold without a purchase price. The page shows this as a caveat. |

Notes:

- An online order's `delivery_fee` is inside `total`. So it counts as sales. It also counts as profit, because it has no cost.
- The tax is taken off profit. It is the government's money, not the shop's.

### `series`

- One entry per bucket key from `from` to `to`. Empty buckets are included.
- Each entry has `orders`, `sales`, `refunds` and `profit`.
- The bucketing is done in JS with `bucketKey(date, tz, by)`.

### `hours`

24 buckets of orders and sales, by the shop's local hour. This is the busiest hours chart.

### The breakdowns

| Field | What |
|---|---|
| `top_products` | 10 rows. Most units sold first, then by revenue. Grouped by product + variant + name. Includes `refunded_qty` and `image`. |
| `top_customers` | 10 rows. Most money spent first, then most orders. Fields: `customer_id`, `name`, `orders`, `sales`. Sales with no customer are left out. |
| `by_method` | Per payment method |
| `by_cashier` | Per cashier |
| `by_category` | Per category. A product in several categories counts in each. No category = "Uncategorised". |

The `image` of a top product is one of the order lines' own saved pictures (`order_items.image`).

### Rules for every number

- **Voided orders are left out everywhere.**
- Refunds are not moved back to the sale date.

## Daily report

The shop's sales of the day, posted to its chat once a day.

It is a core feature. But the **Chat alerts** extension does the posting and holds the channels.

### Where the code is

| What | Where |
|---|---|
| Service (`settings`, `channels`, `save`, `run`) | `app/services/sales/DailyReport.Service.ts` |
| Validator (`ReportScheduleInput`) | `app/validators/Report.Validator.ts` |
| Repository | `ShopRepository.updateReport`, `withReport`, `claimReport` |
| Constants | `app/constants/Report.Constant.ts` |
| Dialog | `resources/js/components/reports/DailyReportDialog.vue` |
| Listener `onDailyReport` | `extensions/chat-alerts/index.ts` |
| The job | `daily-report` in `app/jobs/Job.Registry.ts` |

### Settings

The gear button next to the page title opens the dialog. It has:

- a switch
- a time, `HH:MM` on the shop's clock. It is 22:00 until changed (the column default in migration `0084_shop_daily_report.ts`).
- the channels

`PUT /reports/schedule` saves it.

- For managers and admins.
- It answers JSON. A refusal is 422 `{ errors }`.
- It writes `shops.report_enabled`, `report_time` and `report_channels` (migration 0084).

### Channels

The channels are `slack`, `discord` and `line`.
`REPORT_CHANNELS` maps each one to the Chat alerts setting that must be filled.

- The dialog offers only the channels that work now: the extension runs for the shop, and that setting is filled.
- Switching the report on needs at least one channel.
- With nothing to offer, the dialog says to set up Chat alerts. Admins get a link to `/extensions`.

### Sending

1. The cron `daily-report` runs every minute (`REPORT_CRON`). It calls `DailyReportService.run()`.
2. A shop is due when its clock is at or past `report_time`, and `report_sent_on` is not today.
3. `claimReport` marks the day in one statement. So a report goes out once.
4. `ReportService.build` runs for today.
5. The event `report.daily` is fired with `{ report: { date, summary, top_products (5), by_method }, channels }`.
6. It is fired in the shop's first language. It is not awaited.

### Rules

- A save after today's time has passed starts tomorrow.
- A server that was down at the time sends late, on the same day only.
- A day with no sale is one short line.
- One try, no retry. A failed post is only in the log.
- The extension's own tick list (**Send**) is not asked. The switch on `/reports` decides.

### Tests

| File | Checks |
|---|---|
| `app/services/settings/__tests__/Extension.Service.test.ts` | The posted text, once a day, only the picked channels, no extension = cannot switch on |
| `app/services/settings/__tests__/ExtensionEvents.test.ts` | The event's payload |
| `e2e/y-daily-report.spec.ts` | The dialog |
| `e2e/j-users.spec.ts` | A cashier gets 403 |
