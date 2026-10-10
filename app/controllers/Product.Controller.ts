import { ctx } from "@xcore/http/Context";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { back, inertia, redirect } from "@xcore/view/Inertia";
import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { CategoryService } from "@services/catalog/Category.Service";
import { ProductCsvService } from "@services/catalog/ProductCsv.Service";
import { ProductService } from "@services/catalog/Product.Service";
import { slugify } from "@helpers/slug";
import {
	ProductCategoriesInput,
	ProductInput,
} from "@validators/Product.Validator";
import { validate, type Errors } from "@validators/validate";
import { CSV_MAX_BYTES, PRODUCT_SORTS } from "@constants/Product.Constant";

/**
 * Admin-only catalogue management.
 * It includes the Universal POS Product CSV v1 import and export.
 * ponytail: validation errors are rendered straight back as props
 * (no session/flash layer).
 */
@Service()
export class ProductController {
	constructor(
		private products: ProductService,
		private categories: CategoryService,
		private csv: ProductCsvService,
	) {}

	/**
	 * GET /products?q=&category=&sort=&dir=&page= — the product list.
	 * `category` = a category id. 0 or absent = every category.
	 * `sort` = one of PRODUCT_SORTS, `dir` = asc | desc.
	 * Anything else = the normal order.
	 * @param req The current request.
	 * @returns The Products/Index page.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		const q = new Query(req);
		const filters = {
			q: q.text("q"),
			category: Math.max(0, Number(q.raw("category")) || 0),
			sort: Paginate.sort(req, PRODUCT_SORTS),
		};
		const { page, perPage } = Paginate.params(req, "products");
		return inertia(req, "Products/Index", {
			products: await this.products.page(shop.id, filters.q, page, perPage, {
				category: filters.category,
				sold: true,
				sort: filters.sort,
			}),
			filters,
			categories: await this.categories.list(shop.id),
		});
	}

	/**
	 * GET /products/export — Universal POS Product CSV v1 download
	 * of the whole catalogue.
	 * @param req The current request.
	 * @returns The CSV as a file download.
	 */
	async exportCsv(req: Request) {
		const { shop } = ctx(req);
		const csv = await this.csv.export(shop.id, shop.currency);
		const name = `products-${slugify(shop.name) || "shop"}.csv`;
		return new Response(csv, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename="${name}"`,
			},
		});
	}

	/**
	 * POST /products/import — multipart field "file".
	 * It re-renders the list with `import_result`,
	 * the same pattern as failed form posts.
	 * @param req The current request.
	 * @returns The Products/Index page carrying the import result.
	 */
	async importCsv(req: Request) {
		const { shop, user } = ctx(req);
		const file = (await HttpRequest.formOf(req))?.get("file");
		const result = !(file instanceof File)
			? { created: 0, errors: [t("server.csv_pick_file")] }
			: file.size > CSV_MAX_BYTES
				? { created: 0, errors: [t("server.csv_too_large")] }
				: await this.csv.import(
						shop.id,
						shop.currency,
						await file.text(),
						user.id,
					);
		return this.#listWith(req, shop.id, { import_result: result });
	}

	/**
	 * GET /products/create — the empty product form.
	 * @param req The current request.
	 * @returns The Products/Form page.
	 */
	async create(req: Request) {
		return this.#form(req, ctx(req).shop.id, null);
	}

	/**
	 * POST /products — create a product.
	 * @param req The current request.
	 * @returns A redirect to its edit page (the form becomes it),
	 *   or the form with errors.
	 */
	async store(req: Request) {
		const { shop, user } = ctx(req);
		const v = validate(ProductInput, await HttpRequest.body(req));
		const errors =
			v.errors ?? (await this.products.createErrors(shop.id, v.data));
		if (errors || !v.data) return this.#form(req, shop.id, null, { errors });
		const created = await this.products.create(shop.id, v.data, user.id);
		// stay on the product: the form becomes its edit page
		return redirect(`/products/${created.id}/edit`);
	}

	/**
	 * GET /products/:id/edit — the product form
	 * with a stored product loaded.
	 * @param req The current request.
	 * @returns The Products/Form page, or 404.
	 */
	async edit(req: BunRequest<"/products/:id/edit">) {
		const { shop } = ctx(req);
		const product = await this.products.find(HttpRequest.idOf(req), shop.id);
		if (!product) return HttpResponse.notFoundText();
		return this.#form(req, shop.id, product);
	}

	/**
	 * PUT /products/:id — overwrite a product.
	 * @param req The current request.
	 * @returns Back to the form (the page toasts the result),
	 *   the form with errors, or 404.
	 */
	async update(req: BunRequest<"/products/:id">) {
		const { shop, user } = ctx(req);
		const id = HttpRequest.idOf(req);
		const v = validate(ProductInput, await HttpRequest.body(req));
		const errors =
			v.errors ?? (await this.products.updateErrors(id, shop.id, v.data));
		if (errors || !v.data) {
			const product = await this.products.find(id, shop.id);
			return this.#form(req, shop.id, product, { errors });
		}
		if (!(await this.products.update(id, shop.id, v.data, user.id)))
			return HttpResponse.notFoundText();
		// stay on the form; the page toasts the result
		return back(req);
	}

	/**
	 * POST /products/:id/featured — the star toggle on the list.
	 * No validation layer: the flag is the whole payload.
	 * @param req The current request.
	 * @returns Back to where it was posted from.
	 */
	async featured(req: BunRequest<"/products/:id/featured">) {
		const { shop } = ctx(req);
		const { featured } = ((await HttpRequest.body(req)) ?? {}) as {
			featured?: boolean;
		};
		await this.products.setFeatured(HttpRequest.idOf(req), shop.id, !!featured);
		return back(req);
	}

	/**
	 * POST /products/categories — the list's bulk action.
	 * It adds the picked categories to the picked products.
	 * The products keep the categories they already have.
	 * @param req The current request.
	 * @returns Back to the list.
	 */
	async addCategories(req: Request) {
		const { shop } = ctx(req);
		const v = validate(ProductCategoriesInput, await HttpRequest.body(req));
		// ponytail: the dialog never sends an empty pick,
		// so a bad body just goes back unchanged
		if (v.data)
			await this.products.addCategories(
				shop.id,
				v.data.product_ids,
				v.data.category_ids,
			);
		return back(req);
	}

	/**
	 * POST /products/:id/active — the on/off switch on the list.
	 * Off hides the product from the POS and the online store.
	 * @param req The current request.
	 * @returns Back to where it was posted from.
	 */
	async active(req: BunRequest<"/products/:id/active">) {
		const { shop } = ctx(req);
		const { active } = ((await HttpRequest.body(req)) ?? {}) as {
			active?: boolean;
		};
		await this.products.setActive(HttpRequest.idOf(req), shop.id, !!active);
		return back(req);
	}

	/**
	 * DELETE /products/:id — delete a product.
	 * A refusal (the product is inside a package) re-renders
	 * the list with the message, like ShopController.destroy.
	 * @param req The current request.
	 * @returns A redirect to the list, or the list with the refusal on it.
	 */
	async destroy(req: BunRequest<"/products/:id">) {
		const { shop } = ctx(req);
		const error = await this.products.remove(HttpRequest.idOf(req), shop.id);
		if (error)
			return this.#listWith(req, shop.id, { errors: { product: error } });
		return redirect("/products");
	}

	/**
	 * The create/edit form.
	 * Next to the product it gets the categories
	 * and everything a package may contain.
	 * @param req The current request.
	 * @param shopId Active shop.
	 * @param product The stored product, or null for a new one.
	 * @param extra `{ errors }` after a failed save. Left out otherwise.
	 * @returns The Products/Form page.
	 */
	async #form(
		req: Request,
		shopId: number,
		product: unknown,
		extra?: { errors: Errors | null | undefined },
	) {
		return inertia(req, "Products/Form", {
			product,
			categories: await this.categories.list(shopId),
			components: await this.products.components(shopId),
			...extra,
		});
	}

	/**
	 * The product list without filters, with a message on it.
	 * A CSV import and a refused delete end here.
	 * @param req The current request.
	 * @param shopId Active shop.
	 * @param extra The message: `import_result` or `errors`.
	 * @returns The Products/Index page.
	 */
	async #listWith(
		req: Request,
		shopId: number,
		extra: Record<string, unknown>,
	) {
		const { page, perPage } = Paginate.params(req, "products");
		return inertia(req, "Products/Index", {
			products: await this.products.page(shopId, "", page, perPage, {
				sold: true,
			}),
			filters: { q: "", category: 0, sort: null },
			...extra,
		});
	}
}
