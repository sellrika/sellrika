import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { back, inertia } from "@xcore/view/Inertia";
import { PaymentMethodService } from "@services/settings/PaymentMethod.Service";
import { PaymentMethodInput } from "@validators/PaymentMethod.Validator";
import { validate, type Errors } from "@validators/validate";

/**
 * Admin-only payment method management (per shop).
 */
@Service()
export class PaymentMethodController {
	constructor(private methods: PaymentMethodService) {}

	/**
	 * GET /payment-methods — the method list.
	 * @param req The current request.
	 * @returns The PaymentMethods/Index page.
	 */
	index(req: Request) {
		return this.#page(req, ctx(req).shop.id);
	}

	/**
	 * POST /payment-methods — add a method.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async store(req: Request) {
		const { shop } = ctx(req);
		const v = validate(PaymentMethodInput, await HttpRequest.body(req));
		if (v.errors) return this.#page(req, shop.id, v.errors);
		await this.methods.create(shop.id, v.data);
		return back(req, "/payment-methods");
	}

	/**
	 * PUT /payment-methods/:id — edit a method.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async update(req: BunRequest<"/payment-methods/:id">) {
		const { shop } = ctx(req);
		const v = validate(PaymentMethodInput, await HttpRequest.body(req));
		if (v.errors) return this.#page(req, shop.id, v.errors);
		await this.methods.update(HttpRequest.idOf(req), shop.id, v.data);
		return back(req, "/payment-methods");
	}

	/**
	 * DELETE /payment-methods/:id — delete a method, unless it's the shop's
	 * last one.
	 * @param req The current request.
	 * @returns Back to the list, or the list with the refusal on it.
	 */
	async destroy(req: BunRequest<"/payment-methods/:id">) {
		const { shop } = ctx(req);
		const err = await this.methods.remove(HttpRequest.idOf(req), shop.id);
		return err
			? this.#page(req, shop.id, { delete: err })
			: back(req, "/payment-methods");
	}

	/**
	 * Render the method list, optionally with form errors on it.
	 * @param req The current request.
	 * @param shopId Active shop.
	 * @param errors Inertia errors to show, if any.
	 *   Never `{}`: that would clobber the defaults.
	 * @returns The PaymentMethods/Index page.
	 */
	async #page(req: Request, shopId: number, errors?: Errors) {
		return inertia(req, "PaymentMethods/Index", {
			methods: await this.methods.list(shopId),
			...(errors && { errors }),
		});
	}
}
