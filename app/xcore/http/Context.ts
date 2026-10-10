import type { Session, User } from "@models/User";
import type { Shop } from "@models/Shop";
import type { PlanNotice } from "@xcore/hooks/Hooks";
import type { ApiKey } from "@models/ApiKey";

/**
 * Who is asking, and in which shop.
 * `session` is set for a signed-in browser, `apiKey` for an API call.
 * It is one or the other.
 * `plan` is set by the `auth` middleware when an add-on has a plan to show.
 */
export type Ctx = {
	user: User;
	session?: Session;
	apiKey?: ApiKey;
	shop: Shop;
	plan?: PlanNotice;
};

/**
 * Who is asking, kept per request.
 * The auth middleware writes it, handlers read it with `ctx(req)`.
 */
export class Context {
	/** The context of each request that is being answered. */
	static #store = new WeakMap<Request, Ctx>();

	/**
	 * Remember who is asking, for the rest of this request.
	 * @param req The current request.
	 * @param c The user, the shop and how they signed in.
	 * @returns The store itself.
	 */
	static set(req: Request, c: Ctx) {
		return Context.#store.set(req, c);
	}

	/**
	 * Who is asking, when somebody is.
	 * @param req The current request.
	 * @returns The context, or undefined when none was set.
	 */
	static get(req: Request) {
		return Context.#store.get(req);
	}
}

/**
 * Auth context for the current request.
 * It only works inside routes wrapped by the `auth` middleware.
 * @param req The current request.
 * @returns The context.
 * @throws When the route is not behind the auth middleware.
 */
export function ctx(req: Request): Ctx {
	const c = Context.get(req);
	if (!c)
		throw new Error("No auth context — route is not behind auth middleware");
	return c;
}
