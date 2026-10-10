import { DAY_MS } from "@constants/Time.Constant";

/**
 * How many hours after the checkout the abandoned-cart email goes out.
 * The shop picks one on /marketing.
 */
export const ABANDONED_CART_DELAYS = [1, 4, 12, 24] as const;

/** One of `ABANDONED_CART_DELAYS`. */
export type AbandonedCartDelay = (typeof ABANDONED_CART_DELAYS)[number];

/**
 * A cart this long past its delay is not emailed any more.
 * It happens when the switch was just turned on, or the server was down.
 */
export const ABANDONED_CART_LATE_MS = DAY_MS;

/**
 * When the marketing sweep runs: every minute.
 * It sends the due abandoned-cart emails and the due campaigns.
 */
export const MARKETING_CRON = "* * * * *";

/**
 * The life of a campaign.
 * draft → scheduled → sending → sent; "Cancel schedule" goes back to draft.
 */
export const CAMPAIGN_STATUSES = [
	"draft",
	"scheduled",
	"sending",
	"sent",
] as const;

/** One of `CAMPAIGN_STATUSES`. */
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** At most this many recipients in one campaign. */
export const CAMPAIGN_MAX_RECIPIENTS = 5000;

/**
 * How many recipients one insert books and queues.
 * 500 rows of 5 values stay far under the parameter limit
 * of SQLite and Postgres.
 */
export const CAMPAIGN_QUEUE_BATCH = 500;

/** At most this many product cards in one campaign. */
export const CAMPAIGN_MAX_PRODUCTS = 6;

/** Customers per page in the campaign's recipient picker. */
export const CAMPAIGN_PICKER_PER_PAGE = 20;

/**
 * How long one shop may send marketing emails in one run of the sweep.
 * The sweep is one job for every shop, and it runs once a minute.
 * A shop with a slow mail server must not hold the others.
 * What is left goes out in the next runs.
 */
export const MARKETING_SHOP_BUDGET_MS = 30_000;

/**
 * The `settings` key that counts an account's abandoned-cart emails
 * of one month: `reminders:<owner id>:<YYYY-MM>`.
 */
export const REMINDER_COUNT_KEY = "reminders";

/**
 * How many campaign emails one account may send a month
 * through the platform's email.
 * The platform admin may set another number per owner
 * (`users.campaign_email_limit`, on `/owners/:id`).
 */
export const CAMPAIGN_EMAILS_PER_MONTH = 1000;
