import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * Small data an extension keeps for itself, per shop: `ctx.data` in its routes and listeners.
 * One row per shop + extension + name. The Restaurant keeps each table's QR token here.
 *   ext_key — the extension's manifest key
 *   name — the extension's own name for the value
 *   value — JSON text
 */
export async function up(db: SQL) {
	await db.unsafe(`create table extension_data (
    id ${ID_PK},
    shop_id integer not null,
    ext_key text not null,
    name text not null,
    value text not null,
    updated_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_extension_data on extension_data (shop_id, ext_key, name)`,
	);
}
