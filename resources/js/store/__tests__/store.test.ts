import { expect, test } from "bun:test";
import { createStore } from "../index";
import { discountPct, storeMoney } from "../money";
import type { StoreData } from "../types";
import { memoryStorage, product } from "./fixtures";

/**
 * A data island with safe defaults.
 * @param over The `store` fields to change.
 * @returns The data.
 */
function data(over: Partial<StoreData["store"]> = {}): StoreData {
	return {
		store: {
			name: "Shop",
			slug: "shop",
			base: "/store/shop",
			currency: "USD",
			display: null,
			currencies: [],
			login: null,
			customer: null,
			payment_label: "",
			...over,
		},
		locale: "en",
		strings: { "store_ui.only_n_left": "Only {count} left" },
		products: [product()],
		page: "home",
	};
}

test("money with and without a display currency", () => {
	const usd = { currency: "USD", display: null };
	expect(storeMoney(usd, 1800, "en")).toBe("$18");
	expect(storeMoney(usd, 1823, "en")).toBe("$18.23");
	// 1 USD = 0.8 EUR: 1000 cents → 800
	const eur = { currency: "USD", display: { code: "EUR", rate: 0.8 } };
	expect(storeMoney(eur, 1000, "en")).toBe("€8");
	// Myanmar writes "Ks", not Intl's "K"
	const mmk = { currency: "MMK", display: null };
	expect(storeMoney(mmk, 500000, "en")).toMatch(/^Ks\s?5,000$/);
	expect(discountPct({ price: 800, original_price: 1000 })).toBe(20);
	expect(discountPct({ price: 800, original_price: null })).toBeNull();
});

test("createStore: t, money, urls, product and the cart event", () => {
	const events: unknown[] = [];
	const store = createStore(data({ display: { code: "EUR", rate: 0.5 } }), {
		storage: memoryStorage().storage,
		onCart(d) {
			events.push(d);
		},
	});
	expect(store.t("store_ui.only_n_left", { count: 2 })).toBe("Only 2 left");
	expect(store.t("store_ui.missing")).toBe("store_ui.missing");
	expect(store.money(1000)).toBe("€5");
	expect(store.moneyIn(1000, "USD")).toBe("$10");
	expect(store.url.product("mug")).toBe("/store/shop/p/mug");
	expect(store.url.checkout).toBe("/store/shop/checkout");
	expect(store.product(1)?.name).toBe("Mug");
	expect(store.auth.providers()).toEqual([]);
	expect(store.picker(product()).addToCart(2)).toBe(2);
	expect(events.at(-1)).toMatchObject({ count: 2, subtotal: 2000, added: 2 });
});

test("checkout: the checkout page when the store takes payments, else the order is sent from the cart", async () => {
	const went: string[] = [];
	const sent: { url: string; body: unknown }[] = [];
	let answer: { status: number; body: unknown } = {
		status: 200,
		body: { url: "/store/shop/done?sid=direct_1" },
	};
	const env = {
		storage: memoryStorage().storage,
		onCart() {},
		go(url: string) {
			went.push(url);
		},
		fetch: async function fake(url: unknown, init?: RequestInit) {
			sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
			return Response.json(answer.body, { status: answer.status });
		} as typeof fetch,
	};
	// a payment option is on: the button only opens the checkout page
	const paying = createStore(data({ payments: [{ key: "cod" }] }), env);
	expect(await paying.checkout()).toBeNull();
	expect(went).toEqual(["/store/shop/checkout"]);
	expect(sent).toEqual([]);
	// none is on: the cart itself is posted, and the buyer lands on the thank-you page
	const direct = createStore(data({ payments: [] }), env);
	direct.cart.add(product(), null, {}, 2);
	expect(await direct.checkout()).toBeNull();
	expect(sent[0]).toEqual({
		url: "/store/shop/checkout/send",
		body: {
			items: [
				{ product_id: 1, variant_id: null, qty: 2, choices: {}, note: "" },
			],
		},
	});
	expect(went.at(-1)).toBe("/store/shop/done?sid=direct_1");
	// once sent, a second tap sends nothing more
	expect(await direct.checkout()).toBeNull();
	expect(sent).toHaveLength(1);
	// a refusal comes back as the message to show, and the page stays
	answer = { status: 422, body: { errors: { cart: "Only 1 left of Mug" } } };
	const refused = createStore(data({ payments: [] }), env);
	refused.cart.add(product(), null, {}, 2);
	expect(await refused.checkout()).toBe("Only 1 left of Mug");
	expect(went).toHaveLength(2);
	// …and the button works again after a refusal
	expect(await refused.checkout()).toBe("Only 1 left of Mug");
	expect(sent).toHaveLength(3);
});
