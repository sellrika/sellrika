/** Periods and date parsing for /reports. */

/** The date ranges the report screen offers; `custom` reads `?from=`/`?to=`. */
export const REPORT_PRESETS = [
	"today",
	"yesterday",
	"7d",
	"last_week",
	"this_month",
	"last_month",
	"this_year",
	"custom",
] as const;

/** One of `REPORT_PRESETS`. */
export type Preset = (typeof REPORT_PRESETS)[number];

/** A custom range's `from`/`to` must look like this. */
export const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Above this many days a report buckets by month. */
export const MONTH_BUCKET_DAYS = 120;

/** Above this many days a report buckets by week, else by day. */
export const WEEK_BUCKET_DAYS = 31;

/**
 * The daily report: today's sales, posted to the shop's chat channels
 * at the time the shop picked on /reports.
 */

/** When the daily report job looks for shops that are due: every minute. */
export const REPORT_CRON = "* * * * *";

/** A report time must look like this: 24-hour `HH:MM`. */
export const REPORT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The extension that posts the daily report. Its settings hold the channels. */
export const REPORT_EXTENSION = "chat-alerts";

/**
 * The channels a daily report may go to.
 * Each one names the Chat alerts setting that must be filled for it.
 */
export const REPORT_CHANNELS = {
	slack: "slack_url",
	discord: "discord_url",
	line: "line_token",
} as const;

/** One of the keys of `REPORT_CHANNELS`. */
export type ReportChannel = keyof typeof REPORT_CHANNELS;

/** How many of the day's best sellers the daily report lists. */
export const REPORT_DAILY_TOP = 5;
