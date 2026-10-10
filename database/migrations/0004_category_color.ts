import type { SQL } from "bun";

export async function up(db: SQL) {
	await db.unsafe(`alter table categories add column color text`); // "#rrggbb"
}
