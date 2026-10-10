import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Coupons / discount codes for the online checkout (docs/features/coupons.md):
//   coupons             — one code per row, per shop (unique per shop). `type` = percent | fixed | free_delivery,
//                         `value` = whole percent or cents (0 for free delivery), `min_subtotal` / `max_discount` (cents),
//                         `starts_at` / `ends_at` = YYYY-MM-DD in the shop's time zone (null = open ended),
//                         `usage_limit` / `per_customer_limit` (null = unlimited), `product_ids` / `category_ids` /
//                         `emails` = JSON arrays that restrict the code ([] = any product / any buyer).
//   coupon_redemptions  — one row per order that used a code; the usage counters are counts of these rows,
//                         keyed by the buyer's email for the per-customer limit. Deleted when the order is voided.
//   orders.coupon_code  — the code as text so the history survives a deleted coupon (like payment_method).
export async function up(db: SQL) {
	await db.unsafe(`create table coupons (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    code text not null,
    description text not null default '',
    type text not null default 'percent',
    value integer not null default 0,
    min_subtotal integer not null default 0,
    max_discount integer,
    starts_at text,
    ends_at text,
    usage_limit integer,
    per_customer_limit integer,
    product_ids text not null default '[]',
    category_ids text not null default '[]',
    emails text not null default '[]',
    active boolean not null default true,
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_coupons_shop_code on coupons (shop_id, code)`,
	);
	await db.unsafe(`create table coupon_redemptions (
    id ${ID_PK},
    coupon_id integer not null references coupons(id),
    shop_id integer not null references shops(id),
    order_id integer not null,
    email text not null default '',
    amount integer not null default 0,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create index idx_coupon_redemptions_coupon on coupon_redemptions (coupon_id)`,
	);
	await db.unsafe(
		`create index idx_coupon_redemptions_order on coupon_redemptions (order_id)`,
	);
	await db.unsafe(`alter table orders add column coupon_code text`);
}
