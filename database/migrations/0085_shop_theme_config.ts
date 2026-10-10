import type { SQL } from "bun";

/**
 * The shop's own colours and font for the built-in store themes.
 *   shops.theme_config — JSON `{ <theme>: { primary, secondary, font } }`,
 *   '' = every theme keeps its own look.
 */
export async function up(db: SQL) {
	await db.unsafe(
		`alter table shops add column theme_config text not null default ''`,
	);
}
