import type { SQL } from "bun";

// products.active — false hides the product from the POS and the online store; it stays on the admin list, greyed out.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table products add column active boolean not null default true`,
	);
}
