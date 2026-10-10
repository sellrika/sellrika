import type { SQL } from "bun";

// JSON text like {"Color":"Red","Size":"S"} — set by the "Quick generate" editor, used to filter variants in the POS picker.
export async function up(db: SQL) {
	await db.unsafe(`alter table product_variants add column attributes text`);
}
