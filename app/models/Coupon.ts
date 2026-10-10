import type { CouponType } from "@constants/Coupon.Constant";

/**
 * A discount code of one shop (migration 0040).
 * Money is cents.
 * Dates are `YYYY-MM-DD` in the shop's time zone.
 */
export type Coupon = {
	id: number;
	shop_id: number;
	/** Upper-case, unique per shop. */
	code: string;
	/**
	 * What the buyer is told when it applies.
	 * "10% off your first order".
	 */
	description: string;
	type: CouponType;
	/** Percent (1..100) or cents; 0 for free_delivery. */
	value: number;
	/** Cents the whole cart must reach (0 = none). */
	min_subtotal: number;
	/** Cap in cents for a percent code (null = none). */
	max_discount: number | null;
	/** First day it works (inclusive), null = already. */
	starts_at: string | null;
	/** Last day it works (inclusive), null = forever. */
	ends_at: string | null;
	/** Total redemptions allowed (null = unlimited). */
	usage_limit: number | null;
	/** Redemptions per buyer email (null = unlimited). */
	per_customer_limit: number | null;
	/**
	 * Only these products count as eligible ([] = every product)…
	 */
	product_ids: number[];
	/**
	 * …or products in these categories.
	 * A line matches either list.
	 */
	category_ids: number[];
	/**
	 * Only these buyers may use it, matched to the checkout email.
	 * [] = anyone.
	 */
	emails: string[];
	active: boolean;
	created_at: string;
	updated_at: string;
};
/** List row: how often it was used and what it took off in total. */
export type CouponWithStats = Coupon & {
	used_count: number;
	saved_total: number;
};
/**
 * Totals over every code of a shop (cents).
 * Times used, discount given, the totals of those orders.
 */
export type CouponSummary = { uses: number; saved: number; sales: number };
/** One order that used a code — the usage counters are counts of these. */
export type CouponRedemption = {
	id: number;
	coupon_id: number;
	shop_id: number;
	order_id: number;
	email: string;
	amount: number;
	created_at: string;
};
/**
 * History row: the redemption plus what the order became.
 * The order fields are null when the order is gone.
 */
export type CouponRedemptionRow = CouponRedemption & {
	reference: string | null;
	order_total: number | null;
	order_status: string | null;
	customer_name: string | null;
};
