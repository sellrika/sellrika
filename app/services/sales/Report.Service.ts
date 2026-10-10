import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { ReportRepository, type Range } from "@repositories/Report.Repository";
import { StockRepository } from "@repositories/Stock.Repository";
import {
	bucketKey,
	bucketKeys,
	dayRange,
	dbDate,
	formatYmd,
	inZone,
	partsBucketKey,
	utcYmd,
	ymd,
	type Bucket,
} from "@helpers/time";
import {
	MONTH_BUCKET_DAYS,
	REPORT_PRESETS,
	WEEK_BUCKET_DAYS,
	YMD_PATTERN,
	type Preset,
} from "@constants/Report.Constant";
import { DAY_MS } from "@constants/Time.Constant";

export type ReportQuery = {
	preset: Preset;
	from: string;
	to: string;
	by: Bucket;
};

/**
 * The order and refund rows a report is built from.
 */
type OrderRows = Awaited<ReturnType<ReportRepository["orders"]>>;
type RefundRows = Awaited<ReturnType<ReportRepository["refunds"]>>;

/**
 * One bucket of the report's time series.
 */
type SeriesPoint = {
	key: string;
	orders: number;
	sales: number;
	refunds: number;
	profit: number;
};

/**
 * One hour of the hour-of-day histogram.
 */
type HourPoint = { hour: number; orders: number; sales: number };

export type Summary = {
	orders: number;
	items: number;
	gross: number;
	discounts: number;
	sales: number;
	tax: number;
	refunds: number;
	revenue: number;
	cogs: number;
	profit: number;
	margin: number | null;
	avg_order: number;
	no_cost_lines: number;
};

/**
 * Everything the /reports screen shows.
 * Built from the raw order/refund rows, in the shop's own timezone.
 */
@Service()
export class ReportService {
	constructor(
		private reports: ReportRepository,
		private stockRepo: StockRepository,
	) {}

	/**
	 * Build the whole report.
	 * Headline numbers, and the same numbers for the preceding period of
	 * equal length.
	 * A time series bucketed in the shop's timezone.
	 * An hour-of-day histogram.
	 * The top-products / method / cashier / category breakdowns, plus the
	 * current stock summary.
	 * @param shopId Owning shop.
	 * @param tz The shop's timezone. It decides where days, weeks and
	 *   months start.
	 * @param q Resolved date range and bucket size (see `resolveQuery`).
	 * @returns The report payload the Vue page renders.
	 */
	async build(shopId: number, tz: string, q: ReportQuery) {
		const range: Range = dayRange(tz, q.from, q.to);
		const days = ReportService.daysBetween(q.from, q.to);
		const prevRange: Range = dayRange(
			tz,
			ReportService.addDays(q.from, -days),
			ReportService.addDays(q.from, -1),
		);
		const [
			orders,
			refunds,
			previous,
			top_products,
			top_customers,
			by_method,
			by_cashier,
			by_category,
			stock,
		] = await Promise.all([
			this.reports.orders(shopId, range),
			this.reports.refunds(shopId, range),
			this.reports.totals(shopId, prevRange),
			this.reports.topProducts(shopId, range),
			this.reports.topCustomers(shopId, range),
			this.reports.byMethod(shopId, range),
			this.reports.byCashier(shopId, range),
			this.reports.byCategory(shopId, range),
			this.stockRepo.summary(shopId),
		]);

		const { series, hours } = this.#fold(orders, refunds, q, tz);
		return {
			query: q,
			summary: this.#summarize(orders, refunds),
			previous: this.#summary(previous),
			series,
			hours,
			top_products: this.#numeric(top_products, [
				"qty",
				"refunded_qty",
				"revenue",
			]),
			top_customers: this.#numeric(top_customers, ["orders", "sales"]),
			by_method: this.#numeric(by_method, ["orders", "sales"]),
			by_cashier: this.#numeric(by_cashier, ["orders", "sales"]),
			by_category: this.#numeric(by_category, ["qty", "revenue"]).map((c) => ({
				...c,
				name: c.name ?? t("server.report_uncategorised"),
			})),
			stock,
			today: ymd(new Date(), tz),
		};
	}

	/**
	 * Resolve `?preset=&from=&to=&by=` into a concrete shop-local date range.
	 * Today-relative presets use the shop's clock.
	 * Anything unrecognised falls back to the last 30 days.
	 * `by` defaults to a bucket size that suits the span.
	 * @param sp The request's query string.
	 * @param tz The shop's timezone.
	 * @param now Clock to read "today" from (injectable for tests).
	 * @returns The resolved preset, from/to dates (YYYY-MM-DD) and bucket size.
	 */
	static resolveQuery(
		sp: URLSearchParams,
		tz: string,
		now = new Date(),
	): ReportQuery {
		const t = inZone(now, tz);
		const today = formatYmd(t.y, t.m, t.d);
		let preset = (REPORT_PRESETS as readonly string[]).includes(
			sp.get("preset") ?? "",
		)
			? (sp.get("preset") as Preset)
			: "this_month";
		let from = today,
			to = today;
		const f = sp.get("from") ?? "",
			tt = sp.get("to") ?? "";
		if (
			preset === "custom" &&
			YMD_PATTERN.test(f) &&
			YMD_PATTERN.test(tt) &&
			f <= tt
		) {
			from = f;
			to = tt;
		} else if (preset === "custom") preset = "this_month";
		if (preset === "yesterday") from = to = ReportService.addDays(today, -1);
		else if (preset === "7d") from = ReportService.addDays(today, -6);
		else if (preset === "last_week") {
			// Monday to Sunday of the week before this one,
			// like the report's week buckets
			const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
			from = ReportService.addDays(today, -sinceMonday - 7);
			to = ReportService.addDays(from, 6);
		} else if (preset === "this_month") from = formatYmd(t.y, t.m, 1);
		else if (preset === "last_month") {
			const y = t.m === 1 ? t.y - 1 : t.y,
				m = t.m === 1 ? 12 : t.m - 1;
			from = formatYmd(y, m, 1);
			to = formatYmd(y, m, ReportService.lastDay(y, m));
		} else if (preset === "this_year") from = formatYmd(t.y, 1, 1);
		const span = ReportService.daysBetween(from, to);
		const byParam = sp.get("by");
		const by: Bucket =
			byParam === "day" || byParam === "week" || byParam === "month"
				? byParam
				: span > MONTH_BUCKET_DAYS
					? "month"
					: span > WEEK_BUCKET_DAYS
						? "week"
						: "day";
		return { preset, from, to, by };
	}

	/**
	 * A calendar day at UTC midnight, as milliseconds.
	 * @param d The day, `YYYY-MM-DD`.
	 * @returns The time in ms.
	 */
	private static dayMs(d: string) {
		return new Date(`${d}T00:00:00Z`).getTime();
	}

	/**
	 * Move a calendar day forward or back.
	 * @param d The day, `YYYY-MM-DD`.
	 * @param n Days to add (negative = back).
	 * @returns The new day, `YYYY-MM-DD`.
	 */
	private static addDays(d: string, n: number) {
		const t = new Date(`${d}T00:00:00Z`);
		t.setUTCDate(t.getUTCDate() + n);
		return utcYmd(t);
	}

	/**
	 * How many calendar days a range covers, both ends counted.
	 * @param from The first day, `YYYY-MM-DD`.
	 * @param to The last day, `YYYY-MM-DD`.
	 * @returns The number of days (1 for a single day).
	 */
	private static daysBetween(from: string, to: string) {
		return (
			Math.round(
				(ReportService.dayMs(to) - ReportService.dayMs(from)) / DAY_MS,
			) + 1
		);
	}

	/**
	 * The last day of a month.
	 * @param y The year.
	 * @param m The month, 1–12.
	 * @returns 28 to 31.
	 */
	private static lastDay(y: number, m: number) {
		return new Date(Date.UTC(y, m, 0)).getUTCDate();
	}

	/**
	 * Turn the numeric-looking columns of report rows into real numbers.
	 * The database may hand a sum back as text.
	 * @param rows The rows.
	 * @param keys The columns to convert.
	 * @returns The rows, with those columns as numbers.
	 */
	#numeric<T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]) {
		return rows.map((r) => ({
			...r,
			...Object.fromEntries(keys.map((k) => [k, Number(r[k])])),
		}));
	}

	/**
	 * Fold the order and refund rows into the time series and the
	 * hour-of-day histogram, in the shop's zone.
	 * Empty buckets are included, so the chart keeps its shape.
	 * @param orders Order rows of the period.
	 * @param refunds Refund rows of the period.
	 * @param q The resolved date range and bucket size.
	 * @param tz The shop's timezone.
	 * @returns The series, in order, and the 24 hours.
	 */
	#fold(orders: OrderRows, refunds: RefundRows, q: ReportQuery, tz: string) {
		const series = new Map<string, SeriesPoint>();
		for (const key of bucketKeys(q.from, q.to, q.by))
			series.set(key, { key, orders: 0, sales: 0, refunds: 0, profit: 0 });
		const hours: HourPoint[] = [];
		for (let hour = 0; hour < 24; hour++)
			hours.push({ hour, orders: 0, sales: 0 });
		for (const o of orders) {
			// the zone's calendar fields are worked out once per order
			const at = inZone(dbDate(o.created_at), tz);
			const b = series.get(partsBucketKey(at, q.by));
			if (b) {
				b.orders++;
				b.sales += o.total;
				b.profit += o.total - Number(o.cogs) - o.tax;
			}
			const h = hours[at.h]!;
			h.orders++;
			h.sales += o.total;
		}
		for (const r of refunds) {
			const b = series.get(bucketKey(dbDate(r.created_at), tz, q.by));
			if (b) {
				b.refunds += r.amount;
				b.profit -= r.amount - Number(r.cogs_back);
			}
		}
		return { series: [...series.values()], hours };
	}

	/**
	 * Fold order and refund rows into the headline numbers.
	 * @param orders Order rows of the period.
	 * @param refunds Refund rows of the period.
	 * @returns Totals, revenue, COGS, profit and margin.
	 */
	#summarize(orders: OrderRows, refunds: RefundRows): Summary {
		const s = {
			orders: 0,
			items: 0,
			gross: 0,
			discounts: 0,
			sales: 0,
			tax: 0,
			refunds: 0,
			cogs: 0,
			no_cost_lines: 0,
		};
		for (const o of orders) {
			s.orders++;
			s.items += Number(o.items);
			s.gross += o.subtotal;
			s.discounts += o.discount;
			s.sales += o.total;
			s.tax += o.tax;
			s.cogs += Number(o.cogs);
			s.no_cost_lines += Number(o.no_cost);
		}
		for (const r of refunds) {
			s.refunds += r.amount;
			s.cogs -= Number(r.cogs_back);
		}
		return this.#summary(s);
	}

	/**
	 * Turn a period's sums into the headline numbers.
	 * @param s The sums: orders, units, money, refunds and cost of goods.
	 * @returns The sums, plus revenue, profit, margin and average order.
	 */
	#summary(s: Awaited<ReturnType<ReportRepository["totals"]>>): Summary {
		const revenue = s.sales - s.refunds;
		// ponytail: the tax is the government's, not profit.
		// That holds whether it was added on top or sat inside the price.
		// A refund isn't scaled back out of `tax`.
		// Pro-rate it per refund if a shop ever needs the remitted figure exact.
		const profit = revenue - s.cogs - s.tax;
		return {
			...s,
			revenue,
			profit,
			margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
			avg_order: s.orders ? Math.round(s.sales / s.orders) : 0,
		};
	}
}
