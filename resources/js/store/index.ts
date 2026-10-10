import { formatMoney } from "@helpers/currency";
import { createAuth } from "./auth";
import { type Cart, type CartStorage, cartKey, createCart } from "./cart";
import { discountPct, storeMoney } from "./money";
import { createPicker, swatch } from "./picker";
import type {
	StoreApi,
	StoreData,
	StoreExtension,
	StoreExtensionApi,
} from "./types";

/**
 * `window.Store`: the browser helper every store theme uses.
 * It has no HTML, no CSS, no Vue and no Inertia.
 * It reads the data island `#store-data` the server prints.
 * See docs/features/store-themes.md.
 */

/** Outside scripts already asked for, so each loads once. */
const loading = new Map<string, Promise<void>>();

/**
 * Load an outside script once, on demand.
 * @param src The script URL.
 * @returns A promise that settles when the script ran (or failed).
 */
export function loadScript(src: string) {
	let p = loading.get(src);
	if (!p) {
		p = new Promise<void>(function run(ok, fail) {
			const el = document.createElement("script");
			el.src = src;
			el.onload = function loaded() {
				ok();
			};
			el.onerror = function failed() {
				loading.delete(src);
				fail(new Error(`Could not load ${src}`));
			};
			document.head.appendChild(el);
		});
		loading.set(src, p);
	}
	return p;
}

/**
 * Put `params` into the `{placeholders}` of a text.
 * Same rule as `fill()` in i18n/index.ts, which is not imported
 * because it would bring every dictionary into this script.
 * @param text The text.
 * @param params The values.
 * @returns The filled text.
 */
export function fill(text: string, params?: Record<string, string | number>) {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, function one(match, name: string) {
		const v = params[name];
		return v === undefined ? match : String(v);
	});
}

/** What `createStore` needs from the browser (stubs in tests). */
export type StoreEnv = {
	/** `localStorage`, or null when the browser blocks it. */
	storage: CartStorage | null;
	/** Called with every `store:cart` event detail. */
	onCart(detail: unknown): void;
	/** Leave for another page (default: `location.href`). */
	go?(url: string): void;
	/** The network (default: the browser's `fetch`). */
	fetch?: typeof fetch;
};

/**
 * Build `window.Store` from the data island.
 * @param data The parsed `#store-data`.
 * @param env Storage and the cart listener.
 * @returns The helper.
 */
export function createStore(
	data: StoreData,
	env: StoreEnv,
): StoreApi & { cart: Cart } {
	const base = data.store.base;

	/**
	 * Translated text: the page's strings, else the key itself.
	 * @param key A `store.*` / `store_ui.*` key.
	 * @param params Values for the `{placeholders}`.
	 * @returns The text.
	 */
	function t(key: string, params?: Record<string, string | number>) {
		return fill(data.strings[key] ?? key, params);
	}

	const cart = createCart({
		slug: data.store.slug,
		products: data.products,
		storage: env.storage,
		onChange: env.onCart,
	});

	/**
	 * A product shown on this page.
	 * @param id The product id.
	 * @returns The product, or undefined.
	 */
	function product(id: number) {
		return data.products.find(function same(p) {
			return p.id === id;
		});
	}

	/**
	 * Money in the visitor's display currency.
	 * @param cents The amount in the shop's currency.
	 * @returns The formatted amount.
	 */
	function money(cents: number) {
		return storeMoney(data.store, cents, data.locale);
	}

	/**
	 * Money in a given currency, with no conversion.
	 * @param cents The amount.
	 * @param currency The ISO code.
	 * @returns The formatted amount.
	 */
	function moneyIn(cents: number, currency: string) {
		return formatMoney(cents, currency, data.locale);
	}

	/** True while a cart is being sent as an order (and after it was). */
	let sending = false;

	/**
	 * Leave for another page.
	 * @param url Where to.
	 */
	function go(url: string) {
		if (env.go) env.go(url);
		else location.href = url;
	}

	/**
	 * The cart's main button: the checkout page, or, in a store with no
	 * payment option, the order itself (written unpaid, nothing asked).
	 * @returns Why it failed, or null when the browser is leaving the page.
	 */
	async function checkout(): Promise<string | null> {
		const checkoutUrl = `${base}/checkout`;
		if (data.store.payments?.length) {
			go(checkoutUrl);
			return null;
		}
		// a second tap while the order is on its way must not send it twice
		if (sending) return null;
		sending = true;
		try {
			const res = await (env.fetch ?? fetch)(`${checkoutUrl}/send`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					items: cart.lines().map(function item(l) {
						return {
							product_id: l.product_id,
							variant_id: l.variant_id,
							qty: l.qty,
							choices: l.choices ?? {},
							note: l.note ?? "",
						};
					}),
				}),
			});
			const answer = await res.json().catch(function none() {
				return {};
			});
			if (res.ok && answer.url) {
				// `sending` stays on: the page is leaving. "Back" may bring this page
				// out of the browser's cache with its old cart, so load it fresh.
				if (typeof window !== "undefined")
					window.addEventListener("pageshow", function back(e) {
						if (e.persisted) location.reload();
					});
				go(answer.url);
				return null;
			}
			sending = false;
			const errors: Record<string, string> = answer.errors ?? {};
			return errors.cart ?? errors.items ?? t("store.checkout_failed");
		} catch {
			sending = false;
			return t("store.checkout_failed_offline");
		}
	}

	return {
		data,
		product,
		t,
		money,
		moneyIn,
		discountPct,
		url: {
			base,
			product(slug: string) {
				return `${base}/p/${slug}`;
			},
			checkout: `${base}/checkout`,
			account: `${base}/account`,
		},
		cart,
		picker(p, preset) {
			return createPicker(p, { cart, t }, preset);
		},
		auth: createAuth(data, t, loadScript),
		checkout,
		loadScript,
		swatch,
	};
}

/**
 * The browser's localStorage, or null when reading it throws.
 * @returns The storage.
 */
function browserStorage(): CartStorage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/**
 * Fire `store:cart` on the document.
 * @param detail `{ lines, count, subtotal, added? }`.
 */
function fireCart(detail: unknown) {
	document.dispatchEvent(new CustomEvent("store:cart", { detail }));
}

/** Start: read the island, set `window.Store`, keep tabs in sync. */
function boot() {
	const island = document.getElementById("store-data");
	if (!island) return;
	const data = JSON.parse(island.textContent || "{}") as StoreData;
	const store = createStore(data, {
		storage: browserStorage(),
		onCart: fireCart,
	});
	window.Store = store;
	if (data.restore?.length) {
		// the abandoned-cart link: its lines replace the cart
		store.cart.replace(data.restore);
		// on to the plain checkout URL, so a reload doesn't restore again
		history.replaceState(null, "", store.url.checkout);
	}
	const key = cartKey(data.store.slug);
	window.addEventListener("storage", function otherTab(e) {
		if (e.key === key) store.cart.sync(e.newValue);
	});
	const runs = (data.extensions ?? []).map(function run(ext) {
		const done = runExtension(ext, store, data);
		return ext.wait ? done : null;
	});
	// a script the page waits for has run (or failed): show the page
	void Promise.all(runs).then(function show() {
		document.querySelector("style[data-store-wait]")?.remove();
	});
}

/**
 * Load one extension's store script and call its default export.
 * A script that fails is logged and never breaks the store.
 * @param ext The script, its public mount and its texts.
 * @param store `window.Store`.
 * @param data The data island (the page's language).
 */
async function runExtension(
	ext: StoreExtension,
	store: StoreApi,
	data: StoreData,
) {
	const api: StoreExtensionApi = {
		key: ext.key,
		base: ext.base,
		locale: data.locale,
		t(key, params) {
			return fill(ext.strings[key] ?? key, params);
		},
		fetch(path, init) {
			return fetch(ext.base + path, init);
		},
		store,
	};
	try {
		// absolute against the page's origin: in dev the store's JS comes from the Vite server (5173), and a
		// root-relative import would be fetched from there instead of the store that serves the extension's files
		const mod = await import(
			/* @vite-ignore */ new URL(ext.script, location.origin).href
		);
		await mod.default?.(api);
	} catch (error) {
		console.warn(`[extensions] ${ext.key} store script:`, error);
	}
}

if (typeof document !== "undefined") boot();
