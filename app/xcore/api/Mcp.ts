import { type ApiDoc, OpenApi } from "@xcore/api/OpenApi";
import type { ExtensionTool } from "@validators/Extension.Validator";

/**
 * The MCP side of the API: every documented route as one tool.
 * A tool is built from the route's `ApiDoc`.
 * That is the same record the OpenAPI file is built from.
 * So a new API route is a new tool, with nothing to write twice.
 */

/** Any JSON object. */
type Json = Record<string, unknown>;

/**
 * A JSON-RPC 2.0 message, as MCP sends it.
 * A message without an `id` is a notification: it gets no answer.
 */
export type RpcMessage = {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Json;
};

/** The JSON-RPC error codes MCP uses. */
export const RPC_ERROR = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
} as const;

/**
 * One tool: what the assistant sees,
 * and how its arguments become an API call.
 */
export type McpTool = {
	name: string;
	doc: ApiDoc;
	/** The `:name` parts of the path. */
	pathParams: string[];
	/** The argument names that go into the query string. */
	queryParams: string[];
	/**
	 * True = the body's fields sit beside the other arguments.
	 * False = the body is the `body` argument.
	 */
	flatBody: boolean;
	/** What `tools/list` returns for it. */
	listing: Json;
};

/** Words left out of a tool name: "Create a product" → `create_product`. */
const SMALL_WORDS = new Set(["a", "an", "the"]);

/**
 * The MCP side of the API: every documented route as one tool,
 * and the JSON-RPC messages it answers with.
 */
export class Mcp {
	/**
	 * A JSON-RPC answer that carries a result.
	 * @param id The id of the request it answers.
	 * @param result The result.
	 * @returns The message.
	 */
	static result(id: RpcMessage["id"], result: unknown) {
		return { jsonrpc: "2.0", id: id ?? null, result };
	}

	/**
	 * A JSON-RPC answer that carries an error.
	 * @param id The id of the request it answers, null when it could not be read.
	 * @param code One of `RPC_ERROR`.
	 * @param message The reason.
	 * @returns The message.
	 */
	static error(id: RpcMessage["id"], code: number, message: string) {
		return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
	}

	/**
	 * A tool's name, from the route's summary.
	 * ponytail: a reworded summary renames the tool.
	 * That breaks a client that saved the name.
	 * A test pins the names.
	 * Give `ApiDoc` its own `name` field
	 * if summaries ever need to change freely.
	 * @param summary The route's summary, like "Create a product".
	 * @returns The name, like `create_product`.
	 */
	static toolName(summary: string) {
		return summary
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim()
			.split(" ")
			.filter(function kept(word) {
				return !SMALL_WORDS.has(word);
			})
			.join("_");
	}

	/**
	 * Every documented route as a tool, by name.
	 * @param docs The routes' docs.
	 * @returns The tools.
	 * @throws When two routes end up with the same tool name.
	 */
	static buildTools(docs: ApiDoc[]) {
		const tools = new Map<string, McpTool>();
		for (const doc of docs) {
			const tool = Mcp.#toTool(doc);
			if (tools.has(tool.name))
				throw new Error(`Two API routes share the MCP tool name ${tool.name}`);
			tools.set(tool.name, tool);
		}
		return tools;
	}

	/**
	 * Turn a tool call's arguments into the API call it stands for.
	 * @param tool The tool.
	 * @param args The arguments the assistant sent.
	 * @returns The path after the API prefix (with its query string),
	 *   the path's params, and the JSON body if the route takes one.
	 */
	static toolRequest(tool: McpTool, args: Json) {
		const { path, params } = OpenApi.fillPath(
			tool.doc.path,
			tool.pathParams,
			function arg(name) {
				return args[name];
			},
		);
		const qs = Mcp.#queryString(
			tool.queryParams.map(function pair(name): [string, unknown] {
				return [name, args[name]];
			}),
		);
		let body: unknown;
		if (tool.doc.body) {
			if (tool.flatBody) {
				const skip = new Set([...tool.pathParams, ...tool.queryParams]);
				body = Object.fromEntries(
					Object.entries(args).filter(function field([name]) {
						return !skip.has(name);
					}),
				);
			} else body = args.body;
		}
		return { path: qs ? `${path}?${qs}` : path, params, body };
	}

	/**
	 * An extension tool's name: the extension's key in front.
	 * So it never clashes with another extension's.
	 * @param key The extension key, like `restaurant`.
	 * @param name The tool's name in the manifest.
	 * @returns The name, like `restaurant_set_send_to_kitchen`.
	 */
	static extensionToolName(key: string, name: string) {
		return `${key.replaceAll("-", "_")}_${name}`;
	}

	/**
	 * What `tools/list` returns for an extension's tool.
	 * Its arguments sit side by side:
	 * the path's `:name` parts and the manifest's `input`.
	 * @param key The extension key.
	 * @param tool The tool, as the manifest declares it.
	 * @returns The listing.
	 */
	static extensionToolListing(key: string, tool: ExtensionTool): Json {
		const { method, pathParams } = Mcp.#routeOf(tool);
		const properties: Json = {};
		// a path part the manifest does not describe is plain text
		for (const name of pathParams) properties[name] = { type: "string" };
		Object.assign(properties, tool.input);
		return Mcp.#listing(Mcp.extensionToolName(key, tool.name), tool, method, {
			type: "object",
			properties,
			required: [...new Set([...pathParams, ...tool.required])],
		});
	}

	/**
	 * Turn an extension tool call's arguments into the call of its staff route.
	 * The path's parts are filled first.
	 * The rest is the query of a GET or DELETE, else the JSON body.
	 * @param tool The tool.
	 * @param args The arguments the assistant sent.
	 * @returns The method, the path below the extension's mount
	 *   (with its query string), and the JSON body if any.
	 */
	static extensionToolRequest(tool: ExtensionTool, args: Json) {
		const { method, path: pattern, pathParams } = Mcp.#routeOf(tool);
		const { path } = OpenApi.fillPath(pattern, pathParams, function arg(name) {
			return args[name];
		});
		const rest = Object.entries(args).filter(function field([name]) {
			return !pathParams.includes(name);
		});
		if (method !== "GET" && method !== "DELETE")
			return { method, path, body: Object.fromEntries(rest) };
		const qs = Mcp.#queryString(rest);
		return { method, path: qs ? `${path}?${qs}` : path, body: undefined };
	}

	/**
	 * The properties and required names of an object schema.
	 * @param schema A JSON Schema, or nothing.
	 * @returns Its properties and required list.
	 *   Empty when it is not a plain object.
	 */
	static #objectParts(schema: Json | undefined) {
		const plain = schema?.type === "object" && !!schema.properties;
		return {
			plain,
			properties: (plain ? schema?.properties : {}) as Json,
			required: ((plain && schema?.required) || []) as string[],
		};
	}

	/**
	 * Build one tool from a route's docs.
	 * Its arguments sit side by side: the path's `:name` parts,
	 * the query string and the body's fields.
	 * @param doc The route's docs.
	 * @returns The tool.
	 * @throws When two of those parts use the same argument name:
	 *   the call could not tell them apart.
	 */
	static #toTool(doc: ApiDoc): McpTool {
		const pathParams = OpenApi.pathParams(doc.path);
		const query = Mcp.#objectParts(
			doc.query && OpenApi.schemaOf(doc.query, "input"),
		);
		const bodySchema = doc.body && OpenApi.schemaOf(doc.body, "input");
		const body = Mcp.#objectParts(bodySchema);
		const flatBody = !bodySchema || body.plain;
		const properties: Json = {};
		const required: string[] = [];
		for (const name of pathParams) {
			properties[name] = { type: "integer" };
			required.push(name);
		}
		const parts = [query, flatBody ? body : Mcp.#objectParts(undefined)];
		for (const part of parts)
			for (const [name, schema] of Object.entries(part.properties)) {
				if (name in properties)
					throw new Error(`MCP tool for ${doc.path}: "${name}" is used twice`);
				properties[name] = schema;
				if (part.required.includes(name)) required.push(name);
			}
		if (bodySchema && !flatBody) {
			properties.body = bodySchema;
			required.push("body");
		}
		const name = Mcp.toolName(doc.summary);
		return {
			name,
			doc,
			pathParams,
			queryParams: Object.keys(query.properties),
			flatBody,
			listing: Mcp.#listing(name, doc, doc.method, {
				type: "object",
				properties,
				required,
			}),
		};
	}

	/**
	 * What `tools/list` returns for one tool.
	 * @param name The tool's name.
	 * @param text The tool's summary, its longer description, and whether
	 *   it does something that can not be taken back.
	 * @param method The HTTP method of the route behind it, in any case.
	 * @param inputSchema The JSON Schema of the tool's arguments.
	 * @returns The listing.
	 */
	static #listing(
		name: string,
		text: { summary: string; description?: string; destructive?: boolean },
		method: string,
		inputSchema: Json,
	): Json {
		const verb = method.toUpperCase();
		return {
			name,
			title: text.summary,
			description: [text.summary, text.description].filter(Boolean).join(". "),
			inputSchema,
			annotations: {
				title: text.summary,
				readOnlyHint: verb === "GET",
				destructiveHint: verb === "DELETE" || !!text.destructive,
				idempotentHint: verb !== "POST",
				openWorldHint: false,
			},
		};
	}

	/**
	 * A query string from some arguments.
	 * An argument that is missing or null is left out.
	 * @param entries The names and values.
	 * @returns The query string without the `?`, "" when there is none.
	 */
	static #queryString(entries: [string, unknown][]) {
		const search = new URLSearchParams();
		for (const [name, value] of entries)
			if (value !== undefined && value !== null)
				search.set(name, String(value));
		return search.toString();
	}

	/**
	 * The method and path of an extension tool's route.
	 * @param tool The tool.
	 * @returns The method, the path below the extension's mount,
	 *   and the path's `:name` parts.
	 */
	static #routeOf(tool: ExtensionTool) {
		const [method, path] = tool.route.split(" ") as [string, string];
		return { method, path, pathParams: OpenApi.pathParams(path) };
	}
}
