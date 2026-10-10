import type { SQL } from "bun";

export async function up(db: SQL) {
	await db.unsafe(`alter table products add column barcode text`);
	// one barcode per shop; NULLs are free (partial index works in SQLite and Postgres)
	await db.unsafe(
		`create unique index idx_products_shop_barcode on products (shop_id, barcode) where barcode is not null`,
	);
}
