import { t } from "@xcore/i18n/I18n";

/**
 * The plain answers a handler gives.
 * `json()` is the everyday one and stays a plain function.
 */
export class HttpResponse {
	/**
	 * An HTML answer.
	 * @param body The page.
	 * @param status The HTTP status. 200 when left out.
	 * @returns The response.
	 */
	static html(body: string, status = 200) {
		return new Response(body, {
			status,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}

	/**
	 * The JSON answer to a refused input: `{ errors }` with status 422.
	 * The pages' own scripts read this shape. The REST API uses `invalid()`.
	 * @param errors The message per field.
	 * @returns The response.
	 */
	static unprocessable(errors: Record<string, string>) {
		return json({ errors }, 422);
	}

	/**
	 * A plain-text "not found" answer (404).
	 * For a record that is not in this shop.
	 * @returns The response.
	 */
	static notFoundText() {
		// the type is named: without one a browser offers the answer as a download
		return new Response(t("server.not_found"), {
			status: 404,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
}

/**
 * A JSON answer.
 * @param data What to send.
 * @param status The HTTP status. 200 when left out.
 * @returns The response.
 */
export function json(data: unknown, status = 200) {
	return Response.json(data, { status });
}
