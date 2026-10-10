import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * API keys: a program reads and changes one shop's data with one, through `/api/v1`.
 *   shop_id — the one shop the key works in
 *   user_id — the admin who made it; the key acts as them
 *   role — the most the key may do (admin | manager | cashier)
 *   key_hash — SHA-256 of the key; the key itself is shown once and never stored
 *   last4 — the key's last 4 characters, to tell keys apart on the list
 *   last_used_at — the last call made with it (written at most once a minute)
 */
export async function up(db: SQL) {
	await db.unsafe(`create table api_keys (
    id ${ID_PK},
    shop_id integer not null,
    user_id integer not null,
    name text not null,
    role text not null,
    key_hash text not null,
    last4 text not null,
    last_used_at timestamp,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_api_keys_hash on api_keys (key_hash)`,
	);
	await db.unsafe(`create index idx_api_keys_shop on api_keys (shop_id)`);
}
