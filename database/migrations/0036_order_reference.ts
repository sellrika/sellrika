import type { SQL } from "bun";
import { orderReference } from "@helpers/crypto";

// Public order code (`XXXX-XXXX-XXXX-XXXX` at the time, 12 symbols since — `P8J4-MJSQ-4Z8T`): what the buyer sees and tracks by, instead of the sequential id.
// Existing orders get one here so old confirmations can still be looked up by the shop staff.
export async function up(db: SQL) {
	await db.unsafe(`alter table orders add column reference text`);
	await db.unsafe(
		`create unique index idx_orders_reference on orders (reference)`,
	);
	const rows: { id: number }[] = await db.unsafe(
		`select id from orders where reference is null`,
	);
	for (const r of rows)
		await db.unsafe(
			`update orders set reference = '${orderReference()}' where id = ${Number(r.id)}`,
		); // the code is our own [A-Z2-9-] string, the id an integer
}
