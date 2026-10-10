import { expect, test } from "bun:test";
import { availableFor, chosenNames, hasChoices, lineKey } from "../bundles";
import { contentsOf } from "../bundleLabels";
import type { BundleItem } from "@/types";

// "Pen — 1 dozen": 12 × Pen [Red 10 on hand | Blue 30] + 1 × Notebook (untracked)
const pens: BundleItem = {
	id: 1,
	product_id: 5,
	qty: 12,
	name: "Pen",
	active: true,
	options: [
		{ variant_id: 11, name: "Red", price: 250, stock: 10 },
		{ variant_id: 12, name: "Blue", price: 250, stock: 30 },
	],
};
const notebook: BundleItem = {
	id: 2,
	product_id: 6,
	qty: 1,
	name: "Notebook",
	active: true,
	options: [{ variant_id: null, name: "Notebook", price: 900, stock: null }],
};
const pack = { bundle_items: [pens, notebook] };

test("availability is the min over slots of ⌊stock / qty⌋ for the chosen options", () => {
	expect(availableFor(pack, { 1: 12 })).toBe(2); // 30 Blue / 12
	expect(availableFor(pack, { 1: 11 })).toBe(0); // 10 Red / 12
	expect(availableFor({ bundle_items: [notebook] }, {})).toBeNull(); // nothing tracked
	expect(availableFor(pack, {})).toBe(0); // unanswered choice
	expect(availableFor(pack, { 1: 99 })).toBe(0); // stale variant
});

test("choices, names and labels", () => {
	expect(hasChoices(pack)).toBe(true);
	expect(hasChoices({ bundle_items: [notebook] })).toBe(false);
	expect(chosenNames(pack, { 1: 11 })).toBe("12 × Red"); // fixed slots stay out of the line name
	expect(chosenNames({ bundle_items: [notebook] }, {})).toBeNull();
	expect(contentsOf(pack)).toBe("12 × Pen (Red or Blue) · 1 × Notebook");
});

test("cart key separates variants and choices, and is order-insensitive", () => {
	expect(lineKey(3, null)).toBe("3::");
	expect(lineKey(3, 7)).toBe("3:7:");
	expect(lineKey(3, null, { 2: 9, 1: 11 })).toBe(
		lineKey(3, null, { 1: 11, 2: 9 }),
	);
	expect(lineKey(3, null, { 1: 11 })).not.toBe(lineKey(3, null, { 1: 12 }));
});
