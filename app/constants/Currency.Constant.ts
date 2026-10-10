import { DAY_MS } from "@constants/Time.Constant";

/**
 * How often the platform fetches exchange rates, and the gap each one means.
 * The platform admin picks one on /exchange-rates; `off` = never.
 */
export const RATE_SCHEDULES = {
	off: 0,
	"30m": 30 * 60_000,
	"1h": 3_600_000,
	"6h": 6 * 3_600_000,
	"12h": 12 * 3_600_000,
	"1d": DAY_MS,
} as const;

/** One of the `RATE_SCHEDULES` keys. */
export type RateSchedule = keyof typeof RATE_SCHEDULES;

/** What a platform that never picked a schedule gets. */
export const RATE_SCHEDULE_DEFAULT: RateSchedule = "1d";

/** `settings` key of the last fetched rates (`ExchangeRates`). */
export const RATES_SETTING_KEY = "exchange_rates";

/** `settings` key of the schedule (a `RateSchedule`). */
export const RATES_SCHEDULE_KEY = "exchange_rates_schedule";

/**
 * When the rates sweep looks at the clock: every minute.
 * It only fetches once the schedule says the last try is old enough.
 */
export const RATES_CRON = "* * * * *";

/** A rates request that takes longer than this is given up. */
export const RATES_TIMEOUT_MS = 15_000;

/** The most extra currencies one store may offer. */
export const STORE_CURRENCIES_MAX = 20;

/** The cookie holding the currency a store visitor picked. */
export const CURRENCY_COOKIE = "currency";

/** How long that choice is remembered. */
export const CURRENCY_COOKIE_DAYS = 365;
