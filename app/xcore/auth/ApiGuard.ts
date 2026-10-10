import { responseWithoutCosts } from "@helpers/costs";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { Account } from "@xcore/auth/Account";
import { Context, ctx } from "@xcore/http/Context";
import { RateLimit } from "@xcore/http/RateLimit";
import type { Handler, Middleware } from "@xcore/http/Router";
import { t } from "@xcore/i18n/I18n";
import { Container } from "@xcore/di";
import { ApiKeyService } from "@services/settings/ApiKey.Service";
import { OAuthService } from "@services/settings/OAuth.Service";
import { MCP_KEY_HEADER } from "@constants/Api.Constant";
import { OAUTH_RESOURCE_PATH } from "@constants/OAuth.Constant";
import { RATE_LIMITS } from "@constants/Security.Constant";
import type { Role } from "@constants/User.Constant";

/**
 * Route middleware for calls made with an API key.
 * The REST API reads the key from `Authorization: Bearer`.
 * The MCP server reads it from `X-API-Key`, or from `Authorization: Bearer`
 * (what a client that signed in through OAuth sends).
 */
export class ApiGuard {
	/**
	 * Middleware is plain functions, not classes.
	 * So the singletons are pulled out of the container by hand.
	 */
	static #keys = Container.get(ApiKeyService);
	static #oauth = Container.get(OAuthService);

	/**
	 * Route middleware: an API call with a good key
	 * in `Authorization: Bearer <key>`.
	 */
	static key = ApiGuard.#withKey(ApiGuard.#bearer, ApiGuard.#refused);

	/**
	 * Route middleware: an MCP call with a good key
	 * in `X-API-Key: <key>` or `Authorization: Bearer <key>`.
	 */
	static mcpKey = ApiGuard.#withKey(ApiGuard.#mcpToken, ApiGuard.mcpRefused);

	/**
	 * Route middleware (inside `apiKey`): the key needs at least this role.
	 * @param min The least role that may call the route.
	 * @returns The middleware. A weaker key gets a 403.
	 */
	static role(min: Role): Middleware {
		return function ranked(next: Handler): Handler {
			return async function check(req) {
				if (!Account.atLeast(ctx(req).user.role, min))
					return ApiResponse.error(
						"forbidden",
						t("api.forbidden", { role: min }),
					);
				const res = await next(req);
				// a cashier key never reads what the shop pays for its goods
				return Account.atLeast(ctx(req).user.role, "manager")
					? res
					: responseWithoutCosts(res);
			};
		};
	}

	/**
	 * The MCP server's answer to a missing or wrong key (401).
	 * Its `WWW-Authenticate` header says where a client finds the sign-in
	 * (the OAuth discovery file of this host).
	 * @param req The current request.
	 * @returns The JSON response.
	 */
	static async mcpRefused(req: Request) {
		const res = ApiResponse.error("unauthorized", t("api.unauthorized"));
		const origin = await ApiGuard.#oauth.mcpOrigin(req);
		res.headers.set(
			"WWW-Authenticate",
			`Bearer resource_metadata="${origin}${OAUTH_RESOURCE_PATH}"`,
		);
		return res;
	}

	/**
	 * The key a caller sent: `Authorization: Bearer <key>`.
	 * Cookies are never read here.
	 * So a browser session can not call the API by accident (no CSRF risk).
	 * @param req The current request.
	 * @returns The key, or "" when the header is missing or not a Bearer one.
	 */
	static #bearer(req: Request) {
		const [scheme, token] = (req.headers.get("authorization") ?? "").split(" ");
		return scheme?.toLowerCase() === "bearer" && token ? token : "";
	}

	/**
	 * The key an MCP client sent: `X-API-Key: <key>`, the key alone.
	 * @param req The current request.
	 * @returns The key, or "" when the header is missing.
	 */
	static #plainKey(req: Request) {
		return req.headers.get(MCP_KEY_HEADER)?.trim() ?? "";
	}

	/**
	 * The key an MCP client sent, in either header.
	 * @param req The current request.
	 * @returns The key, or "" when both headers are missing.
	 */
	static #mcpToken(req: Request) {
		return ApiGuard.#plainKey(req) || ApiGuard.#bearer(req);
	}

	/**
	 * The API's answer to a missing or wrong key (401).
	 * @returns The JSON response.
	 */
	static #refused() {
		return ApiResponse.error("unauthorized", t("api.unauthorized"));
	}

	/**
	 * Build the middleware for a call with a key.
	 * Exposes `ctx(req)` like `auth` does.
	 * Refuses a missing or wrong key (401)
	 * and a key that calls too often (429).
	 * Anything a handler throws becomes a 500 in the API's own error shape.
	 * @param read Where the key is read from.
	 * @param refused The answer to a missing or wrong key.
	 * @returns The middleware.
	 */
	static #withKey(
		read: (req: Request) => string,
		refused: (req: Request) => Response | Promise<Response>,
	): Middleware {
		return function keyed(next: Handler): Handler {
			return async function check(req) {
				const token = read(req);
				const caller = token ? await ApiGuard.#keys.authenticate(token) : null;
				if (!caller) return refused(req);
				const gate = RateLimit.take(
					`api:${caller.key.id}`,
					RATE_LIMITS.api.limit,
					RATE_LIMITS.api.windowMs,
				);
				if (!gate.allowed) {
					const res = ApiResponse.error(
						"rate_limited",
						t(RATE_LIMITS.api.message),
					);
					res.headers.set("Retry-After", String(gate.retryAfter));
					return res;
				}
				Context.set(req, {
					user: caller.user,
					shop: caller.shop,
					apiKey: caller.key,
				});
				try {
					return await next(req);
				} catch (e) {
					console.error(`[api] ${req.method} ${new URL(req.url).pathname}`, e);
					return ApiResponse.error("server_error", t("api.server_error"));
				}
			};
		};
	}
}
