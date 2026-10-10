import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Extensions the platform admin switched on for all shops: one row per extension key.
//   enabled — the "Enabled for all shops" switch on Admin › Global Extensions; no row = off
// Every key a shop already uses is switched on here, so running shops keep working after the upgrade.
export async function up(db: SQL) {
	await db.unsafe(`create table platform_extensions (
    id ${ID_PK},
    key text not null unique,
    enabled boolean not null default false,
    created_at timestamp not null default current_timestamp
  )`);
	// a literal `true`: SQLite and Postgres both read it, and Postgres can't type a bound parameter in a select list
	await db.unsafe(
		`insert into platform_extensions (key, enabled) select distinct key, true from shop_extensions`,
	);
}
