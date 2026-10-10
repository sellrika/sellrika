import type { SQL } from "bun";

// The languages a shop's online store offers, as a comma list of locales (`en,de`); the first is the default.
// Every shop so far offers every language the app speaks, English first — what the store did before.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column languages text not null default 'en,de'`,
	);
}
