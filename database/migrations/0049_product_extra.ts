import type { SQL } from "bun";

// products.extra — free "Additional data" rows (`[{ title, value }]` as JSON text), e.g. Darreichungsform / Marke / Hersteller for a pharmacy.
export async function up(db: SQL) {
	await db.unsafe(
		`alter table products add column extra text not null default '[]'`,
	);
}
