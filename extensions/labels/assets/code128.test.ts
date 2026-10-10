import { expect, test } from "bun:test";
import { unitsOf } from "../index.ts";
import { barcodeSvg, code128, PATTERNS } from "./code128.ts";

test("code 128 table: 107 different symbols, 11 modules each, 13 for stop", () => {
	expect(PATTERNS.length).toBe(107);
	expect(new Set(PATTERNS).size).toBe(107);
	const widths = PATTERNS.map((p) => [...p].reduce((n, d) => n + Number(d), 0));
	expect(widths.slice(0, 106).every((w) => w === 11)).toBe(true);
	expect(widths[106]).toBe(13);
});

test("code 128: text in set B, digits packed in set C, an odd last digit back in B", () => {
	expect(code128("PJJ123C")).toEqual([
		104, 48, 42, 42, 17, 18, 19, 35, 55, 106,
	]);
	expect(code128("1234")).toEqual([105, 12, 34, 82, 106]);
	expect(code128("12345")).toEqual([105, 12, 34, 100, 21, 54, 106]);
	expect(code128("กาแฟ")).toBeNull();
	expect(code128("")).toBeNull();
	expect(barcodeSvg("กาแฟ")).toBe("");
	// 4 symbols of 11 modules + 13 for stop + 10 quiet on each side
	expect(barcodeSvg("1234")).toContain('viewBox="0 0 77 1"');
});

test("units: one per product, or one per variant with its own price and code", () => {
	const product = {
		id: 7,
		name: "Mug",
		price: 900,
		barcode: null,
		sku: "MUG",
		images: ["/a.webp"],
		variants: [],
	} as unknown as Parameters<typeof unitsOf>[0];
	expect(unitsOf(product)).toEqual([
		{
			key: "7",
			name: "Mug",
			variant: "",
			price: 900,
			code: "",
			image: "/a.webp",
		},
	]);
	const withVariants = {
		...product,
		variants: [
			{ id: 1, name: "Red", price: 950, barcode: "885", sku: "R", images: [] },
			{
				id: 2,
				name: "Blue",
				price: 990,
				barcode: null,
				sku: null,
				images: ["/b.webp"],
			},
		],
	} as unknown as Parameters<typeof unitsOf>[0];
	expect(unitsOf(withVariants)).toEqual([
		{
			key: "7:1",
			name: "Mug",
			variant: "Red",
			price: 950,
			code: "885",
			image: "/a.webp",
		},
		{
			key: "7:2",
			name: "Mug",
			variant: "Blue",
			price: 990,
			code: "",
			image: "/b.webp",
		},
	]);
});
