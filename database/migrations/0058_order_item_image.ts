import type { SQL } from "bun";

// The picture an order line had when it was sold, for the order emails.
//   image — a `/uploads/<uuid>.<ext>` path; null = no picture.
// Uploads get a new name each time and are never deleted, so the path alone is a safe snapshot:
// a later change to the product's pictures does not change old orders.
export async function up(db: SQL) {
	await db.unsafe(`alter table order_items add column image text`);
}
