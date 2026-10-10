import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { back, inertia } from "@xcore/view/Inertia";
import { CategoryService } from "@services/catalog/Category.Service";
import { CategoryInput } from "@validators/Category.Validator";
import { validate, type Errors } from "@validators/validate";

/**
 * Admin-only category management.
 */
@Service()
export class CategoryController {
	constructor(private categories: CategoryService) {}

	/**
	 * GET /categories — the category list.
	 * @param req The current request.
	 * @returns The Categories/Index page.
	 */
	index(req: Request) {
		return this.#page(req, ctx(req).shop.id);
	}

	/**
	 * POST /categories — add a category.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async store(req: Request) {
		const { shop } = ctx(req);
		const v = validate(CategoryInput, await HttpRequest.body(req));
		if (v.errors) return this.#page(req, shop.id, v.errors);
		const errors = await this.categories.copyImage(shop.id, v.data);
		if (errors) return this.#page(req, shop.id, errors);
		await this.categories.create(shop.id, v.data);
		return back(req, "/categories");
	}

	/**
	 * PUT /categories/:id — change a category's name, colour or picture.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async update(req: BunRequest<"/categories/:id">) {
		const { shop } = ctx(req);
		const v = validate(CategoryInput, await HttpRequest.body(req));
		if (v.errors) return this.#page(req, shop.id, v.errors);
		const errors = await this.categories.copyImage(shop.id, v.data);
		if (errors) return this.#page(req, shop.id, errors);
		await this.categories.update(HttpRequest.idOf(req), shop.id, v.data);
		return back(req, "/categories");
	}

	/**
	 * DELETE /categories/:id — delete a category; its products stay.
	 * @param req The current request.
	 * @returns Back to the list.
	 */
	async destroy(req: BunRequest<"/categories/:id">) {
		const { shop } = ctx(req);
		await this.categories.remove(HttpRequest.idOf(req), shop.id);
		return back(req, "/categories");
	}

	/**
	 * Render the category list, optionally with form errors on it.
	 * @param req The current request.
	 * @param shopId Active shop.
	 * @param errors Inertia errors to show, if any.
	 * @returns The Categories/Index page.
	 */
	async #page(req: Request, shopId: number, errors?: Errors) {
		return inertia(req, "Categories/Index", {
			categories: await this.categories.list(shopId),
			...(errors && { errors }),
		});
	}
}
