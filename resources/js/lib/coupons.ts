import { money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Coupon } from "@/types";

/** What a code takes off, in words ("10% off (up to $5.00)", "$5.00 off", "Free delivery"). */
export function couponLabel(
	c: Pick<Coupon, "type" | "value" | "max_discount">,
	currency: string,
) {
	if (c.type === "free_delivery") return t("coupons.type_free_delivery");
	if (c.type === "fixed")
		return t("coupons.label_fixed_off", { amount: money(c.value, currency) });
	return c.max_discount
		? t("coupons.label_percent_off_capped", {
				percent: c.value,
				cap: money(c.max_discount, currency),
			})
		: t("coupons.label_percent_off", { percent: c.value });
}
