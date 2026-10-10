import type { SQL } from "bun";

// IANA time zone per shop — "today" on the Orders page and the day/week/month buckets in Reports follow it
// (timestamps stay UTC in the DB). Existing shops get the server's zone, which is what "today" meant until now.
export async function up(db: SQL) {
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	await db.unsafe(
		`alter table shops add column timezone text not null default 'UTC'`,
	);
	await db`update shops set timezone = ${tz}`;
}
