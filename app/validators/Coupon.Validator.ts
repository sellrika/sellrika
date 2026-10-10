import { z } from "zod";
import { t } from "@xcore/i18n/I18n";
import type { Key } from "@i18n";
import {
	COUPON_CODE_MAX,
	COUPON_CODE_RE,
	COUPON_TYPES,
} from "@constants/Coupon.Constant";
import {
	MAX_COUPON_EMAILS,
	MAX_COUPON_SCOPE,
	MAX_PAID_CENTS,
} from "@constants/Security.Constant";
import { YMD_OR_BLANK_PATTERN } from "@constants/Validation.Constant";
import { blankToNull, isEmail } from "@validators/Fields.Validator";

/**
 * An "at most N" message whose number comes from a constant.
 * The text is built while the form is checked,
 * because that is when the request's language is known.
 * @param key The message key.
 * @param max The number the message names.
 * @returns The `error` option for a zod check.
 */
function atMost(key: Key, max: number) {
	return {
		error: function text() {
			return t(key, { max });
		},
	};
}

/** A `YYYY-MM-DD` day (in the shop's time zone), blank = open ended. */
const day = z
	.string()
	.trim()
	.regex(YMD_OR_BLANK_PATTERN, "validation.enter_a_date")
	.nullable()
	.default("")
	.transform(blankToNull);
/** A positive whole number or blank = no limit. */
const limit = z
	.number()
	.int()
	.min(1, "validation.at_least_1")
	.nullable()
	.default(null);
/** A money amount in whole cents, 0 or more. */
const cents = z
	.number()
	.int()
	.min(0, "validation.cant_be_negative")
	.max(MAX_PAID_CENTS, "validation.too_large");

/** The fields of a discount code, before the rules that span several. */
const CouponFields = z.object({
	/**
	 * The code the buyer types.
	 * Kept in upper case. 3 to 30 characters:
	 * letters, digits, `_` and `-`. Unique per shop.
	 */
	code: z
		.string()
		.trim()
		.toUpperCase()
		.min(3, "validation.at_least_3_chars")
		.max(COUPON_CODE_MAX, atMost("validation.at_most_chars", COUPON_CODE_MAX))
		.regex(COUPON_CODE_RE, "validation.code_charset"),
	/**
	 * A note for the shop about the code.
	 * At most 200 characters. Left out = "".
	 */
	description: z
		.string()
		.trim()
		.max(200, "validation.keep_under_200_chars")
		.default(""),
	/**
	 * What the code gives:
	 * `percent` = a share of the goods,
	 * `fixed` = an amount in cents,
	 * `free_delivery` = no delivery fee.
	 */
	type: z.enum(COUPON_TYPES, { message: "validation.choose_discount_type" }),
	/**
	 * How much the code gives:
	 * a percent (1 to 100) for `percent`, cents for `fixed`.
	 * A free-delivery code has none: it is saved as 0.
	 */
	value: cents.default(0),
	/**
	 * The goods must be worth at least this, in cents.
	 * 0 = no minimum.
	 */
	min_subtotal: cents.default(0),
	/**
	 * The most a percent code may take off, in cents.
	 * null = no cap. Other types lose it.
	 */
	max_discount: z
		.number()
		.int()
		.min(1, "validation.at_least_1")
		.max(MAX_PAID_CENTS, "validation.too_large")
		.nullable()
		.default(null),
	/**
	 * The first day the code works.
	 * `YYYY-MM-DD` on the shop's clock, inclusive.
	 * Blank = no first day (saved as null).
	 */
	starts_at: day,
	/**
	 * The last day the code works.
	 * `YYYY-MM-DD` on the shop's clock, inclusive.
	 * Blank = no last day (saved as null).
	 */
	ends_at: day,
	/**
	 * How many times the code may be used in all.
	 * null = no limit.
	 */
	usage_limit: limit,
	/**
	 * How many times one buyer may use the code.
	 * Buyers are told apart by their email.
	 * null = no limit.
	 */
	per_customer_limit: limit,
	/**
	 * Only these products get the discount, 200 at most.
	 * [] = no product limit. Repeats are dropped.
	 */
	product_ids: z
		.array(z.number().int())
		.max(
			MAX_COUPON_SCOPE,
			atMost("validation.at_most_products", MAX_COUPON_SCOPE),
		)
		.default([]),
	/**
	 * Only products of these categories get the discount,
	 * 200 at most. [] = no category limit. Repeats are dropped.
	 */
	category_ids: z
		.array(z.number().int())
		.max(
			MAX_COUPON_SCOPE,
			atMost("validation.at_most_categories", MAX_COUPON_SCOPE),
		)
		.default([]),
	/**
	 * Only these buyers may use the code, 500 at most.
	 * Kept in lower case. [] = everyone. Repeats are dropped.
	 */
	emails: z
		.array(
			z
				.string()
				.trim()
				.toLowerCase()
				.max(200)
				.refine(isEmail, "validation.enter_valid_emails"),
		)
		.max(
			MAX_COUPON_EMAILS,
			atMost("validation.at_most_customers", MAX_COUPON_EMAILS),
		)
		.default([]),
	/** False = the code is switched off. Left out = on. */
	active: z.boolean().default(true),
});
/** The checked fields of a discount code. */
type CouponFields = z.infer<typeof CouponFields>;

/**
 * The rules that span several fields of a discount code.
 * A percent is 1 to 100, a fixed amount is at least 1,
 * and the last day is not before the first.
 * @param d The form.
 * @param ctx Where the problems are written.
 */
function couponRules(d: CouponFields, ctx: z.core.$RefinementCtx) {
	if (d.type === "percent" && (d.value < 1 || d.value > 100))
		ctx.addIssue({
			code: "custom",
			path: ["value"],
			message: "validation.percent_1_100",
		});
	if (d.type === "fixed" && d.value < 1)
		ctx.addIssue({
			code: "custom",
			path: ["value"],
			message: "validation.enter_discount_amount",
		});
	if (d.starts_at && d.ends_at && d.ends_at < d.starts_at)
		ctx.addIssue({
			code: "custom",
			path: ["ends_at"],
			message: "validation.end_before_start",
		});
}

/**
 * Tidy a discount code before it is saved.
 * A free-delivery code has no value.
 * Only a percentage needs a cap, so the others lose `max_discount`.
 * Repeats are dropped from the three lists.
 * @param d The checked form.
 * @returns The form to save.
 */
function tidyCoupon(d: CouponFields): CouponFields {
	return {
		...d,
		value: d.type === "free_delivery" ? 0 : d.value,
		max_discount: d.type === "percent" ? d.max_discount : null,
		product_ids: [...new Set(d.product_ids)],
		category_ids: [...new Set(d.category_ids)],
		emails: [...new Set(d.emails)],
	};
}

/**
 * The admin's discount code form.
 * POST /coupons and PUT /coupons/:id.
 * The REST API uses it too (`/api/v1/coupons`).
 * Money is integer cents; `value` is a percent for `percent` codes.
 */
export const CouponInput =
	CouponFields.superRefine(couponRules).transform(tidyCoupon);
/** A checked `CouponInput`. */
export type CouponInput = z.infer<typeof CouponInput>;
