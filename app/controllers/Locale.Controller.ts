import type { BunRequest } from "bun";
import { app } from "@config/app";
import { Service } from "@xcore/di";
import { HttpRequest } from "@xcore/http/Request";
import { back } from "@xcore/view/Inertia";
import { isLocale } from "@i18n";
import { LOCALE_COOKIE, LOCALE_COOKIE_DAYS } from "@constants/Locale.Constant";
import { DAY_SECONDS } from "@constants/Time.Constant";

/**
 * The language switcher (staff app and storefront alike).
 */
@Service()
export class LocaleController {
	/**
	 * POST /lang `{ locale }` — remember the language in a cookie and go back
	 * to the page.
	 * An unknown locale is ignored (the cookie is left as it was).
	 * @param req The current request.
	 * @returns Back to where the visitor was.
	 */
	async set(req: BunRequest) {
		const { locale } = (await HttpRequest.body(req)) as { locale?: unknown };
		if (isLocale(locale))
			req.cookies.set(LOCALE_COOKIE, locale, {
				sameSite: "lax",
				path: "/",
				maxAge: LOCALE_COOKIE_DAYS * DAY_SECONDS,
				secure: app.isProd,
			});
		return back(req, "/");
	}
}
