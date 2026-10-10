import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * Lists an extension keeps for itself, per shop: `ctx.data.collection(name)`.
 * One row per record, so a list may grow without end
 * (`extension_data` keeps one value per name).
 *   ext_key — the extension's manifest key
 *   collection — the extension's own name for the list
 *   ref — one lookup key the extension picks ("customer:12"), '' = none
 *   value — JSON text, the record itself
 */
export async function up(db: SQL) {
	await db.unsafe(`create table extension_rows (
    id ${ID_PK},
    shop_id integer not null,
    ext_key text not null,
    collection text not null,
    ref text not null default '',
    value text not null,
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create index idx_extension_rows on extension_rows (shop_id, ext_key, collection, ref, id)`,
	);
}
