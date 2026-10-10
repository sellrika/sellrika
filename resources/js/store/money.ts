import {
	convertCents,
	type DisplayCurrency,
	formatMoney,
} from "@helpers/currency";

/**
 * A store price as the visitor sees it.
 * It is in the currency they picked (display only), else the shop's own.
 * @param store The shop currency and the visitor's pick (null = none).
 * @param cents The amount in the shop's currency.
 * @param locale The page language.
 * @returns The formatted amount.
 */
export function storeMoney(
	store: { currency: string; display: DisplayCurrency | null },
	cents: number,
	locale: string,
) {
	const d = store.display;
	if (!d) return formatMoney(cents, store.currency, locale);
	return formatMoney(convertCents(cents, d.rate), d.code, locale);
}

/**
 * The whole % off when the original price is above the price.
 * @param p The product's price and original price.
 * @returns 20 for "−20%", or null when there is no discount.
 */
export function discountPct(p: {
	price: number;
	original_price: number | null;
}) {
	if (!p.original_price || p.original_price <= p.price) return null;
	return Math.round((1 - p.price / p.original_price) * 100);
}
