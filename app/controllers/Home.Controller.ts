import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { Context } from "@xcore/http/Context";
import { Hooks } from "@xcore/hooks/Hooks";
import { Url } from "@xcore/http/Url";
import { Inertia } from "@xcore/view/Inertia";
import { ShopRepository } from "@repositories/Shop.Repository";
import { StoreController } from "@controllers/Store.Controller";
import { StorefrontSupport } from "@controllers/support/Storefront.Support";

/**
 * The page at `/`.
 * On a store's host it is the store.
 * On the app's own host it is the way in.
 */
@Service()
export class HomeController {
	constructor(
		private site: StorefrontSupport,
		private shops: ShopRepository,
		private store: StoreController,
	) {}

	/**
	 * GET / — a store's host shows its store.
	 * The main host has no page of its own in the source-available app:
	 * a signed-in user goes to the POS, everyone else to the sign-in.
	 * An add-on may put a front page there (`Hooks.frontPage`).
	 * @param req The current request.
	 * @returns The storefront, the add-on's front page, or a redirect.
	 */
	async home(req: BunRequest<"/">) {
		// a store's host serves its store at "/"
		const host = Url.hostOf(req);
		const shop = await this.shops.findByHost(host);
		const own = await this.site.forShop(req, shop);
		if (own) return this.store.catalog(req, own);
		// a store's host whose store is off, or a subdomain nobody has,
		// never shows the app's own page
		if (shop || Url.slugOfHost(host)) return Inertia.notFound(req);
		if (Hooks.frontPage) return Hooks.frontPage(req);
		return new Response(null, {
			status: 302,
			headers: { Location: Context.get(req) ? "/pos" : "/login" },
		});
	}
}
