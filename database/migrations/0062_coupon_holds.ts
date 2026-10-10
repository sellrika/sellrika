import type { SQL } from "bun";

// A discount code is held from the moment an online checkout starts, not only once the order exists.
// Otherwise several checkouts at once could all use a one-time code before any of them is counted.
//   store_carts.coupon_id     — the code this checkout holds (null = none)
//   store_carts.coupon_email  — the buyer's email (lower-cased), for the per-customer limit
// A hold counts while the cart has no order and is younger than COUPON_HOLD_MS.
export async function up(db: SQL) {
	await db.unsafe(`alter table store_carts add column coupon_id integer`);
	await db.unsafe(
		`alter table store_carts add column coupon_email text not null default ''`,
	);
	await db.unsafe(
		`create index idx_store_carts_coupon on store_carts (coupon_id)`,
	);
}
