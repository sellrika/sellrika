import { en } from "./en";
import { de } from "./de";
import { th } from "./th";
import { fill, type Params } from "./fill";

export { fill, type Params };

// The one dictionary for the whole app — the Bun server (validation + service messages, emails) and the
// Vue frontend (pages, storefront, SSR) both import from here, so a text is translated exactly once.
// Keys are flat and dotted (`area.what_it_says`); `{name}` placeholders are filled from `params`.

/** A language the app speaks. */
export type Locale = "en" | "de" | "th";
/** Every locale, in the order the switcher shows them. */
export const LOCALES: Locale[] = ["en", "de", "th"];
/** What a visitor gets with no cookie and no matching Accept-Language. */
export const DEFAULT_LOCALE: Locale = "en";
/** Every key of the dictionary — a typo in a `t("…")` call is a type error. */
export type Key = keyof typeof en;

/**
 * Copies, so an add-on's words can join them (`extend`).
 * The language files themselves stay as they are.
 */
const dictionaries: Record<Locale, Record<string, string>> = {
	en: { ...en },
	de: { ...de },
	th: { ...th },
};

/**
 * Add words to one language, for an add-on with its own dictionary.
 * A key the app already has is replaced.
 * @param locale The language.
 * @param words Its `{ key: text }` pairs.
 */
export function extend(locale: Locale, words: Record<string, string>) {
	Object.assign(dictionaries[locale], words);
}

/**
 * Is `s` a language the app speaks? Narrows an untrusted string (cookie, query) to `Locale`.
 * @param s Any string.
 * @returns true when it names a supported locale.
 */
export function isLocale(s: unknown): s is Locale {
	return typeof s === "string" && (LOCALES as string[]).includes(s);
}

/**
 * The text for `key` in `locale`, with `{placeholders}` filled in.
 * A key missing in `locale` falls back to English; a key missing everywhere is returned as is.
 * @param locale The language to render in.
 * @param key A key of the dictionary.
 * @param params Values for the `{placeholders}` of the text.
 * @returns The translated text.
 */
export function translate(locale: Locale, key: Key, params?: Params): string {
	return fill(dictionaries[locale][key] ?? dictionaries.en[key] ?? key, params);
}

/**
 * The languages a shop's online store offers, read from the `shops.languages` comma list.
 * Unknown codes are dropped; an empty list falls back to the default, so a shop always offers one.
 * @param list The stored comma list (`en,de`), or null.
 * @returns The locales, the shop's default first.
 */
export function shopLocales(list: string | null | undefined): Locale[] {
	const locales = String(list ?? "")
		.split(",")
		.map(function trim(s) {
			return s.trim();
		})
		.filter(isLocale);
	return locales.length ? [...new Set(locales)] : [DEFAULT_LOCALE];
}

/**
 * Pick the best locale from an `Accept-Language` header.
 * @param header The header value, or null.
 * @param allowed The locales to pick from (a shop's list on its store; every locale elsewhere).
 * @param fallback What to answer when nothing matches.
 * @returns The first listed language in `allowed`, else `fallback`.
 */
export function negotiate(
	header: string | null | undefined,
	allowed: readonly Locale[] = LOCALES,
	fallback: Locale = DEFAULT_LOCALE,
): Locale {
	if (!header) return fallback;
	const tags = header
		.split(",")
		.map(function parse(part) {
			const [tag = "", ...rest] = part.trim().split(";");
			const q = rest.find(function isQ(p) {
				return p.trim().startsWith("q=");
			});
			return { tag: tag.toLowerCase(), q: q ? Number(q.split("=")[1]) : 1 };
		})
		.sort(function byQ(a, b) {
			return b.q - a.q;
		});
	for (const { tag } of tags) {
		const base = tag.split("-")[0];
		if (isLocale(base) && allowed.includes(base)) return base;
	}
	return fallback;
}
