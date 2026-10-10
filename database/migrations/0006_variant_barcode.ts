import type { SQL } from "bun";

// Per-variant barcode (a barcode identifies one sellable unit). Uniqueness per shop is enforced in ProductService
// because variants carry no shop_id for a partial index.
export async function up(db: SQL) {
	await db.unsafe(`alter table product_variants add column barcode text`);
}
