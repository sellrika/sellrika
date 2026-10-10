import type { SQL } from "bun";

// Order-level discount: `discount_type` 'percent' (discount_value = whole percent 0..100) or 'fixed' (discount_value =
// cents); `discount` is the resulting cents, always recomputed server-side; total = subtotal - discount.
// `order_items.cost` snapshots the purchase price at sale time so profit reports survive later price edits.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table orders add column subtotal integer not null default 0`,
	);
	await db.unsafe(`alter table orders add column discount_type text`);
	await db.unsafe(
		`alter table orders add column discount_value integer not null default 0`,
	);
	await db.unsafe(
		`alter table orders add column discount integer not null default 0`,
	);
	await db.unsafe(`update orders set subtotal = total`);
	await db.unsafe(`alter table order_items add column cost integer`); // cents per unit; null = unknown
}
