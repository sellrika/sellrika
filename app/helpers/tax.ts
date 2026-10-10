/**
 * Tax settings as they sit on a shop.
 * An order keeps a frozen copy of them from the time of the sale.
 * `tax_rate` is hundredths of a percent: 700 = 7%.
 */
export type TaxRules = { tax_rate: number; tax_included: boolean };

/**
 * The tax on `base` cents.
 * `base` is the goods after the discount. Delivery is never taxed.
 * Included: the tax is already inside the price and is backed out of it.
 * The total does not change then.
 * Added: the tax goes on top of the price.
 * Rounded to the cent either way.
 * @param base The cents the tax is worked out on.
 * @param r The tax rate and whether prices already hold the tax.
 * @returns The tax in cents.
 */
export function taxAmount(base: number, r: TaxRules): number {
	if (r.tax_rate <= 0 || base <= 0) return 0;
	return r.tax_included
		? base - Math.round((base * 10000) / (10000 + r.tax_rate))
		: Math.round((base * r.tax_rate) / 10000);
}

/**
 * The tax and the total of an order.
 * The tax is worked out on the goods after the discount.
 * A tax added on top joins the total. An included one does not.
 * The delivery fee is added last and is never taxed.
 * The caller picks the rules: the shop's for a new order,
 * the order's own frozen ones for an order that changes.
 * @param r The tax rules to use.
 * @param m The subtotal, and the discount and delivery fee (0 when left out).
 * @returns The tax and the total, in cents.
 */
export function orderTotals(
	r: TaxRules,
	m: { subtotal: number; discount?: number; delivery_fee?: number },
): { tax: number; total: number } {
	const goods = m.subtotal - (m.discount ?? 0);
	const tax = taxAmount(goods, r);
	return {
		tax,
		total: goods + (r.tax_included ? 0 : tax) + (m.delivery_fee ?? 0),
	};
}

/**
 * The tax rules a new order or cart snapshot freezes.
 * The label is kept too, so history survives a rename.
 * @param r The shop's tax settings.
 * @returns The rate, the label and the included flag.
 */
export function frozenTax<T extends TaxRules & { tax_label: string }>(r: T) {
	return {
		tax_rate: r.tax_rate,
		tax_label: r.tax_label,
		tax_included: r.tax_included,
	};
}

/**
 * How the tax line reads on receipts.
 * "VAT 7%" when added on top, "Incl. VAT 7%" when prices already hold it.
 * This helper runs in the browser and on the server.
 * So the caller passes the translated prefix in.
 * @param t The tax rules and the label.
 * @param incl The translated "Incl. " (`t("common.tax_included_prefix")`).
 * @returns The line's text.
 */
export function taxLabel(
	t: TaxRules & { tax_label: string },
	incl = "Incl. ",
): string {
	return `${t.tax_included ? incl : ""}${t.tax_label} ${t.tax_rate / 100}%`;
}
