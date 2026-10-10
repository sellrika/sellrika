import { I18n, t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { DEFAULT_LOCALE } from "@i18n";
import type { Shop } from "@models/Shop";
import type { Campaign } from "@models/Campaign";
import type { Errors } from "@validators/validate";
import type {
	CampaignInput,
	ScheduleInput,
} from "@validators/Marketing.Validator";
import { CampaignRepository } from "@repositories/Campaign.Repository";
import {
	EmailQueueRepository,
	type QueuedEmail,
} from "@repositories/EmailQueue.Repository";
import { ProductRepository } from "@repositories/Product.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { MailService } from "@services/settings/Mail.Service";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { CampaignEmail, type CampaignProduct } from "@emails/Campaign.Email";
import { unsubscribeUrl } from "@emails/marketing";
import { sanitizeHtml } from "@helpers/html";
import { zonedToUtc } from "@helpers/time";
import { workers } from "@helpers/workers";
import {
	CAMPAIGN_MAX_RECIPIENTS,
	CAMPAIGN_PICKER_PER_PAGE,
} from "@constants/Marketing.Constant";
import { MARKETING_SHOP_BUDGET_MS } from "@constants/Marketing.Constant";
import { EMAIL_WORKERS } from "@constants/Mail.Constant";

/**
 * Email campaigns: the owner writes one, picks customers, and schedules it.
 * The marketing sweep sends the due ones. Each recipient is booked in
 * `campaign_sends` before the email goes out, so nobody gets it twice.
 */
@Service()
export class CampaignService {
	constructor(
		private campaigns: CampaignRepository,
		private products: ProductRepository,
		private shops: ShopRepository,
		private mail: MailService,
		private limits: PlanLimitService,
		private queue: EmailQueueRepository,
	) {}

	/**
	 * One page of the shop's campaigns.
	 * @param shopId The shop.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of campaigns.
	 */
	page(shopId: number, page: number, perPage: number) {
		return this.campaigns.page(shopId, page, perPage);
	}

	/**
	 * One campaign of the shop.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @returns The campaign, or null.
	 */
	find(id: number, shopId: number) {
		return this.campaigns.find(id, shopId);
	}

	/**
	 * Who a campaign went to, one page at a time.
	 * @param id Campaign id (already checked to be the shop's).
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of recipient rows.
	 */
	sends(id: number, page: number, perPage: number) {
		return this.campaigns.sends(id, page, perPage);
	}

	/**
	 * The recipient picker: one page of customers with an email.
	 * @param shopId The shop.
	 * @param q Search over name and email.
	 * @param page 1-based page number.
	 * @returns The page, with each one's unsubscribe flag.
	 */
	pick(shopId: number, q: string, page: number) {
		return this.campaigns.customers(shopId, q, page, CAMPAIGN_PICKER_PER_PAGE);
	}

	/**
	 * "Select all matching": every matching customer who may get email.
	 * @param shopId The shop.
	 * @param q The picker's search.
	 * @returns Their ids, at most `CAMPAIGN_MAX_RECIPIENTS`.
	 */
	pickAll(shopId: number, q: string) {
		return this.campaigns.customerIds(shopId, q, CAMPAIGN_MAX_RECIPIENTS);
	}

	/**
	 * Save a new draft. The text is sanitised first.
	 * @param shopId The shop.
	 * @param d The form.
	 * @param userId Who wrote it.
	 * @returns The new campaign.
	 */
	async create(shopId: number, d: CampaignInput, userId: number) {
		return this.campaigns.create(
			shopId,
			{ ...d, body: await sanitizeHtml(d.body) },
			userId,
		);
	}

	/**
	 * Change a draft or a scheduled campaign.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @param d The form.
	 * @returns `{errors}` when it is sending or sent, else `{}`.
	 */
	async update(
		id: number,
		shopId: number,
		d: CampaignInput,
	): Promise<{ errors?: Errors }> {
		const ok = await this.campaigns.update(id, shopId, {
			...d,
			body: await sanitizeHtml(d.body),
		});
		return ok ? {} : { errors: { subject: t("marketing.locked") } };
	}

	/**
	 * May this shop send campaigns at all?
	 * The page asks, so it can say so before a campaign is written.
	 * @param shop The shop.
	 * @returns Why not, or null when it may.
	 */
	blocked(shop: Shop): Promise<string | null> {
		return this.limits.campaignError(shop);
	}

	/**
	 * "Send now" or "Schedule": the sweep sends it when the time comes.
	 * @param shop The shop.
	 * @param id Campaign id.
	 * @param d Now, or a date and time on the shop's clock.
	 * @param now The current time.
	 * @returns `{errors}` when it can't go out, else `{}`.
	 */
	async schedule(
		shop: Shop,
		id: number,
		d: ScheduleInput,
		now = new Date(),
	): Promise<{ errors?: Errors }> {
		const c = await this.campaigns.find(id, shop.id);
		if (!c) return { errors: { date: t("server.not_found") } };
		const refused = await this.limits.campaignError(shop);
		if (refused) return { errors: { date: refused } };
		if (!shop.online_enabled || !shop.slug)
			return { errors: { date: t("marketing.needs_store") } };
		if (!c.customer_ids.length)
			return { errors: { date: t("marketing.no_recipients") } };
		if (!(await this.mail.ready(shop.id)))
			return { errors: { date: t("server.mail_not_set_up") } };
		if (!(await this.limits.campaignEmailsLeft(shop, now)))
			return { errors: { date: t("marketing.limit_reached") } };
		// one campaign at a time per account; a scheduled one just waits in the sweep
		if (d.now && (await this.campaigns.sending(shop.owner_id)))
			return { errors: { date: t("marketing.busy") } };
		let at = now;
		if (!d.now) {
			const [y, m, day] = d.date.split("-").map(Number) as [
				number,
				number,
				number,
			];
			const [h, mi] = d.time.split(":").map(Number) as [number, number];
			at = zonedToUtc(shop.timezone, y, m, day, h, mi);
			if (at <= now) return { errors: { date: t("marketing.in_the_past") } };
		}
		const ok = await this.campaigns.schedule(id, shop.id, at);
		return ok ? {} : { errors: { date: t("marketing.locked") } };
	}

	/**
	 * "Cancel schedule": back to a draft.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @returns `{errors}` when it is already sending or sent, else `{}`.
	 */
	async cancel(id: number, shopId: number): Promise<{ errors?: Errors }> {
		const ok = await this.campaigns.schedule(id, shopId, null);
		return ok ? {} : { errors: { date: t("marketing.locked") } };
	}

	/**
	 * Delete a campaign, never while it is sending.
	 * @param id Campaign id.
	 * @param shopId The shop.
	 * @returns False when nothing was deleted.
	 */
	remove(id: number, shopId: number) {
		return this.campaigns.remove(id, shopId);
	}

	/**
	 * "Send test to me": the campaign as a customer would get it.
	 * @param shop The shop.
	 * @param c The campaign.
	 * @param to The signed-in user's email.
	 * @returns Null when it went out, else the reason.
	 */
	async sendTest(shop: Shop, c: Campaign, to: string) {
		if (!shop.slug) return t("marketing.needs_store");
		const parts = await CampaignEmail.parts(
			shop,
			c,
			await this.#cards(shop, c),
		);
		return this.mail.send(
			new CampaignEmail(to, shop, parts, unsubscribeUrl(shop, to)),
		);
	}

	/**
	 * The sweep: send every due campaign, and finish any a crash cut off.
	 * A shop whose email is off (no own setup, platform off) is skipped.
	 * Its campaigns wait.
	 * So does a campaign while another one of the same account is sending.
	 * @param now The current time.
	 * @returns How many emails went out.
	 */
	async sweep(now = new Date()) {
		let sent = 0;
		for (const c of await this.campaigns.due(now)) {
			// its email is off: the campaign waits
			if (!(await this.mail.ready(c.shop_id))) continue;
			const shop = await this.shops.find(c.shop_id);
			if (!shop) continue;
			// the shop may send none right now: a scheduled one waits
			if (c.status === "scheduled" && (await this.limits.campaignError(shop)))
				continue;
			if (c.status === "scheduled" && !(await this.campaigns.claim(c.id)))
				continue;
			const { sent: n, done } = await I18n.withLocale(
				CampaignService.shopLocale(shop),
				() => this.#deliver(shop, c, now),
			);
			sent += n;
			// out of time: the campaign stays "sending", the next run goes on
			if (!done) continue;
			await this.campaigns.finish(c.id);
			await this.queue.clear("campaign", c.id);
			console.log(
				`[campaign] #${c.id} (${shop.name}): ${n} email(s) sent, now finished`,
			);
		}
		return sent;
	}

	/**
	 * The language a shop's marketing emails are written in.
	 * @param shop The shop.
	 * @returns Its first language, else the app's default.
	 */
	static shopLocale(shop: Shop) {
		return shop.languages?.[0] ?? DEFAULT_LOCALE;
	}

	/**
	 * Send one campaign to every recipient not booked yet.
	 * The recipients go into `email_queue` first, so a restart loses none.
	 * Then `EMAIL_WORKERS` workers empty the queue.
	 * Each takes the next waiting email when it is free.
	 * Past the account's monthly limit the rest are marked "Monthly limit reached".
	 * @param shop The shop.
	 * @param c The campaign.
	 * @param now The current time.
	 * @returns How many emails went out, and whether the queue is empty
	 *   (false = it ran out of time, the rest waits for the next run).
	 */
	async #deliver(shop: Shop, c: Campaign, now: Date) {
		// the pictures are read and shrunk once, every recipient's email shares them
		const parts = await CampaignEmail.parts(
			shop,
			c,
			await this.#cards(shop, c),
		);
		let sent = 0;
		let left = await this.limits.campaignEmailsLeft(shop, now);
		const platform = left !== Infinity; // no own Shop Email: these count
		const recipients = await this.campaigns.recipients(shop.id, c.customer_ids);
		await this.campaigns.enqueue(
			c.id,
			recipients,
			platform,
			t("marketing.unsubscribed"),
		);
		const { campaigns, mail, queue } = this;
		// read once: every email of this run goes through the same setup
		const setup = await mail.setupFor(shop.id);
		// A mail server may be slow or silent.
		// One campaign gets only so much time per run, so it can not hold
		// every other shop's emails. The rest goes out in the next runs.
		const until = Date.now() + MARKETING_SHOP_BUDGET_MS;
		let done = true;
		/**
		 * The next waiting email of this campaign.
		 * @returns It, or null when the queue is empty.
		 */
		function next() {
			if (Date.now() > until) {
				done = false;
				return Promise.resolve(null);
			}
			return queue.take("campaign", c.id, now);
		}
		/**
		 * Send one queued email, record how it went, and take it off the queue.
		 * @param job The queued email.
		 */
		async function one(job: QueuedEmail) {
			if (left <= 0) {
				await campaigns.settle(job.ref_id, t("marketing.limit_hit"), now);
				await queue.done(job.id);
				return;
			}
			// taken before the send,
			// so workers side by side never pass the limit
			left--;
			const to = job.to_email;
			const error = await mail.send(
				new CampaignEmail(to, shop, parts, unsubscribeUrl(shop, to)),
				setup,
			);
			await campaigns.settle(job.ref_id, error, now);
			await queue.done(job.id);
			if (error) {
				left++;
				console.warn(`[campaign] #${c.id} to ${to}: ${error}`);
			} else sent++;
		}
		await workers(EMAIL_WORKERS, next, one);
		return { sent, done };
	}

	/**
	 * The product cards: the picked products that still exist and are on sale.
	 * @param shop The shop.
	 * @param c The campaign.
	 * @returns The cards, in the picked order.
	 */
	async #cards(shop: Shop, c: Campaign): Promise<CampaignProduct[]> {
		const cards: CampaignProduct[] = [];
		for (const id of c.product_ids) {
			const p = await this.products.find(id, shop.id);
			if (p?.active)
				cards.push({
					name: p.name,
					price: p.price,
					slug: p.slug,
					image: p.images[0] ?? null,
				});
		}
		return cards;
	}
}
