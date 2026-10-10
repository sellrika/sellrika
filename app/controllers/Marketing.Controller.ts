import type { BunRequest } from "bun";
import { ctx } from "@xcore/http/Context";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { inertia, redirect } from "@xcore/view/Inertia";
import { Service } from "@xcore/di";
import { MarketingService } from "@services/sales/marketing/Marketing.Service";
import { CampaignService } from "@services/sales/marketing/Campaign.Service";
import { MailService } from "@services/settings/Mail.Service";
import { ProductRepository } from "@repositories/Product.Repository";
import {
	AbandonedInput,
	CampaignInput,
	ScheduleInput,
} from "@validators/Marketing.Validator";
import { validate, type Errors } from "@validators/validate";
import { dbDate, inZone } from "@helpers/time";
import type { Campaign } from "@models/Campaign";
import {
	ABANDONED_CART_DELAYS,
	CAMPAIGN_MAX_PRODUCTS,
	CAMPAIGN_MAX_RECIPIENTS,
} from "@constants/Marketing.Constant";

/**
 * The /marketing page of the active shop (admin only):
 * email campaigns and the abandoned-cart email.
 */
@Service()
export class MarketingController {
	constructor(
		private marketing: MarketingService,
		private campaigns: CampaignService,
		private mail: MailService,
		private products: ProductRepository,
	) {}

	/**
	 * GET /marketing?page= — the campaigns and the abandoned-cart settings.
	 * @param req The current request.
	 * @param errors Errors of the abandoned-cart form, when it failed.
	 * @returns The Marketing/Index page.
	 */
	async index(req: Request, errors?: Errors) {
		const { shop } = ctx(req);
		const { page, perPage } = Paginate.params(req, "campaigns");
		return inertia(req, "Marketing/Index", {
			campaigns: await this.campaigns.page(shop.id, page, perPage),
			abandoned: await this.marketing.settings(shop.id),
			delays: ABANDONED_CART_DELAYS,
			mail_ready: await this.mail.ready(shop.id),
			store_ready: shop.online_enabled && !!shop.slug,
			campaign_blocked: await this.campaigns.blocked(shop),
			...(errors && { errors }),
		});
	}

	/**
	 * PUT /marketing/abandoned — switch the abandoned-cart email and pick its delay.
	 * @param req The current request.
	 * @returns Back to /marketing, or the page with errors.
	 */
	async abandoned(req: Request) {
		const { shop } = ctx(req);
		const v = validate(AbandonedInput, await HttpRequest.body(req));
		if (v.errors) return this.index(req, v.errors);
		await this.marketing.saveSettings(shop.id, v.data);
		return redirect("/marketing");
	}

	/**
	 * JSON: GET /marketing/customers?q=&page= — one page of the recipient picker;
	 * with `&all=1`, the ids of every matching customer who may get email.
	 * @param req The current request.
	 * @returns The page, or `{ ids }`.
	 */
	async customers(req: Request) {
		const { shop } = ctx(req);
		const query = new Query(req);
		const q = query.text("q").slice(0, 100);
		if (query.raw("all") === "1")
			return json({ ids: await this.campaigns.pickAll(shop.id, q) });
		const page = Math.max(1, Math.floor(Number(query.raw("page"))) || 1);
		return json(await this.campaigns.pick(shop.id, q, page));
	}

	/**
	 * GET /marketing/campaigns/create — an empty campaign form.
	 * @param req The current request.
	 * @returns The Marketing/Campaign page.
	 */
	create(req: Request) {
		return this.#form(req, null);
	}

	/**
	 * GET /marketing/campaigns/:id — edit a draft or scheduled campaign;
	 * a sending or sent one is read-only with its recipients.
	 * @param req The current request.
	 * @returns The Marketing/Campaign page, or 404.
	 */
	async show(req: BunRequest<"/marketing/campaigns/:id">) {
		const { shop } = ctx(req);
		const c = await this.campaigns.find(HttpRequest.idOf(req), shop.id);
		if (!c) return HttpResponse.notFoundText();
		return this.#form(req, c);
	}

	/**
	 * POST /marketing/campaigns — save a new draft.
	 * @param req The current request.
	 * @returns To the saved campaign, or the form with errors.
	 */
	async store(req: Request) {
		const { shop, user } = ctx(req);
		const v = validate(CampaignInput, await HttpRequest.body(req));
		if (v.errors) return this.#form(req, null, v.errors);
		const c = await this.campaigns.create(shop.id, v.data, user.id);
		return redirect(`/marketing/campaigns/${c.id}`);
	}

	/**
	 * PUT /marketing/campaigns/:id — save changes to a draft or scheduled campaign.
	 * @param req The current request.
	 * @returns To the campaign, or the form with errors.
	 */
	async update(req: BunRequest<"/marketing/campaigns/:id">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		const v = validate(CampaignInput, await HttpRequest.body(req));
		const r = v.errors
			? { errors: v.errors }
			: await this.campaigns.update(id, shop.id, v.data);
		return this.#done(req, id, r.errors);
	}

	/**
	 * POST /marketing/campaigns/:id/schedule — "Send now" or "Schedule".
	 * @param req The current request.
	 * @returns To the campaign, or the form with errors.
	 */
	async schedule(req: BunRequest<"/marketing/campaigns/:id/schedule">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		const v = validate(ScheduleInput, await HttpRequest.body(req));
		const r = v.errors
			? { errors: v.errors }
			: await this.campaigns.schedule(shop, id, v.data);
		return this.#done(req, id, r.errors);
	}

	/**
	 * POST /marketing/campaigns/:id/cancel — "Cancel schedule", back to a draft.
	 * @param req The current request.
	 * @returns To the campaign, or the form with errors.
	 */
	async cancel(req: BunRequest<"/marketing/campaigns/:id/cancel">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		const r = await this.campaigns.cancel(id, shop.id);
		return this.#done(req, id, r.errors);
	}

	/**
	 * POST /marketing/campaigns/:id/test — "Send test to me".
	 * @param req The current request.
	 * @returns To the campaign, or the form with the reason it failed.
	 */
	async test(req: BunRequest<"/marketing/campaigns/:id/test">) {
		const { shop, user } = ctx(req);
		const id = HttpRequest.idOf(req);
		const c = await this.campaigns.find(id, shop.id);
		if (!c) return HttpResponse.notFoundText();
		const error = await this.campaigns.sendTest(shop, c, user.email);
		return this.#done(req, id, error ? { test: error } : undefined);
	}

	/**
	 * DELETE /marketing/campaigns/:id — delete a campaign that is not sending.
	 * @param req The current request.
	 * @returns To the list, or the form with errors.
	 */
	async destroy(req: BunRequest<"/marketing/campaigns/:id">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		if (await this.campaigns.remove(id, shop.id)) return redirect("/marketing");
		return this.#again(req, id, { subject: t("marketing.locked") });
	}

	/**
	 * Two digits.
	 * @param n A number.
	 * @returns For example "07".
	 */
	#pad(n: number) {
		return String(n).padStart(2, "0");
	}

	/**
	 * The answer after a change to a campaign.
	 * @param req The current request.
	 * @param id Campaign id.
	 * @param errors What was refused, if anything.
	 * @returns To the campaign, or the form with errors.
	 */
	#done(req: Request, id: number, errors?: Errors) {
		return errors ? this.#again(req, id, errors) : this.#to(id);
	}

	/**
	 * Back to a campaign's page.
	 * @param id Campaign id.
	 * @returns The 303 redirect.
	 */
	#to(id: number) {
		return redirect(`/marketing/campaigns/${id}`);
	}

	/**
	 * A campaign's page again, with errors.
	 * @param req The current request.
	 * @param id Campaign id.
	 * @param errors What went wrong.
	 * @returns The form, or 404.
	 */
	async #again(req: Request, id: number, errors: Errors) {
		const c = await this.campaigns.find(id, ctx(req).shop.id);
		if (!c) return HttpResponse.notFoundText();
		return this.#form(req, c, errors);
	}

	/**
	 * The campaign form (or read-only detail).
	 * @param req The current request.
	 * @param c The campaign, or null for a new one.
	 * @param errors Errors to show.
	 * @returns The Marketing/Campaign page.
	 */
	async #form(req: Request, c: Campaign | null, errors?: Errors) {
		const { shop } = ctx(req);
		const { page, perPage } = Paginate.params(req, "campaign_sends");
		const locked = !!c && (c.status === "sending" || c.status === "sent");
		const at = c?.send_at ? inZone(dbDate(c.send_at), shop.timezone) : null;
		return inertia(req, "Marketing/Campaign", {
			campaign: c,
			products: await this.products.names(shop.id),
			sends:
				c && locked ? await this.campaigns.sends(c.id, page, perPage) : null,
			send_at: at && {
				date: `${at.y}-${this.#pad(at.m)}-${this.#pad(at.d)}`,
				time: `${this.#pad(at.h)}:${this.#pad(at.mi)}`,
			},
			limits: {
				products: CAMPAIGN_MAX_PRODUCTS,
				recipients: CAMPAIGN_MAX_RECIPIENTS,
			},
			...(errors && { errors }),
		});
	}
}
