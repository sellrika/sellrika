import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Extensions a shop installed (app/extensions): one row per shop + extension key.
//   enabled — the switch on /extensions; an installed but disabled extension keeps its settings and does nothing
//   config  — JSON `{ field: value }` of the extension's settings, secret fields encrypted with APP_KEY
export async function up(db: SQL) {
	await db.unsafe(`create table shop_extensions (
    id ${ID_PK},
    shop_id integer not null,
    key text not null,
    enabled boolean not null default true,
    config text not null default '{}',
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_shop_extensions_shop_key on shop_extensions (shop_id, key)`,
	);
}
