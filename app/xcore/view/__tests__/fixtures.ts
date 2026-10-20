/*
 * Shared fixtures for the store render tests: a shop, products, an order,
 * every page's own variables and a view service with fake collaborators.
 * No database needed.
 */
import { expect } from "bun:test";
import {
	type ActiveTheme,
	type StorePageName,
	type Storefront,
	StoreViewService,
} from "@services/sales/StoreView.Service";
import type { Shop } from "@models/Shop";

export const EVIL = "<img src=x onerror=1>";

/**
 * The shop a page belongs to: only what the store pages read.
 */
export const shop = {
	id: 1,
	name: "Tea & Co",
	slug: "tea",
	logo: null,
	currency: "USD",
	timezone: "UTC",
	country: "US",
	pickup: false,
	guided_address: false,
	delivery_zones: [],
	tax_rate: 0,
	tax_label: "",
	tax_included: false,
	banner: "Free tea on Fridays",
	banner_type: "info",
	phone: "+1 555 0100",
	address: "1 Leaf Road",
	hours: "",
	facebook: "",
	instagram: "",
	viber: "",
	whatsapp: "",
	languages: "en,de",
	fulfillment_steps: [
		{ key: "new", label: "" },
		{ key: "packing", label: "" },
		{ key: "shipped", label: "" },
		{ key: "delivered", label: "" },
	],
	google_site_verification: null,
	ga_id: null,
	meta_pixel_id: null,
	online_template: "ext:aurora",
} as unknown as Shop;

/**
 * One product, with a name that tries to break out of the HTML.
 * @param id The product id.
 * @returns A store product.
 */
export function product(id: number) {
	return {
		id,
		name: `${EVIL} ${id}`,
		slug: `tea-${id}`,
		description: "<p>Green &amp; fresh</p>",
		amount: 50,
		extra: [{ title: "Origin", value: "Japan" }],
		unit: "g",
		price: 1800,
		original_price: 2400,
		images: [],
		category_ids: [3],
		stock: 4,
		sold_out: false,
		kind: "product",
		bundle_items: [],
		variants: [],
	};
}

/**
 * A public order, for the track and order pages.
 */
export const order = {
	id: 9,
	reference: "P8J4-MJSQ-4Z8T",
	created_at: "2026-09-01 10:00:00",
	status: "completed",
	payment_status: "paid",
	paid: 1800,
	payment_method: "Card",
	fulfillment: "shipped",
	tracking: "TRACK1",
	subtotal: 1800,
	discount: 0,
	coupon_code: null,
	delivery_fee: 0,
	tax: 0,
	tax_rate: 0,
	tax_label: "",
	tax_included: false,
	total: 1800,
	note: "",
	items: [{ name: EVIL, qty: 1, price: 1800, image: null }],
	instructions: null,
};

/**
 * Every page's own variables (docs/features/store-themes.md › Per page).
 */
export const PAGES: Record<string, Record<string, unknown>> = {
	home: {
		catalog: {
			data: [product(1), product(2)],
			total: 2,
			page: 1,
			per_page: 16,
			last_page: 2,
		},
		counts: { all: 2 },
		featured: [product(3)],
		categories: [{ id: 3, name: "Green", color: null, count: 2 }],
		filters: { q: "", category: null, sort: "featured", stock: false },
		sorts: [{ value: "featured", label: "Featured" }],
		pager: {
			prev: null,
			next: "/store/tea?page=2",
			pages: [],
		},
	},
	product: {
		product: product(1),
		related: [product(2)],
		gallery: [],
		range: null,
	},
	page: { title: "About", body: "<p>Hi</p>", css: "" },
	track: { query: { code: "", contact: "" }, order, error: null },
	account: {
		orders: { data: [order], page: 1, last_page: 1 },
		errors: {},
		old: {},
		tab: "orders",
	},
	order: { order },
	unsubscribe: { email: "a@b.c", done: false, action: "/x" },
	"not-found": {},
	checkout: { states: [], restore: null },
	done: {
		order,
		instructions: null,
		pending: false,
		qr: null,
		failed: false,
		reason: null,
	},
};

/**
 * A view service with fake collaborators: no database needed.
 */
export const view = new StoreViewService(
	{
		paymentLabel: async () => "Stripe",
		paymentOptions: async () => [],
	} as never,
	{ links: async () => [{ slug: "about", title: "About" }] } as never,
	{
		logins: () => ({ providers: ["email"] }),
		addresses: async () => [],
	} as never,
	{
		storeTheme: async () => null,
		storeScripts: async () => [],
		storeLinks: async () => [],
		allActive: async () => [],
	} as never,
	{ isFree: async () => false } as never,
);

/**
 * Render one store page.
 * @param theme The theme.
 * @param page Which page.
 * @returns The HTML.
 */
export async function render(theme: ActiveTheme, page: StorePageName) {
	const s: Storefront = {
		shop,
		base: "/store/tea",
		url: "https://shop.test/store/tea",
		customer: null,
		theme,
		currencies: [],
		display: null,
	};
	const seo = StoreViewService.storeSeo(shop, {
		url: s.url,
		title: shop.name,
		desc: shop.name,
	});
	const res = await view.render(s, page, PAGES[page] ?? {}, seo);
	expect(res.status).toBe(200);
	return res.text();
}
