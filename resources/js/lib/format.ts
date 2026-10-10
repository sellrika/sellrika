import { locale } from "@/lib/i18n";
import { formatMoney, SYMBOL_OVERRIDE } from "@helpers/currency";

/**
 * Format integer cents as currency: money(1250, "USD") → "$12.50", money(1800, "USD") → "$18".
 * A whole amount has no ".00". `opts` passes through to Intl (see shortMoney in Reports).
 * @param cents The amount in cents.
 * @param currency The ISO currency code.
 * @param opts More Intl options.
 * @returns The formatted amount, in the page's language.
 */
export function money(
	cents: number,
	currency = "USD",
	opts: Intl.NumberFormatOptions = {},
) {
	return formatMoney(cents, currency, locale(), opts);
}

/** Parse a user-typed amount ("12.50") into integer cents. */
export const toCents = (v: string | number) =>
	Math.round(Number(String(v).replace(/[^0-9.-]/g, "")) * 100) || 0;
export const fromCents = (c: number) => (c / 100).toFixed(2);

/** DB timestamps arrive as "YYYY-MM-DD HH:MM:SS" (UTC) or ISO; render in the page's language. */
export function fmtDate(
	s: string,
	opts: Intl.DateTimeFormatOptions = {
		dateStyle: "medium",
		timeStyle: "short",
	},
) {
	return toDate(s).toLocaleString(locale(), opts);
}
export function toDate(s: string) {
	const iso = /^\d{4}-\d{2}-\d{2} /.test(s) ? `${s.replace(" ", "T")}Z` : s;
	return new Date(iso);
}

/** Short currency symbol, e.g. "USD" → "$", "THB" → "฿", "CHF" → "CHF". */
export function currencySymbol(currency: string) {
	if (SYMBOL_OVERRIDE[currency]) return SYMBOL_OVERRIDE[currency];
	try {
		const parts = new Intl.NumberFormat(locale(), {
			style: "currency",
			currency,
			currencyDisplay: "narrowSymbol",
		}).formatToParts(0);
		return parts.find((p) => p.type === "currency")?.value ?? currency;
	} catch {
		return currency;
	}
}

/** "50 g" — how much one unit holds, with its unit; "" when the amount is not set. */
export const packSize = (p: { amount: number | null; unit: string | null }) =>
	p.amount == null ? "" : `${p.amount} ${p.unit ?? ""}`.trim();

/** Rich-text HTML → plain text, for one-line previews (product list) where markup can't render. */
export const plain = (html: string) =>
	// tags → spaces first (textContent alone would run "<p>a</p><p>b</p>" together as "ab"), then parse to decode entities
	(
		new DOMParser().parseFromString(html.replace(/<[^>]*>/g, " "), "text/html")
			.body.textContent ?? ""
	)
		.replace(/\s+/g, " ")
		.trim();
