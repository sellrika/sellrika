import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { PaymentMethodService } from "@services/settings/PaymentMethod.Service";
import { PaymentMethodInput } from "@validators/PaymentMethod.Validator";
import { validate } from "@validators/validate";

/**
 * API: the payment methods the till of the key's shop offers.
 */
@Service()
export class PaymentMethodApiController {
	constructor(private methods: PaymentMethodService) {}

	/**
	 * GET /payment-methods — every method, switched on or off.
	 * @param req The current request.
	 * @returns The methods in display order.
	 */
	async index(req: Request) {
		return json(await this.methods.list(ctx(req).shop.id));
	}

	/**
	 * GET /payment-methods/:id — one method.
	 * @param req The current request.
	 * @returns The method, or 404.
	 */
	async show(req: BunRequest) {
		const method = await this.#find(HttpRequest.idOf(req), ctx(req).shop.id);
		return method ? json(method) : ApiResponse.notFound();
	}

	/**
	 * POST /payment-methods — add a method.
	 * @param req The current request.
	 * @returns 201 with the method, or 422.
	 */
	async store(req: Request) {
		const v = validate(PaymentMethodInput, await HttpRequest.body(req));
		if (v.errors) return ApiResponse.invalid(v.errors);
		return ApiResponse.created(
			await this.methods.create(ctx(req).shop.id, v.data),
		);
	}

	/**
	 * PUT /payment-methods/:id — edit a method.
	 * @param req The current request.
	 * @returns The method, 404 or 422.
	 */
	async update(req: BunRequest) {
		const v = validate(PaymentMethodInput, await HttpRequest.body(req));
		if (v.errors) return ApiResponse.invalid(v.errors);
		const method = await this.methods.update(
			HttpRequest.idOf(req),
			ctx(req).shop.id,
			v.data,
		);
		return method ? json(method) : ApiResponse.notFound();
	}

	/**
	 * DELETE /payment-methods/:id — delete a method. A shop keeps at least one.
	 * @param req The current request.
	 * @returns `{ deleted, id }`, 404, or 422 for the last method.
	 */
	async destroy(req: BunRequest) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		if (!(await this.#find(id, shop.id))) return ApiResponse.notFound();
		const error = await this.methods.remove(id, shop.id);
		return error
			? ApiResponse.invalid({ payment_method: error })
			: ApiResponse.deleted(id);
	}

	/**
	 * One payment method of a shop.
	 * @param id Method id.
	 * @param shopId Owning shop.
	 * @returns The method, or undefined.
	 */
	async #find(id: number, shopId: number) {
		const all = await this.methods.list(shopId);
		return all.find(function same(m) {
			return m.id === id;
		});
	}
}
