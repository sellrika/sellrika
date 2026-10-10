/**
 * Cents taken off `subtotal` for a discount.
 * Used for the POS discount and a coupon's percent / fixed maths.
 * @param subtotal The order subtotal in cents.
 * @param type "percent" (whole %) or "fixed" (cents); null = no discount.
 * @param value The percentage or the cent amount.
 * @returns The discount in cents, never more than the subtotal.
 */
export function discountAmount(
	subtotal: number,
	type: "percent" | "fixed" | null,
	value: number,
) {
	if (!type || value <= 0) return 0;
	const raw = type === "percent" ? Math.round((subtotal * value) / 100) : value;
	return Math.min(subtotal, raw);
}
