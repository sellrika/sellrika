import type { SQL } from "bun";

// Payment methods can be switched off without deleting them (hidden from checkout, kept on past orders).
export async function up(db: SQL) {
	await db.unsafe(
		`alter table payment_methods add column enabled boolean not null default true`,
	);
}
