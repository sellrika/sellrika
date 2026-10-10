import type { SQL } from "bun";

// "Was" price in cents — nullable, purely for display. The storefront shows it struck through
// (and a % off badge) whenever it is above what the product actually sells for.
// ponytail: product-level only; move it onto product_variants if per-variant sales are ever needed.
export async function up(db: SQL) {
	await db.unsafe(`alter table products add column original_price integer`);
}
