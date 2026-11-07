/**
 * Staff roles, most power first (`Account.atLeast()` reads this order).
 * `admin` may do everything.
 * `manager` = a cashier plus the catalog, payment methods,
 * marketing, reports and the cashiers.
 * `cashier` may sell, read orders, and manage customers.
 */
export const ROLES = ["admin", "manager", "cashier"] as const;

/** One of `ROLES`. */
export type Role = (typeof ROLES)[number];

/**
 * `users.last_active_at` is written at most this often per user.
 * So a busy user costs no write per request.
 */
export const USER_SEEN_EVERY_MS = 5 * 60_000;
