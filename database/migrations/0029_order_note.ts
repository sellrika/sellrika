import type { SQL } from "bun";

// Free-text note on an order. The online store writes the buyer's delivery details here
// ("Deliver to: name · phone\naddress"); shown on the order page and the receipt.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table orders add column note text not null default ''`,
	);
}
