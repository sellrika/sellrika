import { z } from "zod";
import { TIMEZONES } from "@constants/Shop.Constant";
import { Storage } from "@xcore/storage/Storage";
import { personName } from "@validators/Fields.Validator";

/** The time zones a shop may pick, for a fast lookup. */
const tzSet = new Set(TIMEZONES);

/**
 * The shop form: a shop's name, currency, logo, time zone and tax.
 * POST /shops and PUT /shops/:id.
 * The sign-up form reuses its name, currency and time zone rules.
 * Not here: the support email (order emails) and delivery
 * (country, prices, pick-up…).
 * They are set on /online-store (`Store.Validator.ts`).
 */
export const ShopInput = z.object({
	/** The shop's name. Needed, at most 100 characters. */
	name: personName,
	/**
	 * The currency the shop sells in.
	 * A 3-letter code, kept in upper case, like `USD`.
	 */
	currency: z
		.string()
		.trim()
		.toUpperCase()
		.length(3, "validation.currency_code_3"),
	/**
	 * The shop's logo: one of our own uploads.
	 * null = no logo.
	 */
	logo: z
		.string()
		.refine((s) => Storage.isUploadUrl(s), "validation.invalid_image")
		.nullable()
		.default(null),
	/**
	 * The shop's time zone, like `Asia/Bangkok`.
	 * It decides what "today" is and how reports are grouped.
	 * Left out = `UTC`.
	 */
	timezone: z
		.string()
		.trim()
		.default("UTC")
		.refine(
			(s) => s === "UTC" || tzSet.has(s),
			"validation.pick_valid_timezone",
		),
	/**
	 * The tax / VAT rate (migration 0041).
	 * In hundredths of a percent: 750 = 7.5%.
	 * 0 = no tax. At most 10000 (100%).
	 */
	tax_rate: z
		.number()
		.int()
		.min(0)
		.max(10000, "validation.tax_rate_max")
		.default(0),
	/**
	 * The name of the tax line, like "VAT".
	 * At most 20 characters. Left out = "Tax".
	 */
	tax_label: z
		.string()
		.trim()
		.min(1, "validation.tax_label_required")
		.max(20)
		.default("Tax"),
	/**
	 * True when the prices already include the tax.
	 * False = the tax is added on top of the total.
	 */
	tax_included: z.boolean().default(false),
});
/** A checked `ShopInput`. */
export type ShopInput = z.infer<typeof ShopInput>;
