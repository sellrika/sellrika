import { Outbound } from "@xcore/http/Outbound";
import { ExtensionLoader } from "@xcore/extensions/ExtensionLoader";
import { json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { I18n, t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { Shop } from "@models/Shop";
import { extensionSignature } from "@helpers/crypto";
import { messageOf } from "@helpers/error";
import {
	EXTENSION_ASSETS_DIR,
	EXTENSION_CONFIG_SLOT,
} from "@constants/Extension.Constant";
import { ExtensionCatalog } from "./Extension.Catalog";
import { byKey, translatorOf } from "./Extension.Manifest";
import { ExtensionMail } from "./Extension.Mail";
import { ExtensionRuntime } from "./Extension.Runtime";
import type {
	ExtensionInfo,
	ExtensionRouteExtra,
	RunningExtension,
} from "./types/Extension.Types";

/**
 * The requests below an extension's mount.
 * Its files, and the routes its entry module adds:
 * staff routes at `/ext/<key>/*`,
 * public ones at `/store/<slug>/ext/<key>/*`.
 */
@Service()
export class ExtensionRoutes {
	constructor(
		private runtime: ExtensionRuntime,
		private catalog: ExtensionCatalog,
		private mail: ExtensionMail,
	) {}

	/**
	 * Serve a request below an extension's mount.
	 * Its `assets/…` files first.
	 * Else the matching handler of its route table: `routes` for staff,
	 * `publicRoutes` on the storefront.
	 * A handler may return a Response, or data to send as JSON.
	 * @param kind Which table: staff routes or public storefront routes.
	 * @param shop The shop the request is for.
	 * @param key The extension key.
	 * @param req The request.
	 * @param subpath The path below the mount (`/items/7`).
	 * @param extra Who is calling: the signed-in `user` on staff routes,
	 * the `actor` on public ones, and the functions with no API route.
	 * @returns The extension's response.
	 * 404 when nothing runs or matches, 500 when the handler threw.
	 */
	async handle(
		kind: "routes" | "publicRoutes",
		shop: Shop,
		key: string,
		req: Request,
		subpath: string,
		extra: ExtensionRouteExtra = {},
	): Promise<Response> {
		// staff: the logo of any extension (the lists show ones still off),
		// every other file only while it runs for the shop
		// the storefront: those the platform switched on for this shop's owner
		if (subpath.startsWith(`/${EXTENSION_ASSETS_DIR}/`))
			return this.#serveAsset(
				kind === "routes"
					? await this.#staffFiles(shop.id, key, subpath)
					: await this.catalog.available(shop),
				key,
				subpath,
				new URL(req.url).searchParams.has("v"),
			);
		const active = await this.runtime.active(shop, key);
		if (!active) return this.#notFound();
		try {
			const match = ExtensionLoader.matchRoute(
				(await ExtensionLoader.load(active.ext.dir, active.ext.main))[kind],
				req.method,
				subpath,
			);
			if (!match) return this.#notFound();
			const res = await match.fn(
				this.#routeContext(active, shop, req, match.params, extra),
			);
			return res instanceof Response ? res : json(res ?? null);
		} catch (error) {
			console.warn(
				`[extensions] ${key} ${req.method} ${subpath} for shop #${shop.id}:`,
				messageOf(error),
			);
			return json({ error: t("server.ext_failed") }, 500);
		}
	}

	/**
	 * What a route handler gets: the request, the shop, the settings,
	 * every API route as a function and the few with no API route.
	 * @param active The running extension.
	 * @param shop The shop.
	 * @param req The request.
	 * @param params The route's `:name` segments.
	 * @param extra Who is calling, and the functions with no API route.
	 * @returns The context.
	 */
	#routeContext(
		active: RunningExtension,
		shop: Shop,
		req: Request,
		params: Record<string, string>,
		extra: ExtensionRouteExtra,
	) {
		const key = active.ext.key;
		const handles = this.runtime.functionsFor(shop, extra);
		// …joined by the few functions with no API route,
		// under the same area names
		for (const [area, own] of Object.entries(extra.handles ?? {}))
			handles[area] = { ...handles[area], ...(own as object) };
		return {
			req,
			url: new URL(req.url),
			params,
			shop,
			config: active.config,
			t: translatorOf(active.ext),
			locale: I18n.current(),
			store_url: Url.storeOrigin(shop),
			sign: (value: string) => extensionSignature(key, shop.id, String(value)),
			data: this.runtime.dataOf(shop.id, key),
			outbound: Outbound.send,
			mail: this.mail.for(shop),
			...handles,
			...(extra.user && { user: extra.user }),
			// public routes: the customer signed in to the store, or null
			...(extra.customer !== undefined && { customer: extra.customer }),
		};
	}

	/**
	 * The extensions whose file staff may load at this path.
	 * The logo: any in the catalog.
	 * An extension with its own settings form (slot `extension.config`):
	 * every file while the shop may use it, so the form also shows
	 * before the extension is switched on.
	 * Anything else: only one running for the shop.
	 * @param shopId The active shop.
	 * @param key The extension key.
	 * @param subpath The path below the mount (`/assets/logo.svg`).
	 * @returns The extension in a list of one, or an empty list.
	 */
	async #staffFiles(
		shopId: number,
		key: string,
		subpath: string,
	): Promise<ExtensionInfo[]> {
		const ext = byKey(await this.catalog.catalog(), key);
		if (ext?.icon && subpath === `/${ext.icon}`) return [ext];
		const own = byKey(await this.catalog.available(shopId), key);
		if (own?.slots.some((slot) => slot.name === EXTENSION_CONFIG_SLOT))
			return [own];
		const active = await this.runtime.active(shopId, key);
		return active ? [active.ext] : [];
	}

	/**
	 * A file of an extension: the logo, a page script, a slot script.
	 * The extension need not run: the lists show the logo of one that is off.
	 * Routes, unlike files, need the extension running.
	 * @param pool The extensions whose files may be served.
	 * @param key The extension key.
	 * @param subpath The path below the mount (`/assets/main.ts`).
	 * @param versioned True when the URL carries `?v=<version>`.
	 * @returns The file, or 404.
	 */
	async #serveAsset(
		pool: ExtensionInfo[],
		key: string,
		subpath: string,
		versioned: boolean,
	): Promise<Response> {
		const ext = byKey(pool, key);
		const file =
			ext &&
			(await ExtensionLoader.asset(
				ext.dir,
				subpath.slice(EXTENSION_ASSETS_DIR.length + 2),
				versioned,
			));
		return file || this.#notFound();
	}

	/**
	 * The answer when an extension, a file or a route is not there.
	 * @returns A 404 response.
	 */
	#notFound(): Response {
		return new Response(t("server.not_found"), { status: 404 });
	}
}
