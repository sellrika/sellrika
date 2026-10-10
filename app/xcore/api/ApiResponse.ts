import type { z } from "zod";
import { json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { validate, type Errors } from "@validators/validate";

/**
 * Every way an API call can fail.
 * The `type` is for programs, the `message` for people.
 * `validation_error` also carries `fields`: one message per input field.
 */
export const API_ERROR_STATUS = {
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	validation_error: 422,
	rate_limited: 429,
	server_error: 500,
} as const;
/** The name of one way an API call can fail. */
export type ApiErrorType = keyof typeof API_ERROR_STATUS;

/**
 * The answers of the REST API, always in the same shape,
 * and the reader of its query strings.
 */
export class ApiResponse {
	/**
	 * An API error, always the same shape:
	 * `{ error: { type, message, fields? } }`.
	 * @param type What went wrong. It decides the HTTP status.
	 * @param message The reason, in the caller's language.
	 * @param fields For a refused input: the message per field.
	 * @returns The JSON response.
	 */
	static error(type: ApiErrorType, message: string, fields?: Errors) {
		const res = json(
			{ error: { type, message, ...(fields && { fields }) } },
			API_ERROR_STATUS[type],
		);
		// tells a client which kind of key the 401 wants
		// (the MCP server takes this header off again)
		if (type === "unauthorized") res.headers.set("WWW-Authenticate", "Bearer");
		return res;
	}

	/**
	 * The answer to a refused input (422).
	 * The top message is the first field's message.
	 * So a caller who shows only one line shows a useful one.
	 * @param fields The message per field.
	 * @returns The JSON response.
	 */
	static invalid(fields: Errors) {
		return ApiResponse.error(
			"validation_error",
			Object.values(fields)[0] ?? "",
			fields,
		);
	}

	/**
	 * The answer for a record that is not in this shop (404).
	 * @returns The JSON response.
	 */
	static notFound() {
		return ApiResponse.error("not_found", t("server.not_found"));
	}

	/**
	 * The answer to a create (201).
	 * @param data The new record.
	 * @returns The JSON response.
	 */
	static created(data: unknown) {
		return json(data, 201);
	}

	/**
	 * The answer to a delete.
	 * @param id The id of the record that is gone.
	 * @returns The JSON response.
	 */
	static deleted(id: number) {
		return json({ deleted: true, id });
	}

	/**
	 * Read the query string with a zod object.
	 * @param req The current request.
	 * @param schema The query's schema.
	 *   Numbers and switches are coerced from text.
	 * @returns `{data}`, or `{errors}` for a 422.
	 */
	static query<T extends z.ZodType>(req: Request, schema: T) {
		return validate(
			schema,
			Object.fromEntries(new URL(req.url).searchParams.entries()),
		);
	}
}
