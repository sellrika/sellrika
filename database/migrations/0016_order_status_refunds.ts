import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Order lifecycle. status: 'completed' | 'partially_refunded' | 'refunded' | 'voided'.
// Void = the sale never happened (mistake): excluded from revenue, stock restored. Refund = money returned later,
// possibly partial, recorded in `refunds` (+ `refund_items` for returned units); orders.refunded caches the sum and
// order_items.refunded_qty caches the returned units so remaining refundable qty/amount is one read.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table orders add column status text not null default 'completed'`,
	);
	await db.unsafe(
		`alter table orders add column refunded integer not null default 0`,
	);
	await db.unsafe(`alter table orders add column voided_at timestamp`);
	await db.unsafe(
		`alter table orders add column voided_by integer references users(id)`,
	);
	await db.unsafe(`alter table orders add column void_reason text`);
	await db.unsafe(
		`alter table order_items add column refunded_qty integer not null default 0`,
	);
	await db.unsafe(`create table refunds (
    id ${ID_PK},
    order_id integer not null references orders(id),
    shop_id integer not null references shops(id),
    user_id integer not null references users(id),
    amount integer not null,
    reason text not null default '',
    restock boolean not null default true,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create index idx_refunds_order on refunds (order_id)`);
	await db.unsafe(
		`create index idx_refunds_shop_created on refunds (shop_id, created_at)`,
	);
	await db.unsafe(`create table refund_items (
    id ${ID_PK},
    refund_id integer not null references refunds(id),
    order_item_id integer not null references order_items(id),
    qty integer not null
  )`);
	await db.unsafe(
		`create index idx_refund_items_refund on refund_items (refund_id)`,
	);
	await db.unsafe(
		`create index idx_orders_shop_created on orders (shop_id, created_at)`,
	);
}
