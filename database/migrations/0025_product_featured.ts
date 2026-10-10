import type { SQL } from "bun";

// Display order for every product list (admin, POS, storefront): featured first, then most recently edited.
// `updated_at` has no default — SQLite rejects a non-constant default in ALTER TABLE — so it is backfilled
// from created_at here and written explicitly on every create/update.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table products add column featured boolean not null default false`,
	);
	await db.unsafe(`alter table products add column updated_at timestamp`);
	await db.unsafe(`update products set updated_at = created_at`);
}
