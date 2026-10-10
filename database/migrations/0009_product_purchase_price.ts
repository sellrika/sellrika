import type { SQL } from "bun";

export async function up(db: SQL) {
	await db.unsafe(`alter table products add column purchase_price integer`); // cents; null = unknown
}
