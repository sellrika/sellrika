/**
 * `node:` because Bun has no built-in request-scoped storage.
 * AsyncLocalStorage is what carries the locale down to code
 * that never sees the request (validators, services, mail templates).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { BunRequest } from "bun";
import { LOCALE_COOKIE } from "@constants/Locale.Constant";
import {
	DEFAULT_LOCALE,
	isLocale,
	LOCALES,
	negotiate,
	translate,
	type Key,
	type Locale,
	type Params,
} from "@i18n";

/**
 * The language of the running request.
 * `t()` is the everyday function and stays a plain function.
 */
export class I18n {
	/**
	 * The current request's language.
	 * It is kept in a box (not the bare locale),
	 * so `narrowLocale()` can change it once the handler knows the store's shop.
	 */
	static #store = new AsyncLocalStorage<{ locale: Locale }>();

	/**
	 * The language of a request.
	 * It is the `lang` cookie when allowed,
	 * else the best Accept-Language match, else the default.
	 * @param req The current request.
	 * @param allowed The locales it may be:
	 *   a shop's list on its store (default first).
	 *   Every locale when left out.
	 * @returns The locale to answer in.
	 */
	static localeOf(req: Request, allowed?: readonly Locale[]): Locale {
		const list = allowed ?? LOCALES;
		const cookie = (req as BunRequest).cookies?.get(LOCALE_COOKIE);
		if (isLocale(cookie) && list.includes(cookie)) return cookie;
		return negotiate(
			req.headers.get("accept-language"),
			list,
			allowed?.[0] ?? DEFAULT_LOCALE,
		);
	}

	/**
	 * Run `fn` with `locale` as the current language.
	 * Every `t()` inside (however deep, across awaits) uses it.
	 * The router wraps each handler in it.
	 * Background jobs call it themselves with the locale they saved.
	 * @param locale The language.
	 * @param fn What to run.
	 * @returns Whatever `fn` returns.
	 */
	static withLocale<T>(locale: Locale, fn: () => T): T {
		return I18n.#store.run({ locale }, fn);
	}

	/**
	 * Change the language of the running request, from here on.
	 * A store page does it, once its shop is known.
	 * Outside `withLocale` it does nothing.
	 * @param locale The language.
	 */
	static narrow(locale: Locale) {
		const box = I18n.#store.getStore();
		if (box) box.locale = locale;
	}

	/**
	 * The language of the code running now (set by `withLocale`).
	 * Outside a request it is the default.
	 * @returns The current locale.
	 */
	static current(): Locale {
		return I18n.#store.getStore()?.locale ?? DEFAULT_LOCALE;
	}
}

/**
 * Translate `key` in the current request's language.
 * @param key A key of the dictionary (`i18n/en.ts`).
 * @param params Values for the `{placeholders}`.
 * @returns The text.
 */
export function t(key: Key, params?: Params): string {
	return translate(I18n.current(), key, params);
}
