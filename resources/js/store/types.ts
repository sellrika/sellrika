/**
 * The contract between the server-rendered store pages and the browser.
 * `window.Store` (resources/js/store/index.ts) is the shared helper with no UI;
 * each theme's `script.js` builds its own drawer, picker and dialogs on top of it.
 * See docs/features/store-themes.md.
 */
import type { Choices } from "@/lib/bundles";
import type {
	DisplayCurrency,
	StoreCustomerAccount,
	StoreLogin,
	StoreProduct,
	StoreVariant,
} from "@/types";

/** One cart line — the shape the checkout reads from localStorage `store-cart:<slug>` (`{ at, lines }`). Never change it without the checkout. */
export type StoreCartLine = {
	key: string;
	product_id: number;
	variant_id: number | null;
	name: string;
	variant_name: string | null;
	image: string | null;
	price: number;
	qty: number;
	/** null = not tracked */
	stock: number | null;
	/** package slot id → chosen variant id ({} on ordinary lines) */
	choices: Choices;
	/** the product page — a line whose product is not on the current page opens there */
	slug?: string;
	/** the buyer's custom request (like the name to engrave); lines with different notes stay apart */
	note?: string;
};

/** Which store page is showing (`data.page`). */
export type StorePageName =
	| "home"
	| "product"
	| "page"
	| "track"
	| "account"
	| "order"
	| "unsubscribe"
	| "not-found"
	| "checkout"
	| "done";

/** The data island `<script type="application/json" id="store-data">` every store page prints. */
export type StoreData = {
	store: {
		name: string;
		slug: string;
		/** "" on the shop's own domain, else `/store/<slug>` */
		base: string;
		currency: string;
		display: DisplayCurrency | null;
		currencies: DisplayCurrency[];
		login: StoreLogin | null;
		customer: StoreCustomerAccount | null;
		payment_label: string;
		/** How a buyer can pay. None = the cart sends the order itself (`Store.checkout()`). */
		payments?: unknown[];
	};
	locale: string;
	/** Every `store.*`, `store_ui.*` and `customer_auth.*` text in the page's language, the theme's own words merged over them. */
	strings: Record<string, string>;
	/** The products shown on this page (catalog page, or the product + related) — the picker and the cart re-sync read them. */
	products: StoreProduct[];
	page: StorePageName;
	/** Lines from an abandoned-cart link (`/cart/<token>`) — they replace the cart. */
	restore?: StoreCartLine[];
	/**
	 * The scripts of the shop's running extensions (slot `store.page`).
	 * `window.Store` loads each one and calls its default export.
	 */
	extensions?: StoreExtension[];
};

/** One extension script on the store pages: where it is, its public mount and its texts. */
export type StoreExtension = {
	key: string;
	script: string;
	base: string;
	strings: Record<string, string>;
	/** the page is hidden until this script has run (`STORE_WAIT_STYLE` in the head) */
	wait?: boolean;
};

/**
 * What an extension's store script gets (`extensions/types.ts` › `StoreScript`).
 * `store` is `window.Store`: the script may replace `store.checkout`.
 */
export type StoreExtensionApi = {
	key: string;
	/** The extension's public mount, `/store/<slug>/ext/<key>`. */
	base: string;
	locale: string;
	/** The extension's own dictionary in the page's language. */
	t(key: string, params?: Record<string, string | number>): string;
	/** `fetch` against the extension's public routes: `fetch("/order")` → `<base>/order`. */
	fetch(path: string, init?: RequestInit): Promise<Response>;
	store: StoreApi;
};

/** The state of one product's option picker (`Store.picker(product)`). Plain data + methods; the theme draws it. */
export type StorePicker = {
	product: StoreProduct;
	/** Attribute groups (Colour, Size…) when every variant has attributes — "guided" mode. */
	guided: boolean;
	groups: { name: string; values: string[] }[];
	/** The picked value per group (guided mode). */
	picked: Record<string, string>;
	/** The picked variant id (plain list mode). */
	variantId: number | null;
	/** The key of the cart line being edited (from the preset), else null. It counts as 0 in `left()`. */
	editing: string | null;
	/** Package slots that ask the buyer (2+ options). */
	slots: StoreProduct["bundle_items"];
	choices: Choices;
	/** true = the product asks the buyer for a custom request (a required text box). */
	asksNote: boolean;
	/** The question over that box, in the page's language. */
	noteLabel: string;
	/** The most characters the box takes (`maxlength`). */
	noteMax: number;
	/** What the buyer wrote so far. */
	note: string;
	/** Keep what the buyer typed. It does not need a redraw. */
	setNote(text: string): void;
	choose(group: string, value: string): void;
	pickVariant(id: number): void;
	pickSlot(slotId: number, variantId: number): void;
	/** Can this value still be picked (some in-stock variant matches it and the other picks)? */
	available(group: string, value: string): boolean;
	/** How many packages this slot option still allows (null = not tracked). */
	optionLeft(slotId: number, variantId: number | null): number | null;
	/** The chosen unit: the variant, the product itself when it has no variants, or null while unanswered. */
	chosen(): StoreVariant | StoreProduct | null;
	canAdd(): boolean;
	/** Units still addable for this choice, minus what is already in the cart (null = not tracked). */
	left(): number | null;
	/** Why Add can't fire for `qty` units, translated ("Only 2 left", "Choose Size to continue"), or null. */
	error(qty: number): string | null;
	/**
	 * Add `qty` of the chosen unit (replacing `editingKey` when editing a line); returns how many were added.
	 * Adds nothing while a required note is empty — call the box's `reportValidity()` first.
	 */
	addToCart(qty: number, editingKey?: string): number;
};

/** `window.Store` — shared by every theme, no HTML or CSS. */
export type StoreApi = {
	data: StoreData;
	product(id: number): StoreProduct | undefined;
	t(key: string, params?: Record<string, string | number>): string;
	/** Money in the visitor's display currency (converted when they picked one). */
	money(cents: number): string;
	/** Money in a given currency, no conversion. */
	moneyIn(cents: number, currency: string): string;
	/** The whole % off (20 for "−20%") when `original_price` is above `price`, else null. */
	discountPct(p: {
		price: number;
		original_price: number | null;
	}): number | null;
	url: {
		base: string;
		product(slug: string): string;
		checkout: string;
		account: string;
	};
	cart: {
		lines(): StoreCartLine[];
		count(): number;
		subtotal(): number;
		/** Adds up to `qty`, capped at stock; returns how many were added (0 = none). */
		add(
			product: StoreProduct,
			variant?: StoreVariant | null,
			choices?: Choices,
			qty?: number,
			/** The buyer's custom request ("" = none). */
			note?: string,
		): number;
		setQty(key: string, qty: number): void;
		remove(key: string): void;
		replace(lines: StoreCartLine[]): void;
		clear(): void;
	};
	picker(
		product: StoreProduct,
		/** Start from a cart line: its variant, its package answers, its note and its key (`editing`). */
		preset?: {
			variantId?: number | null;
			choices?: Choices;
			note?: string;
			editing?: string;
		},
	): StorePicker;
	auth: {
		providers(): StoreLogin["providers"];
		signIn(
			provider: "google" | "microsoft" | "email",
			creds?: { email: string; password: string },
		): Promise<{ error?: string; notice?: string; unverified?: boolean }>;
		signUp(creds: {
			email: string;
			password: string;
		}): Promise<{ error?: string; notice?: string }>;
		resetPassword(email: string): Promise<{ error?: string; notice?: string }>;
		resendVerification(): Promise<{ error?: string; notice?: string }>;
	};
	/**
	 * The cart's main button.
	 * A store that takes payments: go to the checkout page.
	 * A store with no payment option: send the cart as an unpaid order, then go to its thank-you page.
	 * Resolves with why it failed, translated, or null when the browser is leaving the page.
	 */
	checkout(): Promise<string | null>;
	loadScript(src: string): Promise<void>;
	/** A CSS colour for an attribute value that names one ("Red", "#0af"), else null. */
	swatch(value: string): string | null;
};

/**
 * Events fired on `document`:
 * - `store:cart`  detail `{ lines, count, subtotal, added? }` — after every cart change (`added` = units just added).
 * - `store:login` no detail — something asks the theme to open its sign-in dialog (the checkout's "Sign in" link).
 */
export type StoreCartEvent = CustomEvent<{
	lines: StoreCartLine[];
	count: number;
	subtotal: number;
	added?: number;
}>;

declare global {
	interface Window {
		Store: StoreApi;
	}
}
