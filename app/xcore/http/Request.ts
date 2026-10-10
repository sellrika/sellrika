import type { BunRequest } from "bun";

/**
 * Reading a request: its body, its `:id`, its uploaded form.
 */
export class HttpRequest {
	/**
	 * The request body as a plain object.
	 * Inertia and the store scripts send JSON; plain HTML forms on the
	 * public store send form data (url-encoded or multipart).
	 * JSON is read only when the content type says JSON:
	 * a page on another site can send `text/plain` without asking first.
	 * ponytail: a repeated form field keeps only its last value.
	 * @param req The current request.
	 * @returns The parsed body, or {} when it is empty, broken
	 *   or of another content type.
	 */
	static async body(req: Request): Promise<unknown> {
		const type = (req.headers.get("content-type") ?? "").toLowerCase();
		try {
			if (
				type.startsWith("application/x-www-form-urlencoded") ||
				type.startsWith("multipart/form-data")
			)
				return Object.fromEntries((await req.formData()).entries());
			if (!type.startsWith("application/json")) return {};
			return await req.json();
		} catch {
			return {};
		}
	}

	/**
	 * The `:id` of the route, as a number.
	 * @param req The current request.
	 * @returns The id. 0 when it is not a number, which matches no row.
	 */
	static idOf(req: BunRequest) {
		return Number((req.params as Record<string, string>).id) || 0;
	}

	/**
	 * The uploaded form of a request.
	 * @param req The current request.
	 * @returns The form data, or null when the body is not a form.
	 */
	static async formOf(req: Request): Promise<FormData | null> {
		try {
			return await req.formData();
		} catch {
			return null;
		}
	}
}

/**
 * The query string of a request, read the way the list pages need it.
 * A wrong value never fails: it falls back, so an old link still opens.
 * The REST API is strict instead and uses `query()` with a zod schema.
 */
export class Query {
	private params: URLSearchParams;

	/**
	 * @param req The current request.
	 */
	constructor(req: Request) {
		this.params = new URL(req.url).searchParams;
	}

	/**
	 * The raw value, as it was sent.
	 * @param name The parameter name.
	 * @returns The value, or null when it is missing.
	 */
	raw(name: string): string | null {
		return this.params.get(name);
	}

	/**
	 * A text value with the spaces around it removed.
	 * @param name The parameter name.
	 * @returns The text, or "" when it is missing.
	 */
	text(name: string): string {
		return (this.params.get(name) ?? "").trim();
	}

	/**
	 * A record id.
	 * @param name The parameter name.
	 * @returns The number when it is above 0, else null.
	 */
	id(name: string): number | null {
		const n = Number(this.params.get(name));
		return n > 0 ? n : null;
	}

	/**
	 * A value that must be one of a fixed list.
	 * @param name The parameter name.
	 * @param allowed The values the page knows.
	 * @param fallback What a missing or unknown value means.
	 * @returns The value, or the fallback.
	 */
	oneOf<T extends string, F>(
		name: string,
		allowed: readonly T[],
		fallback: F,
	): T | F {
		const v = this.params.get(name) as T;
		return allowed.includes(v) ? v : fallback;
	}
}
