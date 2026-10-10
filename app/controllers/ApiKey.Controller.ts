import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { back, inertia } from "@xcore/view/Inertia";
import { ApiKeyService } from "@services/settings/ApiKey.Service";
import { ApiKeyInput } from "@validators/ApiKey.Validator";
import { validate } from "@validators/validate";
import { MCP_PATH } from "@constants/Api.Constant";
import { Hooks } from "@xcore/hooks/Hooks";
import type { Shop } from "@models/Shop";

/**
 * Settings › MCP & API keys (admin).
 * These are the keys programs call `/api/v1` with,
 * for the active shop.
 */
@Service()
export class ApiKeyController {
	constructor(private keys: ApiKeyService) {}

	/**
	 * GET /api-keys — the keys of the active shop.
	 * @param req The current request.
	 * @returns The ApiKeys/Index page.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		return inertia(req, "ApiKeys/Index", {
			keys: await this.keys.list(shop.id),
			// the docs host when one is set, else the page on this host
			docs_url: Hooks.docs.api,
			mcp_url: `${this.#mcpOrigin(req, shop)}${MCP_PATH}`,
		});
	}

	/**
	 * JSON: POST /api-keys — make a key.
	 * The answer is the only place the key is ever shown.
	 * The server keeps its hash.
	 * It is JSON and not a page prop,
	 * so the key never sits in the browser's page history.
	 * @param req The current request.
	 * @returns 201 `{ key, token }` (never cached), or 422 `{ errors }`.
	 */
	async store(req: Request) {
		const { shop, user } = ctx(req);
		const v = validate(ApiKeyInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.keys.create(shop.id, user, v.data);
		if (r.errors) return HttpResponse.unprocessable(r.errors);
		const res = json({ key: r.key, token: r.token }, 201);
		res.headers.set("Cache-Control", "no-store");
		return res;
	}

	/**
	 * DELETE /api-keys/:id — delete a key. It stops working at once.
	 * @param req The current request.
	 * @returns Back to the list.
	 */
	async destroy(req: BunRequest<"/api-keys/:id">) {
		await this.keys.remove(HttpRequest.idOf(req), ctx(req).shop.id);
		return back(req, "/api-keys");
	}

	/**
	 * The origin of the shop's MCP server.
	 * It is the shop's free address.
	 * That address is routed only while its store is open,
	 * so else it is the app's own.
	 * @param req The current request.
	 * @param shop The active shop.
	 * @returns The origin, without a path.
	 */
	#mcpOrigin(req: Request, shop: Shop) {
		return shop.online_enabled
			? Url.storeOrigin({ domain: null, slug: shop.slug })
			: Url.originOf(req);
	}
}
