import { z } from "zod";
import { API_ERROR_STATUS, type ApiErrorType } from "@xcore/api/ApiResponse";
import type { Handler } from "@xcore/http/Router";
import { ROLES, type Role } from "@constants/User.Constant";

/**
 * The OpenAPI file of the API, built from the routes themselves.
 * Each API route is registered with an `ApiDoc` (routes/api.ts).
 * So a route can not exist without its docs.
 * Request bodies and query strings come from the zod validators
 * the handlers use.
 */

/** Any JSON object. */
type Json = Record<string, unknown>;
/** The HTTP methods an API route may use. */
export type ApiMethod = "get" | "post" | "put" | "delete";

/**
 * What a route answers with on success.
 * A name = one record, `list` = an array of them,
 * `paged` = a page of them, null = nothing (204).
 */
export type ApiAnswer<N extends string> = N | { list: N } | { paged: N } | null;

/**
 * The docs of one API route.
 * Text is English: it is a reference for programmers.
 */
export type ApiDoc<N extends string = string> = {
	method: ApiMethod;
	/** The path after the API prefix, Bun style: `/orders/:id`. */
	path: string;
	/** The section of the docs it sits in. */
	tag: string;
	summary: string;
	description?: string;
	/** The least role a key needs. */
	role: Role;
	/** The query string, as the zod object the handler reads it with. */
	query?: z.ZodType;
	/** The JSON body, as the zod schema the handler validates it with. */
	body?: z.ZodType;
	/** A body that works, shown in the docs. */
	example?: unknown;
	answer: ApiAnswer<N>;
	/** The success status; 200 when absent. */
	status?: 200 | 201;
	/**
	 * Set = this is an MCP tool only, not an API route.
	 * No path answers it and the OpenAPI file leaves it out.
	 * The tool calls this handler.
	 */
	mcpOnly?: Handler;
	/**
	 * The route as a function for code inside the app:
	 * `<area>.<name>`, like `products.create`.
	 * Extensions get it under that name (`apiFunctions` in `apiCall.ts`).
	 */
	fn?: string;
	/**
	 * It takes money, stock or emails that can not be taken back.
	 * An MCP client is told so (`destructiveHint`) and asks the person first.
	 */
	destructive?: boolean;
	/**
	 * The route's own handler behind its role check only, with no key check.
	 * What the function `fn` runs.
	 */
	run?: Handler;
};

/** Every documented API route, filled while the routes are registered. */
export const apiDocs: ApiDoc[] = [];

/** What zod writes for "any whole number": noise in the docs. */
const SAFE = Number.MAX_SAFE_INTEGER;

/** What each error status means, for the docs. */
const ERROR_TEXT: Record<ApiErrorType, string> = {
	unauthorized: "The key is missing or wrong.",
	forbidden: "The key's role may not do this.",
	not_found: "No such record in this shop.",
	validation_error: "The input was refused. `fields` says why, per field.",
	rate_limited: "Too many calls. Wait for `Retry-After` seconds.",
	server_error: "Something broke on our side.",
};

/**
 * The OpenAPI file of the API, built from the routes themselves.
 */
export class OpenApi {
	/**
	 * The `:name` parts of a route path, in order.
	 * @param path A Bun style path, like `/orders/:id`.
	 * @returns The names, like `["id"]`.
	 */
	static pathParams(path: string): string[] {
		return [...path.matchAll(/:(\w+)/g)].map(function name(m) {
			return m[1] as string;
		});
	}

	/**
	 * Put values into the `:name` parts of a path, URL-encoded.
	 * A missing value becomes an empty part.
	 * @param path A Bun style path, like `/orders/:id`.
	 * @param names The `:name` parts to fill.
	 * @param read Gives the value of one part.
	 * @returns The filled path, and each part's value as text.
	 */
	static fillPath(
		path: string,
		names: string[],
		read: (name: string, index: number) => unknown,
	) {
		const params: Record<string, string> = {};
		let filled = path;
		names.forEach(function fill(name, i) {
			params[name] = String(read(name, i) ?? "");
			filled = filled.replace(`:${name}`, encodeURIComponent(params[name]));
		});
		return { path: filled, params };
	}

	/**
	 * A zod schema as JSON Schema.
	 * @param schema The zod schema.
	 * @param io `input` = what a caller sends (defaults optional).
	 *   `output` = what the API returns.
	 * @returns The JSON Schema.
	 */
	static schemaOf(schema: z.ZodType, io: "input" | "output") {
		return OpenApi.#clean(
			z.toJSONSchema(schema, { io, unrepresentable: "any" }),
		) as Json;
	}

	/**
	 * Build the OpenAPI 3.1 file.
	 * @param o The title and text of the API, the server URL,
	 *   the tags in order, the named models and the routes.
	 * @returns The OpenAPI document, ready for `JSON.stringify`.
	 */
	static build(o: {
		title: string;
		version: string;
		description: string;
		server: string;
		tags: { name: string; description: string }[];
		schemas: Record<string, z.ZodType>;
		docs: ApiDoc[];
	}) {
		const paths: Record<string, Json> = {};
		for (const doc of o.docs) {
			if (doc.mcpOnly) continue;
			const path = doc.path.replace(/:(\w+)/g, "{$1}");
			paths[path] = { ...paths[path], [doc.method]: OpenApi.#operation(doc) };
		}
		return {
			openapi: "3.1.0",
			info: { title: o.title, version: o.version, description: o.description },
			servers: [{ url: o.server }],
			security: [{ apiKey: [] }],
			tags: o.tags,
			paths,
			components: {
				securitySchemes: {
					apiKey: {
						type: "http",
						scheme: "bearer",
						description: "Your API key: `Authorization: Bearer srk_…`",
					},
				},
				schemas: Object.fromEntries(
					Object.entries(o.schemas).map(function model([name, schema]) {
						return [name, OpenApi.schemaOf(schema, "output")];
					}),
				),
			},
		};
	}

	/**
	 * Tidy a JSON Schema for the docs.
	 * It drops `$schema`, the "safe integer" bounds and "no other fields".
	 * An answer may carry more fields than the docs name.
	 * @param node Any part of a JSON Schema.
	 * @returns The same part, cleaned.
	 */
	static #clean(node: unknown): unknown {
		if (Array.isArray(node)) return node.map(OpenApi.#clean);
		if (!node || typeof node !== "object") return node;
		const out: Json = {};
		for (const [k, v] of Object.entries(node)) {
			if (k === "$schema" || (k === "additionalProperties" && v === false))
				continue;
			if ((k === "minimum" && v === -SAFE) || (k === "maximum" && v === SAFE))
				continue;
			out[k] = OpenApi.#clean(v);
		}
		return out;
	}

	/**
	 * A pointer at a named model: `#/components/schemas/<name>`.
	 * @param name The model's name.
	 * @returns The `$ref` object.
	 */
	static #ref(name: string) {
		return { $ref: `#/components/schemas/${name}` };
	}

	/**
	 * The schema of a successful answer.
	 * @param answer One record, a list or a page of them.
	 * @returns The JSON Schema, pointing at the named model.
	 */
	static #answerSchema(answer: Exclude<ApiAnswer<string>, null>): Json {
		if (typeof answer === "string") return OpenApi.#ref(answer);
		if ("list" in answer)
			return { type: "array", items: OpenApi.#ref(answer.list) };
		const count = { type: "integer" };
		return {
			type: "object",
			required: ["data", "total", "page", "per_page", "last_page"],
			properties: {
				data: { type: "array", items: OpenApi.#ref(answer.paged) },
				total: { ...count, description: "Rows in the whole list." },
				page: count,
				per_page: count,
				last_page: count,
			},
		};
	}

	/**
	 * The `parameters` of a route:
	 * the `:name` parts of its path, then its query string.
	 * @param doc The route's docs.
	 * @returns OpenAPI parameter objects.
	 */
	static #parameters(doc: ApiDoc) {
		const path = OpenApi.pathParams(doc.path).map(function param(name) {
			return {
				name,
				in: "path",
				required: true,
				schema: { type: "integer" },
			};
		});
		if (!doc.query) return path;
		const q = OpenApi.schemaOf(doc.query, "input");
		const required = (q.required as string[] | undefined) ?? [];
		const query = Object.entries((q.properties as Json | undefined) ?? {}).map(
			function param([name, s]) {
				const { description, ...schema } = s as Json;
				return {
					name,
					in: "query",
					required: required.includes(name),
					...(description ? { description } : {}),
					schema,
				};
			},
		);
		return [...path, ...query];
	}

	/**
	 * The error answers a route can give.
	 * @param doc The route's docs.
	 * @returns OpenAPI responses by status.
	 */
	static #errorAnswers(doc: ApiDoc) {
		const types: ApiErrorType[] = ["unauthorized"];
		if (doc.role !== ROLES[ROLES.length - 1]) types.push("forbidden");
		if (doc.path.includes(":")) types.push("not_found");
		if (doc.body || doc.query || doc.method !== "get")
			types.push("validation_error");
		types.push("rate_limited");
		return Object.fromEntries(
			types.map(function answer(type) {
				return [
					String(API_ERROR_STATUS[type]),
					{
						description: ERROR_TEXT[type],
						content: { "application/json": { schema: OpenApi.#ref("Error") } },
					},
				];
			}),
		);
	}

	/**
	 * One route as an OpenAPI operation.
	 * @param doc The route's docs.
	 * @returns The operation object.
	 */
	static #operation(doc: ApiDoc) {
		const status = String(doc.status ?? 200);
		const needs = `Needs a key with the role **${doc.role}**${doc.role === ROLES[0] ? "" : " or above"}.`;
		return {
			operationId: `${doc.method}${doc.path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
			tags: [doc.tag],
			summary: doc.summary,
			description: doc.description ? `${doc.description}\n\n${needs}` : needs,
			parameters: OpenApi.#parameters(doc),
			...(doc.body && {
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: OpenApi.schemaOf(doc.body, "input"),
							...(doc.example !== undefined && { example: doc.example }),
						},
					},
				},
			}),
			responses: {
				[status]: doc.answer
					? {
							description: "OK",
							content: {
								"application/json": {
									schema: OpenApi.#answerSchema(doc.answer),
								},
							},
						}
					: { description: "OK" },
				...OpenApi.#errorAnswers(doc),
			},
		};
	}
}
