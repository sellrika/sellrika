import type { StoreProduct, StoreVariant } from "@/types";
import type { CartStorage } from "../cart";

/**
 * A store product with safe defaults.
 * @param over The fields to change.
 * @returns The product.
 */
export function product(over: Partial<StoreProduct> = {}): StoreProduct {
	return {
		id: 1,
		name: "Mug",
		slug: "mug",
		description: "",
		amount: null,
		extra: [],
		unit: null,
		price: 1000,
		original_price: null,
		images: ["/uploads/mug.png"],
		category_ids: [],
		stock: 5,
		sold_out: false,
		variants: [],
		kind: "item",
		bundle_items: [],
		custom_request: null,
		...over,
	};
}

/**
 * A variant with safe defaults.
 * @param over The fields to change.
 * @returns The variant.
 */
export function variant(over: Partial<StoreVariant> = {}): StoreVariant {
	return {
		id: 10,
		name: "Red",
		price: 1200,
		images: [],
		attributes: null,
		stock: 3,
		sold_out: false,
		...over,
	};
}

/**
 * A tiny in-memory localStorage.
 * @returns The storage and its backing map.
 */
export function memoryStorage() {
	const map = new Map<string, string>();
	const storage: CartStorage = {
		getItem(k) {
			return map.get(k) ?? null;
		},
		setItem(k, v) {
			map.set(k, v);
		},
		removeItem(k) {
			map.delete(k);
		},
	};
	return { storage, map };
}
