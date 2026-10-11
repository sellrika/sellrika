// Applies every migration in ./migrations/index.ts not yet recorded in `migrations`, in version order.
// Versioned by the numeric filename prefix (0001_, 0002_ …). Up only — no rollback.
import type { SQL } from "bun";
import { dialect, sql } from "@xcore/database/Database";
import { MysqlDdl } from "@xcore/database/MysqlDdl";
import * as registry from "./migrations";

/**
 * The connection a migration must be given.
 * MySQL reads the migrations' SQL through a translator.
 * @param db The connection or transaction.
 * @returns The connection to hand to `up()`.
 */
export function migrationDb(db: SQL): SQL {
	return dialect === "mysql" ? MysqlDdl.wrap(db) : db;
}

/**
 * Apply every migration that has not run yet. Safe to call again.
 * @param quiet True = print nothing (the tests).
 */
export async function migrate(quiet = false) {
	await migrationDb(sql).unsafe(`create table if not exists migrations (
    version text primary key,
    applied_at timestamp not null default current_timestamp
  )`);
	const applied = new Set(
		(await sql`select version from migrations`).map(
			(r: { version: string }) => r.version,
		),
	);
	const entries = Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	);

	for (const [key, up] of entries) {
		const version = key.slice(1); // m0001_x → 0001_x
		if (applied.has(version)) continue;
		await sql.begin(async (tx) => {
			await up(migrationDb(tx));
			await tx`insert into migrations (version) values (${version})`;
		});
		if (!quiet) console.log("migrated", version);
	}
	if (!quiet) console.log(`migrations up to date (${entries.length})`);
}

if (import.meta.main) {
	await migrate();
	await sql.close();
}
