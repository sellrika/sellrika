import type { SQL } from "bun";

// Reconciling unpaid checkouts (app/services/sales/Store.Service.ts › reconcile): how many times the
// gateway has been asked about this cart, and when to ask again (null = at the next sweep).
export async function up(db: SQL) {
	await db.unsafe(
		`alter table store_carts add column checks integer not null default 0`,
	);
	await db.unsafe(`alter table store_carts add column next_check_at timestamp`);
}
