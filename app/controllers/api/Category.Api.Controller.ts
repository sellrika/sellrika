import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { CategoryService } from "@services/catalog/Category.Service";
import { CategoryInput } from "@validators/Category.Validator";
import { validate } from "@validators/validate";

/**
 * API: the categories of the key's shop.
 */
@Service()
export class CategoryApiController {
	constructor(private categories: CategoryService) {}

	/**
	 * GET /categories — every category, in display order.
	 * @param req The current request.
	 * @returns The categories with their product count.
	 */
	async index(req: Request) {
		return json(await this.categories.list(ctx(req).shop.id));
	}

	/**
	 * GET /categories/:id — one category.
	 * @param req The current request.
	 * @returns The category, or 404.
	 */
	async show(req: BunRequest) {
		const category = await this.#find(HttpRequest.idOf(req), ctx(req).shop.id);
		return category ? json(category) : ApiResponse.notFound();
	}

	/**
	 * POST /categories — add a category.
	 * @param req The current request.
	 * @returns 201 with the category, or 422.
	 */
	async store(req: Request) {
		const { shop } = ctx(req);
		const v = validate(CategoryInput, await HttpRequest.body(req));
		if (v.errors) return ApiResponse.invalid(v.errors);
		const errors = await this.categories.copyImage(shop.id, v.data);
		if (errors) return ApiResponse.invalid(errors);
		return ApiResponse.created(await this.categories.create(shop.id, v.data));
	}

	/**
	 * PUT /categories/:id — change a category's name, colour or picture.
	 * @param req The current request.
	 * @returns The category, 404 or 422.
	 */
	async update(req: BunRequest) {
		const { shop } = ctx(req);
		const v = validate(CategoryInput, await HttpRequest.body(req));
		if (v.errors) return ApiResponse.invalid(v.errors);
		const errors = await this.categories.copyImage(shop.id, v.data);
		if (errors) return ApiResponse.invalid(errors);
		const category = await this.categories.update(
			HttpRequest.idOf(req),
			shop.id,
			v.data,
		);
		return category ? json(category) : ApiResponse.notFound();
	}

	/**
	 * DELETE /categories/:id — delete a category; its products stay.
	 * @param req The current request.
	 * @returns `{ deleted, id }`, or 404.
	 */
	async destroy(req: BunRequest) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		if (!(await this.#find(id, shop.id))) return ApiResponse.notFound();
		await this.categories.remove(id, shop.id);
		return ApiResponse.deleted(id);
	}

	/**
	 * One category of a shop, with its product count.
	 * @param id Category id.
	 * @param shopId Owning shop.
	 * @returns The category, or undefined.
	 */
	async #find(id: number, shopId: number) {
		const all = await this.categories.list(shopId);
		return all.find(function same(c) {
			return c.id === id;
		});
	}
}
