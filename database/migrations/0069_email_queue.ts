import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * The email queue: emails waiting for a worker, kept in the database so a restart loses none.
 *   kind — what the email is: `campaign` (ref_id = the `campaign_sends` row, group_id = the campaign)
 *   group_id — the batch the email belongs to; the workers of one batch take only its rows
 *   status — queued → sending; the row is deleted when the email is done
 *     (the result stays in the batch's own history, like `campaign_sends`)
 */
export async function up(db: SQL) {
	await db.unsafe(`create table email_queue (
    id ${ID_PK},
    kind text not null,
    group_id integer not null,
    ref_id integer not null,
    to_email text not null,
    status text not null default 'queued',
    taken_at timestamp,
    created_at timestamp not null default current_timestamp
  )`);
	await db.unsafe(
		`create unique index idx_email_queue_ref on email_queue (kind, ref_id)`,
	);
	await db.unsafe(
		`create index idx_email_queue_next on email_queue (kind, group_id, status)`,
	);
}
