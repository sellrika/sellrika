import type { SQL } from "bun";

// Delivery pricing per shop, applied at the online checkout:
//   shops.country             — where the shop is (country NAME from app/validators/countries.ts); null = not set
//   shops.delivery_fee        — cents, delivery inside the shop's country (the only fee when country is null)
//   shops.delivery_fee_abroad — cents, delivery to any other country; null = the store only delivers domestically
//   orders.delivery_fee       — cents charged on that order; total = subtotal − discount + delivery_fee
export async function up(db: SQL) {
	await db.unsafe(`alter table shops add column country text`);
	await db.unsafe(
		`alter table shops add column delivery_fee integer not null default 0`,
	);
	await db.unsafe(`alter table shops add column delivery_fee_abroad integer`);
	await db.unsafe(
		`alter table orders add column delivery_fee integer not null default 0`,
	);
}
