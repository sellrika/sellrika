import { app } from "@config/app";
import {
	NEXT_COOKIE,
	NEXT_COOKIE_PROD,
	NEXT_COOKIE_SECONDS,
	NEXT_PATH_MAX,
} from "@constants/Auth.Constant";
import { Account } from "@xcore/auth/Account";
import { Context, ctx } from "@xcore/http/Context";
import type { Handler } from "@xcore/http/Router";
import { t } from "@xcore/i18n/I18n";
import { inertia } from "@xcore/view/Inertia";
import type { User } from "@models/User";
import { Hooks } from "@xcore/hooks/Hooks";
import { responseWithoutCosts } from "@helpers/costs";

import { Auth } from "@xcore/auth/Auth";

/**
 * The route middleware that decides who may open a route.
 * Use them in the route files: `router.group([Guard.auth, Guard.admin], …)`.
 * Every method is static and never reads `this`,
 * so it can be handed to the router as it is.
 */
export class Guard {
	/**
	 * Requires a logged-in user.
	 * It exposes `ctx(req)` to handlers.
	 * It lets in an owner who has not confirmed their email yet.
	 * That is only for sign-out and the confirmation routes.
	 * @param next The handler to wrap.
	 * @returns The wrapped handler. Nobody signed in: a redirect to `/login`.
	 */
	static signedIn(next: Handler): Handler {
		return async function check(req) {
			const c = await Auth.current(req);
			if (!c)
				return new Response(null, {
					status: req.method === "GET" ? 302 : 303,
					headers: { Location: "/login" },
				});
			Context.set(req, c);
			return next(req);
		};
	}

	/**
	 * The name of the cookie that remembers the page a guest wanted.
	 * @returns `__Host-next` in production, `next` in development.
	 */
	static nextCookie() {
		return app.isProd ? NEXT_COOKIE_PROD : NEXT_COOKIE;
	}

	/**
	 * Outside `auth`, on a page (GET) a guest should come back to.
	 * A guest is sent to `/login`, and the page is remembered in a cookie.
	 * The sign-in then goes to it instead of the POS.
	 * @param next The handler to wrap.
	 * @returns The wrapped handler.
	 */
	static comeBack(next: Handler): Handler {
		return async function check(req) {
			if (await Auth.current(req)) return next(req);
			const url = new URL(req.url);
			const path = url.pathname + url.search;
			if (path.length <= NEXT_PATH_MAX)
				req.cookies.set(Guard.nextCookie(), path, {
					httpOnly: true,
					sameSite: "lax",
					path: "/",
					maxAge: NEXT_COOKIE_SECONDS,
					secure: app.isProd,
				});
			return new Response(null, {
				status: 302,
				headers: { Location: "/login" },
			});
		};
	}

	/**
	 * A logged-in user whose email is confirmed.
	 * A self sign-up owner has `email_verified_at` null until they open the link.
	 * They get the Auth/Confirm page (GET) or a bare 403.
	 * It does not look at the plan, so an add-on's plan page sits here.
	 * @param next The handler to wrap.
	 * @returns The wrapped handler.
	 */
	static confirmed(next: Handler): Handler {
		return Guard.signedIn(async function check(req) {
			const { user } = ctx(req);
			if (user.email_verified_at) return next(req);
			return Guard.#forbidden(req, "Auth/Confirm", { email: user.email });
		});
	}

	/**
	 * A confirmed user whose account may use the app.
	 * Nobody is locked out over a plan.
	 * What an add-on says about the plan (`Hooks.plan`) rides
	 * on the context, for the banner on every page.
	 * @param next The handler to wrap.
	 * @returns The wrapped handler.
	 */
	static auth(next: Handler): Handler {
		return Guard.confirmed(async function check(req) {
			const c = ctx(req);
			const plan = await Hooks.plan(c.user);
			if (plan) Context.set(req, { ...c, plan });
			return Guard.#answer(req, next);
		});
	}

	/**
	 * Run the handler for a signed-in user.
	 * A cashier's JSON answer loses its cost values:
	 * the Sell screen and the order pages read the same rows as a manager.
	 * An Inertia answer is already cleaned when the page is built.
	 * @param req The current request, with its context.
	 * @param next The handler.
	 * @returns The handler's answer.
	 */
	static async #answer(req: Parameters<Handler>[0], next: Handler) {
		const res = await next(req);
		if (Guard.#isManager(ctx(req).user) || res.headers.has("x-inertia"))
			return res;
		return responseWithoutCosts(res);
	}

	/**
	 * Never redirects.
	 * It only exposes the session when there is one.
	 * Public pages use it, so a signed-in staff member gets
	 * the "back to POS" bar on the storefront.
	 * @param next The handler to wrap.
	 * @returns The wrapped handler.
	 */
	static maybeAuth(next: Handler): Handler {
		return async function check(req) {
			const c = await Auth.current(req);
			if (c) Context.set(req, c);
			return next(req);
		};
	}

	/**
	 * Inside `auth`: the platform admin only (`ADMIN_EMAIL`).
	 * Others get a 403 page (GET) or a bare 403.
	 * @param next The handler to wrap.
	 * @returns The wrapped handler.
	 */
	static platform(next: Handler): Handler {
		return Guard.#only(next, Account.isPlatformAdmin);
	}

	/**
	 * Inside `auth`: managers and admins.
	 * Cashiers get a 403 page (GET) or a bare 403 (mutations).
	 * @param next The handler to wrap.
	 * @returns The wrapped handler.
	 */
	static manager(next: Handler): Handler {
		return Guard.#only(next, Guard.#isManager);
	}

	/**
	 * Inside `auth`: admins only.
	 * Others get a 403 page (GET) or a bare 403 (mutations).
	 * @param next The handler to wrap.
	 * @returns The wrapped handler.
	 */
	static admin(next: Handler): Handler {
		return Guard.#only(next, Guard.#isAdmin);
	}

	/**
	 * Let only some users through.
	 * It must sit inside `auth`: it reads the user from `ctx(req)`.
	 * Others get a 403 page (GET) or a bare 403 (anything else).
	 * @param next The handler to wrap.
	 * @param allowed The test a user must pass.
	 * @returns The wrapped handler.
	 */
	static #only(next: Handler, allowed: (user: User) => boolean): Handler {
		return async function check(req) {
			if (!allowed(ctx(req).user)) return Guard.#forbidden(req);
			return next(req);
		};
	}

	/**
	 * The answer to someone who may not do this (403).
	 * A page for a GET, a bare text for anything else.
	 * @param req The current request.
	 * @param page The page a GET shows.
	 * @param props The page's props.
	 * @returns The response.
	 */
	static #forbidden(
		req: Request,
		page = "Errors/Forbidden",
		props: Record<string, unknown> = {},
	) {
		return req.method === "GET"
			? inertia(req, page, props, 403)
			: new Response(t("server.forbidden"), { status: 403 });
	}

	/**
	 * Is this user a manager or an admin?
	 * @param user The user.
	 * @returns True for both roles.
	 */
	static #isManager(user: User) {
		return Account.atLeast(user.role, "manager");
	}

	/**
	 * Is this user an admin?
	 * @param user The user.
	 * @returns True for an admin only.
	 */
	static #isAdmin(user: User) {
		return user.role === "admin";
	}
}
