import type { SQL } from "bun";

// Extensions for some users only (Admin › Global Extensions › Available to).
//   users — JSON list of the owners' user ids who may use the extension; [] = every user
export async function up(db: SQL) {
	await db.unsafe(
		`alter table platform_extensions add column users text not null default '[]'`,
	);
}
