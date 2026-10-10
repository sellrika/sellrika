import type { SQL } from "bun";

// Online-order lifecycle + manual payments.
// orders.payment_status: 'paid' (POS + gateway orders) | 'unpaid' | 'partial' — `paid` holds the cents received so far.
// orders.fulfillment: '' for POS sales; online orders walk new → packing → shipped → delivered (+ `tracking`).
// shops.manual_gateways: comma list of manual payment options switched on next to the online gateway (cod, bank_transfer).
export async function up(db: SQL) {
	await db.unsafe(
		`alter table orders add column payment_status text not null default 'paid'`,
	);
	await db.unsafe(
		`alter table orders add column fulfillment text not null default ''`,
	);
	await db.unsafe(
		`alter table orders add column tracking text not null default ''`,
	);
	await db.unsafe(
		`alter table shops add column manual_gateways text not null default ''`,
	);
	// existing online orders (signed by the hidden Online Store user) start at "new" — visible and fixable, never silently "delivered"
	await db.unsafe(
		`update orders set fulfillment = 'new' where user_id in (select id from users where email = 'online-store@pos.local')`,
	);
}
