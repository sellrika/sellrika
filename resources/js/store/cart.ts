import {
	availableFor,
	type Choices,
	chosenNames,
	lineKey,
} from "@/lib/bundles";
import type { StoreProduct, StoreVariant } from "@/types";
import type { StoreApi, StoreCartLine } from "./types";

/**
 * How long a saved cart lives: one day.
 * The POS cart works the same way.
 */
export const CART_TTL_MS = 24 * 60 * 60 * 1000;

/** The part of `localStorage` the cart uses (a stub in tests). */
export type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What the `store:cart` event carries. */
export type CartChange = {
	lines: StoreCartLine[];
	count: number;
	subtotal: number;
	added?: number;
};

/** What `createCart` needs from the page. */
export type CartOptions = {
	/** The shop's slug — the storage key is `store-cart:<slug>`. */
	slug: string;
	/** The products on this page, for the re-sync. */
	products: StoreProduct[];
	/** null when the browser blocks storage. */
	storage: CartStorage | null;
	/** Called after every change (index.ts fires `store:cart`). */
	onChange(change: CartChange): void;
	/** The clock, so tests can move time. */
	now?: () => number;
};

/** The cart as `window.Store.cart`, plus `sync` for the other-tab event. */
export type Cart = StoreApi["cart"] & {
	/**
	 * Take the cart another tab just saved.
	 * @param raw The new storage value (null = removed).
	 */
	sync(raw: string | null): void;
};

/**
 * The localStorage key of a shop's cart. The checkout reads the same key.
 * @param slug The shop's slug.
 * @returns `store-cart:<slug>`.
 */
export function cartKey(slug: string) {
	return `store-cart:${slug}`;
}

/**
 * The key of a cart line with a custom request.
 * The same product with two different notes makes two lines.
 * @param key The key from `lineKey`.
 * @param note The buyer's note ("" = none).
 * @returns The key to store on the line.
 */
export function noteKey(key: string, note = "") {
	return note ? `${key}|${note}` : key;
}

/**
 * Bring saved lines up to date with the products on this page.
 * Gone products and variants are dropped. Price and stock are refreshed.
 * The quantity is cut down to the stock. Sold-out lines are dropped.
 * @param saved The lines as saved.
 * @param products The products on this page.
 * @returns The lines to keep.
 */
export function resync(
	saved: StoreCartLine[],
	products: StoreProduct[],
): StoreCartLine[] {
	const out: StoreCartLine[] = [];
	for (const l of saved) {
		const next = resyncLine(l, products);
		if (next) out.push(next);
	}
	return out;
}

/**
 * One line of `resync`.
 * @param l The saved line.
 * @param products The products on this page.
 * @returns The fresh line, or null to drop it.
 */
function resyncLine(
	l: StoreCartLine,
	products: StoreProduct[],
): StoreCartLine | null {
	const p = products.find(function same(x) {
		return x.id === l.product_id;
	});
	// ponytail: a product not on this page is kept as saved.
	// The checkout re-prices and re-checks stock from the DB anyway.
	if (!p) return { ...l, choices: l.choices ?? {} };
	if (p.kind === "bundle") {
		// a package: its choices must still exist, stock comes from its parts
		const choices = l.choices ?? {};
		const stock = availableFor(p, choices);
		if (stock !== null && stock < 1) return null;
		return {
			...l,
			choices,
			key: noteKey(lineKey(p.id, null, choices), l.note),
			price: p.price,
			variant_name: chosenNames(p, choices),
			stock,
			qty: stock === null ? l.qty : Math.min(l.qty, stock),
		};
	}
	const v = l.variant_id
		? p.variants.find(function same(x) {
				return x.id === l.variant_id;
			})
		: null;
	if (l.variant_id && !v) return null;
	const stock = v ? v.stock : p.stock;
	if (stock !== null && stock < 1) return null;
	return {
		...l,
		choices: {},
		key: noteKey(lineKey(p.id, v?.id ?? null), l.note),
		price: v?.price ?? p.price,
		stock,
		qty: stock === null ? l.qty : Math.min(l.qty, stock),
	};
}

/**
 * The stock one unit allows: a package counts its parts.
 * @param product The product.
 * @param variant The variant, or null.
 * @param choices The package answers.
 * @returns The units on hand, or null when not tracked.
 */
export function unitStock(
	product: StoreProduct,
	variant: StoreVariant | null,
	choices: Choices,
) {
	if (product.kind === "bundle") return availableFor(product, choices);
	return variant ? variant.stock : product.stock;
}

/**
 * The browser cart of one shop.
 * It is loaded from storage, re-synced with the page, and saved on change.
 * @param opts The shop, the page's products, the storage and the listener.
 * @returns The cart.
 */
export function createCart(opts: CartOptions): Cart {
	const key = cartKey(opts.slug);
	const now = opts.now ?? Date.now;
	let lines: StoreCartLine[] = read(opts.storage?.getItem(key) ?? null);
	if (lines.length) save();
	else remove();

	/**
	 * Parse a saved cart and re-sync it. Too old or broken = empty.
	 * @param raw The storage value.
	 * @returns The lines.
	 */
	function read(raw: string | null): StoreCartLine[] {
		try {
			const saved = JSON.parse(raw ?? "null");
			if (!saved || now() - saved.at >= CART_TTL_MS) return [];
			return resync(saved.lines as StoreCartLine[], opts.products);
		} catch {
			// ponytail: corrupt storage → start empty
			return [];
		}
	}

	/** Forget the saved cart. Blocked storage is ignored. */
	function remove() {
		try {
			opts.storage?.removeItem(key);
		} catch {
			// blocked storage: the cart lives on this page only
		}
	}

	/** Write the cart (or remove it when empty). */
	function save() {
		if (!lines.length) return remove();
		try {
			opts.storage?.setItem(key, JSON.stringify({ at: now(), lines }));
		} catch {
			// full or blocked storage: the cart lives on this page only
		}
	}

	/**
	 * Tell the page the cart changed.
	 * @param added Units just added, when this was an add.
	 */
	function emit(added?: number) {
		const change: CartChange = {
			lines: [...lines],
			count: count(),
			subtotal: subtotal(),
		};
		if (added !== undefined) change.added = added;
		opts.onChange(change);
	}

	/**
	 * Save, then tell the page.
	 * @param added Units just added, when this was an add.
	 */
	function changed(added?: number) {
		save();
		emit(added);
	}

	/**
	 * Find a line by key.
	 * @param k The line key.
	 * @returns The line, or undefined.
	 */
	function find(k: string) {
		return lines.find(function same(l) {
			return l.key === k;
		});
	}

	/** @returns The units in the cart. */
	function count() {
		let n = 0;
		for (const l of lines) n += l.qty;
		return n;
	}

	/** @returns The cart total in cents, before delivery and discounts. */
	function subtotal() {
		let n = 0;
		for (const l of lines) n += l.price * l.qty;
		return n;
	}

	/**
	 * Add up to `qty` units, capped at the stock.
	 * @param product The product.
	 * @param variant The chosen variant (null = none).
	 * @param choices The package answers ({} = none).
	 * @param qty How many to add.
	 * @param note The buyer's custom request ("" = none).
	 * @returns How many were added (0 = none).
	 */
	function add(
		product: StoreProduct,
		variant: StoreVariant | null = null,
		choices: Choices = {},
		qty = 1,
		note = "",
	) {
		const k = noteKey(lineKey(product.id, variant?.id ?? null, choices), note);
		const stock = unitStock(product, variant, choices);
		const line = find(k);
		const want = Math.floor(qty);
		const n = stock === null ? want : Math.min(want, stock - (line?.qty ?? 0));
		if (n < 1) return 0;
		if (line) line.qty += n;
		else
			lines.push({
				key: k,
				product_id: product.id,
				variant_id: variant?.id ?? null,
				name: product.name,
				variant_name: variant?.name ?? chosenNames(product, choices),
				image: variant?.images[0] ?? product.images[0] ?? null,
				price: variant?.price ?? product.price,
				qty: n,
				stock,
				choices,
				slug: product.slug,
				...(note ? { note } : {}),
			});
		changed(n);
		return n;
	}

	/**
	 * Set a line's quantity, capped at its stock. Below 1 removes it.
	 * @param k The line key.
	 * @param qty The new quantity.
	 */
	function setQty(k: string, qty: number) {
		if (qty < 1) return removeLine(k);
		const line = find(k);
		if (!line) return;
		line.qty = line.stock !== null ? Math.min(qty, line.stock) : qty;
		changed();
	}

	/**
	 * Remove a line.
	 * @param k The line key.
	 */
	function removeLine(k: string) {
		lines = lines.filter(function other(l) {
			return l.key !== k;
		});
		changed();
	}

	/**
	 * Put these lines in place of the cart (the abandoned-cart link).
	 * @param next The new lines.
	 */
	function replace(next: StoreCartLine[]) {
		lines = next.map(function copy(l) {
			return { ...l, choices: l.choices ?? {} };
		});
		changed();
	}

	/** Empty the cart (after the order went through). */
	function clear() {
		lines = [];
		changed();
	}

	/**
	 * Take the cart another tab saved. It is not saved again,
	 * so two tabs never write back and forth.
	 * @param raw The new storage value.
	 */
	function sync(raw: string | null) {
		lines = read(raw);
		emit();
	}

	return {
		lines() {
			return [...lines];
		},
		count,
		subtotal,
		add,
		setQty,
		remove: removeLine,
		replace,
		clear,
		sync,
	};
}
