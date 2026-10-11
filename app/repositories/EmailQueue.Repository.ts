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
		await this.pushAll(db, kind, groupId, [{ ref_id: refId, to_email: to }]);
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
		await Db.upsert(db, "email_queue", rows, ["kind", "ref_id"]);
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
		/**
		 * Two steps: find the oldest one, then claim it.
		 * One statement with a subquery makes two workers wait
		 * for each other's lock on MySQL (a deadlock).
		 */
		for (;;) {
			const [next] =
				await sql`select id from email_queue where kind = ${kind} and group_id = ${groupId} and status = 'queued' order by id limit 1`;
			if (!next) return null;
			const [row] = await Db.update(
				sql,
				"email_queue",
				sql`status = 'sending', taken_at = ${sqlStamp(now)}`,
				sql`id = ${next.id} and status = 'queued'`,
				sql`id, ref_id, to_email`,
			);
			if (row)
				return {
					id: Number(row.id),
					ref_id: Number(row.ref_id),
					to_email: row.to_email,
				};
		}
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
