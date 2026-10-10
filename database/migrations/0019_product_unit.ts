import type { SQL } from "bun";

export async function up(db: SQL) {
	await db.unsafe(`alter table products add column unit text`); // "pcs", "kg", … ; null = none
}
