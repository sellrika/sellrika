import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { Paginate } from "@xcore/http/Paginate";
import { parseJson } from "@helpers/json";
import { sqlStamp } from "@helpers/time";
import type {
	Campaign,
	CampaignSend,
	MarketingCustomer,
} from "@models/Campaign";
import {
	CAMPAIGN_QUEUE_BATCH,
	type CampaignStatus,
} from "@constants/Marketing.Constant";
import { isUnsubscribed } from "./Customer.Repository";
import { EmailQueueRepository, type QueueEntry } from "./EmailQueue.Repository";

/** What a campaign is made of when it is saved. */
export type CampaignData = {
	subject: string;
	body: string;
	product_ids: number[];
	customer_ids: number[];
};

/**
 * A `campaigns` row as the driver returns it.
 * The id lists are JSON text, the counts may be strings.
 */
type CampaignRow = Omit<
	Campaign,
	"product_ids" | "customer_ids" | "sent" | "failed"
> & {
	product_ids: string | null;
	customer_ids: string | null;
	sent: unknown;
	failed: unknown;
};

/**
 * A picker row before the unsubscribe flag is turned into a boolean.
 * SQLite gives 0/1.
 */
type PickRow = Omit<MarketingCustomer, "unsubscribed"> & {
	unsubscribed: unknown;
};

/** Is this customer's email on the shop's unsubscribe list? As a column. */
const unsubscribed = sql`${isUnsubscribed} as unsubscribed`;

/** Email campaigns of a shop, and who each one went to. */
@Service()
export class CampaignRepository {
	/**
	 * @param queue The email queue the recipients are put in.
	 */
	constructor(private queue: EmailQueueRepository) {}

	/**
	 * One page of the shop's campaigns, newest first.
	 * @param shopId The shop.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of campaigns.
	 */
	async page(shopId: number, page: number, perPage: number) {
		const [{ n }] =
			await sql`select count(*) as n from campaigns where shop_id = ${shopId}`;
		const rows: CampaignRow[] =
			await sql`select * from campaigns where shop_id = ${shopId} order by id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<Campaign>(
			rows.map((r) => this.#row(r)),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * One campaign of a shop.
	 * @param id Campaign id.
	 * @param shopId The shop it must belong to.
	 * @returns The campaign, or null.
	 */
	async find(id: number, shopId: number): Promise<Campaign | null> {
		return Db.one(
			sql`select * from campaigns where id = ${id} and shop_id = ${shopId}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Add a draft.
	 * @param shopId The shop.
	 * @param d Subject, body and the id lists.
	 * @param userId Who wrote it.
	 * @returns The new campaign.
	 */
	async create(shopId: number, d: CampaignData, userId: number) {
		return this.#row(
			(
				await Db.insert(
					sql,
					"campaigns",
					sql`insert into campaigns (shop_id, subject, body, product_ids, customer_ids, created_by)
      values (${shopId}, ${d.subject}, ${d.body}, ${JSON.stringify(d.product_ids)}, ${JSON.stringify(d.customer_ids)}, ${userId})`,
				)
			)[0],
		);
	}

	/**
	 * Change a draft or a scheduled campaign.
	 * One that is sending or sent stays as it is.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @param d Subject, body and the id lists.
	 * @returns False when nothing was changed.
	 */
	async update(id: number, shopId: number, d: CampaignData) {
		return Db.exists(
			Db.update(
				sql,
				"campaigns",
				sql`subject = ${d.subject}, body = ${d.body}, product_ids = ${JSON.stringify(d.product_ids)},
      customer_ids = ${JSON.stringify(d.customer_ids)}, updated_at = current_timestamp`,
				sql`id = ${id} and shop_id = ${shopId} and status in ('draft', 'scheduled')`,
			),
		);
	}

	/**
	 * Schedule a campaign, or take it back to a draft.
	 * Only a draft or a scheduled one can change.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @param sendAt When it goes out, or null for a draft.
	 * @returns False when nothing was changed.
	 */
	async schedule(id: number, shopId: number, sendAt: Date | null) {
		const status: CampaignStatus = sendAt ? "scheduled" : "draft";
		const at = sendAt ? sqlStamp(sendAt) : null;
		return Db.exists(
			Db.update(
				sql,
				"campaigns",
				sql`status = ${status}, send_at = ${at}, updated_at = current_timestamp`,
				sql`id = ${id} and shop_id = ${shopId} and status in ('draft', 'scheduled')`,
			),
		);
	}

	/**
	 * Delete a campaign and its recipient rows. Never one that is sending.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @returns False when nothing was deleted.
	 */
	async remove(id: number, shopId: number) {
		return await sql.begin((tx) => this.#drop(tx, id, shopId));
	}

	/**
	 * The campaigns the sweep works on: scheduled ones that are due,
	 * and ones left "sending" (a crash in the middle of a send).
	 * @param now The current time.
	 * @returns Those campaigns, oldest first.
	 */
	async due(now: Date): Promise<Campaign[]> {
		return (
			await sql`select * from campaigns where status = 'sending' or (status = 'scheduled' and send_at <= ${sqlStamp(now)}) order by id`
		).map((r: CampaignRow) => this.#row(r));
	}

	/**
	 * Move a due campaign from scheduled to sending. Atomic.
	 * Refused while another campaign of the same account is sending.
	 * One at a time per account.
	 * The sending ones are read through `busy`: MySQL refuses
	 * a plain subquery on the table it updates.
	 * @param id Campaign id.
	 * @returns False when another sweep, "Cancel schedule",
	 *   or another campaign got there first.
	 */
	async claim(id: number) {
		return Db.exists(
			Db.update(
				sql,
				"campaigns",
				sql`status = 'sending', updated_at = current_timestamp`,
				sql`id = ${id} and status = 'scheduled' and not exists (
        select 1 from (
          select s.owner_id from campaigns o join shops s on s.id = o.shop_id where o.status = 'sending'
        ) busy
        where busy.owner_id = (select owner_id from shops where id = campaigns.shop_id)
      )`,
			),
		);
	}

	/**
	 * Is a campaign of this account sending right now?
	 * @param ownerId The account's owner.
	 * @returns True while one is.
	 */
	async sending(ownerId: number) {
		return Db.exists(
			sql`select 1 from campaigns c join shops s on s.id = c.shop_id
      where c.status = 'sending' and s.owner_id = ${ownerId} limit 1`,
		);
	}

	/**
	 * Book one recipient before the email goes out.
	 * The unique (campaign, customer) index makes this the "sent once" guard.
	 * @param campaignId Campaign id.
	 * @param customerId The recipient.
	 * @param email Their address at send time.
	 * @param platform It goes through the platform's email.
	 *   It then counts toward the monthly limit.
	 * @returns The row id, or null when the recipient was booked before.
	 */
	async book(
		campaignId: number,
		customerId: number,
		email: string,
		platform = false,
	) {
		return Db.insertOnce(
			sql,
			"campaign_sends",
			{ campaign_id: campaignId, customer_id: customerId, email, platform },
			["campaign_id", "customer_id"],
		);
	}

	/**
	 * Put a campaign's recipients in the email queue, in one transaction.
	 * Each one is first booked in `campaign_sends`, so nobody is queued twice.
	 * An unsubscribed one is booked with the reason and not queued.
	 * Run again after a crash, it only adds who is not booked yet.
	 * @param campaignId Campaign id.
	 * @param recipients The picked customers who have an email.
	 * @param platform They go through the platform's email.
	 *   They then count toward the monthly limit.
	 * @param unsubscribed The reason written for an unsubscribed one.
	 */
	async enqueue(
		campaignId: number,
		recipients: MarketingCustomer[],
		platform: boolean,
		unsubscribed: string,
	) {
		await sql.begin((tx) =>
			this.#queueAll(tx, campaignId, recipients, platform, unsubscribed),
		);
	}

	/**
	 * Record how one send went.
	 * @param sendId The recipient row.
	 * @param error Why it failed, or null when it went out.
	 * @param now The current time.
	 */
	settle(sendId: number, error: string | null, now: Date) {
		const at = error ? null : sqlStamp(now);
		return sql`update campaign_sends set sent_at = ${at}, error = ${error} where id = ${sendId}`;
	}

	/**
	 * Mark a campaign sent and count its recipient rows.
	 * @param id Campaign id.
	 */
	finish(id: number) {
		return sql`update campaigns set status = 'sent', updated_at = current_timestamp,
      sent = (select count(*) from campaign_sends s where s.campaign_id = ${id} and s.sent_at is not null),
      failed = (select count(*) from campaign_sends s where s.campaign_id = ${id} and s.sent_at is null)
      where id = ${id}`;
	}

	/**
	 * How many campaign emails an account's shops sent
	 * through the platform's email since a time.
	 * Failed and skipped ones, and ones through a shop's own email, do not count.
	 * @param ownerId The account's owner.
	 * @param since From this time on.
	 * @returns The count.
	 */
	async platformSentSince(ownerId: number, since: Date) {
		const [{ n }] =
			await sql`select count(*) as n from campaign_sends s join campaigns c on c.id = s.campaign_id
      join shops sh on sh.id = c.shop_id
      where sh.owner_id = ${ownerId} and s.platform = ${true} and s.sent_at >= ${sqlStamp(since)}`;
		return Number(n);
	}

	/**
	 * One page of a campaign's recipient rows.
	 * @param campaignId Campaign id.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of rows with the customer's name.
	 */
	async sends(campaignId: number, page: number, perPage: number) {
		const [{ n }] =
			await sql`select count(*) as n from campaign_sends where campaign_id = ${campaignId}`;
		const rows: CampaignSend[] =
			await sql`select s.*, c.name from campaign_sends s left join customers c on c.id = s.customer_id
      where s.campaign_id = ${campaignId} order by s.id ${Paginate.limit(page, perPage)}`;
		return Paginate.of<CampaignSend>(rows, Number(n), page, perPage);
	}

	/**
	 * One page of the recipient picker: the shop's customers who have an email.
	 * @param shopId The shop.
	 * @param q Search over name and email ("" = everyone).
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of customers with their unsubscribe flag.
	 */
	async customers(shopId: number, q: string, page: number, perPage: number) {
		const where = this.#pickable(shopId, q);
		const [{ n }] = await sql`select count(*) as n from customers c ${where}`;
		const rows: PickRow[] =
			await sql`select c.id, c.name, c.email, ${unsubscribed} from customers c ${where} order by c.name, c.id ${Paginate.limit(page, perPage)}`;
		return Paginate.of<MarketingCustomer>(
			rows.map((r) => this.#pick(r)),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * "Select all": the ids of every matching customer who may get email.
	 * @param shopId The shop.
	 * @param q The same search as the picker.
	 * @param limit At most this many.
	 * @returns The ids.
	 */
	async customerIds(shopId: number, q: string, limit: number) {
		const rows: { id: unknown }[] =
			await sql`select c.id from customers c ${this.#pickable(shopId, q)}
      and not ${isUnsubscribed}
      order by c.name, c.id limit ${limit}`;
		return rows.map((r) => Number(r.id));
	}

	/**
	 * The recipients a campaign sends to: the picked customers who still have an email.
	 * @param shopId The shop.
	 * @param ids The picked customer ids.
	 * @returns Each one's id, email and unsubscribe flag.
	 */
	async recipients(
		shopId: number,
		ids: number[],
	): Promise<MarketingCustomer[]> {
		if (!ids.length) return [];
		const rows: PickRow[] =
			await sql`select c.id, c.name, c.email, ${unsubscribed} from customers c
      where c.shop_id = ${shopId} and c.id in ${sql(ids)} and coalesce(c.email, '') <> '' order by c.id`;
		return rows.map((r) => this.#pick(r));
	}

	/**
	 * Turn a DB row into a campaign.
	 * The id lists are JSON text in the columns.
	 * @param r The row.
	 * @returns The campaign.
	 */
	#row(r: CampaignRow): Campaign {
		return {
			...r,
			product_ids: parseJson(r.product_ids, []),
			customer_ids: parseJson(r.customer_ids, []),
			sent: Number(r.sent),
			failed: Number(r.failed),
		};
	}

	/**
	 * Turn a picker row into a `MarketingCustomer`.
	 * @param r The raw row.
	 * @returns The customer with a real unsubscribe flag.
	 */
	#pick(r: PickRow): MarketingCustomer {
		return { ...r, unsubscribed: !!r.unsubscribed };
	}

	/**
	 * The writes of `remove`, inside its transaction.
	 * @param tx The open transaction.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @returns False when nothing was deleted.
	 * @throws When the campaign started sending in between. Nothing is deleted then.
	 */
	async #drop(tx: SQL, id: number, shopId: number) {
		const mine = tx`id = ${id} and shop_id = ${shopId} and status <> 'sending'`;
		if (!(await Db.exists(tx`select 1 from campaigns where ${mine}`)))
			return false;
		// the recipients first: Postgres refuses to delete a campaign that has some
		await tx`delete from campaign_sends where campaign_id = ${id}`;
		if (!(await Db.delete(tx, "campaigns", mine)))
			throw new Error(`campaign ${id} started sending while it was deleted`);
		return true;
	}

	/**
	 * The writes of `enqueue`, inside its transaction.
	 * Many rows go in one insert, `CAMPAIGN_QUEUE_BATCH` at a time.
	 * One insert per recipient was slow for a big campaign.
	 * A recipient booked before is skipped by the unique index, as before.
	 * @param tx The open transaction.
	 * @param campaignId Campaign id.
	 * @param recipients The picked customers who have an email.
	 * @param platform They go through the platform's email.
	 * @param unsubscribed The reason written for an unsubscribed one.
	 */
	async #queueAll(
		tx: SQL,
		campaignId: number,
		recipients: MarketingCustomer[],
		platform: boolean,
		unsubscribed: string,
	) {
		for (let i = 0; i < recipients.length; i += CAMPAIGN_QUEUE_BATCH) {
			const rows = [];
			for (const r of recipients.slice(i, i + CAMPAIGN_QUEUE_BATCH))
				rows.push({
					campaign_id: campaignId,
					customer_id: r.id,
					email: r.email,
					platform,
					error: r.unsubscribed ? unsubscribed : null,
				});
			const booked = await this.#bookAll(tx, campaignId, rows);
			const emails: QueueEntry[] = [];
			for (const b of booked)
				if (!b.error) emails.push({ ref_id: Number(b.id), to_email: b.email });
			await this.queue.pushAll(tx, "campaign", campaignId, emails);
		}
	}

	/**
	 * Book many recipients of a campaign with one insert.
	 * MySQL cannot say which rows an insert added.
	 * So the ones booked before are read first and left out.
	 * @param tx The open transaction.
	 * @param campaignId Campaign id.
	 * @param rows The `campaign_sends` rows to add.
	 * @returns The rows this call added, with their ids.
	 */
	async #bookAll(
		tx: SQL,
		campaignId: number,
		rows: { customer_id: number }[],
	): Promise<{ id: unknown; email: string; error: string | null }[]> {
		const ids = rows.map((r) => r.customer_id);
		const before: { customer_id: unknown }[] =
			await tx`select customer_id from campaign_sends where campaign_id = ${campaignId} and customer_id in ${tx(ids)}`;
		const known = new Set(before.map((r) => Number(r.customer_id)));
		const fresh = rows.filter((r) => !known.has(r.customer_id));
		if (!fresh.length) return [];
		await Db.upsert(tx, "campaign_sends", fresh, [
			"campaign_id",
			"customer_id",
		]);
		return tx`select id, email, error from campaign_sends where campaign_id = ${campaignId} and customer_id in ${tx(fresh.map((r) => r.customer_id))} order by id`;
	}

	/**
	 * The filter the picker and "select all" share.
	 * @param shopId The shop.
	 * @param q Search over name and email.
	 * @returns The `where` fragment.
	 */
	#pickable(shopId: number, q: string) {
		const like = `%${q.toLowerCase()}%`;
		return sql`where c.shop_id = ${shopId} and coalesce(c.email, '') <> '' and (${q} = '' or lower(c.name) like ${like} or lower(c.email) like ${like})`;
	}
}
