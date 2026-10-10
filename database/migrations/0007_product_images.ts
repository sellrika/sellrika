import type { SQL } from "bun";

// Products and variants get a JSON text array of image URLs (`images`), replacing the single `image` column.
// Same JSON-in-text pattern as product_variants.attributes (portable across SQLite and Postgres).
export async function up(db: SQL) {
	await db.unsafe(`alter table products add column images text`);
	await db.unsafe(
		`update products set images = '["' || image || '"]' where image is not null and image <> ''`,
	);
	await db.unsafe(`alter table products drop column image`);
	await db.unsafe(`alter table product_variants add column images text`);
}
