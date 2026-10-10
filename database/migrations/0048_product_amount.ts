import type { SQL } from "bun";

// products.amount — how much one sale unit holds, as a number (50 for "50 g" — the unit is products.unit); shown next to the name.
export async function up(db: SQL) {
	await db.unsafe(`alter table products add column amount real`);
}
