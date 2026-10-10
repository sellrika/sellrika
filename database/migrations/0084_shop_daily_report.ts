import type { SQL } from "bun";

/**
 * The daily sales report of a shop, posted to its chat channels.
 *   shops.report_enabled  — the switch on /reports
 *   shops.report_time     — when it goes out, "HH:MM" on the shop's clock
 *   shops.report_channels — the Chat alerts channels picked (comma list)
 *   shops.report_sent_on  — the shop's day of the last report, "" = never
 */
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column report_enabled boolean not null default false`,
	);
	await db.unsafe(
		`alter table shops add column report_time text not null default '22:00'`,
	);
	await db.unsafe(
		`alter table shops add column report_channels text not null default ''`,
	);
	await db.unsafe(
		`alter table shops add column report_sent_on text not null default ''`,
	);
}
