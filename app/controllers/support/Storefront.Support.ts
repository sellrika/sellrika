import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { Auth } from "@xcore/auth/Auth";
import { json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { I18n, t } from "@xcore/i18n/I18n";
import { Inertia, redirect } from "@xcore/view/Inertia";
import { stripTags } from "@helpers/html";
import { ShopRepository } from "@repositories/Shop.Repository";
import { StoreService } from "@services/sales/Store.Service";
import { ExchangeRateService } from "@services/settings/ExchangeRate.Service";
import { CURRENCY_COOKIE } from "@constants/Currency.Constant";
import {
	StoreViewService,
	type Storefront,
} from "@services/sales/StoreView.Service";
import type { Customer } from "@models/Customer";
import type { Shop } from "@models/Shop";

/**
 * A storefront whose visitor is signed in.
 */
export type CustomerStorefront = Storefront & { customer: Customer };

/**
 * What the public store's controllers share:
 * finding the shop of a request, the guards in front of a page,
 * and the head of a personal page.
 */
@Service()
export class StorefrontSupport {
	constructor(
		private shops: ShopRepository,
		private exchange: ExchangeRateService,
		private view: StoreViewService,
		private store: StoreService,
	) {}

	/**
	 * Make a text safe to print inside HTML or XML.
	 * @param s The text.
	 * @returns The text with `&`, `<`, `>` and `"` escaped.
	 */
	static esc(s: string) {
		return s
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	/**
	 * Rich text as one plain line.
	 * This is what a search result shows.
	 * @param html The rich text.
	 * @returns The plain text, at most 160 characters.
	 */
	static summary(html: string) {
		const text = stripTags(html).replace(/\s+/g, " ").trim();
		return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
	}

	/**
	 * The shop a public request belongs to, from its Host.
	 * The shop's own domain comes first, else `<slug>.<STORE_DOMAIN>`.
	 * It also sets the request's language to one the shop offers.
	 * @param req The current request.
	 * @returns The shop, its link prefix (`base`, always ""), its
	 *   absolute `url` and the signed-in `customer` (null for a guest).
	 *   Null when no shop claims this address or its store is off.
	 */
	async find(req: BunRequest): Promise<Storefront | null> {
		return this.forShop(req, await this.shops.findByHost(Url.hostOf(req)));
	}

	/**
	 * Is the request on the host of a shop whose store is on?
	 * The cheap question: one query, no theme, no customer.
	 * @param req The current request.
	 * @returns True when `find` would give a storefront.
	 */
	async isStore(req: BunRequest): Promise<boolean> {
		return !!(await this.shops.findByHost(Url.hostOf(req)))?.online_enabled;
	}

	/**
	 * The storefront of a request whose shop is already loaded.
	 * It also sets the request's language to one the shop offers.
	 * @param req The current request.
	 * @param shop The shop that answers on the request's host, or null.
	 * @returns The storefront. Null when there is no shop or its store is off.
	 */
	async forShop(
		req: BunRequest,
		shop: Shop | null,
	): Promise<Storefront | null> {
		if (!shop?.online_enabled) return null;
		// the store speaks only the shop's languages
		I18n.narrow(I18n.localeOf(req, shop.languages));
		// ponytail: every store is at the root of its own host now,
		// so `base` is always ""; every theme still prefixes its links
		const base = "";
		// the visitor's pick shows the prices in another currency
		// one the shop no longer offers is ignored
		const currencies = await this.exchange.forShop(shop);
		const picked = req.cookies?.get(CURRENCY_COOKIE);
		const display =
			currencies.find((c) => c.code === picked && c.code !== shop.currency) ??
			null;
		// the hostname was just matched against a shop,
		// so the request's own origin is vouched for
		return {
			currencies,
			display,
			shop,
			base,
			url: Url.requestOrigin(req),
			customer: shop.customer_logins.length
				? await Auth.currentCustomer(req, shop.id)
				: null,
			theme: await this.view.theme(shop),
		};
	}

	/**
	 * The storefront of a page request.
	 * @param req The current request.
	 * @returns The storefront, or the app's not-found page (404).
	 */
	async open(req: BunRequest): Promise<Storefront | Response> {
		return (await this.find(req)) ?? Inertia.notFound(req);
	}

	/**
	 * The storefront of a JSON request.
	 * @param req The current request.
	 * @param field The error field the page's script reads.
	 * @returns The storefront, or 404 `{ errors: { [field] } }`.
	 */
	async openJson(
		req: BunRequest,
		field: string,
	): Promise<Storefront | Response> {
		const s = await this.find(req);
		if (s) return s;
		const errors = { [field]: t("store_server.store_unavailable") };
		return json({ errors }, 404);
	}

	/**
	 * The storefront of a request only a signed-in customer may make.
	 * @param req The current request.
	 * @returns The storefront with its customer, the app's not-found
	 *   page (404), or a redirect to the account page for a guest.
	 */
	async openCustomer(req: BunRequest): Promise<CustomerStorefront | Response> {
		const s = await this.find(req);
		if (!s) return Inertia.notFound(req);
		if (!s.customer) return redirect(`${s.base}/account`);
		return s as CustomerStorefront;
	}

	/**
	 * The shop's own states.
	 * With them the guided address shows its lists on the first paint.
	 * @param s The resolved storefront.
	 * @returns The states, or [] when the shop wants plain text boxes.
	 */
	async states(s: Storefront) {
		return s.shop.guided_address
			? (await this.store.address(s.shop.country ?? "", "")).states
			: [];
	}

	/**
	 * The head of a personal page.
	 * Such a page is kept out of search indexes (`noindex`).
	 * @param s The resolved storefront.
	 * @param path The page's path below the store, "" for its home.
	 * @param title The page's title.
	 * @param desc The page's description.
	 * @returns The head data.
	 */
	privateSeo(s: Storefront, path: string, title: string, desc: string) {
		return StoreViewService.storeSeo(s.shop, {
			url: `${s.url}${path}`,
			title,
			desc,
			noindex: true,
		});
	}
}
