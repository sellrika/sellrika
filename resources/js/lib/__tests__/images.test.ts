import { expect, test } from "bun:test";
import { galleryOf } from "../images";

const product = {
	images: ["p1.webp", "p2.webp"],
	variants: [{ images: ["red.webp", "p1.webp"] }, { images: ["blue.webp"] }],
};

test("galleryOf: the product's photos, then each variant's, without repeats", () => {
	expect(galleryOf(product)).toEqual([
		"p1.webp",
		"p2.webp",
		"red.webp",
		"blue.webp",
	]);
});

test("galleryOf: the chosen variant's photos lead, the rest only move", () => {
	expect(galleryOf(product, product.variants[1])).toEqual([
		"blue.webp",
		"p1.webp",
		"p2.webp",
		"red.webp",
	]);
	expect(galleryOf(product, null)).toEqual(galleryOf(product));
});

test("galleryOf: a product with no variants and no photos is an empty strip", () => {
	expect(galleryOf({ images: [] })).toEqual([]);
	expect(galleryOf({ images: ["p1.webp"] }, { images: [] })).toEqual([
		"p1.webp",
	]);
});
