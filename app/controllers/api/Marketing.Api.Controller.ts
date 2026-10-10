import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { MarketingService } from "@services/sales/marketing/Marketing.Service";
import { CampaignService } from "@services/sales/marketing/Campaign.Service";
import {
	AbandonedInput,
	CampaignInput,
	ScheduleInput,
} from "@validators/Marketing.Validator";
import { PageQuery } from "@validators/ApiQuery.Validator";
import { ApiController } from "./Api.Controller";

/**
 * API: the email campaigns and the abandoned-cart email of the key's shop.
 */
@Service()
export class MarketingApiController extends ApiController<object> {
	constructor(
		private marketing: MarketingService,
		private campaigns: CampaignService,
	) {
		super();
	}

	/**
	 * GET /marketing/abandoned-cart — the abandoned-cart email:
	 * on or off, and its delay.
	 * @param req The current request.
	 * @returns `{ enabled, hours }`.
	 */
	async abandoned(req: Request) {
		return json(await this.marketing.settings(ctx(req).shop.id));
	}

	/**
	 * PUT /marketing/abandoned-cart — switch the abandoned-cart email and pick
	 * its delay.
	 * @param req The current request.
	 * @returns `{ enabled, hours }`, or 422.
	 */
	async saveAbandoned(req: Request) {
		const { shop } = ctx(req);
		const data = await this.input(req, AbandonedInput);
		if (data instanceof Response) return data;
		await this.marketing.saveSettings(shop.id, data);
		return json(await this.marketing.settings(shop.id));
	}

	/**
	 * GET /marketing/campaigns?page=&per_page= — one page of campaigns, newest
	 * first.
	 * @param req The current request.
	 * @returns A page of campaigns.
	 */
	async index(req: Request) {
		const v = ApiResponse.query(req, PageQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		return json(
			await this.campaigns.page(ctx(req).shop.id, v.data.page, v.data.per_page),
		);
	}

	/**
	 * GET /marketing/campaigns/:id — one campaign.
	 * @param req The current request.
	 * @returns The campaign, or 404.
	 */
	async show(req: BunRequest) {
		const c = await this.campaigns.find(
			HttpRequest.idOf(req),
			ctx(req).shop.id,
		);
		return c ? json(c) : ApiResponse.notFound();
	}

	/**
	 * POST /marketing/campaigns — save a new draft. Nothing is sent.
	 * @param req The current request.
	 * @returns 201 with the campaign, or 422.
	 */
	async store(req: Request) {
		const { shop, user } = ctx(req);
		const data = await this.input(req, CampaignInput);
		if (data instanceof Response) return data;
		return ApiResponse.created(
			await this.campaigns.create(shop.id, data, user.id),
		);
	}

	/**
	 * PUT /marketing/campaigns/:id — change a draft or a scheduled campaign.
	 * @param req The current request.
	 * @returns The campaign, 404, or 422 once it is sending or sent.
	 */
	async update(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, CampaignInput);
		if (data instanceof Response) return data;
		const r = await this.campaigns.update(id, shop.id, data);
		return this.#after(r.errors, id, shop.id);
	}

	/**
	 * POST /marketing/campaigns/:id/schedule — send at a date and time on the
	 * shop's clock, or now.
	 * `now: true` sends real email at once, so only an admin key may ask for it.
	 * @param req The current request.
	 * @returns The campaign, 403, 404 or 422.
	 */
	async schedule(req: BunRequest) {
		const { shop, user } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, ScheduleInput);
		if (data instanceof Response) return data;
		if (data.now && user.role !== "admin")
			return ApiResponse.error(
				"forbidden",
				t("api.forbidden", { role: "admin" }),
			);
		const r = await this.campaigns.schedule(shop, id, data);
		return this.#after(r.errors, id, shop.id);
	}

	/**
	 * POST /marketing/campaigns/:id/cancel — cancel the schedule: back to a draft.
	 * @param req The current request.
	 * @returns The campaign, 404, or 422 once it is sending or sent.
	 */
	async cancel(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const r = await this.campaigns.cancel(id, shop.id);
		return this.#after(r.errors, id, shop.id);
	}

	/**
	 * DELETE /marketing/campaigns/:id — delete a campaign, never while it is
	 * sending.
	 * @param req The current request.
	 * @returns `{ deleted, id }`, 404 or 422.
	 */
	async destroy(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		if (await this.campaigns.remove(id, shop.id))
			return ApiResponse.deleted(id);
		return ApiResponse.invalid({ campaign: t("marketing.locked") });
	}

	/**
	 * One campaign of a shop.
	 * @param id The record's id.
	 * @param shopId The key's shop.
	 * @returns The campaign, or nothing when the shop has none with this id.
	 */
	protected find(id: number, shopId: number) {
		return this.campaigns.find(id, shopId);
	}

	/**
	 * The answer after a change to a campaign:
	 * the errors, or the campaign as it is now.
	 * @param errors What the service refused, if anything.
	 * @param id Campaign id.
	 * @param shopId Owning shop.
	 * @returns 422, or the campaign.
	 */
	async #after(
		errors: Record<string, string> | undefined,
		id: number,
		shopId: number,
	) {
		if (errors) return ApiResponse.invalid(errors);
		return json(await this.campaigns.find(id, shopId));
	}
}
