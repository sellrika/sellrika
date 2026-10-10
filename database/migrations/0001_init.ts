import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Portable DDL: works on SQLite and Postgres (integer cents, `timestamp`, `boolean`).
export async function up(db: SQL) {
	await db.unsafe(`create table users (
    id ${ID_PK},
    name text not null,
    email text not null unique,
    password_hash text not null,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create table sessions (
    id text primary key,
    user_id integer not null,
    shop_id integer,
    expires_at timestamp not null
  )`);
	await db.unsafe(`create table shops (
    id ${ID_PK},
    name text not null,
    currency text not null default 'USD',
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create table categories (
    id ${ID_PK},
    shop_id integer not null,
    name text not null,
    position integer not null default 0
  )`);
	await db.unsafe(`create table products (
    id ${ID_PK},
    shop_id integer not null,
    name text not null,
    description text not null default '',
    price integer not null,
    image text,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create table product_categories (
    product_id integer not null,
    category_id integer not null,
    primary key (product_id, category_id)
  )`);
	await db.unsafe(`create table product_variants (
    id ${ID_PK},
    product_id integer not null,
    name text not null,
    price integer not null,
    position integer not null default 0
  )`);
	await db.unsafe(`create table orders (
    id ${ID_PK},
    shop_id integer not null,
    user_id integer not null,
    total integer not null,
    paid integer not null,
    change integer not null default 0,
    payment_method text not null default 'cash',
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create table order_items (
    id ${ID_PK},
    order_id integer not null,
    product_id integer,
    variant_id integer,
    name text not null,
    price integer not null,
    qty integer not null
  )`);
	await db.unsafe(`create index idx_products_shop on products (shop_id)`);
	await db.unsafe(`create index idx_categories_shop on categories (shop_id)`);
	await db.unsafe(
		`create index idx_variants_product on product_variants (product_id)`,
	);
	await db.unsafe(`create index idx_orders_shop on orders (shop_id)`);
	await db.unsafe(
		`create index idx_order_items_order on order_items (order_id)`,
	);
}
