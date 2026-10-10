import type { SQL } from "bun";

// orders.tax_label — the shop's tax label ("VAT") frozen at sale time, like payment_method stores the method's
// name: a later rename leaves old receipts alone. Its own migration: 0041 had already run on a dev DB before
// the column was added to it, and an applied migration is never re-run.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table orders add column tax_label text not null default 'Tax'`,
	);
}
