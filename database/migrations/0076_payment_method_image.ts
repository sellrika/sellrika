import type { SQL } from "bun";

/**
 * A picture per payment method, shown to the customer on the second screen
 * while the cashier has that method picked: a QR code to pay, say.
 *   image — an `/uploads/<shop id>/payments/…` path, null = none
 */
export async function up(db: SQL) {
	await db.unsafe(`alter table payment_methods add column image text`);
}
