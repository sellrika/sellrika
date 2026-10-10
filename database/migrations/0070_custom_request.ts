import type { SQL } from "bun";

/**
 * Custom requests: a buyer may write a note for a product (like the name to engrave).
 *   products.custom_request — on = the store asks for the note when the product is added
 *   products.custom_request_label — the question over the box ("" = the default words)
 *   order_items.note — what the buyer wrote for that line ("" = nothing)
 */
export async function up(db: SQL) {
	await db.unsafe(
		`alter table products add column custom_request boolean not null default false`,
	);
	await db.unsafe(
		`alter table products add column custom_request_label text not null default ''`,
	);
	await db.unsafe(
		`alter table order_items add column note text not null default ''`,
	);
}
