/** Reasons and filters of the /stock screen. */
import type { Key } from "@i18n";

/** Why a manual adjustment was made — stored on the movement's reason line. */
export const ADJUST_REASONS = [
	"received",
	"count",
	"damaged",
	"other",
] as const;

/** One of `ADJUST_REASONS`. */
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/**
 * What each reason reads as in the ledger.
 * A dictionary key, translated when the movement is written.
 */
export const ADJUST_REASON_LABEL: Record<AdjustReason, Key> = {
	received: "server.stock_reason_received",
	count: "server.stock_reason_count",
	damaged: "server.stock_reason_damaged",
	other: "server.stock_reason_other",
};

/**
 * Accepted `?filter=` values on /stock.
 * Everything, low (includes out), or out only.
 */
export const STOCK_FILTERS = new Set(["all", "low", "out"]);

/**
 * How long the sidebar's low-stock number of a shop is kept in memory.
 * Every staff page shows it, and counting it reads every tracked unit.
 * A stock move or a saved product clears it at once.
 */
export const LOW_STOCK_CACHE_MS = 30_000;
