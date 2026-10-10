import { expect, test } from "bun:test";
import { invoiceNumber, refusal, sums } from "./utils.ts";

const paid = {
	status: "completed",
	payment_status: "paid",
	tax: 700,
	total: 10700,
	delivery_fee: 0,
} as const;

test("invoiceNumber is the prefix and the order's code, or its id", () => {
	expect(invoiceNumber("INV-", { id: 7, reference: "9JDW-QTGP-FR7U" })).toBe(
		"INV-9JDW-QTGP-FR7U",
	);
	expect(invoiceNumber("INV-", { id: 7, reference: null })).toBe("INV-7");
});

test("refusal: only a paid, live order with tax gets an invoice", () => {
	expect(refusal(paid)).toBeNull();
	expect(refusal({ ...paid, status: "voided" })).toBe("refuse.cancelled");
	expect(refusal({ ...paid, payment_status: "unpaid" })).toBe("refuse.unpaid");
	expect(refusal({ ...paid, tax: 0 })).toBe("refuse.no_tax");
});

test("sums: the value is the total less the tax and the delivery fee", () => {
	// tax added on top, with a delivery fee
	expect(sums({ ...paid, total: 11200, delivery_fee: 500 })).toEqual({
		value: 10000,
		tax: 700,
		delivery: 500,
		total: 11200,
	});
	// tax inside the prices: the total stays what the buyer paid
	expect(sums({ ...paid, total: 10700 }).value).toBe(10000);
});
