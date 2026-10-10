import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * Sales staff: the people who sell, named on an order next to the cashier.
 * They have no login. They belong to a shop.
 *   sales_staff.commission — their share of a sale, hundredths of a percent (0..10000)
 *   orders.sales_staff_id — who sold it (null = nobody named)
 * The commission due is not stored: it is worked out from the sales since the last payment.
 * Each payment is kept as a `sales_commissions` row, the history (the newest row = the last payment):
 *   amount — cents paid
 *   sales — cents sold in the paid period (refunds taken off, voided left out)
 *   orders — how many sales that was
 *   commission — the rate it was paid at, hundredths of a percent
 *   created_at — when it was paid
 */
export async function up(db: SQL) {
	await db.unsafe(`create table sales_staff (
    id ${ID_PK},
    shop_id integer not null,
    name text not null,
    commission integer not null default 0,
    active boolean not null default true,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create index idx_sales_staff_shop on sales_staff (shop_id)`);
	await db.unsafe(`create table sales_commissions (
    id ${ID_PK},
    shop_id integer not null,
    sales_staff_id integer not null,
    amount integer not null,
    sales integer not null,
    orders integer not null,
    commission integer not null,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create index idx_sales_commissions_staff on sales_commissions (sales_staff_id)`,
	);
	await db.unsafe(`alter table orders add column sales_staff_id integer`);
	await db.unsafe(
		`create index idx_orders_sales_staff on orders (sales_staff_id)`,
	);
}
