import type { BunRequest } from "bun";
import { Container, type Constructable } from "@xcore/di";
import { Compress } from "@xcore/http/Compress";
import { SecurityHeaders } from "@xcore/http/Headers";
import { Url } from "@xcore/http/Url";
import { I18n } from "@xcore/i18n/I18n";

/** The HTTP methods a route can answer. */
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
/** What answers a request. */
export type Handler = (req: BunRequest) => Response | Promise<Response>;
/** Wraps a handler, to run something before or after it. */
export type Middleware = (next: Handler) => Handler;
/**
 * Anything a route can be pointed at:
 * a controller class, or a plain object of handlers.
 */
type Controller = Constructable<object> | Record<string, Handler>;
/** A plain function, or Laravel-style `[Controller, "method"]`. */
type Action = Handler | [Controller, string];

/** The methods `any()` registers. `OPTIONS` is not one of them. */
const ANY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// ponytail: builds the plain `routes` object Bun.serve already understands
class Router {
	routes: Record<string, Response | Partial<Record<Method, Handler>>> = {};
	private wrap: Middleware = (h) => h;

	/**
	 * The plain handler an action points at, with no middleware around it.
	 * For a caller that brings its own checks
	 * (`ApiCall.functions`, the API as functions for extensions).
	 * @param action The handler, or `[Controller, "method"]`.
	 * @returns The handler.
	 */
	bare(action: Action): Handler {
		return this.#toHandler(action);
	}

	/**
	 * A handler built like a route's, but put on no path:
	 * nothing outside can call it.
	 * It is wrapped in whatever middleware is currently in scope.
	 * This is the one place every route passes, so a new route can never
	 * ship without the security headers.
	 * Every handler (and everything it awaits) runs in the request's
	 * language, so `t()` needs no request passed around.
	 * A signed-in change from a page of another host is refused here (403).
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this handler only, outer first.
	 * @returns The wrapped handler.
	 */
	handler(action: Action, via: Middleware[] = []): Handler {
		const handler = this.wrap(this.#wrapAll(via, this.#toHandler(action)));
		return async function serve(req) {
			if (Url.foreign(req))
				return SecurityHeaders.apply(
					req,
					new Response("Forbidden", { status: 403 }),
				);
			return SecurityHeaders.apply(
				req,
				await Compress.gzip(
					req,
					await I18n.withLocale(I18n.localeOf(req), () => handler(req)),
				),
			);
		};
	}

	/**
	 * Register a GET route.
	 * @param path Bun route pattern.
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this route only, outer first.
	 * @returns This router, for chaining.
	 */
	get(path: string, action: Action, ...via: Middleware[]) {
		return this.#add("GET", path, action, via);
	}

	/**
	 * Register a POST route.
	 * @param path Bun route pattern.
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this route only, outer first.
	 * @returns This router, for chaining.
	 */
	post(path: string, action: Action, ...via: Middleware[]) {
		return this.#add("POST", path, action, via);
	}

	/**
	 * Register a PUT route.
	 * @param path Bun route pattern.
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this route only, outer first.
	 * @returns This router, for chaining.
	 */
	put(path: string, action: Action, ...via: Middleware[]) {
		return this.#add("PUT", path, action, via);
	}

	/**
	 * Register a PATCH route.
	 * @param path Bun route pattern.
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this route only, outer first.
	 * @returns This router, for chaining.
	 */
	patch(path: string, action: Action, ...via: Middleware[]) {
		return this.#add("PATCH", path, action, via);
	}

	/**
	 * Register a DELETE route.
	 * @param path Bun route pattern.
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this route only, outer first.
	 * @returns This router, for chaining.
	 */
	delete(path: string, action: Action, ...via: Middleware[]) {
		return this.#add("DELETE", path, action, via);
	}

	/**
	 * Register a CORS preflight.
	 * Bun answers a method only where the path names it,
	 * so each path needs its own.
	 * @param path Bun route pattern.
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this route only, outer first.
	 * @returns This router, for chaining.
	 */
	options(path: string, action: Action, ...via: Middleware[]) {
		return this.#add("OPTIONS", path, action, via);
	}

	/**
	 * Register one action for GET, POST, PUT, PATCH and DELETE.
	 * `OPTIONS` is left out.
	 * @param path Bun route pattern.
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for these routes only, outer first.
	 * @returns This router, for chaining.
	 */
	any(path: string, action: Action, ...via: Middleware[]) {
		for (const method of ANY_METHODS) this.#add(method, path, action, via);
		return this;
	}

	/**
	 * A permanent redirect handled by Bun itself, with no handler in between.
	 * @param from The old path.
	 * @param to Where it should go now.
	 * @returns This router, for chaining.
	 */
	redirect(from: string, to: string) {
		this.routes[from] = Response.redirect(to);
		return this;
	}

	/**
	 * Every route registered inside `register` is wrapped with `middleware`.
	 * Groups nest.
	 * A list is the same as nested groups, the first one outermost:
	 * `[a, b]` gives `a(b(handler))`.
	 * @param middleware The middleware to wrap them in, or a list of them.
	 * @param register Callback that registers the routes.
	 * @returns This router, for chaining.
	 */
	group(middleware: Middleware | Middleware[], register: () => void) {
		const list = Array.isArray(middleware) ? middleware : [middleware];
		const prev = this.wrap;
		this.wrap = (h) => prev(this.#wrapAll(list, h));
		try {
			register();
		} finally {
			this.wrap = prev;
		}
		return this;
	}

	/**
	 * The seven RESTful routes, but only the ones the controller defines.
	 * @param path Base path, e.g. `/products`.
	 * @param c The controller class (resolved from the container),
	 *   or a plain handler object.
	 * @returns This router, for chaining.
	 */
	resource(path: string, c: Controller) {
		const id = `${path}/:id`;
		const has = (name: string) => this.#defines(c, name);
		if (has("index")) this.get(path, [c, "index"]);
		if (has("create")) this.get(`${path}/create`, [c, "create"]);
		if (has("store")) this.post(path, [c, "store"]);
		if (has("show")) this.get(id, [c, "show"]);
		if (has("edit")) this.get(`${id}/edit`, [c, "edit"]);
		if (has("update")) this.put(id, [c, "update"]).patch(id, [c, "update"]);
		if (has("destroy")) this.delete(id, [c, "destroy"]);
		return this;
	}

	/**
	 * Register one method+path.
	 * It is wrapped in whatever middleware is currently in scope,
	 * then in the route's own `via` middleware.
	 * @param method HTTP method.
	 * @param path Bun route pattern (`/orders/:id`, `/build/*`).
	 * @param action The handler, or `[Controller, "method"]`.
	 * @param via Middleware for this route only, outer first.
	 * @returns This router, for chaining.
	 */
	#add(method: Method, path: string, action: Action, via: Middleware[] = []) {
		const entry = (this.routes[path] ??= {});
		if (entry instanceof Response)
			throw new Error(`${path} is already a redirect`);
		entry[method] = this.handler(action, via);
		return this;
	}

	/**
	 * The handler an action points at.
	 * A controller class comes from the DI container, bound so `this` survives.
	 * A plain object is used as it is.
	 * @param a The handler, or `[Controller, "method"]`.
	 * @returns The handler.
	 */
	#toHandler(a: Action): Handler {
		if (typeof a === "function") return a;
		const [c, method] = a;
		if (typeof c !== "function") return c[method]!;
		const inst = Container.get(c) as Record<string, Handler>;
		return inst[method]!.bind(inst);
	}

	/**
	 * Does this controller define `name`?
	 * Class methods live on the prototype.
	 * @param c The controller class, or a plain object of handlers.
	 * @param name The method name.
	 * @returns True when it is a function there.
	 */
	#defines(c: Controller, name: string) {
		return (
			typeof (typeof c === "function" ? c.prototype[name] : c[name]) ===
			"function"
		);
	}

	/**
	 * Wrap a handler in some middleware, the first one outermost.
	 * `[a, b]` gives `a(b(handler))`.
	 * @param list The middleware, outer first.
	 * @param h The handler.
	 * @returns The wrapped handler.
	 */
	#wrapAll(list: Middleware[], h: Handler): Handler {
		return list.reduceRight((inner, middleware) => middleware(inner), h);
	}
}

export const router = new Router();
