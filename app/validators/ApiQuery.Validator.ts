import { z } from "zod";
import { MAX_PER_PAGE } from "@constants/Pagination.Constant";
import { API_PER_PAGE } from "@constants/Api.Constant";
import { PRODUCT_SORTS } from "@constants/Product.Constant";
import { REPORT_PRESETS } from "@constants/Report.Constant";
import { GUIDE_DEFAULT, GUIDE_TOPICS } from "@constants/Guide.Constant";

/**
 * The query strings of the API's list routes.
 * A query string is text.
 * So numbers and switches are read from text (`z.coerce`).
 * A wrong value is refused with a 422, never silently replaced.
 */

/** A row id in the query string; absent = no filter. */
const id = z.coerce.number().int().positive().optional();

/** A search box: trimmed, capped. */
const q = z.string().trim().max(100).default("");

/** `?page=&per_page=` of every paged list. */
const paging = {
	/** The page to read, from 1. Left out = 1. */
	page: z.coerce.number().int().min(1).default(1),
	/** Rows per page: 1 to 100. Left out = 20. */
	per_page: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_PER_PAGE)
		.default(API_PER_PAGE),
};

/**
 * A list with no filters, only pages.
 * GET /api/v1/coupons/:id/redemptions and
 * GET /api/v1/marketing/campaigns.
 */
export const PageQuery = z.object(paging);

/** GET /api/v1/products: search, category, sort and pages. */
export const ProductQuery = z.object({
	/** What to search for. At most 100 characters. "" = everything. */
	q,
	/** Only products in this category. Absent = every category. */
	category: id.meta({ description: "Only products in this category." }),
	/**
	 * The column to sort by: `name`, `category`, `active`,
	 * `stock`, `price` or `sold`. Absent = the list's own order.
	 */
	sort: z.enum(PRODUCT_SORTS).optional(),
	/** `asc` = smallest first, `desc` = largest first. Left out = `asc`. */
	dir: z.enum(["asc", "desc"]).default("asc"),
	...paging,
});

/** GET /api/v1/orders: search, the list's filters and pages. */
export const OrderQuery = z.object({
	/**
	 * What to search for: the order code, id or customer.
	 * "" = everything.
	 */
	q: q.meta({ description: "Matches the order code, id or customer." }),
	/**
	 * Only orders in this state. Left out = `all`.
	 * `refunded_any` = partly or fully refunded.
	 * `unpaid` = not paid in full yet.
	 */
	status: z
		.enum([
			"all",
			"completed",
			"partially_refunded",
			"refunded",
			"voided",
			"refunded_any",
			"unpaid",
		])
		.default("all"),
	/**
	 * Where the order was made: `pos` = the till,
	 * `online` = the online store. Left out = `all`.
	 */
	source: z.enum(["all", "pos", "online"]).default("all"),
	/** A delivery step key of the shop. Left out = `all`. */
	fulfillment: z
		.string()
		.max(30)
		.default("all")
		.meta({ description: "A delivery step key of the shop, or `all`." }),
	/** A payment method name. Left out = `all`. */
	method: z
		.string()
		.max(50)
		.default("all")
		.meta({ description: "A payment method name, or `all`." }),
	/** Only orders of this customer. Absent = every customer. */
	customer: id,
	/** Only sales made by this staff user. Absent = everyone. */
	cashier: id.meta({ description: "The staff user who made the sale." }),
	/** Only sales that name this sales person. Absent = everyone. */
	sales: id.meta({ description: "The sales person named on the sale." }),
	...paging,
});

/** GET /api/v1/coupons: search, sort and pages. */
export const CouponQuery = z.object({
	/** What to search for. At most 100 characters. "" = everything. */
	q,
	/** `used` = most used first. "" = the list's own order. */
	sort: z
		.enum(["", "used"])
		.default("")
		.meta({ description: "`used` = most used first." }),
	...paging,
});

/** GET /api/v1/stock: search, the low / out filter and pages. */
export const StockQuery = z.object({
	/** What to search for. At most 100 characters. "" = everything. */
	q,
	/**
	 * `low` = low on stock, out of stock included.
	 * `out` = out of stock only. Left out = `all`.
	 */
	filter: z
		.enum(["all", "low", "out"])
		.default("all")
		.meta({ description: "`low` includes out of stock." }),
	...paging,
});

/**
 * GET /api/v1/stock/movements:
 * the ledger of one product or variant.
 */
export const StockMovementQuery = z.object({
	/** The product whose ledger to read. Needed. */
	product_id: z.coerce.number().int().positive(),
	/** The variant, when the product has variants. */
	variant_id: id.meta({
		description: "The variant, when the product has variants.",
	}),
	...paging,
});

/**
 * The period of a report: GET /api/v1/sales-staff/:id.
 * GET /api/v1/reports adds `by` to it (`ReportQuery`).
 * Read by `resolveQuery`, the same reader the Reports page uses.
 * An unknown value falls back to this month.
 */
export const PeriodQuery = z.object({
	/**
	 * The period: `today`, `yesterday`, `7d`, `last_week`,
	 * `this_month`, `last_month`, `this_year` or `custom`.
	 * Left out = `this_month`.
	 */
	preset: z.enum(REPORT_PRESETS).default("this_month"),
	/** First day, `YYYY-MM-DD`. Only with `preset=custom`. */
	from: z.string().optional().meta({
		description: "First day, `YYYY-MM-DD`. Only with `preset=custom`.",
	}),
	/** Last day, `YYYY-MM-DD`. Only with `preset=custom`. */
	to: z.string().optional().meta({
		description: "Last day, `YYYY-MM-DD`. Only with `preset=custom`.",
	}),
});

/**
 * GET /api/v1/reports:
 * the period and the bucket size of the time series.
 */
export const ReportQuery = PeriodQuery.extend({
	/**
	 * The bucket size of the time series: `day`, `week` or `month`.
	 * Absent = picked from the length of the period.
	 */
	by: z.enum(["day", "week", "month"]).optional().meta({
		description: "Bucket size. Absent = picked from the length of the period.",
	}),
});

/** The MCP tool `read_user_guide`: which part of the user guide. */
export const GuideQuery = z.object({
	/**
	 * The part of the guide to read.
	 * At most 50 characters. Left out = the overview.
	 */
	topic: z
		.string()
		.max(50)
		.default(GUIDE_DEFAULT)
		.meta({
			description: `The part of the guide to read: ${GUIDE_TOPICS.join(", ")}, or the topic of an extension the shop runs (every answer lists them in \`topics\`). Absent = the overview, which says what each topic covers.`,
		}),
});
