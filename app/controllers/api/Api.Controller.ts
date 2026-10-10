import type { BunRequest } from "bun";
import type { z } from "zod";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { validate } from "@validators/validate";

/**
 * The steps every API controller of one record type shares.
 * A subclass says how to find its record (`find`).
 * This class then answers 404 for a record that is not in the
 * key's shop, and 422 for a refused body.
 * The 404 always comes before the 422.
 */
export abstract class ApiController<T> {
	/**
	 * One record of a shop.
	 * @param id The record's id.
	 * @param shopId The key's shop.
	 * @returns The record, or nothing when the shop has no such record.
	 */
	protected abstract find(
		id: number,
		shopId: number,
	): Promise<T | null | undefined>;

	/**
	 * The record the route's `:id` names, in the key's shop.
	 * @param req The current request.
	 * @returns `{ id, row }`, or the 404 answer.
	 */
	protected async owned(
		req: BunRequest,
	): Promise<{ id: number; row: T } | Response> {
		const id = HttpRequest.idOf(req);
		const row = await this.find(id, ctx(req).shop.id);
		return row ? { id, row } : ApiResponse.notFound();
	}

	/**
	 * The request body, checked with a zod schema.
	 * @param req The current request.
	 * @param schema The body's schema.
	 * @returns The parsed body, or the 422 answer.
	 */
	protected async input<S extends z.ZodType>(
		req: Request,
		schema: S,
	): Promise<z.infer<S> | Response> {
		const v = validate(schema, await HttpRequest.body(req));
		return v.errors ? ApiResponse.invalid(v.errors) : v.data;
	}
}
