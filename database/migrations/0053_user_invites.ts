import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

// Invitations to a new shop owner (app/services/settings/Invite.Service.ts): the platform admin creates a
// shop for an email, the person gets a link and picks their own name and password there.
//   token_hash — sha256 of the token in the link; the token itself is never stored
//   expires_at — the link stops working after this; accepting it deletes the row
export async function up(db: SQL) {
	await db.unsafe(`create table user_invites (
    id ${ID_PK},
    user_id integer not null,
    token_hash text not null,
    expires_at timestamp not null,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_user_invites_token on user_invites (token_hash)`,
	);
}
