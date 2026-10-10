import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { HttpRequest, Query } from "@xcore/http/Request";
import { back, inertia, Inertia, redirect } from "@xcore/view/Inertia";
import { StoreService } from "@services/sales/Store.Service";
import { DomainService } from "@services/sales/Domain.Service";
import { StorePageRepository } from "@repositories/StorePage.Repository";
import { GatewayRegistry } from "@gateways/Gateway.Registry";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import {
	OnlineStoreInput,
	StoreCurrenciesInput,
	StoreDeliveryInput,
	StoreLanguagesInput,
	StoreThemeInput,
	StorePageInput,
} from "@validators/Store.Validator";
import {
	STORE_FONTS,
	STORE_TEMPLATE_INFO,
	STORE_TEMPLATES,
	type StoreTemplate,
} from "@constants/Store.Constant";
import { validate, type Errors } from "@validators/validate";

/**
 * What changes between two renders of the settings page.
 * A key that is left out is not sent at all.
 */
type SettingsExtra = { section?: string | null; errors?: Errors };

/**
 * The online store's settings (`/online-store`, admin):
 * the sections of the settings rail and the custom pages.
 */
@Service()
export class StoreSettingsController {
	constructor(
		private store: StoreService,
		private pages: StorePageRepository,
		private gateways: GatewayRegistry,
		private extensions: ExtensionService,
		private domains: DomainService,
	) {}

	/**
	 * GET /online-store?section= — the storefront settings rail.
	 * `?section=` picks the active tab.
	 * A #hash can land after mount, so the query string is used.
	 * @param req The current request.
	 * @returns The OnlineStore/Index page.
	 */
	async settings(req: Request) {
		const { shop } = ctx(req);
		const section = new Query(req).raw("section");
		return this.#settingsPage(req, shop.id, { section });
	}

	/**
	 * PUT /online-store — save the storefront and payment settings.
	 * @param req The current request.
	 * @returns Back to the settings page, or the page with errors.
	 */
	async update(req: Request) {
		const { shop } = ctx(req);
		const v = validate(OnlineStoreInput, await HttpRequest.body(req));
		const errors =
			v.errors ?? (await this.store.updateSettings(shop.id, v.data!)).errors;
		if (!errors) return back(req, "/online-store");
		return this.#settingsPage(req, shop.id, { errors });
	}

	/**
	 * POST /online-store/domain/check — look at the custom domain's DNS.
	 * It is checked now, not at the next 5-minute check.
	 * @param req The current request.
	 * @returns Back to the settings page, which shows the new status.
	 */
	async checkDomain(req: Request) {
		await this.domains.run();
		return back(req, "/online-store");
	}

	/**
	 * PUT /online-store/delivery — save the Delivery section.
	 * That is where the shop is, the prices, the free-delivery
	 * threshold, the per-city rates and pick-up in store.
	 * It is its own form, apart from the other settings.
	 * @param req The current request.
	 * @returns Back to the Delivery section, or the page with errors.
	 */
	async delivery(req: Request) {
		const { shop } = ctx(req);
		const v = validate(StoreDeliveryInput, await HttpRequest.body(req));
		if (v.errors)
			return this.#settingsPage(req, shop.id, {
				section: "delivery",
				errors: v.errors,
			});
		await this.store.updateDelivery(shop.id, v.data);
		return back(req, "/online-store?section=delivery");
	}

	/**
	 * PUT /online-store/languages — save the Languages section.
	 * These are the languages the store offers, the default first.
	 * @param req The current request.
	 * @returns Back to the Languages section, or the page with errors.
	 */
	async languages(req: Request) {
		const { shop } = ctx(req);
		const v = validate(StoreLanguagesInput, await HttpRequest.body(req));
		if (v.errors)
			return this.#settingsPage(req, shop.id, {
				section: "languages",
				errors: v.errors,
			});
		await this.store.updateLanguages(shop.id, v.data);
		return back(req, "/online-store?section=languages");
	}

	/**
	 * PUT /online-store/theme — save one built-in theme's own look.
	 * The primary colour, the secondary colour and the font.
	 * @param req The current request.
	 * @returns Back to the Template section, or the page with errors.
	 */
	async theme(req: Request) {
		const { shop } = ctx(req);
		const v = validate(StoreThemeInput, await HttpRequest.body(req));
		if (v.errors)
			return this.#settingsPage(req, shop.id, {
				section: "template",
				errors: v.errors,
			});
		await this.store.updateTheme(shop.id, v.data);
		return back(req, "/online-store?section=template");
	}

	/**
	 * PUT /online-store/currencies — save the Currencies section.
	 * These are the extra currencies the store shows prices in.
	 * Each has a manual rate or the automatic one.
	 * @param req The current request.
	 * @returns Back to the Currencies section, or the page with errors.
	 */
	async currencies(req: Request) {
		const { shop } = ctx(req);
		const v = validate(StoreCurrenciesInput, await HttpRequest.body(req));
		if (v.errors)
			return this.#settingsPage(req, shop.id, {
				section: "currencies",
				errors: v.errors,
			});
		await this.store.updateCurrencies(shop, v.data);
		return back(req, "/online-store?section=currencies");
	}

	/**
	 * GET /online-store/pages/create — the page builder, empty.
	 * @param req The current request.
	 * @returns The OnlineStore/PageEditor page.
	 */
	createPage(req: Request) {
		return inertia(req, "OnlineStore/PageEditor", { page: null });
	}

	/**
	 * GET /online-store/pages/:id/edit — the page builder
	 * with a stored page loaded.
	 * @param req The current request.
	 * @returns The OnlineStore/PageEditor page, or the not-found page.
	 */
	async editPage(req: BunRequest<"/online-store/pages/:id/edit">) {
		const { shop } = ctx(req);
		const page = await this.pages.find(HttpRequest.idOf(req), shop.id);
		if (!page) return Inertia.notFound(req);
		return inertia(req, "OnlineStore/PageEditor", { page });
	}

	/**
	 * POST /online-store/pages — save a new page from the builder.
	 * @param req The current request.
	 * @returns A redirect to the page list, or the editor with errors.
	 */
	storePage(req: BunRequest<"/online-store/pages">) {
		return this.#savePage(req, null);
	}

	/**
	 * PUT /online-store/pages/:id — save an existing page
	 * from the builder.
	 * @param req The current request.
	 * @returns A redirect to the page list, or the editor with errors.
	 */
	updatePage(req: BunRequest<"/online-store/pages/:id">) {
		return this.#savePage(req, HttpRequest.idOf(req));
	}

	/**
	 * DELETE /online-store/pages/:id — delete a custom page.
	 * @param req The current request.
	 * @returns Back to the settings page.
	 */
	async destroyPage(req: BunRequest<"/online-store/pages/:id">) {
		const { shop } = ctx(req);
		await this.pages.delete(HttpRequest.idOf(req), shop.id);
		return back(req, "/online-store");
	}

	/**
	 * One built-in theme as the /online-store picker lists it.
	 * `description` is a dictionary key. The page translates it.
	 * @param key The theme's key.
	 * @returns `{ key, label, description, colors }`.
	 */
	#templateChoice(key: StoreTemplate) {
		return {
			key,
			label: STORE_TEMPLATE_INFO[key].label,
			description: STORE_TEMPLATE_INFO[key].description,
			colors: STORE_TEMPLATE_INFO[key].colors,
		};
	}

	/**
	 * The built-in themes as the /online-store picker lists them.
	 * @returns One `{ key, label, description, colors }` per theme.
	 */
	#templates() {
		return STORE_TEMPLATES.map((key) => this.#templateChoice(key));
	}

	/**
	 * The fonts a shop may pick for a built-in theme.
	 * @returns One `{ key, label }` per font.
	 */
	#fonts() {
		return Object.entries(STORE_FONTS).map(([key, font]) => ({
			key,
			label: font.label,
		}));
	}

	/**
	 * One custom page as the settings list shows it.
	 * The body and CSS are left out: the editor loads those itself.
	 * @param page The stored page.
	 * @returns `{ id, slug, title }`.
	 */
	#pageRow(page: { id: number; slug: string; title: string }) {
		return { id: page.id, slug: page.slug, title: page.title };
	}

	/**
	 * The payment gateway extensions the shop can use.
	 * They are switched on and set up in the Payments section.
	 * @param shopId Active shop.
	 * @returns One /extensions row per gateway.
	 */
	async #paymentExtensions(shopId: number) {
		const all = await this.extensions.list(shopId);
		return all.filter((e) => e.payment);
	}

	/**
	 * Page list for the settings UI.
	 * @param shopId Active shop.
	 * @returns One `{ id, slug, title }` per custom page.
	 */
	async #adminPages(shopId: number) {
		return (await this.pages.all(shopId)).map((page) => this.#pageRow(page));
	}

	/**
	 * The settings page.
	 * @param req The current request.
	 * @param shopId Active shop.
	 * @param extra The active section and the errors, when there are any.
	 * @returns The OnlineStore/Index page.
	 */
	async #settingsPage(req: Request, shopId: number, extra: SettingsExtra) {
		return inertia(req, "OnlineStore/Index", {
			settings: await this.store.settings(shopId),
			templates: this.#templates(),
			fonts: this.#fonts(),
			themes: await this.extensions.themes(shopId),
			gateways: this.gateways.meta(),
			payments: await this.#paymentExtensions(shopId),
			pages: await this.#adminPages(shopId),
			...extra,
		});
	}

	/**
	 * Shared body of `storePage` / `updatePage`.
	 * @param req The current request.
	 * @param id The page being overwritten, or null to create one.
	 * @returns A redirect to the page list, or the editor with errors.
	 */
	async #savePage(req: BunRequest, id: number | null) {
		const { shop } = ctx(req);
		const v = validate(StorePageInput, await HttpRequest.body(req));
		const errors =
			v.errors ?? (await this.store.savePage(shop.id, id, v.data!)).errors;
		if (!errors) return redirect("/online-store?section=pages");
		return inertia(req, "OnlineStore/PageEditor", {
			page: id ? await this.pages.find(id, shop.id) : null,
			errors,
		});
	}
}
