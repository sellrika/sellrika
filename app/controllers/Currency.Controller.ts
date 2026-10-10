import type { BunRequest } from "bun";
import { app } from "@config/app";
import { Service } from "@xcore/di";
import { HttpRequest } from "@xcore/http/Request";
import { back, inertia, redirect } from "@xcore/view/Inertia";
import { ExchangeRateService } from "@services/settings/ExchangeRate.Service";
import { RateScheduleInput } from "@validators/Store.Validator";
import { validate, type Errors } from "@validators/validate";
import {
	CURRENCY_COOKIE,
	CURRENCY_COOKIE_DAYS,
	RATE_SCHEDULES,
} from "@constants/Currency.Constant";
import { DAY_SECONDS } from "@constants/Time.Constant";

/**
 * Currencies.
 * The storefront's currency switcher is public.
 * The Exchange rates page (`/exchange-rates`) is for the platform
 * admin only: how often the automatic rates are fetched,
 * and the table they left.
 */
@Service()
export class CurrencyController {
	constructor(private exchange: ExchangeRateService) {}

	/**
	 * POST /currency `{ currency }` — remember the currency a store
	 * visitor picked and go back to the page.
	 * The store checks it against its own list on every page,
	 * so any well-formed code is kept.
	 * @param req The current request.
	 * @returns Back to where the visitor was.
	 */
	async set(req: BunRequest) {
		const { currency } = (await HttpRequest.body(req)) as {
			currency?: unknown;
		};
		if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency))
			req.cookies.set(CURRENCY_COOKIE, currency, {
				sameSite: "lax",
				path: "/",
				maxAge: CURRENCY_COOKIE_DAYS * DAY_SECONDS,
				secure: app.isProd,
			});
		return back(req, "/");
	}

	/**
	 * GET /exchange-rates — the schedule and the last fetched table.
	 * @param req The current request.
	 * @returns The ExchangeRates/Index page.
	 */
	index(req: BunRequest) {
		return this.#page(req);
	}

	/**
	 * PUT /exchange-rates `{ schedule }` — how often the rates are fetched.
	 * @param req The current request.
	 * @returns Back to the page, or the page with errors.
	 */
	async update(req: BunRequest) {
		const v = validate(RateScheduleInput, await HttpRequest.body(req));
		if (v.errors) return this.#page(req, v.errors);
		await this.exchange.setSchedule(v.data.schedule);
		return redirect("/exchange-rates");
	}

	/**
	 * POST /exchange-rates/refresh — fetch the rates now.
	 * A failure shows on the page.
	 * @returns Back to the page.
	 */
	async refresh() {
		await this.exchange.refresh();
		return redirect("/exchange-rates");
	}

	/**
	 * The Exchange rates page, maybe with errors on it.
	 * @param req The current request.
	 * @param errors Inertia errors to show, if any.
	 * @returns The ExchangeRates/Index page.
	 */
	async #page(req: BunRequest, errors?: Errors) {
		return inertia(req, "ExchangeRates/Index", {
			schedule: await this.exchange.schedule(),
			schedules: Object.keys(RATE_SCHEDULES),
			rates: await this.exchange.rates(),
			...(errors && { errors }),
		});
	}
}
