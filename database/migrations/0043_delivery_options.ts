import type { SQL } from "bun";

// Delivery options per shop, on top of the flat prices from 0030 (applied at the online checkout, see deliveryFee()):
//   shops.pickup            — the buyer may collect in store instead (fee 0, no address asked)
//   shops.free_delivery_min — cents; a domestic order whose goods reach this amount ships free; null = no threshold
//   shops.delivery_rates    — JSON [{ cities: string[], fee }]: a domestic address in one of a row's cities pays that fee instead of delivery_fee
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column pickup boolean not null default false`,
	);
	await db.unsafe(`alter table shops add column free_delivery_min integer`);
	await db.unsafe(
		`alter table shops add column delivery_rates text not null default '[]'`,
	);
}
