import { expect, test } from "bun:test";
import {
	convertCents,
	crossRate,
	formatMoney,
	storeCurrencies,
} from "@helpers/currency";

const RATES = { USD: 1, EUR: 0.5, THB: 35 };

test("crossRate: through the table's base, 1 for the same currency, null when one is missing", () => {
	expect(crossRate(RATES, "THB", "EUR")).toBeCloseTo(0.5 / 35);
	expect(crossRate(RATES, "EUR", "THB")).toBe(70);
	expect(crossRate(RATES, "EUR", "EUR")).toBe(1);
	expect(crossRate(RATES, "EUR", "JPY")).toBeNull();
});

test("convertCents rounds to the cent", () => {
	expect(convertCents(1000, 0.0285714)).toBe(29);
	expect(convertCents(1999, 1.5)).toBe(2999);
});

test("storeCurrencies: own first, manual beats automatic, no rate = left out", () => {
	expect(storeCurrencies("THB", [], RATES)).toEqual([]);
	expect(
		storeCurrencies(
			"THB",
			[
				{ code: "USD", rate: null }, // automatic
				{ code: "EUR", rate: 0.03 }, // the shop's own
				{ code: "JPY", rate: null }, // no rate anywhere
				{ code: "THB", rate: 2 }, // its own currency is never an extra
			],
			RATES,
		),
	).toEqual([
		{ code: "THB", rate: 1 },
		{ code: "USD", rate: 1 / 35 },
		{ code: "EUR", rate: 0.03 },
	]);
	// only unusable extras → nothing to switch to
	expect(storeCurrencies("THB", [{ code: "JPY", rate: null }], RATES)).toEqual(
		[],
	);
});

test("formatMoney: no .00 on whole amounts, the MMK fix, a fallback for unknown codes", () => {
	expect(formatMoney(1800, "USD", "en")).toBe("$18");
	expect(formatMoney(1823, "USD", "en")).toBe("$18.23");
	expect(formatMoney(150000, "MMK", "en").replace(/\s/g, " ")).toBe("Ks 1,500");
	expect(formatMoney(1250, "EUR", "de").replace(/\s/g, " ")).toBe("12,50 €");
	expect(formatMoney(1250, "NOPE!", "en")).toBe("12.50 NOPE!");
});
