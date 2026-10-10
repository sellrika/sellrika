import type { SQL } from "bun";

/**
 * An address of a customer may carry a tax ID, for invoices.
 *   customer_addresses.tax_id — free text (any country, no format), "" = none
 */
export async function up(db: SQL) {
	await db.unsafe(
		`alter table customer_addresses add column tax_id text not null default ''`,
	);
}
