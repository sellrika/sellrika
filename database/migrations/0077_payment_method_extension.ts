import type { SQL } from "bun";

/**
 * A payment method may be added by an extension (manifest `payment_method`).
 *   extension — the key of the extension that added it, null = the shop's own
 */
export async function up(db: SQL) {
	await db.unsafe(`alter table payment_methods add column extension text`);
}
