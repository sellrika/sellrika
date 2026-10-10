import type { SQL } from "bun";

/**
 * Customer emails are stored lower-case from now on.
 * This lower-cases the old rows, so a lookup can compare the
 * column directly, and adds the index that lookup uses.
 * @param db The connection the migration runs on.
 */
export async function up(db: SQL) {
	await db.unsafe(
		`update customers set email = lower(email) where email is not null and email <> lower(email)`,
	);
	await db.unsafe(
		`create index if not exists idx_customers_shop_email on customers (shop_id, email)`,
	);
}
