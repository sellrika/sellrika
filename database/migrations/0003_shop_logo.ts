import type { SQL } from "bun";

export async function up(db: SQL) {
	await db.unsafe(`alter table shops add column logo text`); // "/uploads/<file>"
}
