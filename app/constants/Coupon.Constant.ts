/**
 * Coupons / discount codes at the online checkout.
 * See docs/features/coupons.md.
 */

/**
 * What a code takes off.
 * `percent` = a whole percentage of the eligible goods.
 * `fixed` = a flat amount off them.
 * `free_delivery` = the delivery fee.
 */
export const COUPON_TYPES = ["percent", "fixed", "free_delivery"] as const;

/** One of `COUPON_TYPES`. */
export type CouponType = (typeof COUPON_TYPES)[number];

/**
 * The shape of a code.
 * Upper-case letters, digits, dashes and underscores, 3–30 long.
 * Buyers may type them in any case.
 */
export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

/** The longest a code may be. */
export const COUPON_CODE_MAX = 30;

/**
 * How long an online checkout holds a code before it is paid.
 * While held, the use counts against the code's limits.
 * So parallel checkouts can't all use a one-time code.
 * A tokenize payment (`/checkout/pay`) with a code is refused after this.
 * The buyer then starts again.
 */
export const COUPON_HOLD_MS = 60 * 60_000;

/**
 * How the /coupons list is sorted.
 * "" = newest first, "used" = most used first.
 */
export type CouponSort = "" | "used";
