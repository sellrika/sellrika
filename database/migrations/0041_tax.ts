import type { SQL } from "bun";

// Tax / VAT line per shop, snapshotted on every order:
//   shops.tax_rate       — hundredths of a percent (700 = 7%); 0 = no tax line
//   shops.tax_label      — what the line is called on receipts ("VAT", "GST", "Sales tax")
//   shops.tax_included   — prices already include the tax (the line is informational, total unchanged)
//                          vs added on top (total = subtotal − discount + tax + delivery_fee)
//   orders.tax/tax_rate/tax_included — what that order was charged, frozen at sale time (orders.tax_label follows in 0042)
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column tax_rate integer not null default 0`,
	);
	await db.unsafe(
		`alter table shops add column tax_label text not null default 'Tax'`,
	);
	await db.unsafe(
		`alter table shops add column tax_included boolean not null default false`,
	);
	await db.unsafe(
		`alter table orders add column tax integer not null default 0`,
	);
	await db.unsafe(
		`alter table orders add column tax_rate integer not null default 0`,
	);
	await db.unsafe(
		`alter table orders add column tax_included boolean not null default false`,
	);
}
