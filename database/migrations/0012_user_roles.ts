import type { SQL } from "bun";

// Staff accounts: `role` = 'admin' (everything) | 'cashier' (sell, orders, customers); `active` = false locks the
// account out without deleting it (orders keep user_id). Every existing user becomes an admin.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table users add column role text not null default 'admin'`,
	);
	await db.unsafe(
		`alter table users add column active boolean not null default true`,
	);
}
