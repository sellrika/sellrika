/** A person who sells but has no login. They belong to a shop. */
export type SalesStaff = {
	id: number;
	shop_id: number;
	name: string;
	/** Their share of a sale, hundredths of a percent (0..10000). */
	commission: number;
	/**
	 * off = no longer offered at the POS.
	 * Old orders keep them.
	 */
	active: boolean;
	created_at: string;
};
/**
 * A row of the Staff page.
 * `orders` = the sales that name them.
 * `last_paid_at` = when their newest `sales_commissions` row was written.
 * null = never paid.
 * `unpaid_orders` / `unpaid_sales` = the sales since then and their cents.
 * Refunds are taken off, voided orders left out.
 * `due` = the commission on those cents, at today's rate.
 * It is not stored until it is paid.
 */
export type SalesStaffRow = SalesStaff & {
	orders: number;
	last_paid_at: string | null;
	unpaid_orders: number;
	unpaid_sales: number;
	due: number;
};
/**
 * One commission payment (`sales_commissions`).
 * The history of what a sales person was paid.
 */
export type SalesCommission = {
	id: number;
	shop_id: number;
	sales_staff_id: number;
	/** Cents paid. */
	amount: number;
	/** Cents sold in the paid period. */
	sales: number;
	/** How many sales that was. */
	orders: number;
	/** The rate it was paid at, hundredths of a percent. */
	commission: number;
	/** When it was paid. */
	created_at: string;
};
