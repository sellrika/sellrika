import type { SQL } from "bun";

// Where customers should write about an order. Shown in the order confirmation email
// (app/services/OrderMailService.ts); null = fall back to the owner's account email.
export async function up(db: SQL) {
	await db.unsafe(`alter table shops add column support_email text`);
}
