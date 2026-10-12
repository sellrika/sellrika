/** Discounts and the status filter of the Orders screen. */

/**
 * How a checkout discount is expressed.
 * A whole percentage, or a flat amount in cents.
 */
export const DISCOUNT_TYPES = ["percent", "fixed"] as const;

/** One of `DISCOUNT_TYPES`. */
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/**
 * Accepted `?status=` values on /orders.
 * `refunded_any` matches partially *and* fully refunded.
 * `unpaid` = not fully paid yet.
 */
export const ORDER_STATUS_FILTERS = new Set([
	"all",
	"completed",
	"partially_refunded",
	"refunded",
	"voided",
	"refunded_any",
	"unpaid",
]);

/**
 * The built-in delivery steps of an online order, in order.
 * A shop may rename them, reorder them and add its own
 * (`shops.fulfillment_steps`).
 * POS sales carry '' (nothing to deliver).
 */
export const FULFILLMENT_STATUSES = [
	"new",
	"packing",
	"shipped",
	"delivered",
] as const;

/** The colour each built-in step starts with (its badge). */
export const FULFILLMENT_COLORS: Record<string, string> = {
	new: "#0ea5e9",
	packing: "#8b5cf6",
	shipped: "#3b82f6",
	delivered: "#10b981",
};

/** The colour a new step of the shop's own starts with: amber. */
export const FULFILLMENT_NEW_COLOR = "#f59e0b";

/**
 * The built-in steps with their starting colours, in order.
 * @returns A fresh list (safe to change).
 */
export function defaultSteps(): FulfillmentStep[] {
	return FULFILLMENT_STATUSES.map(function step(key) {
		return { key, label: "", color: FULFILLMENT_COLORS[key] };
	});
}

/**
 * Steps a shop can never remove.
 * The checkout writes `new`, and `shipped` emails the buyer.
 */
export const FULFILLMENT_LOCKED = ["new", "shipped", "delivered"] as const;

/** The most delivery steps one shop may have. */
export const FULFILLMENT_STEPS_MAX = 12;

/** A delivery step key: a built-in one or a shop's own. */
export type FulfillmentStatus = string;

/**
 * One delivery step of a shop.
 * `label` '' = the translated built-in name (`orders.<key>`).
 * `color` = its badge colour (`#rrggbb`).
 * null or missing = the built-in one (grey for a shop's own).
 */
export type FulfillmentStep = {
	key: string;
	label: string;
	color?: string | null;
};

/**
 * How much of `orders.total` has come in.
 * Gateway / POS sales are `paid` at once.
 * Manual orders (cash on delivery, bank transfer) start `unpaid`
 * and move through `partial` as money is recorded.
 */
export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;

/** One of `PAYMENT_STATUSES`. */
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Accepted `?source=` values on /orders: where the sale was made. */
export const ORDER_SOURCE_FILTERS = new Set(["all", "pos", "online"]);

/**
 * How long the Orders screen's filter lists of a shop are kept in memory.
 * The cashiers and the payment names on its orders.
 * A new order or a recorded payment clears them at once.
 */
export const ORDER_FILTERS_CACHE_MS = 5 * 60_000;

/**
 * How long a shop's all-time order count and sales are kept in memory.
 * The Orders screen's average order is worked out from them.
 * A new order, a payment or a void clears them at once.
 */
export const ORDER_TOTALS_CACHE_MS = 60_000;

/**
 * The longest payment reference a pay dialog may send (`payment_ref`):
 * the short text an extension gave when it approved the payment.
 */
export const PAYMENT_REF_MAX = 200;
