import type { BunRequest } from "bun";
import { type ApiDoc, apiDocs, OpenApi } from "@xcore/api/OpenApi";
import { Context } from "@xcore/http/Context";
import { API_PREFIX } from "@constants/Api.Constant";
import type { User } from "@models/User";
import type { Shop } from "@models/Shop";

/**
 * The REST API as plain functions, for code inside the app.
 * Extensions get them in their route and listener context:
 * `products.create(input)`, `orders.pay(id, { amount })`,
 * `stock.adjust(input)`…
 * Like the MCP server, nothing is written twice.
 * Every function is built from the API's own route list (`apiDocs`)
 * and runs that route's own handler.
 * So the controller, the validators and the service classes are the API's.
 * Only the key check is skipped. The role check is not.
 */

/**
 * An API function that was refused.
 * It carries what the API's error body carries.
 */
export class ApiCallError extends Error {
	override name = "ApiError";
	/**
	 * @param status The HTTP status the route answered (403, 404, 422…).
	 * @param type The API's error type
	 *   (`forbidden`, `not_found`, `validation_error`…).
	 * @param message The reason, in the request's language.
	 * @param fields For a refused input: the message per field.
	 */
	constructor(
		public status: number,
		public type: string,
		message: string,
		public fields?: Record<string, string>,
	) {
		super(message);
	}
}

/** Who a function is called as, and in which shop. Asked on each call. */
export type ApiCaller = () => Promise<{ user: User; shop: Shop }>;

/**
 * One API route as a function.
 * The path's ids come first, then one object
 * (the body, or the query of a read).
 */
export type ApiFunction = (...args: unknown[]) => Promise<unknown>;

/**
 * The REST API as plain functions, for code inside the app.
 */
export class ApiCall {
	/**
	 * Every API route as a function, grouped by area:
	 * `{ products: { list, get, create, … }, orders: { … }, … }`.
	 * The names come from each route's `fn` (`routes/api.ts`).
	 * So a new API route is a new function with no other change.
	 * @param caller Who the functions are called as.
	 * @returns The groups.
	 */
	static functions(
		caller: ApiCaller,
	): Record<string, Record<string, ApiFunction>> {
		const groups: Record<string, Record<string, ApiFunction>> = {};
		for (const doc of apiDocs) {
			if (!doc.fn || !doc.run) continue;
			const [group, name] = doc.fn.split(".") as [string, string];
			(groups[group] ??= {})[name] = async function call(...args: unknown[]) {
				return ApiCall.#run(await caller(), doc, args);
			};
		}
		return groups;
	}

	/**
	 * Run one API route as a user of a shop.
	 * @param caller Who is asking and in which shop.
	 *   The role of `user` decides what is allowed.
	 * @param doc The route.
	 * @param args The values of the path's `:name` parts in order,
	 *   then the body (or, for a route with no body, the query).
	 * @returns The route's JSON answer.
	 *   A read of one record that is not there gives null.
	 * @throws ApiCallError when the route refuses
	 *   (role too low, not found, input refused).
	 */
	static async #run(
		caller: { user: User; shop: Shop },
		doc: ApiDoc,
		args: unknown[],
	): Promise<unknown> {
		const names = OpenApi.pathParams(doc.path);
		const { path, params } = OpenApi.fillPath(
			doc.path,
			names,
			function arg(_name, i) {
				return args[i];
			},
		);
		const input = args[names.length];
		const url = new URL(`http://app.internal${API_PREFIX}${path}`);
		if (!doc.body)
			for (const [k, v] of Object.entries(input ?? {}))
				if (v !== undefined && v !== null && v !== "")
					url.searchParams.set(k, String(v));
		const req = Object.assign(
			new Request(url, {
				method: doc.method.toUpperCase(),
				headers: { "Content-Type": "application/json" },
				...(doc.body && { body: JSON.stringify(input ?? {}) }),
			}),
			{ params },
		) as unknown as BunRequest;
		Context.set(req, caller);
		const res = await doc.run!(req);
		const text = await res.text();
		const answer = text ? JSON.parse(text) : null;
		if (res.status < 400) return answer;
		// reading one record that is gone is an answer, not a failure
		if (res.status === 404 && doc.method === "get" && names.length) return null;
		const error = answer?.error ?? {};
		throw new ApiCallError(
			res.status,
			error.type ?? "server_error",
			error.message ?? `${doc.fn} failed (${res.status})`,
			error.fields,
		);
	}
}
