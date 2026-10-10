import type { Key, Locale } from "@i18n";
import { fill, type Params } from "@i18n/fill";
import type { StoreData } from "@/store/types";

/**
 * The frontend side of the shared dictionary (i18n/).
 * Staff pages are Inertia pages: `locale` rides on every page's props.
 * Store pages are server-rendered: `locale` and the words sit in `#store-data`.
 * So `t()` works in any component, composable or lib on both.
 * The dictionaries and Inertia are handed in by app.ts (`useDictionary`), never imported here:
 * the store's checkout island loads this file too, and must stay small.
 */

/** Page props as the staff app's Inertia pages carry them. */
export type PageProps =
	| {
			locale?: Locale;
			store?: { theme?: { strings?: Record<string, string> } };
			extension_ui?: { strings?: Record<string, string> }[];
	  }
	| undefined;

/** The dictionary lookup and the page props getter, once app.ts handed them in. */
let dictionary: {
	translate: (locale: Locale, key: Key, params?: Params) => string;
	props: () => PageProps;
} | null = null;

/**
 * Hand in the full dictionary and the Inertia page props (staff app only).
 * @param translate `translate()` from `@i18n`.
 * @param props Returns the current page's props (`usePage().props`).
 */
export function useDictionary(
	translate: (locale: Locale, key: Key, params?: Params) => string,
	props: () => PageProps,
) {
	dictionary = { translate, props };
}

/**
 * The store page's data island, once it was read.
 */
let island: StoreData | null = null;

/**
 * The data island of a server-rendered store page.
 * `window.Store` parsed it already; before it loads, read the tag itself.
 * @returns The data, or null on a staff page or on the server.
 */
function storeData(): StoreData | null {
	if (island || typeof document === "undefined") return island;
	if (window.Store?.data) return (island = window.Store.data);
	const text = document.getElementById("store-data")?.textContent;
	if (!text) return null;
	try {
		island = JSON.parse(text) as StoreData;
	} catch {
		// ponytail: a broken island means English, the page still works
	}
	return island;
}

/** The prefix of an extension's own key that rewords an app text: `app.nav.customers` → `nav.customers`. */
const APP_WORD = "app.";

/** The app words of each `extension_ui` list, worked out once per page. */
const appWordsCache = new WeakMap<object, Record<string, string>>();

/**
 * The app texts the running extensions reword in the staff app.
 * A key `app.<app key>` in an extension's dictionary wins over the app's text,
 * so the Restaurant extension can say "Tables" where the app says "Customers".
 * @param list The shared prop `extension_ui`.
 * @returns app key → text.
 */
function appWords(list: { strings?: Record<string, string> }[]) {
	let words = appWordsCache.get(list);
	if (words) return words;
	words = {};
	for (const ext of list)
		for (const [key, text] of Object.entries(ext.strings ?? {}))
			if (key.startsWith(APP_WORD)) words[key.slice(APP_WORD.length)] = text;
	appWordsCache.set(list, words);
	return words;
}

/**
 * The language and the theme's words of the page being shown.
 * An Inertia page (staff app) carries them in its props.
 * A store page carries them in its data island.
 * @returns The locale, and the words that win over the dictionary.
 */
function current(): { locale: Locale; strings?: Record<string, string> } {
	// no props = no Inertia page (the store's island, tests)
	const props = dictionary?.props();
	if (props)
		return {
			locale: props.locale ?? "en",
			strings:
				props.store?.theme?.strings ??
				(props.extension_ui && appWords(props.extension_ui)),
		};
	const data = storeData();
	return {
		locale: (data?.locale as Locale | undefined) ?? "en",
		strings: data?.strings,
	};
}

/**
 * The language of the page being shown.
 * @returns The current locale (English before the first page arrives).
 */
export function locale(): Locale {
	return current().locale;
}

/**
 * Translate `key` in the page's language.
 * On the public store a theme may reword anything:
 * a key in its own words wins over the app's, so "Add to cart" can read "Book".
 * In the staff app a running extension may do the same with `app.<key>` in its dictionary.
 * A store page only has the words the server put in its data island; a missing one comes back as the key.
 * @param key A key of the dictionary (`i18n/en.ts`).
 * @param params Values for the `{placeholders}`.
 * @returns The text.
 */
export function t(key: Key, params?: Params): string {
	const page = current();
	const own = page.strings?.[key];
	if (own !== undefined) return fill(own, params);
	return dictionary
		? dictionary.translate(page.locale, key, params)
		: fill(key, params);
}

/**
 * An extension's `t()` in the browser over the dictionary the server sent (already in the page's language, English filled in).
 * @param strings key → text.
 * @returns `t(key, params)` — a key the dictionary lacks comes back as is.
 */
export function extensionT(strings: Record<string, string> = {}) {
	return function t(key: string, params?: Params) {
		return fill(strings[key] ?? key, params);
	};
}
