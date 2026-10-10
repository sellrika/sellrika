import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { sqlStamp } from "@helpers/time";
import type { EmailQueueKind } from "@constants/Mail.Constant";

/** One email a worker took from the queue. */
export type QueuedEmail = {
	id: number;
	ref_id: number;
	to_email: string;
};

/** One email to put in the queue: what to send, and to whom. */
export type QueueEntry = Pick<QueuedEmail, "ref_id" | "to_email">;

/**
 * The email queue (`email_queue`): emails waiting for a worker, kept in the database
 * so a restart loses none. A row is deleted when its email is done.
 */
@Service()
export class EmailQueueRepository {
	/**
	 * Put one email in the queue. Nothing happens when it is queued already.
	 * @param db The transaction it belongs to.
	 * @param kind What the email is.
	 * @param groupId The batch, e.g. the campaign.
	 * @param refId The row that says what to send, e.g. the `campaign_sends` row.
	 * @param to The recipient.
	 */
	async push(
		db: SQL,
		kind: EmailQueueKind,
		groupId: number,
		refId: number,
		to: string,
	) {
		await db`insert into email_queue (kind, group_id, ref_id, to_email) values (${kind}, ${groupId}, ${refId}, ${to})
      on conflict (kind, ref_id) do nothing`;
	}

	/**
	 * Put many emails of one batch in the queue, with one insert.
	 * One that is queued already is skipped.
	 * @param db The transaction they belong to.
	 * @param kind What the emails are.
	 * @param groupId The batch, e.g. the campaign.
	 * @param emails Each one's row to send and its recipient.
	 */
	async pushAll(
		db: SQL,
		kind: EmailQueueKind,
		groupId: number,
		emails: QueueEntry[],
	) {
		if (!emails.length) return;
		const rows = [];
		for (const e of emails)
			rows.push({
				kind,
				group_id: groupId,
				ref_id: e.ref_id,
				to_email: e.to_email,
			});
		await db`insert into email_queue ${db(rows)} on conflict (kind, ref_id) do nothing`;
	}

	/**
	 * Take the oldest waiting email of a batch: queued → sending. Atomic.
	 * When another worker got that row first, the next one is tried.
	 * @param kind What the email is.
	 * @param groupId The batch.
	 * @param now The current time.
	 * @returns The email, or null when nothing of the batch is waiting.
	 */
	async take(
		kind: EmailQueueKind,
		groupId: number,
		now: Date,
	): Promise<QueuedEmail | null> {
		for (;;) {
			const [row] =
				await sql`update email_queue set status = 'sending', taken_at = ${sqlStamp(now)}
        where id = (select id from email_queue where kind = ${kind} and group_id = ${groupId} and status = 'queued' order by id limit 1)
        and status = 'queued' returning id, ref_id, to_email`;
			if (row)
				return {
					id: Number(row.id),
					ref_id: Number(row.ref_id),
					to_email: row.to_email,
				};
			if (!(await this.waiting(kind, groupId))) return null;
		}
	}

	/**
	 * Does a batch still have emails waiting?
	 * @param kind What the emails are.
	 * @param groupId The batch.
	 * @returns True while one is queued.
	 */
	async waiting(kind: EmailQueueKind, groupId: number) {
		return Db.exists(
			sql`select 1 from email_queue where kind = ${kind} and group_id = ${groupId} and status = 'queued' limit 1`,
		);
	}

	/**
	 * An email is done (sent or failed): it leaves the queue.
	 * @param id The queue row.
	 */
	async done(id: number) {
		await sql`delete from email_queue where id = ${id}`;
	}

	/**
	 * Empty a finished batch.
	 * Rows still "sending" were cut off by a crash.
	 * They are never sent again.
	 * @param kind What the emails are.
	 * @param groupId The batch.
	 */
	async clear(kind: EmailQueueKind, groupId: number) {
		await sql`delete from email_queue where kind = ${kind} and group_id = ${groupId}`;
	}
}
