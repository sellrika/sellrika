/**
 * One extra currency a store shows its prices in.
 * `rate` = the shop's manual override:
 * 1 unit of the shop's currency = `rate` of `code`.
 * null = the automatic rate from the platform's table.
 */
export type StoreCurrency = { code: string; rate: number | null };

/**
 * A currency the store offers as the visitor sees it.
 * It holds the code and the rate that is used.
 * The shop's own currency is in the list too, with rate 1.
 */
export type DisplayCurrency = { code: string; rate: number };

/**
 * How much of `to` one unit of `from` buys.
 * It is worked out from a table of rates against one base.
 * @param rates Units of each currency per 1 of the table's base
 * (open.er-api.com shape).
 * @param from The currency converted from.
 * @param to The currency converted to.
 * @returns The rate, or null when the table lacks either currency.
 */
export function crossRate(
	rates: Record<string, number>,
	from: string,
	to: string,
): number | null {
	if (from === to) return 1;
	const a = rates[from];
	const b = rates[to];
	return a && b ? b / a : null;
}

/**
 * Integer cents of one currency → integer cents of another.
 * The app keeps every amount as 1/100 of the unit, whatever the currency.
 * @param cents The amount in the shop's currency.
 * @param rate Units of the other currency per unit of the shop's.
 * @returns The amount in the other currency, rounded to the cent.
 */
export function convertCents(cents: number, rate: number) {
	return Math.round(cents * rate);
}

/**
 * The currencies a store offers its visitors, the shop's own first.
 * A currency with no manual rate and no automatic one is left out:
 * it can't be shown.
 * @param shopCurrency The shop's own currency.
 * @param list The shop's extra currencies.
 * @param rates The platform's table (units per 1 of its base).
 * @returns `[]` when no extra currency can be shown,
 * else the shop's own + every usable one.
 */
export function storeCurrencies(
	shopCurrency: string,
	list: StoreCurrency[],
	rates: Record<string, number>,
): DisplayCurrency[] {
	const usable: DisplayCurrency[] = [];
	for (const c of list) {
		if (c.code === shopCurrency) continue;
		const rate = c.rate ?? crossRate(rates, shopCurrency, c.code);
		if (rate && rate > 0) usable.push({ code: c.code, rate });
	}
	return usable.length ? [{ code: shopCurrency, rate: 1 }, ...usable] : [];
}

/**
 * Intl's narrow symbol is wrong for a few currencies.
 * For example it gives MMK "K", but Myanmar writes "Ks".
 * ponytail: one line per fix.
 */
export const SYMBOL_OVERRIDE: Record<string, string> = { MMK: "Ks" };

/**
 * Format integer cents as money.
 * It works the same way on the server and in the browser.
 * A whole amount has no ".00": 1800 USD → "$18", 1250 USD → "$12.50".
 * @param cents The amount in cents.
 * @param currency The ISO currency code.
 * @param locale The language to format in.
 * @param opts More Intl options (they win over the defaults).
 * @returns The formatted amount, or "12.50 XYZ" for an unknown currency.
 */
export function formatMoney(
	cents: number,
	currency: string,
	locale: string,
	opts: Intl.NumberFormatOptions = {},
): string {
	try {
		const parts = new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			currencyDisplay: "narrowSymbol",
			trailingZeroDisplay: "stripIfInteger",
			...opts,
		}).formatToParts(cents / 100);
		const symbol = SYMBOL_OVERRIDE[currency];
		return parts
			.map(function part(p) {
				return symbol && p.type === "currency" ? symbol : p.value;
			})
			.join("");
	} catch {
		return `${cents % 100 ? (cents / 100).toFixed(2) : cents / 100} ${currency}`;
	}
}
