import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import { inertia } from "@xcore/view/Inertia";
import {
	type OAuthClient,
	OAuthService,
} from "@services/settings/OAuth.Service";
import type { Shop } from "@models/Shop";
import {
	OAuthApproveInput,
	OAuthAuthorizeInput,
	OAuthRegisterInput,
	OAuthTokenInput,
} from "@validators/OAuth.Validator";
import { MCP_PATH } from "@constants/Api.Constant";
import {
	OAUTH_AUTHORIZE_PATH,
	OAUTH_CORS_HEADERS,
	OAUTH_REGISTER_PATH,
	OAUTH_TOKEN_PATH,
} from "@constants/OAuth.Constant";

/**
 * OAuth 2.0 sign-in for the MCP server.
 * An assistant finds the endpoints through the two discovery files,
 * registers itself, sends the admin to the consent page,
 * and swaps the code it gets back for an API key.
 */
@Service()
export class OAuthController {
	constructor(private oauth: OAuthService) {}

	/**
	 * GET /.well-known/oauth-protected-resource — which server signs
	 * people in for the MCP server of this host.
	 * It is always the app's own host: the staff session lives there.
	 * @param req The current request.
	 * @returns The JSON of RFC 9728.
	 */
	async resource(req: Request) {
		return json({
			resource: `${await this.oauth.mcpOrigin(req)}${MCP_PATH}`,
			authorization_servers: [Url.appOrigin()],
			bearer_methods_supported: ["header"],
		});
	}

	/**
	 * GET /.well-known/oauth-authorization-server — where the sign-in
	 * endpoints are, and what they take.
	 * @returns The JSON of RFC 8414.
	 */
	server() {
		const origin = Url.appOrigin();
		return json({
			issuer: origin,
			authorization_endpoint: `${origin}${OAUTH_AUTHORIZE_PATH}`,
			token_endpoint: `${origin}${OAUTH_TOKEN_PATH}`,
			registration_endpoint: `${origin}${OAUTH_REGISTER_PATH}`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
		});
	}

	/**
	 * POST /oauth/register — a client registers itself.
	 * @param req The current request.
	 * A refusal is logged with what was sent:
	 * a client only shows its own words, so the log is where the reason is found.
	 * @returns 201 with the client, or 400 in the error shape of RFC 7591.
	 */
	async register(req: Request) {
		const v = OAuthRegisterInput.safeParse(await HttpRequest.body(req));
		if (!v.success) {
			const issue = v.error.issues[0];
			const why = `${issue?.path.join(".") || "body"}: ${issue?.message}`;
			console.warn(`[oauth] register refused, ${why}`);
			return this.#refused("invalid_client_metadata", why);
		}
		const client = this.oauth.register(v.data);
		if (!client) {
			console.warn("[oauth] register refused, redirect", v.data.redirect_uris);
			return this.#refused(
				"invalid_redirect_uri",
				"A redirect address must be https, or http on localhost, with no fragment",
			);
		}
		return json(client, 201);
	}

	/**
	 * GET /oauth/authorize — the consent page, for a signed-in admin.
	 * A wrong client or redirect address is shown as an error here.
	 * The person is never sent to an address that was not checked.
	 * @param req The current request.
	 * @returns The OAuth/Authorize page (400 with `error` when refused).
	 */
	async authorize(req: Request) {
		const asked = Object.fromEntries(new URL(req.url).searchParams);
		const found = await this.#request(
			req,
			OAuthAuthorizeInput.safeParse(asked),
		);
		if (!found.ok)
			return inertia(req, "OAuth/Authorize", { error: found.error }, 400);
		const { d, client, shop } = found;
		return inertia(req, "OAuth/Authorize", {
			error: null,
			client: { name: client.name, host: new URL(d.redirect_uri).host },
			shop: { name: shop.name },
			params: d,
			deny_url: OAuthService.withQuery(d.redirect_uri, {
				error: "access_denied",
				state: d.state,
			}),
		});
	}

	/**
	 * JSON: POST /oauth/authorize — the admin allows the client.
	 * The page then sends the browser to `url` itself:
	 * a form may not post to another site here (`form-action 'self'`).
	 * @param req The current request.
	 * @returns `{ url }` = the client's address with the code,
	 *   or 422 `{ errors }`.
	 */
	async approve(req: Request) {
		const body = await HttpRequest.body(req);
		const found = await this.#request(req, OAuthApproveInput.safeParse(body));
		if (!found.ok) return HttpResponse.unprocessable({ role: found.error });
		const { d, client, shop } = found;
		const r = await this.oauth.approve(ctx(req).user, shop, client, d);
		if (!("url" in r)) return HttpResponse.unprocessable({ role: r.error });
		return json({ url: r.url });
	}

	/**
	 * POST /oauth/token — a client swaps its one-time code for a key.
	 * The key is the access token. It does not run out:
	 * the admin deletes it on Settings › MCP & API keys.
	 * @param req The current request (a form or JSON body).
	 * @returns The token answer of OAuth (never cached),
	 *   or 400 `invalid_grant` / `invalid_request`.
	 */
	async token(req: Request) {
		const v = OAuthTokenInput.safeParse(await HttpRequest.body(req));
		if (!v.success) return this.#refused("invalid_request");
		const token = await this.oauth.exchange(v.data);
		if (!token) return this.#refused("invalid_grant");
		const res = json({ access_token: token, token_type: "Bearer" });
		res.headers.set("Cache-Control", "no-store");
		return res;
	}

	/**
	 * The answer to a CORS preflight of a public OAuth endpoint.
	 * @returns 204 with the open CORS headers.
	 */
	preflight() {
		return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
	}

	/**
	 * Check what a client asks for, on the consent page and on its answer.
	 * @param req The current request, with a signed-in admin.
	 * @param v The request, parsed by its zod schema.
	 * @returns `ok` with the checked values, the client and the shop.
	 *   Or `error` = the words to show.
	 */
	async #request<D extends OAuthAuthorizeInput>(
		req: Request,
		v: { success: true; data: D } | { success: false },
	): Promise<
		| { ok: true; d: D; client: OAuthClient; shop: Shop }
		| { ok: false; error: string }
	> {
		if (!v.success) return { ok: false, error: t("oauth.invalid") };
		const d = v.data;
		const client = this.oauth.client(d.client_id, d.redirect_uri);
		if (!client) return { ok: false, error: t("oauth.invalid") };
		const { user, shop: active } = ctx(req);
		const shop = await this.oauth.shopFor(user, active, d.resource);
		if (!shop) return { ok: false, error: t("oauth.wrong_shop") };
		return { ok: true, d, client, shop };
	}

	/**
	 * A refused call, in OAuth's own error shape.
	 * @param error The error code, like `invalid_grant`.
	 * @param description Why, for the programmer of the client.
	 * @returns 400 `{ error, error_description? }`.
	 */
	#refused(error: string, description?: string) {
		return json(
			{ error, ...(description && { error_description: description }) },
			400,
		);
	}
}
