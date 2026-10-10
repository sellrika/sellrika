import {
	DEFAULT_FAVICON,
	VITE_CSS_ENTRY,
	VITE_ENTRY,
} from "@constants/Inertia.Constant";
import { app } from "@config/app";
import { Account } from "@xcore/auth/Account";
import { Context } from "@xcore/http/Context";
import { HttpResponse } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { I18n } from "@xcore/i18n/I18n";
import { edge } from "@xcore/view/Edge";
import { Ssr } from "@xcore/view/Ssr";
import { Vite } from "@xcore/view/Vite";
import { safeJson } from "@helpers/json";
import { withoutCosts } from "@helpers/costs";
import { Container } from "@xcore/di";
import { ShopRepository } from "@repositories/Shop.Repository";
import { StockRepository } from "@repositories/Stock.Repository";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
/**
 * Embedded at compile time, so it works inside the single binary.
 */
import appTemplate from "@resources/views/app.edge" with { type: "text" };

edge.registerTemplate("app", { template: appTemplate });

/**
 * Inertia pages: the page itself, its shared props,
 * and the answers that send the browser elsewhere.
 */
export class Inertia {
	/**
	 * Shared props are built by a plain function, not a class.
	 * So the singletons are pulled out of the container by hand.
	 */
	static #shops = Container.get(ShopRepository);
	static #stockRepo = Container.get(StockRepository);
	static #extensions = Container.get(ExtensionService);

	/**
	 * Render an Inertia page.
	 * JSON for XHR visits, Edge root view for full loads.
	 * A full load of a page in `SSR_PAGES` holds the page's HTML too
	 * (`renderPage`).
	 * @param req The current request.
	 * @param component The page, e.g. "Customers/Index".
	 * @param props The page's props.
	 *   A prop may be a function: it is called only when the prop is sent,
	 *   so a partial reload never pays for what it did not ask for.
	 * @param status The HTTP status.
	 * @param view The `<title>` and extra `<head>` tags of a full load.
	 *   Only a public page needs them:
	 *   crawlers and link previews do not run the script.
	 * @returns The page as JSON or as HTML.
	 */
	static async render(
		req: Request,
		component: string,
		props: Record<string, unknown> = {},
		status = 200,
		view: { title?: string; head?: string } = {},
	) {
		const { css, js, version } = await Vite.tags([VITE_CSS_ENTRY, VITE_ENTRY]);
		const u = new URL(req.url);
		// after a failed POST we re-render the form:
		// keep the browser URL on the page the user was on
		// `samePath` strips the origin:
		// a spoofed Referer can never move the browser off this site
		const referer = req.headers.get("referer");
		const url =
			req.method === "GET" || !referer
				? u.pathname + u.search
				: Url.samePath(referer, u.pathname + u.search);
		const resolved = await Inertia.#resolve(req, component, {
			errors: {},
			...Inertia.#sharedProps(req),
			...props,
		});
		// a cashier's page never carries what the shop pays for its goods
		const role = Context.get(req)?.user.role;
		const page = {
			component,
			props:
				role && !Account.atLeast(role, "manager")
					? withoutCosts(resolved)
					: resolved,
			url,
			version,
		};

		if (req.headers.get("X-Inertia")) {
			if (
				req.method === "GET" &&
				req.headers.get("X-Inertia-Version") !== version
			) {
				return Inertia.#locationConflict(req.url);
			}
			return Response.json(page, {
				status,
				headers: { "X-Inertia": "true", Vary: "X-Inertia" },
			});
		}
		const pageJson = safeJson(page);
		// a public page arrives with its HTML
		// `data-server-rendered` tells the browser to take it over
		const rendered = await Ssr.render(page);
		const root =
			rendered === null
				? `<div id="app"></div>`
				: `<div id="app" data-server-rendered="true">${rendered}</div>`;
		const document = await edge.render("app", {
			body: `${root}<script data-page="app" type="application/json">${pageJson}</script>`,
			vite: `${css}\n${js}`,
			title: view.title ?? "POS",
			head: view.head ?? "",
			icon: DEFAULT_FAVICON,
			// the customer's screen is always light, whatever theme the cashier picked
			theme: component === "Pos/Display" ? "light" : "auto",
			locale: I18n.current(),
			// visitors only: a signed-in page never loads the tag
			// (staff URLs hold order and customer data)
			ga: Context.get(req) ? "" : app.gaId,
			passwordManager: component === "Auth/Login",
		});
		return HttpResponse.html(document, status);
	}

	/**
	 * The app's own "not found" page (404).
	 * For a public page that does not exist, or a request no shop claims.
	 * @param req The current request.
	 * @returns The Errors/NotFound page.
	 */
	static notFound(req: Request) {
		return Inertia.render(req, "Errors/NotFound", {}, 404);
	}

	/**
	 * Send the browser to another site, e.g. Stripe's checkout.
	 * An Inertia visit can't follow a redirect to another origin.
	 * So it gets 409 with `X-Inertia-Location`,
	 * and the client loads the page whole.
	 * @param req The current request.
	 * @param url The address on the other site.
	 * @returns The redirect.
	 */
	static away(req: Request, url: string) {
		return req.headers.get("X-Inertia")
			? Inertia.#locationConflict(url)
			: redirect(url);
	}

	/**
	 * Work out the props a response carries.
	 * A partial reload (`router.reload({ only })`) names the props it wants.
	 * Only those are sent, plus `errors`, which the protocol always sends.
	 * The browser keeps the props it already has for the rest.
	 * Props that are functions are called here, side by side.
	 * @param req The current request.
	 * @param component The page being rendered.
	 * @param props Shared and page props. Values, or functions giving one.
	 * @returns The props to send, every function replaced by its value.
	 */
	static async #resolve(
		req: Request,
		component: string,
		props: Record<string, unknown>,
	) {
		// the protocol: a partial reload counts only for the same page
		const partial =
			req.headers.get("X-Inertia-Partial-Component") === component;
		const only = Inertia.#headerList(req, "X-Inertia-Partial-Data");
		const except = Inertia.#headerList(req, "X-Inertia-Partial-Except");
		const keys: string[] = [];
		const values: unknown[] = [];
		for (const [key, value] of Object.entries(props)) {
			const kept =
				key === "errors" ||
				!partial ||
				((!only.length || only.includes(key)) && !except.includes(key));
			if (!kept) continue;
			keys.push(key);
			values.push(typeof value === "function" ? value() : value);
		}
		const done = await Promise.all(values);
		const out: Record<string, unknown> = {};
		for (const [i, key] of keys.entries()) out[key] = done[i];
		return out;
	}

	/**
	 * The prop names in a partial-reload header.
	 * A nested name (`user.name`) counts as its first part:
	 * the whole top-level prop is sent.
	 * @param req The current request.
	 * @param name The header.
	 * @returns The top-level prop names, [] when the header is not there.
	 */
	static #headerList(req: Request, name: string): string[] {
		const names: string[] = [];
		for (const part of (req.headers.get(name) ?? "").split(",")) {
			const key = part.trim().split(".")[0];
			if (key) names.push(key);
		}
		return names;
	}

	/**
	 * Props every page gets: the language, current user, current shop,
	 * and the account's shops (for the switcher).
	 * The ones that read the database are functions,
	 * so `#resolve` runs them side by side and skips the ones not asked for.
	 * @param req The current request.
	 * @returns The shared props. With nobody signed in: empty ones.
	 */
	static #sharedProps(req: Request): Record<string, unknown> {
		const c = Context.get(req);
		const locale = I18n.current();
		if (!c)
			return {
				locale,
				auth: { user: null },
				shop: null,
				store_url: null,
				shops: [],
				low_stock: 0,
				extension_ui: [],
				plan: null,
			};
		const { id, name, email, role } = c.user;
		const shopId = c.shop?.id;
		const account = Account.id(c.user);
		return {
			locale,
			// `platform` = the ADMIN_EMAIL user, who alone sees the platform settings
			auth: {
				user: {
					id,
					name,
					email,
					role,
					platform: Account.isPlatformAdmin(c.user),
				},
			},
			shop: c.shop,
			// the active shop's online store:
			// its own domain, else its subdomain
			store_url: Url.storeOrigin(c.shop),
			shops: () => Inertia.#shops.all(account),
			// sidebar badge on Stock; it already includes out-of-stock units
			low_stock: () =>
				Account.atLeast(role, "manager") && shopId
					? Inertia.#stockRepo.lowCount(shopId)
					: 0,
			// the running extensions' sidebar pages and slot scripts
			// `extension_ui`, not `extensions`:
			// the /extensions page's own prop uses that name
			extension_ui: () => (shopId ? Inertia.#extensions.ui(shopId, role) : []),
			// what an add-on says about the account's plan; null = nothing
			plan: c.plan ?? null,
		};
	}

	/**
	 * Tell an Inertia visit to load an address as a whole page (409).
	 * @param url The address to load.
	 * @returns The response, with `X-Inertia-Location`.
	 */
	static #locationConflict(url: string) {
		return new Response(null, {
			status: 409,
			headers: { "X-Inertia-Location": url },
		});
	}
}

/**
 * Send the browser to another page of the app.
 * Inertia needs 303 after PUT/PATCH/DELETE so the client follows with GET.
 * @param to The path to go to.
 * @returns The redirect.
 */
export function redirect(to: string) {
	return new Response(null, { status: 303, headers: { Location: to } });
}

/**
 * Go back to the page the request came from (Laravel `back()`).
 * @param req The current request.
 * @param fallback Where to go when the request names no usable page.
 * @returns The redirect.
 */
export function back(req: Request, fallback = "/") {
	return redirect(Url.samePath(req.headers.get("referer"), fallback));
}

/**
 * Render an Inertia page. The everyday name of `Inertia.render`.
 * @param req The current request.
 * @param component The page, e.g. "Customers/Index".
 * @param props The page's props.
 * @param status The HTTP status.
 * @param view The `<title>` and extra `<head>` tags of a full load.
 * @returns The page as JSON or as HTML.
 */
export function inertia(
	req: Request,
	component: string,
	props: Record<string, unknown> = {},
	status = 200,
	view: { title?: string; head?: string } = {},
) {
	return Inertia.render(req, component, props, status, view);
}
