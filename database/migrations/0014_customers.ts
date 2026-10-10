import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Customers are per shop; an order may point at one (kept on delete → set null by the repository).
// Phone is optional but unique per shop when present (partial unique index: SQLite + Postgres).
export async function up(db: SQL) {
	await db.unsafe(`create table customers (
    id ${ID_PK},
    shop_id integer not null references shops(id),
    name text not null,
    phone text,
    email text,
    note text not null default '',
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(`create index idx_customers_shop on customers (shop_id)`);
	await db.unsafe(
		`create unique index idx_customers_shop_phone on customers (shop_id, phone) where phone is not null`,
	);
	await db.unsafe(
		`alter table orders add column customer_id integer references customers(id)`,
	);
	await db.unsafe(`create index idx_orders_customer on orders (customer_id)`);
}
