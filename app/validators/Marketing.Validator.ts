import { z } from "zod";
import {
	ABANDONED_CART_DELAYS,
	CAMPAIGN_MAX_PRODUCTS,
	CAMPAIGN_MAX_RECIPIENTS,
	type AbandonedCartDelay,
} from "@constants/Marketing.Constant";
import { YMD_OR_BLANK_PATTERN } from "@constants/Validation.Constant";

/**
 * The abandoned-cart email's switch and its delay.
 * PUT /marketing/abandoned.
 * The REST API uses it too (PUT /api/v1/marketing/abandoned-cart).
 */
export const AbandonedInput = z.object({
	/** True = the shop sends the abandoned-cart email. */
	enabled: z.boolean().default(false),
	/**
	 * How long after the cart was left the email goes out.
	 * In hours: 1, 4, 12 or 24.
	 */
	hours: z
		.number()
		/**
		 * Is the delay one the app offers?
		 * @param h The hours.
		 * @returns True for 1, 4, 12 or 24.
		 */
		.refine(function listed(h) {
			return (ABANDONED_CART_DELAYS as readonly number[]).includes(h);
		}, "validation.pick_delay")
		/**
		 * Give the checked number its exact type.
		 * @param h The hours, already checked.
		 * @returns The same number, typed as a delay.
		 */
		.transform(function narrow(h) {
			return h as AbandonedCartDelay;
		}),
});
/** A checked `AbandonedInput`. */
export type AbandonedInput = z.infer<typeof AbandonedInput>;

/**
 * A list of row ids, without repeats.
 * @param max At most this many.
 * @returns The schema.
 */
function ids(max: number) {
	return z
		.array(z.number().int().positive())
		.max(max, "validation.too_many")
		.default([])
		.transform(function unique(list) {
			// Each id once, in the same order.
			return [...new Set(list)];
		});
}

/**
 * The campaign form.
 * POST /marketing/campaigns and PUT /marketing/campaigns/:id.
 * The REST API uses it too (`/api/v1/marketing/campaigns`).
 * `body` is rich text, sanitised in CampaignService before it is stored.
 */
export const CampaignInput = z.object({
	/** The email's subject line. Needed, at most 200 characters. */
	subject: z
		.string()
		.trim()
		.min(1, "validation.subject_required")
		.max(200, "validation.keep_under_200_chars"),
	/**
	 * The email's text, as rich text (HTML).
	 * Left out = "".
	 */
	body: z.string().max(200000, "validation.too_large").default(""),
	/**
	 * The products shown as cards in the email, 6 at most.
	 * Repeats are dropped.
	 */
	product_ids: ids(CAMPAIGN_MAX_PRODUCTS),
	/**
	 * The customers who get the email, 5000 at most.
	 * Repeats are dropped.
	 */
	customer_ids: ids(CAMPAIGN_MAX_RECIPIENTS),
});
/** A checked `CampaignInput`. */
export type CampaignInput = z.infer<typeof CampaignInput>;

/**
 * When a campaign goes out.
 * POST /marketing/campaigns/:id/schedule.
 * The REST API uses it too.
 * `now` = "Send now"; otherwise `date` + `time` on the shop's clock.
 */
export const ScheduleInput = z
	.object({
		/** True = send it right away. */
		now: z.boolean().default(false),
		/**
		 * The day to send it, `YYYY-MM-DD` on the shop's clock.
		 * Needed unless `now` is true.
		 */
		date: z
			.string()
			.regex(YMD_OR_BLANK_PATTERN, "validation.enter_a_date")
			.default(""),
		/**
		 * The time to send it, `HH:MM` on the shop's clock.
		 * Needed unless `now` is true.
		 */
		time: z
			.string()
			.regex(/^(\d{2}:\d{2})?$/, "validation.enter_a_time")
			.default(""),
	})
	.refine(
		/**
		 * Is it clear when to send?
		 * @param d The form.
		 * @returns True for "Send now", or when a day and a time are given.
		 */
		function complete(d) {
			return d.now || (!!d.date && !!d.time);
		},
		{ path: ["date"], message: "validation.enter_a_date" },
	);
/** A checked `ScheduleInput`. */
export type ScheduleInput = z.infer<typeof ScheduleInput>;
