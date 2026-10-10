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
