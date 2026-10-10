import type { SQL } from "bun";

/**
 * A picture per category.
 *   image — an `/uploads/<shop id>/categories/…` path, null = none
 */
export async function up(db: SQL) {
	await db.unsafe(`alter table categories add column image text`);
}
