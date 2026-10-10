import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Inventory. products.track_stock turns it on per product; the on-hand quantity lives on the product (no variants)
// or on each variant. low_stock_at = alert threshold (stock <= it). Every change goes through stock_movements
// (signed qty; type 'sale' | 'refund' | 'void' | 'adjustment') so the history can be audited; the stock columns
// are the running total.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table products add column track_stock boolean not null default false`,
	);
	await db.unsafe(
		`alter table products add column stock integer not null default 0`,
	);
	await db.unsafe(
		`alter table products add column low_stock_at integer not null default 0`,
	);
	await db.unsafe(
		`alter table product_variants add column stock integer not null default 0`,
	);
	await db.unsafe(`create table stock_movements (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    product_id integer not null references products(id),
    variant_id integer references product_variants(id),
    type text not null,
    qty integer not null,
    reason text not null default '',
    order_id integer references orders(id),
    user_id integer references users(id),
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create index idx_stock_movements_item on stock_movements (product_id, variant_id, id)`,
	);
	await db.unsafe(
		`create index idx_stock_movements_shop on stock_movements (shop_id, created_at)`,
	);
}
