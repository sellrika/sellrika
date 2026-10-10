import type { SQL } from "bun";

export async function up(db: SQL) {
	// optional merchant SKU; on a product with variants it lives per variant (like barcodes)
	await db.unsafe(`alter table products add column sku text`);
	await db.unsafe(`alter table product_variants add column sku text`);
}
