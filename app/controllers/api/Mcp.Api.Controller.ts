import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { Mcp, type McpTool, RPC_ERROR, type RpcMessage } from "@xcore/api/Mcp";
import { apiDocs } from "@xcore/api/OpenApi";
import { Account } from "@xcore/auth/Account";
import { ApiGuard } from "@xcore/auth/ApiGuard";
import { Context, ctx } from "@xcore/http/Context";
import { json } from "@xcore/http/Response";
import type { Handler } from "@xcore/http/Router";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import { ShopRepository } from "@repositories/Shop.Repository";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { ExtensionController } from "@controllers/Extension.Controller";
import {
	API_PREFIX,
	API_VERSION,
	MCP_BATCH_MAX,
	MCP_INSTRUCTIONS,
	MCP_PROTOCOL_VERSIONS,
	MCP_SERVER_NAME,
	MCP_SERVER_TITLE,
} from "@constants/Api.Constant";
import { ICON_192_PATH, ICON_512_PATH } from "@constants/Http.Constant";
import { RATE_LIMITS } from "@constants/Security.Constant";
import { RateLimit } from "@xcore/http/RateLimit";

type Versions = readonly string[];

/**
 * The MCP server (`POST /mcp`): the API as tools an AI assistant can call.
 * It answers on the app's own host and on every shop's host,
 * so each shop has its own address.
 * It holds no rules.
 * A tool call is turned into the API call it stands for.
 * That call is sent through the route's own handler,
 * with the caller's key.
 * So the key, the role, the validation and the errors
 * are the API's own.
 */
@Service()
export class McpApiController {
	constructor(
		private shops: ShopRepository,
		private extensions: ExtensionService,
		private extensionRoutes: ExtensionController,
	) {}

	/**
	 * The tools, built on the first call.
	 * By then every API route is registered.
	 */
	private tools?: Map<string, McpTool>;

	/**
	 * POST /mcp — one JSON-RPC message, or a list of them.
	 * @param req The current request, with an API key.
	 * @returns The answer as JSON.
	 *   202 when there is nothing to answer (only notifications).
	 *   400 for a protocol version it does not speak.
	 *   401 on a shop's own host for a key of another shop.
	 */
	async handle(req: BunRequest) {
		// a shop's own address is for that shop
		// a key of another shop is a wrong key there
		const host = await this.shops.findByHost(Url.hostOf(req));
		if (host && host.id !== ctx(req).shop.id) return ApiGuard.mcpRefused(req);
		const wanted = req.headers.get("mcp-protocol-version");
		if (wanted && !(MCP_PROTOCOL_VERSIONS as Versions).includes(wanted))
			return json(
				Mcp.error(null, RPC_ERROR.invalidRequest, "Unsupported MCP version"),
				400,
			);
		let payload: unknown;
		try {
			payload = await req.json();
		} catch {
			return json(
				Mcp.error(null, RPC_ERROR.parse, "The body is not JSON"),
				400,
			);
		}
		const many = Array.isArray(payload);
		const messages = (many ? payload : [payload]) as RpcMessage[];
		if (messages.length > MCP_BATCH_MAX)
			return json(
				Mcp.error(
					null,
					RPC_ERROR.invalidRequest,
					`At most ${MCP_BATCH_MAX} messages in one request`,
				),
				400,
			);
		const answers = [];
		let calls = 0;
		for (const message of messages) {
			// the request itself paid for the first tool call
			const paid =
				!this.#isCall(message) || calls++ === 0 || this.#takeHit(req);
			const answer = paid
				? await this.#answer(req, message)
				: await this.#toolResult(
						message,
						ApiResponse.error("rate_limited", t(RATE_LIMITS.api.message)),
					);
			if (answer) answers.push(answer);
		}
		if (!answers.length) return new Response(null, { status: 202 });
		return json(many ? answers : answers[0]);
	}

	/**
	 * Is this message a tool call that gets an answer?
	 * @param m The message.
	 * @returns True for a `tools/call` with an id.
	 */
	#isCall(m: RpcMessage) {
		return m?.method === "tools/call" && m.id !== undefined && m.id !== null;
	}

	/**
	 * Take one more hit of the key's `api` budget.
	 * Each tool call after the first of a request costs one,
	 * so a list of calls is not cheaper than the same calls one by one.
	 * @param req The current request, with its key.
	 * @returns False when the key's budget is used up.
	 */
	#takeHit(req: BunRequest) {
		return RateLimit.take(
			`api:${ctx(req).apiKey?.id}`,
			RATE_LIMITS.api.limit,
			RATE_LIMITS.api.windowMs,
		).allowed;
	}

	/**
	 * GET or DELETE /mcp — this server opens no stream and keeps no session.
	 * @returns 405.
	 */
	notAllowed() {
		return new Response(null, { status: 405, headers: { Allow: "POST" } });
	}

	/**
	 * Every tool, by name.
	 * @returns The tools.
	 */
	#all() {
		this.tools ??= Mcp.buildTools(apiDocs);
		return this.tools;
	}

	/**
	 * Answer one JSON-RPC message.
	 * @param req The current request.
	 * @param m The message.
	 * @returns The answer, or null for a notification.
	 */
	async #answer(req: BunRequest, m: RpcMessage) {
		if (!m || typeof m !== "object" || typeof m.method !== "string")
			return Mcp.error(
				null,
				RPC_ERROR.invalidRequest,
				"Not a JSON-RPC message",
			);
		// a notification (no id) is never answered
		if (m.id === undefined || m.id === null) return null;
		switch (m.method) {
			case "initialize":
				return Mcp.result(m.id, this.#initialize(m.params));
			case "ping":
				return Mcp.result(m.id, {});
			case "tools/list":
				return Mcp.result(m.id, { tools: await this.#list(req) });
			case "tools/call":
				return this.#call(req, m);
			default:
				return Mcp.error(
					m.id,
					RPC_ERROR.methodNotFound,
					`Unknown method ${m.method}`,
				);
		}
	}

	/**
	 * The answer to `initialize`.
	 * It names the version to speak, and what this server offers
	 * (tools only).
	 * @param params The client's `initialize` params.
	 * @returns The result.
	 */
	#initialize(params: RpcMessage["params"]) {
		const asked = String(params?.protocolVersion ?? "");
		return {
			protocolVersion: (MCP_PROTOCOL_VERSIONS as Versions).includes(asked)
				? asked
				: MCP_PROTOCOL_VERSIONS[0],
			capabilities: { tools: {} },
			serverInfo: {
				name: MCP_SERVER_NAME,
				title: MCP_SERVER_TITLE,
				version: API_VERSION,
				// the logo a client shows next to the server's name
				icons: [
					{
						src: `${Url.appOrigin()}${ICON_192_PATH}`,
						mimeType: "image/png",
						sizes: ["192x192"],
					},
					{
						src: `${Url.appOrigin()}${ICON_512_PATH}`,
						mimeType: "image/png",
						sizes: ["512x512"],
					},
				],
			},
			instructions: MCP_INSTRUCTIONS,
		};
	}

	/**
	 * The tools this key may call.
	 * A tool whose route needs a higher role is left out.
	 * The tools of the shop's running extensions come after the API's own.
	 * @param req The current request.
	 * @returns The tool listings.
	 */
	async #list(req: BunRequest) {
		const { role } = ctx(req).user;
		const own = [...this.#all().values()]
			.filter(function allowed(tool) {
				return Account.atLeast(role, tool.doc.role);
			})
			.map(function listing(tool) {
				return tool.listing;
			});
		const added = (await this.#extensionTools(req))
			.filter(function allowed(one) {
				return Account.atLeast(role, one.tool.role);
			})
			.map(function listing(one) {
				return Mcp.extensionToolListing(one.key, one.tool);
			});
		return [...own, ...added];
	}

	/**
	 * The tools of the shop's running extensions (manifest `tools`).
	 * One named like a tool of the API is left out: the API's own wins.
	 * @param req The current request.
	 * @returns Per tool: its extension's key and the tool.
	 */
	async #extensionTools(req: BunRequest) {
		const taken = this.#all();
		return (await this.extensions.tools(ctx(req).shop.id)).filter(
			function free(one) {
				return !taken.has(Mcp.extensionToolName(one.key, one.tool.name));
			},
		);
	}

	/**
	 * The request a tool call stands for, to hand to a route's handler.
	 * It carries the caller's language.
	 * @param req The current request.
	 * @param path The path of the route to call.
	 * @param method The HTTP method.
	 * @param body The JSON body, or undefined for none.
	 * @returns The request.
	 */
	#inner(req: Request, path: string, method: string, body: unknown) {
		return new Request(new URL(path, req.url), {
			method,
			headers: {
				"Content-Type": "application/json",
				"Accept-Language": req.headers.get("accept-language") ?? "",
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
		});
	}

	/**
	 * A route's answer as the answer to a `tools/call`.
	 * @param m The `tools/call` message.
	 * @param res What the route answered.
	 * @returns The answer's text, with `isError` for a refused call.
	 */
	async #toolResult(m: RpcMessage, res: Response) {
		return Mcp.result(m.id, {
			content: [{ type: "text", text: await res.text() }],
			isError: res.status >= 400,
		});
	}

	/**
	 * Run one tool of an extension: its staff route, as the key's user.
	 * The role is checked here, and the route may check again.
	 * @param req The current request.
	 * @param m The `tools/call` message.
	 * @returns The route's answer as the tool's text.
	 *   An error for a name no running extension has.
	 */
	async #callExtension(req: BunRequest, m: RpcMessage) {
		const name = String(m.params?.name ?? "");
		const found = (await this.#extensionTools(req)).find(function named(one) {
			return Mcp.extensionToolName(one.key, one.tool.name) === name;
		});
		if (!found) return Mcp.error(m.id, RPC_ERROR.invalidParams, "Unknown tool");
		const { shop, user } = ctx(req);
		const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
		const { method, path, body } = Mcp.extensionToolRequest(found.tool, args);
		const inner = this.#inner(req, `/ext/${found.key}${path}`, method, body);
		const res = Account.atLeast(user.role, found.tool.role)
			? await this.extensionRoutes.run(
					shop,
					user,
					found.key,
					inner,
					// the filled path itself, never read back from a URL:
					// a URL drops `..`, and the call would reach another route
					path.split("?")[0]!,
				)
			: ApiResponse.error(
					"forbidden",
					t("api.forbidden", { role: found.tool.role }),
				);
		return this.#toolResult(m, res);
	}

	/**
	 * Run one tool.
	 * The API call it stands for goes through that route's own handler,
	 * as the caller this request's key already stands for.
	 * The key was checked and counted once, by `ApiGuard.mcpKey`.
	 * The handler checks the role again,
	 * so a tool left out of the list is still refused.
	 * @param req The current request.
	 * @param m The `tools/call` message.
	 * @returns The API's answer as the tool's text, with `isError` for a
	 *   refused call.
	 */
	async #call(req: BunRequest, m: RpcMessage) {
		const tool = this.#all().get(String(m.params?.name ?? ""));
		// not a tool of the API: maybe one of a running extension
		if (!tool) return this.#callExtension(req, m);
		const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
		const { path, params, body } = Mcp.toolRequest(tool, args);
		const method = tool.doc.method.toUpperCase();
		// the route's handler behind its role check, with no second key check
		const handler = tool.doc.run;
		if (!handler)
			return Mcp.error(m.id, RPC_ERROR.invalidParams, "Unknown tool");
		const inner = Object.assign(
			this.#inner(req, `${API_PREFIX}${path}`, method, body),
			{ params },
		) as unknown as BunRequest;
		Context.set(inner, ctx(req));
		return this.#toolResult(m, await this.#run(handler, inner));
	}

	/**
	 * Call a route's handler for a tool.
	 * Anything it throws becomes the API's own 500 answer,
	 * so one broken tool never fails the whole MCP request.
	 * @param handler The route's handler behind its role check.
	 * @param inner The request the tool call stands for.
	 * @returns What the route answered.
	 */
	async #run(handler: Handler, inner: BunRequest) {
		try {
			return await handler(inner);
		} catch (e) {
			console.error(`[api] ${inner.method} ${new URL(inner.url).pathname}`, e);
			return ApiResponse.error("server_error", t("api.server_error"));
		}
	}
}
