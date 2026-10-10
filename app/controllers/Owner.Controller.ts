import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { Url } from "@xcore/http/Url";
import { inertia, Inertia, redirect } from "@xcore/view/Inertia";
import { validate, type Errors } from "@validators/validate";
import { CampaignLimitInput } from "@validators/User.Validator";
import { OwnerService } from "@services/settings/Owner.Service";
import { SignupService } from "@services/settings/Signup.Service";

/**
 * The platform admin's shop owner pages (`/owners`).
 * They are inside the `platform` group.
 */
@Service()
export class OwnerController {
	constructor(
		private owners: OwnerService,
		private signup: SignupService,
	) {}

	/**
	 * GET /owners?q=&page= — every shop owner, with their counts.
	 * Also the self sign-up switch.
	 * @param req The current request.
	 * @returns The Owners/Index page.
	 */
	async index(req: Request) {
		const q = new Query(req).text("q");
		const { page, perPage } = Paginate.params(req, "owners");
		return inertia(req, "Owners/Index", {
			owners: await this.owners.list(q, page, perPage),
			filters: { q },
			signup: await this.signup.enabled(),
		});
	}

	/**
	 * GET /owners/:id — one owner, their shops, their staff
	 * and their campaign emails.
	 * @param req The current request.
	 * @param errors Validation errors to show, if any.
	 * @returns The Owners/Show page, or 404.
	 */
	async show(req: BunRequest<"/owners/:id">, errors?: Errors) {
		const data = await this.owners.show(HttpRequest.idOf(req));
		return data
			? inertia(req, "Owners/Show", { ...data, ...(errors && { errors }) })
			: Inertia.notFound(req);
	}

	/**
	 * PUT /owners/:id/campaign-limit {limit} — the owner's monthly
	 * campaign email limit (null = default).
	 * @param req The current request.
	 * @returns Back to the owner page.
	 *   The page with errors when the value is wrong.
	 *   404 for no such owner.
	 */
	async campaignLimit(req: BunRequest<"/owners/:id">) {
		const v = validate(CampaignLimitInput, await HttpRequest.body(req));
		if (v.errors) return this.show(req, v.errors);
		const ok = await this.owners.setCampaignLimit(
			HttpRequest.idOf(req),
			v.data.limit,
		);
		return ok ? redirect(`/owners/${req.params.id}`) : Inertia.notFound(req);
	}

	/**
	 * GET /owners/:id/shops/:shop?preset= — one shop: its info, totals and sales.
	 * @param req The current request.
	 * @returns The Owners/Shop page, or 404.
	 */
	async shop(req: BunRequest<"/owners/:id/shops/:shop">) {
		const data = await this.owners.shop(
			HttpRequest.idOf(req),
			Number(req.params.shop),
			new URL(req.url).searchParams,
		);
		// `store_link`, not `store_url`: a page prop named like
		// a shared prop would replace it in the layout
		return data
			? inertia(req, "Owners/Shop", {
					...data,
					store_link: Url.storeOrigin(data.shop),
				})
			: Inertia.notFound(req);
	}

	/**
	 * GET /owners/:id/shops/:shop/products?q=&page= — every product
	 * of one shop, read-only.
	 * @param req The current request.
	 * @returns The Owners/Products page, or 404.
	 */
	async products(req: BunRequest<"/owners/:id/shops/:shop/products">) {
		const q = new Query(req).text("q");
		const { page, perPage } = Paginate.params(req, "owner_products");
		const data = await this.owners.shopProducts(
			HttpRequest.idOf(req),
			Number(req.params.shop),
			q,
			page,
			perPage,
		);
		return data
			? inertia(req, "Owners/Products", { ...data, filters: { q } })
			: Inertia.notFound(req);
	}
}
