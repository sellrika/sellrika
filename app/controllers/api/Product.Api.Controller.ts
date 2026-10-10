import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { ProductService } from "@services/catalog/Product.Service";
import { ProductInput } from "@validators/Product.Validator";
import { ProductQuery } from "@validators/ApiQuery.Validator";
import { ApiController } from "./Api.Controller";

/**
 * API: the products of the key's shop.
 * Every rule of the product form applies.
 */
@Service()
export class ProductApiController extends ApiController<object> {
	constructor(private products: ProductService) {
		super();
	}

	/**
	 * GET /products?q=&category=&sort=&dir=&page=&per_page= — one page of products.
	 * @param req The current request.
	 * @returns A page of products with variants, categories and units sold.
	 */
	async index(req: Request) {
		const v = ApiResponse.query(req, ProductQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		const f = v.data;
		return json(
			await this.products.page(ctx(req).shop.id, f.q, f.page, f.per_page, {
				category: f.category ?? null,
				sold: true,
				sort: f.sort ? { by: f.sort, dir: f.dir } : null,
			}),
		);
	}

	/**
	 * GET /products/:id — one product with its variants, categories and
	 * package slots.
	 * @param req The current request.
	 * @returns The product, or 404.
	 */
	async show(req: BunRequest) {
		const product = await this.products.find(
			HttpRequest.idOf(req),
			ctx(req).shop.id,
		);
		return product ? json(product) : ApiResponse.notFound();
	}

	/**
	 * POST /products — create a product.
	 * An `https://` image link is copied into our storage.
	 * @param req The current request.
	 * @returns 201 with the product, or 422.
	 */
	async store(req: Request) {
		const { shop, user } = ctx(req);
		const data = await this.input(req, ProductInput);
		if (data instanceof Response) return data;
		const errors = await this.products.createErrors(shop.id, data);
		if (errors) return ApiResponse.invalid(errors);
		const made = await this.products.create(shop.id, data, user.id);
		return ApiResponse.created(await this.products.find(made.id, shop.id));
	}

	/**
	 * PUT /products/:id — overwrite a product.
	 * Send the whole product, like the form does.
	 * A variant sent with its `id` is kept; one left out is deleted.
	 * @param req The current request.
	 * @returns The product, 404 or 422.
	 */
	async update(req: BunRequest) {
		const { shop, user } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, ProductInput);
		if (data instanceof Response) return data;
		const errors = await this.products.updateErrors(id, shop.id, data);
		if (errors) return ApiResponse.invalid(errors);
		await this.products.update(id, shop.id, data, user.id);
		return json(await this.products.find(id, shop.id));
	}

	/**
	 * DELETE /products/:id — delete a product. Refused while a package contains it.
	 * @param req The current request.
	 * @returns `{ deleted, id }`, 404 or 422.
	 */
	async destroy(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const error = await this.products.remove(id, shop.id);
		return error
			? ApiResponse.invalid({ product: error })
			: ApiResponse.deleted(id);
	}

	/**
	 * One product of a shop.
	 * @param id The record's id.
	 * @param shopId The key's shop.
	 * @returns The product, or nothing when the shop has none with this id.
	 */
	protected find(id: number, shopId: number) {
		return this.products.find(id, shopId);
	}
}
