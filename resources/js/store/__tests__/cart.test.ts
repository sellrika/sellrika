import { expect, test } from "bun:test";
import type { BundleItem } from "@/types";
import { CART_TTL_MS, type CartChange, createCart } from "../cart";
import type { StoreCartLine } from "../types";
import { memoryStorage, product, variant } from "./fixtures";

const KEY = "store-cart:shop";

/**
 * A cart over a fresh storage.
 * @param products The products on the page.
 * @param saved What storage holds before the page loads.
 * @param at The clock.
 * @returns The cart, the storage map and the events seen.
 */
function setup(
	products = [product()],
	saved?: unknown,
	at = { now: 1_000_000 },
) {
	const { storage, map } = memoryStorage();
	if (saved !== undefined) map.set(KEY, JSON.stringify(saved));
	const events: CartChange[] = [];
	const cart = createCart({
		slug: "shop",
		products,
		storage,
		onChange(c) {
			events.push(c);
		},
		now() {
			return at.now;
		},
	});
	return { cart, map, events, at };
}

/**
 * A saved line with safe defaults.
 * @param over The fields to change.
 * @returns The line.
 */
function line(over: Partial<StoreCartLine> = {}): StoreCartLine {
	return {
		key: "1::",
		product_id: 1,
		variant_id: null,
		name: "Mug",
		variant_name: null,
		image: null,
		price: 500,
		qty: 2,
		stock: 9,
		choices: {},
		...over,
	};
}

test("add caps at stock, setQty and remove, events and storage", () => {
	const { cart, map, events } = setup();
	const mug = product();
	// stock 5: 3 go in, then only 2 more fit
	expect(cart.add(mug, null, {}, 3)).toBe(3);
	expect(cart.add(mug, null, {}, 4)).toBe(2);
	expect(cart.add(mug)).toBe(0);
	expect(cart.count()).toBe(5);
	expect(cart.subtotal()).toBe(5000);
	expect(events.at(-1)?.added).toBe(2);
	expect(cart.lines()[0]).toMatchObject({
		key: "1::",
		name: "Mug",
		image: "/uploads/mug.png",
		slug: "mug",
		stock: 5,
	});
	// storage round-trip: the same shape the checkout reads
	const saved = JSON.parse(map.get(KEY)!);
	expect(saved.at).toBe(1_000_000);
	expect(saved.lines).toEqual(cart.lines());

	cart.setQty("1::", 9); // clamped to stock
	expect(cart.count()).toBe(5);
	cart.setQty("1::", 2);
	expect(cart.count()).toBe(2);
	expect(events.at(-1)?.added).toBeUndefined();
	cart.setQty("1::", 0); // below 1 removes
	expect(cart.lines()).toEqual([]);
	expect(map.has(KEY)).toBe(false);

	// a variant: its own key, price and stock
	const red = variant();
	const tee = product({ id: 2, variants: [red], stock: null });
	expect(cart.add(tee, red, {}, 10)).toBe(3);
	expect(cart.lines()[0]).toMatchObject({
		key: "2:10:",
		price: 1200,
		variant_name: "Red",
	});
	cart.remove("2:10:");
	expect(cart.count()).toBe(0);
});

test("a saved cart loads again, and expires after a day", () => {
	const fresh = setup([product()], { at: 1_000_000 - 1000, lines: [line()] });
	expect(fresh.cart.count()).toBe(2);
	// loading saves again with a new time
	expect(JSON.parse(fresh.map.get(KEY)!).at).toBe(1_000_000);

	const old = setup([product()], {
		at: 1_000_000 - CART_TTL_MS,
		lines: [line()],
	});
	expect(old.cart.count()).toBe(0);
	expect(old.map.has(KEY)).toBe(false);

	const broken = memoryStorage();
	broken.map.set(KEY, "{nope");
	const cart = createCart({
		slug: "shop",
		products: [],
		storage: broken.storage,
		onChange() {},
	});
	expect(cart.lines()).toEqual([]);
});

test("re-sync against the products on the page", () => {
	const red = variant({ id: 10, price: 1500, stock: 1 });
	const pens: BundleItem = {
		id: 7,
		product_id: 50,
		qty: 2,
		name: "Pen",
		active: true,
		options: [
			{ variant_id: 71, name: "Blue", price: 100, stock: 6 },
			{ variant_id: 72, name: "Black", price: 100, stock: 0 },
		],
	};
	const products = [
		product({ id: 1, price: 800, stock: 3 }),
		product({ id: 2, variants: [red], stock: null }),
		product({ id: 3, stock: 0 }),
		product({
			id: 4,
			kind: "bundle",
			price: 999,
			stock: null,
			bundle_items: [pens],
		}),
	];
	const { cart } = setup(products, {
		at: 1_000_000,
		lines: [
			line({ product_id: 1, qty: 5 }), // price refreshed, qty clamped to 3
			line({ key: "2:10:", product_id: 2, variant_id: 10, qty: 4 }), // → 1
			line({ key: "2:99:", product_id: 2, variant_id: 99 }), // variant gone
			line({ key: "3::", product_id: 3 }), // sold out
			line({ key: "4::7=71", product_id: 4, choices: { 7: 71 }, qty: 5 }), // 6/2 = 3
			line({ key: "4::7=72", product_id: 4, choices: { 7: 72 } }), // no stock
			line({ key: "8::", product_id: 8, price: 123 }), // not on this page: kept
		],
	});
	const got = cart.lines();
	expect(got.map(keyOf)).toEqual(["1::", "2:10:", "4::7=71", "8::"]);
	expect(got[0]).toMatchObject({ price: 800, stock: 3, qty: 3 });
	expect(got[1]).toMatchObject({ price: 1500, stock: 1, qty: 1 });
	expect(got[2]).toMatchObject({
		price: 999,
		stock: 3,
		qty: 3,
		variant_name: "2 × Blue",
	});
	expect(got[3]).toMatchObject({ price: 123, qty: 2 });
});

test("replace, clear and another tab's change", () => {
	const { cart, map, events } = setup();
	cart.replace([line({ qty: 4 })]);
	expect(cart.count()).toBe(4);
	expect(JSON.parse(map.get(KEY)!).lines[0].qty).toBe(4);
	cart.clear();
	expect(map.has(KEY)).toBe(false);

	// another tab saved a cart: taken over, not written back
	const before = events.length;
	cart.sync(JSON.stringify({ at: 1_000_000, lines: [line({ qty: 1 })] }));
	expect(cart.count()).toBe(1);
	expect(events.length).toBe(before + 1);
	expect(map.has(KEY)).toBe(false);
	cart.sync(null);
	expect(cart.count()).toBe(0);
});

/**
 * @param l A cart line.
 * @returns Its key.
 */
function keyOf(l: StoreCartLine) {
	return l.key;
}
