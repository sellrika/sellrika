import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * Passkeys: a staff user signs in with a fingerprint, face or screen lock.
 *   credential_id — the passkey's own id from the device, base64url
 *   public_key — the key that checks its signatures, SPKI DER as base64url
 *   name — what the user called it ('' = no name)
 *   sign_count — the device's use counter (0 for passkeys that sync)
 */
export async function up(db: SQL) {
	await db.unsafe(`create table passkeys (
    id ${ID_PK},
    user_id integer not null,
    credential_id text not null,
    public_key text not null,
    name text not null default '',
    sign_count integer not null default 0,
    last_used_at timestamp,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_passkeys_credential on passkeys (credential_id)`,
	);
	await db.unsafe(`create index idx_passkeys_user on passkeys (user_id)`);
}
