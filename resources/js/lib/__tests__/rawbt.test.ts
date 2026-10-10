import { expect, test } from "bun:test";
import { rasterBytes, receiptLines, type SlipLine } from "../rawbt";
import type { Order } from "@/types";

const order = {
	id: 7,
	status: "completed",
	subtotal: 1500,
	discount_type: "percent",
	discount_value: 10,
	discount: 150,
	total: 1350,
	paid: 2000,
	change: 650,
	refunded: 0,
	payment_method: "Cash",
	created_at: "2026-08-25 10:00:00",
	cashier: "Ada",
	customer: null,
	note: "Deliver to: Ann Shopper · 555-0100\n1 Main St\nSpringfield, IL 62701\nUnited States",
	items: [
		{ name: "Coffee", price: 500, qty: 3 },
		{ name: "A very long product name that will not fit", price: 0, qty: 1 },
	],
} as unknown as Order;

/**
 * The slip lines as plain text, one per line: "text | amount".
 * @param lines The slip lines.
 * @returns The text.
 */
function plain(lines: SlipLine[]) {
	return lines
		.map(function one(l) {
			if (l === "rule") return "---";
			return l.right ? `${l.text} | ${l.right}` : l.text;
		})
		.join("\n");
}

test("the receipt has every line, with its amount", () => {
	const out = plain(receiptLines(order, "USD", "Shop"));
	expect(out).toStartWith("Shop\n");
	expect(out).toContain("3 x Coffee | $15");
	expect(out).toContain("Subtotal | $15");
	expect(out).toContain("Discount (10%) | -$1.50");
	expect(out).toContain("TOTAL | $13.50");
	expect(out).toContain("Change | $6.50");
});

test("an order not paid in full prints what is due, not change", () => {
	const unpaid = { ...order, paid: 0, change: 0, payment_status: "unpaid" };
	const out = plain(receiptLines(unpaid as Order, "USD", "Shop"));
	expect(out).toContain("Due | $13.50");
	expect(out).not.toContain("Change");
});

test("non-Latin names are kept whole", () => {
	const thai = { ...order, items: [{ name: "ผัดไทยกุ้ง", price: 12000, qty: 1 }] };
	const out = plain(receiptLines(thai as unknown as Order, "THB", "ร้าน"));
	expect(out).toContain("1 x ผัดไทยกุ้ง | ");
});

test("the order note prints the Deliver to line, then the address on one line", () => {
	const out = plain(receiptLines(order, "USD", "Shop"));
	expect(out).toContain("Deliver to: Ann Shopper · 555-0100");
	expect(out).toContain("1 Main St, Springfield, IL 62701, United States");
});

test("a picture becomes one bit per dot, dark = printed", () => {
	// 16 x 2 pixels: the first pixel of row 0 and the last pixel of row 1 are black
	const data = new Uint8Array(16 * 2 * 4).fill(255);
	data.fill(0, 0, 3);
	data.fill(0, 31 * 4, 31 * 4 + 3);
	expect(rasterBytes({ data, width: 16, height: 2 })).toEqual([
		0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0x80, 0x00, 0x00, 0x01,
	]);
});

test("a tall picture is sent in strips", () => {
	const data = new Uint8Array(8 * 450 * 4).fill(255);
	const out = rasterBytes({ data, width: 8, height: 450 });
	// three strips: 200 + 200 + 50 rows, 8 header bytes each
	expect(out.length).toBe(450 + 3 * 8);
	// the last strip starts after two strips of 8 + 200 bytes
	expect(out.slice(416, 424)).toEqual([0x1d, 0x76, 0x30, 0, 1, 0, 50, 0]);
});
