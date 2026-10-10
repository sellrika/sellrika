// Applies every migration in ./migrations/index.ts not yet recorded in `migrations`, in version order.
// Versioned by the numeric filename prefix (0001_, 0002_ …). Up only — no rollback.
import { sql } from "@xcore/database/Database";
import * as registry from "./migrations";

export async function migrate() {
	await sql`create table if not exists migrations (version text primary key, applied_at text not null default current_timestamp)`;
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
			await up(tx);
			await tx`insert into migrations (version) values (${version})`;
		});
		console.log("migrated", version);
	}
	console.log(`migrations up to date (${entries.length})`);
}

if (import.meta.main) {
	await migrate();
	await sql.close();
}
