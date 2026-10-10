import { expect, test } from "bun:test";
import { taxAmount, taxLabel } from "../tax";

test("taxAmount: added on top vs backed out of an inclusive price, rounded to the cent, 0 when off", () => {
	expect(taxAmount(10000, { tax_rate: 700, tax_included: false })).toBe(700); // 7% on $100
	expect(taxAmount(10700, { tax_rate: 700, tax_included: true })).toBe(700); // $107 already holds $7
	expect(taxAmount(1005, { tax_rate: 750, tax_included: false })).toBe(75); // 75.375 → 75
	expect(taxAmount(999, { tax_rate: 2000, tax_included: true })).toBe(166); // 999 − round(832.5) = 999 − 833 (JS rounds .5 up)
	expect(taxAmount(10000, { tax_rate: 0, tax_included: false })).toBe(0);
	expect(taxAmount(0, { tax_rate: 700, tax_included: false })).toBe(0);
	expect(taxAmount(-5, { tax_rate: 700, tax_included: true })).toBe(0);
});

test("taxLabel: rate as a plain percent, 'Incl.' when the prices already hold it", () => {
	expect(
		taxLabel({ tax_label: "VAT", tax_rate: 700, tax_included: false }),
	).toBe("VAT 7%");
	expect(
		taxLabel({ tax_label: "GST", tax_rate: 750, tax_included: true }),
	).toBe("Incl. GST 7.5%");
});
