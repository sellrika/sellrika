import { expect, test } from "bun:test";
import { displaySale, parseCart, paymentKey } from "../display";

test("parseCart: the saved cart, or null when it is missing or broken", () => {
	const saved = { cart: [{ id: 1 }], customer: null };
	expect(parseCart(JSON.stringify(saved))).toEqual(saved);
	expect(parseCart(null)).toBeNull();
	expect(parseCart("not json")).toBeNull();
	expect(parseCart(JSON.stringify({ cart: "x" }))).toBeNull();
	expect(parseCart("[]")).toBeNull();
});

test("displaySale: line totals, a unit count and a trimmed note", () => {
	const sale = displaySale(
		[
			{ name: "Latte", variant_name: "Large", qty: 2, price: 450, image: null },
			{
				name: "Bagel",
				variant_name: null,
				qty: 3,
				price: 300,
				image: "/b.png",
				note: "  toasted ",
			},
			{
				name: "Tea",
				variant_name: null,
				qty: 1,
				price: 200,
				image: null,
				note: "  ",
			},
		],
		{ subtotal: 2000, discount: 100, tax: 0, total: 1900 },
		"Ann",
		"USD",
	);
	expect(sale.lines.map((l) => l.total)).toEqual([900, 900, 200]);
	expect(sale.lines.map((l) => l.note)).toEqual([null, "toasted", null]);
	expect(sale.lines[0]!.variant).toBe("Large");
	expect(sale.count).toBe(6);
	expect(sale).toMatchObject({ customer: "Ann", total: 1900, currency: "USD" });
});

test("paymentKey: one key per shop", () => {
	expect(paymentKey(7)).toBe("display:7");
});
