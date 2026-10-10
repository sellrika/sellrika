import { Service } from "@xcore/di";
import { app } from "@config/app";
import { SettingRepository } from "@repositories/Setting.Repository";
import {
	RATE_SCHEDULE_DEFAULT,
	RATE_SCHEDULES,
	RATES_SCHEDULE_KEY,
	RATES_SETTING_KEY,
	RATES_TIMEOUT_MS,
	type RateSchedule,
} from "@constants/Currency.Constant";
import {
	crossRate,
	storeCurrencies,
	type DisplayCurrency,
} from "@helpers/currency";
import type { Shop } from "@models/Shop";

/**
 * The platform's table of exchange rates, as the last fetch left it.
 * `rates` = units of each currency per 1 of `base`.
 * `fetched_at` = the last good fetch.
 * `tried_at` = the last attempt (the schedule counts from it).
 * `error` = why that attempt failed.
 */
export type ExchangeRates = {
	base: string;
	rates: Record<string, number>;
	fetched_at: string | null;
	tried_at: string | null;
	error: string | null;
};

/**
 * The table before any fetch.
 */
const EMPTY: ExchangeRates = {
	base: "USD",
	rates: {},
	fetched_at: null,
	tried_at: null,
	error: null,
};

/**
 * Automatic exchange rates for the whole platform.
 * They are fetched on the schedule the platform admin picks
 * (/exchange-rates) and kept in `settings`.
 * Shops show their store prices in other currencies with them,
 * unless they typed a rate of their own.
 * Display only: nothing is ever charged in another currency.
 */
@Service()
export class ExchangeRateService {
	/**
	 * HTTP client. Tests hand in a stub.
	 */
	fetcher: (url: string, init?: RequestInit) => Promise<Response> = (
		url,
		init,
	) => fetch(url, init);
	/**
	 * The fetch in flight.
	 * So a "Refresh now" during the sweep doesn't ask twice.
	 */
	private job: Promise<ExchangeRates> | null = null;
	/**
	 * The stored table, parsed once.
	 * Every store page of a shop with currencies reads it.
	 * A fetch replaces it, so it is never older than the row.
	 */
	private table: ExchangeRates | null = null;

	constructor(private settings: SettingRepository) {}

	/**
	 * How often rates are fetched.
	 * @returns The stored schedule, else the default.
	 */
	async schedule(): Promise<RateSchedule> {
		const raw = await this.settings.get(RATES_SCHEDULE_KEY);
		const s = raw ? JSON.parse(raw) : null;
		return typeof s === "string" && s in RATE_SCHEDULES
			? (s as RateSchedule)
			: RATE_SCHEDULE_DEFAULT;
	}

	/**
	 * Save how often rates are fetched.
	 * @param s The new schedule.
	 */
	async setSchedule(s: RateSchedule) {
		await this.settings.set(RATES_SCHEDULE_KEY, JSON.stringify(s));
	}

	/**
	 * The last fetched table.
	 * It is read from `settings` once, then kept in memory.
	 * Callers share it: never change it in place.
	 * @returns The stored rates, or an empty table when none was ever fetched.
	 */
	async rates(): Promise<ExchangeRates> {
		if (this.table) return this.table;
		const raw = await this.settings.get(RATES_SETTING_KEY);
		this.table = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
		return this.table as ExchangeRates;
	}

	/**
	 * Fetch the rates now.
	 * A failure keeps the old table and records why.
	 * @returns The table after the attempt.
	 */
	refresh(): Promise<ExchangeRates> {
		this.job ??= this.#fetchRates().finally(this.#jobDone.bind(this));
		return this.job;
	}

	/**
	 * The cron's work.
	 * Fetch when the schedule says the last attempt is old enough.
	 * @param now The current time (ms). Tests pass their own.
	 * @returns True when it fetched.
	 */
	async run(now = Date.now()): Promise<boolean> {
		const every = RATE_SCHEDULES[await this.schedule()];
		if (!every) return false;
		const { tried_at } = await this.rates();
		if (tried_at && now - Date.parse(tried_at) < every) return false;
		await this.refresh();
		return true;
	}

	/**
	 * The currencies a store offers its visitors, with the rate each one uses.
	 * @param shop The shop.
	 * @returns The shop's own currency first.
	 * Then every extra one that has a rate. `[]` when there is none.
	 */
	async forShop(
		shop: Pick<Shop, "currency" | "currencies">,
	): Promise<DisplayCurrency[]> {
		if (!shop.currencies.length) return [];
		return storeCurrencies(
			shop.currency,
			shop.currencies,
			(await this.rates()).rates,
		);
	}

	/**
	 * The automatic rates seen from one shop's currency.
	 * For its Currencies settings.
	 * @param currency The shop's currency.
	 * @returns Units of each currency per 1 of the shop's.
	 * And when the table was fetched.
	 */
	async forCurrency(currency: string) {
		const r = await this.rates();
		const rates: Record<string, number> = {};
		for (const code of Object.keys(r.rates)) {
			const rate = crossRate(r.rates, currency, code);
			if (rate && code !== currency) rates[code] = rate;
		}
		return { rates, fetched_at: r.fetched_at };
	}

	/**
	 * Forget the fetch in flight once it has ended.
	 */
	#jobDone() {
		this.job = null;
	}

	/**
	 * Ask the provider and store the answer.
	 * @returns The table after the attempt.
	 */
	async #fetchRates(): Promise<ExchangeRates> {
		const before = await this.rates();
		const tried_at = new Date().toISOString();
		let next: ExchangeRates;
		try {
			const res = await this.fetcher(app.exchangeRatesUrl, {
				signal: AbortSignal.timeout(RATES_TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as {
				base_code?: unknown;
				rates?: Record<string, unknown>;
			};
			const rates: Record<string, number> = {};
			for (const [code, v] of Object.entries(body.rates ?? {}))
				if (/^[A-Z]{3}$/.test(code) && this.#isRate(v)) rates[code] = v;
			const base = typeof body.base_code === "string" ? body.base_code : "";
			if (!/^[A-Z]{3}$/.test(base) || !Object.keys(rates).length)
				throw new Error("The answer held no rates");
			rates[base] = 1;
			next = { base, rates, fetched_at: tried_at, tried_at, error: null };
		} catch (e) {
			next = { ...before, tried_at, error: (e as Error).message };
		}
		await this.settings.set(RATES_SETTING_KEY, JSON.stringify(next));
		this.table = next;
		return next;
	}

	/**
	 * Is this a rate we can use: a finite number above zero?
	 * @param v One value of the provider's `rates` object.
	 * @returns True when it is.
	 */
	#isRate(v: unknown): v is number {
		return typeof v === "number" && Number.isFinite(v) && v > 0;
	}
}
