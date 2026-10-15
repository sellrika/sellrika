import { Hooks } from "@xcore/hooks/Hooks";
import { Url } from "@xcore/http/Url";
import { Auth } from "@xcore/auth/Auth";
import { ctx } from "@xcore/http/Context";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { I18n, t } from "@xcore/i18n/I18n";
import { back, inertia, Inertia } from "@xcore/view/Inertia";
import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ShopRepository } from "@repositories/Shop.Repository";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import type { Shop } from "@models/Shop";
import { StoreService } from "@services/sales/Store.Service";
import {
	ExtensionInput,
	GlobalExtensionInput,
	GlobalExtensionUsersInput,
} from "@validators/Extension.Validator";
import { validate, type Errors } from "@validators/validate";
import { ExtensionHandles } from "@controllers/support/Extension.Handles";
import type { User } from "@models/User";
import { StorefrontSupport } from "@controllers/support/Storefront.Support";
import {
	StoreViewService,
	type Storefront,
} from "@services/sales/StoreView.Service";
import { Storage } from "@xcore/storage/Storage";
import { sanitizeHtml } from "@helpers/html";
import {
	EXTENSION_STORE_DESC_MAX,
	EXTENSION_STORE_LINK_TITLE_MAX,
	EXTENSION_STORE_TITLE_MAX,
} from "@constants/Extension.Constant";

/**
 * Admin › Global Extensions.
 * Its forms go back to this page.
 */
const GLOBAL_EXTENSIONS = "/admin/extensions";

/**
 * The extension pages and mounts.
 * `/admin/extensions` = the platform's extensions (platform admin).
 * `/extensions` = the active shop's extensions (admin).
 * It also holds the mounts an extension's own routes, pages
 * and files answer on.
 */
@Service()
export class ExtensionController {
	constructor(
		private extensions: ExtensionService,
		private shops: ShopRepository,
		private store: StoreService,
		private handles: ExtensionHandles,
		private site: StorefrontSupport,
		private view: StoreViewService,
	) {}

	/**
	 * GET /extensions — every extension with the shop's state on it.
	 * @param req The current request.
	 * @returns The Extensions/Index page.
	 */
	index(req: Request) {
		return this.#page(req, ctx(req).shop.id);
	}

	/**
	 * PUT /extensions/:key — install, configure or switch one extension.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async update(req: BunRequest<"/extensions/:key">) {
		const { shop } = ctx(req);
		const v = validate(ExtensionInput, await HttpRequest.body(req));
		if (v.errors) return this.#page(req, shop.id, v.errors);
		const r = await this.extensions.save(shop.id, req.params.key, v.data);
		return r.errors
			? this.#page(req, shop.id, r.errors)
			: back(req, "/extensions");
	}

	/**
	 * GET /admin/extensions — every extension of the platform
	 * with its global switch (platform admin).
	 * @param req The current request.
	 * @returns The Extensions/Global page.
	 */
	globalIndex(req: Request) {
		return this.#globalPage(req);
	}

	/**
	 * POST /admin/extensions — add a zip to the platform.
	 * It is uploaded (multipart, field "file"), or downloaded from
	 * an https link (`url`, multipart or JSON).
	 * @param req The current request.
	 * @returns Back to the list, or the list with the refusal on it
	 *   (`errors.file` / `errors.url`).
	 */
	async globalStore(req: Request) {
		const form = req.headers
			.get("content-type")
			?.includes("multipart/form-data")
			? await HttpRequest.formOf(req)
			: null;
		const file = form?.get("file");
		const url = form
			? form.get("url")
			: (((await HttpRequest.body(req)) as { url?: unknown })?.url ?? null);
		if (!(file instanceof File) && typeof url !== "string")
			return this.#globalPage(req, { file: t("server.ext_pick_zip") });
		const r =
			file instanceof File
				? await this.extensions.upload(file)
				: await this.extensions.fromUrl(url as string);
		return this.#globalDone(req, r.errors);
	}

	/**
	 * PUT /admin/extensions/:key — switch an extension on or off
	 * for all shops (`{enabled}`).
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async globalUpdate(req: BunRequest<"/admin/extensions/:key">) {
		const v = validate(GlobalExtensionInput, await HttpRequest.body(req));
		if (v.errors) return this.#globalPage(req, v.errors);
		const r = await this.extensions.setGlobal(req.params.key, v.data.enabled);
		return this.#globalDone(req, r.errors);
	}

	/**
	 * PUT /admin/extensions/:key/users — who may use an extension.
	 * The body is `{users: emails}`. [] = every user.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async globalUsers(req: BunRequest<"/admin/extensions/:key/users">) {
		const v = validate(GlobalExtensionUsersInput, await HttpRequest.body(req));
		if (v.errors) return this.#globalPage(req, v.errors);
		const r = await this.extensions.setUsers(req.params.key, v.data.users);
		return this.#globalDone(req, r.errors);
	}

	/**
	 * GET /admin/extensions/users?q= — users to pick
	 * for "Available to" (JSON).
	 * @param req The current request.
	 * @returns `{places: emails, more}`.
	 */
	async globalUserChoices(req: Request) {
		const q = new Query(req).text("q");
		return json(await this.extensions.userChoices(q));
	}

	/**
	 * DELETE /admin/extensions/:key — delete an uploaded extension's code.
	 * A built-in one is refused.
	 * @param req The current request.
	 * @returns Back to the list, or the list with the refusal.
	 */
	async globalDestroy(req: BunRequest<"/admin/extensions/:key">) {
		const r = await this.extensions.remove(req.params.key);
		return this.#globalDone(req, r.errors);
	}

	/**
	 * GET /extensions/:key/:page — one of an extension's own pages,
	 * inside the app layout.
	 * Both roles get here. The page says who may see it.
	 * @param req The current request.
	 * @returns The Extensions/Page page, the 403 page, or 404.
	 */
	async show(req: BunRequest<"/extensions/:key/:page">) {
		const { shop, user } = ctx(req);
		const p = await this.extensions.page(
			shop.id,
			req.params.key,
			req.params.page,
			user.role,
		);
		if (p === "forbidden") return inertia(req, "Errors/Forbidden", {}, 403);
		return p ? inertia(req, "Extensions/Page", p) : Inertia.notFound(req);
	}

	/**
	 * ANY /ext/:key/* — an extension's staff routes and `assets/` files,
	 * for the active shop.
	 * Every role gets here. The handler gets `user` and every function
	 * of the API as that staff member.
	 * @param req The current request.
	 * @returns Whatever the extension answers.
	 *   404 when it doesn't run or nothing matches.
	 */
	route(req: BunRequest<"/ext/:key/*">) {
		const { shop, user } = ctx(req);
		return this.run(
			shop,
			user,
			req.params.key,
			req,
			this.#below(req, `/ext/${req.params.key}`),
		);
	}

	/**
	 * Run one staff route of an extension as a staff member.
	 * Used by the `/ext` mount and by an MCP tool call.
	 * @param shop The shop.
	 * @param user Who calls it.
	 * @param key The extension key.
	 * @param req The request the handler reads.
	 * @param subpath The path below the extension's mount (`/items/7`).
	 * @returns Whatever the extension answers.
	 *   404 when it doesn't run or nothing matches.
	 */
	run(shop: Shop, user: User, key: string, req: Request, subpath: string) {
		return this.extensions.handle("routes", shop, key, req, subpath, {
			user,
			handles: this.handles.for(shop.id, user.id),
		});
	}

	/**
	 * ANY /store/:slug/ext/:key/* — an extension's public storefront
	 * routes and `assets/` files.
	 * No login. The shop comes from the slug.
	 * @param req The current request.
	 * @returns Whatever the extension answers.
	 *   404 when the store is off, the extension doesn't run
	 *   or nothing matches.
	 */
	async storeRoute(req: BunRequest<"/store/:slug/ext/:key/*">) {
		const shop = await this.shops.findBySlug(req.params.slug);
		if (!shop?.online_enabled) return HttpResponse.notFoundText();
		// the store speaks only the shop's languages
		I18n.narrow(I18n.localeOf(req, shop.languages));
		return this.extensions.handle(
			"publicRoutes",
			shop,
			req.params.key,
			req,
			this.#below(req, `/store/${req.params.slug}/ext/${req.params.key}`),
			{
				actor: () => this.#storeActor(shop),
				handles: this.handles.for(shop.id),
				customer: await this.#storeCustomer(req, shop),
			},
		);
	}

	/**
	 * GET /* on a store's host — a page an extension brings to the store
	 * (manifest `storefront.path`, like `/blog` and `/blog/my-post`).
	 * Every route of the app wins over it: this is the last one tried.
	 * The extension's `publicRoutes` answer, with `ctx.storefront.page()`
	 * to draw the page inside the shop's theme.
	 * @param req The current request.
	 * @returns The extension's page. 404 as plain text when no store or
	 *   no extension owns the address, the theme's not-found page when
	 *   the extension has no such page.
	 */
	async storePage(req: BunRequest) {
		const s = await this.site.find(req);
		if (!s) return HttpResponse.notFoundText();
		const { pathname } = new URL(req.url);
		const key = await this.extensions.storeOwner(
			s.shop,
			pathname.split("/")[1] ?? "",
		);
		if (!key) return HttpResponse.notFoundText();
		const { shop, customer } = s;
		const res = await this.extensions.handle(
			"publicRoutes",
			shop,
			key,
			req,
			pathname,
			{
				actor: () => this.#storeActor(shop),
				handles: {
					...this.handles.for(shop.id),
					storefront: { page: (page) => this.#themed(s, pathname, page) },
				},
				customer: customer && {
					id: customer.id,
					name: customer.name,
					email: customer.email,
				},
			},
		);
		return res.status === 404 ? this.view.notFound(req, s) : res;
	}

	/**
	 * Draw an extension's page inside the shop's theme: the theme's
	 * `page` template, the one the shop's own pages use, or with
	 * `frame: "full"` the shared `store/extension` template, where the
	 * extension draws everything between the header and the footer.
	 * The body is cleaned here, whatever the extension did before:
	 * a store page never runs a script somebody typed.
	 * Its pictures load from the app's own host, like a product's.
	 * @param s The resolved storefront.
	 * @param pathname The path of the request.
	 * @param page What the extension gave `ctx.storefront.page()`.
	 * @returns The HTML response.
	 */
	async #themed(s: Storefront, pathname: string, page: unknown) {
		const p = (page ?? {}) as Record<string, unknown>;
		const title = String(p.title ?? "").slice(0, EXTENSION_STORE_TITLE_MAX);
		const body = Url.uploadsIn(await sanitizeHtml(String(p.body ?? "")));
		const canonical =
			typeof p.canonical === "string" && /^\/[^\s<>"]*$/.test(p.canonical)
				? p.canonical
				: pathname;
		const image =
			typeof p.image === "string" && Storage.isUploadUrl(p.image)
				? Url.upload(p.image)
				: null;
		return this.view.render(
			s,
			// `frame: "full"`: only the theme's header and footer around it
			p.frame === "full" ? "extension" : "page",
			{
				title,
				body,
				// printed inside <style>: a "</style" in it must not end the tag
				css: String(p.css ?? "").replace(/<\/style/gi, "<\\/style"),
				back: this.#backLink(s, p.back),
			},
			StoreViewService.storeSeo(s.shop, {
				url: s.url + canonical,
				title: `${title} · ${s.shop.name}`,
				desc:
					String(p.description ?? "").slice(0, EXTENSION_STORE_DESC_MAX) ||
					StorefrontSupport.summary(body) ||
					`${title} — ${s.shop.name}`,
				image,
				noindex: p.noindex === true,
			}),
			p.status === 404 ? 404 : 200,
		);
	}

	/**
	 * The page's own back link ("Back to blog"), in place of the theme's
	 * "Back to shop".
	 * @param s The resolved storefront.
	 * @param back What the extension gave: `{ title, path }`.
	 * @returns `{ title, url }`, or null: the theme then leads back to the shop.
	 */
	#backLink(s: Storefront, back: unknown) {
		const { title, path } = (back ?? {}) as Record<string, unknown>;
		if (typeof title !== "string" || !title.trim()) return null;
		if (typeof path !== "string" || !/^\/[^\s<>"]*$/.test(path)) return null;
		return {
			title: title.trim().slice(0, EXTENSION_STORE_LINK_TITLE_MAX),
			url: s.base + path,
		};
	}

	/**
	 * The customer signed in to the shop's online store, for a public route.
	 * @param req The current request.
	 * @param shop The shop of the request.
	 * @returns Their id, name and email, or null for a guest.
	 */
	async #storeCustomer(req: BunRequest, shop: Shop) {
		const customer = await Auth.currentCustomer(req, shop.id);
		if (!customer) return null;
		return { id: customer.id, name: customer.name, email: customer.email };
	}

	/**
	 * The path below a mount: `/ext/<key>/items/7` → `/items/7`.
	 * @param req The current request.
	 * @param prefix The mount, e.g. `/ext/<key>`.
	 * @returns The rest of the path, "/" when there is none.
	 */
	#below(req: Request, prefix: string) {
		return new URL(req.url).pathname.slice(prefix.length) || "/";
	}

	/**
	 * Render the extension list, optionally with form errors on it.
	 * @param req The current request.
	 * @param shopId Active shop.
	 * @param errors Inertia errors to show, if any.
	 * @returns The Extensions/Index page.
	 */
	async #page(req: Request, shopId: number, errors?: Errors) {
		return inertia(req, "Extensions/Index", {
			extensions: await this.extensions.list(shopId),
			...(errors && { errors }),
		});
	}

	/**
	 * Render Admin › Global Extensions, optionally with form errors on it.
	 * @param req The current request.
	 * @param errors Inertia errors to show, if any.
	 * @returns The Extensions/Global page.
	 */
	async #globalPage(req: Request, errors?: Errors) {
		return inertia(req, "Extensions/Global", {
			extensions: await this.extensions.platformList(),
			// the guide for extension authors
			guide_url: Hooks.docs.extensions,
			...(errors && { errors }),
		});
	}

	/**
	 * The answer after a change on Admin › Global Extensions.
	 * @param req The current request.
	 * @param errors What the service refused, if anything.
	 * @returns Back to the list, or the list with the errors.
	 */
	#globalDone(req: Request, errors?: Errors) {
		return errors
			? this.#globalPage(req, errors)
			: back(req, GLOBAL_EXTENSIONS);
	}

	/**
	 * Who an extension's functions run as on a public route,
	 * where nobody is signed in.
	 * It is the online store's system user,
	 * acting for the shop's account with every right.
	 * So a guest's order is signed "Online Store", like any online order.
	 * @param shop The shop of the request.
	 * @returns That user.
	 */
	async #storeActor(shop: Shop): Promise<User> {
		return {
			...(await this.store.systemUser()),
			role: "admin",
			owner_id: shop.owner_id,
		};
	}
}
