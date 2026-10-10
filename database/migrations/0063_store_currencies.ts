import type { SQL } from "bun";

// The extra currencies a shop's online store shows its prices in, JSON `[{code, rate}]`:
// `rate` = the shop's manual override (1 unit of the shop's currency = `rate` of `code`),
// null = the automatic rate. Display only — orders stay in `shops.currency`.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column currencies text not null default '[]'`,
	);
}
