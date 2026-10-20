import { expect, test } from "bun:test";
import { fromCents, packSize, toCents, toDate } from "../format";

test("toCents: a typed amount becomes whole cents", () => {
	expect(toCents("12.50")).toBe(1250);
	expect(toCents("$1,234.5")).toBe(123450);
	expect(toCents(0.1 + 0.2)).toBe(30); // no float leftovers
	expect(toCents("-3")).toBe(-300);
});

test("toCents: text that is not a number is 0", () => {
	expect(toCents("")).toBe(0);
	expect(toCents("abc")).toBe(0);
	expect(toCents("1.2.3")).toBe(0);
});

test("fromCents: cents become an amount with two decimals", () => {
	expect(fromCents(1250)).toBe("12.50");
	expect(fromCents(1800)).toBe("18.00");
	expect(fromCents(5)).toBe("0.05");
});

test("toDate: a database time is read as UTC, an ISO time as is", () => {
	expect(toDate("2026-10-19 08:30:00").toISOString()).toBe(
		"2026-10-19T08:30:00.000Z",
	);
	expect(toDate("2026-10-19T08:30:00+07:00").toISOString()).toBe(
		"2026-10-19T01:30:00.000Z",
	);
});

test("packSize: the amount with its unit, or empty when not set", () => {
	expect(packSize({ amount: 50, unit: "g" })).toBe("50 g");
	expect(packSize({ amount: 2, unit: null })).toBe("2");
	expect(packSize({ amount: null, unit: "g" })).toBe("");
});
