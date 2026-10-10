import { expect, test } from "bun:test";
import type { BundleItem } from "@/types";
import { createCart } from "../cart";
import { createPicker } from "../picker";
import { memoryStorage, product, variant } from "./fixtures";

/**
 * A `t()` that shows the key and its params, so tests can read them.
 * @param key The key.
 * @param params The params.
 * @returns "key" or "key {json}".
 */
function t(key: string, params?: Record<string, string | number>) {
	return params ? `${key} ${JSON.stringify(params)}` : key;
}

/** @returns An empty cart over a memory storage. */
function emptyCart() {
	return createCart({
		slug: "s",
		products: [],
		storage: memoryStorage().storage,
		onChange() {},
	});
}

// T-shirt: Colour × Size, Red/L is sold out, one fabric only
const shirt = product({
	id: 3,
	stock: null,
	variants: [
		variant({
			id: 31,
			name: "Red S",
			stock: 2,
			attributes: { Colour: "Red", Size: "S", Fabric: "Cotton" },
		}),
		variant({
			id: 32,
			name: "Red L",
			stock: 0,
			sold_out: true,
			attributes: { Colour: "Red", Size: "L", Fabric: "Cotton" },
		}),
		variant({
			id: 33,
			name: "Blue L",
			stock: null,
			attributes: { Colour: "Blue", Size: "L", Fabric: "Cotton" },
		}),
	],
});

test("guided mode: groups, single-value preselect, availability, errors", () => {
	const cart = emptyCart();
	const p = createPicker(shirt, { cart, t });
	expect(p.guided).toBe(true);
	expect(p.groups.map(nameOf)).toEqual(["Colour", "Size", "Fabric"]);
	// one fabric: already picked
	expect(p.picked).toEqual({ Fabric: "Cotton" });
	expect(p.chosen()).toBeNull();
	expect(p.error(1)).toBe(
		`store_ui.choose_to_continue ${JSON.stringify({ what: "Colour store_ui.and Size" })}`,
	);

	p.choose("Colour", "Red");
	// Red L is sold out, so L is not available with Red
	expect(p.available("Size", "L")).toBe(false);
	expect(p.available("Size", "S")).toBe(true);
	p.choose("Size", "S");
	expect(p.chosen()?.id).toBe(31);
	expect(p.canAdd()).toBe(true);
	expect(p.left()).toBe(2);
	expect(p.error(3)).toBe(
		`store_ui.only_n_left ${JSON.stringify({ count: 2 })}`,
	);
	expect(p.addToCart(3)).toBe(0);
	expect(p.addToCart(2)).toBe(2);
	expect(p.left()).toBe(0);
	expect(p.error(1)).toBe("store_ui.out_of_stock");

	// picking again clears the value
	p.choose("Size", "S");
	expect(p.picked.Size).toBe("");
	expect(p.canAdd()).toBe(false);

	// untracked stock: no limit
	p.choose("Colour", "Blue");
	p.choose("Size", "L");
	expect(p.chosen()?.id).toBe(33);
	expect(p.left()).toBeNull();
	expect(p.error(99)).toBeNull();
});

test("editing a line: preset variant, the line counts 0, add replaces it", () => {
	const cart = emptyCart();
	cart.add(shirt, shirt.variants[0]!, {}, 2);
	const p = createPicker(
		shirt,
		{ cart, t },
		{ variantId: 31, editing: "3:31:" },
	);
	expect(p.picked).toEqual({ Colour: "Red", Size: "S", Fabric: "Cotton" });
	expect(p.left()).toBe(2);
	expect(p.addToCart(1)).toBe(1);
	expect(cart.count()).toBe(1);
});

test("plain list mode when a variant has no attributes", () => {
	const cart = emptyCart();
	const cup = product({
		id: 4,
		variants: [
			variant({ id: 41, name: "Small", stock: 1 }),
			variant({ id: 42, name: "Big", attributes: { Size: "Big" }, stock: 4 }),
		],
	});
	const p = createPicker(cup, { cart, t });
	expect(p.guided).toBe(false);
	expect(p.chosen()).toBeNull();
	expect(p.error(1)).toBe("store_ui.select_option");
	p.pickVariant(42);
	expect(p.chosen()?.id).toBe(42);
	expect(p.left()).toBe(4);
	expect(p.addToCart(1)).toBe(1);
	expect(cart.lines()[0]?.key).toBe("4:42:");

	// a product with no variants is the unit itself
	const mug = createPicker(product(), { cart, t });
	expect(mug.chosen()?.id).toBe(1);
	expect(mug.left()).toBe(5);
});

test("package slots: answers, optionLeft, left and the add", () => {
	const cart = emptyCart();
	const pens: BundleItem = {
		id: 7,
		product_id: 50,
		qty: 2,
		name: "Pen",
		active: true,
		options: [
			{ variant_id: 71, name: "Blue", price: 100, stock: 6 },
			{ variant_id: 72, name: "Black", price: 100, stock: 1 },
		],
	};
	const pad: BundleItem = {
		id: 8,
		product_id: 51,
		qty: 1,
		name: "Pad",
		active: true,
		options: [{ variant_id: null, name: "Pad", price: 300, stock: 10 }],
	};
	const kit = product({
		id: 5,
		kind: "bundle",
		stock: null,
		bundle_items: [pens, pad],
	});
	const p = createPicker(kit, { cart, t });
	// only the slot with 2+ options asks
	expect(p.slots.map(nameOf)).toEqual(["Pen"]);
	expect(p.canAdd()).toBe(false);
	expect(p.error(1)).toBe(
		`store_ui.choose_to_continue ${JSON.stringify({ what: "Pen" })}`,
	);
	expect(p.optionLeft(7, 71)).toBe(3); // 6 / 2
	expect(p.optionLeft(7, 72)).toBe(0); // 1 / 2
	expect(p.optionLeft(8, null)).toBe(10);

	p.pickSlot(7, 71);
	expect(p.choices).toEqual({ 7: 71 });
	expect(p.canAdd()).toBe(true);
	expect(p.left()).toBe(3); // min(6/2, 10/1)
	expect(p.addToCart(2)).toBe(2);
	expect(cart.lines()[0]).toMatchObject({
		key: "5::7=71",
		variant_name: "2 × Blue",
	});
	expect(p.left()).toBe(1);

	// picking the same option again clears it
	p.pickSlot(7, 71);
	expect(p.choices).toEqual({});
});

/**
 * @param x Anything with a name.
 * @returns The name.
 */
function nameOf(x: { name: string }) {
	return x.name;
}

test("custom request: nothing is added without a note, each note makes its own line, editing keeps it", () => {
	const cart = emptyCart();
	const tumbler = product({ id: 9, stock: 5, custom_request: "" });
	const p = createPicker(tumbler, { cart, t });
	expect([p.asksNote, p.noteLabel, p.noteMax]).toEqual([
		true,
		"store_ui.custom_request",
		1000,
	]);
	// empty or only spaces: refused
	p.setNote("   ");
	expect(p.addToCart(1)).toBe(0);
	p.setNote(" Anna ");
	expect(p.addToCart(1)).toBe(1);
	p.setNote("Ben");
	expect(p.addToCart(2)).toBe(2);
	p.setNote("Anna");
	expect(p.addToCart(1)).toBe(1);
	expect(
		cart.lines().map(function short(l) {
			return [l.note, l.qty];
		}),
	).toEqual([
		["Anna", 2],
		["Ben", 2],
	]);
	// the stock counts every line of the product with the same note only
	expect(p.left()).toBe(3);
	// editing a line from the cart starts from its note and replaces it
	const ben = cart.lines()[1]!;
	const edit = createPicker(
		tumbler,
		{ cart, t },
		{
			note: ben.note,
			editing: ben.key,
		},
	);
	expect(edit.note).toBe("Ben");
	edit.setNote("Benjamin");
	expect(edit.addToCart(2)).toBe(2);
	expect(
		cart.lines().map(function note(l) {
			return l.note;
		}),
	).toEqual(["Anna", "Benjamin"]);
	// a product that asks for none never gets a note, and the box is capped
	const cap = createPicker(product({ id: 10 }), { cart, t });
	cap.setNote("x".repeat(2000));
	expect([cap.asksNote, cap.note.length]).toEqual([false, 1000]);
	expect(cap.addToCart(1)).toBe(1);
	expect(cart.lines()[2]!.note).toBeUndefined();
});
