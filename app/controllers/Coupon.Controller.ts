import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse } from "@xcore/http/Response";
import { back, inertia, redirect } from "@xcore/view/Inertia";
import { CouponService } from "@services/sales/Coupon.Service";
import { CategoryService } from "@services/catalog/Category.Service";
import { ProductRepository } from "@repositories/Product.Repository";
import { CouponInput } from "@validators/Coupon.Validator";
import { validate, type Errors } from "@validators/validate";
import type { CouponSort } from "@constants/Coupon.Constant";

/**
 * Discount codes of the active shop (admin only).
 */
@Service()
export class CouponController {
	constructor(
		private coupons: CouponService,
		private categories: CategoryService,
		private products: ProductRepository,
	) {}

	/**
	 * GET /coupons?q=&sort=&page= — the totals and the list.
	 * It also has the products and categories the scope picker offers.
	 * @param req The current request.
	 * @param errors Inertia errors to show (a failed save re-renders
	 *   through here).
	 * @returns The Coupons/Index page.
	 */
	async index(req: Request, errors?: Errors) {
		const { shop } = ctx(req);
		const q = new Query(req);
		const filters = {
			q: q.text("q"),
			sort: (q.raw("sort") === "used" ? "used" : "") as CouponSort,
		};
		const { page, perPage } = Paginate.params(req, "coupons");
		return inertia(req, "Coupons/Index", {
			coupons: await this.coupons.page(
				shop.id,
				filters.q,
				filters.sort,
				page,
				perPage,
			),
			summary: await this.coupons.summary(shop.id),
			filters,
			products: (await this.products.allForShop(shop.id)).map((p) =>
				this.#productOption(p),
			),
			categories: await this.categories.list(shop.id),
			...(errors && { errors }),
		});
	}

	/**
	 * GET /coupons/:id?page= — the code's history.
	 * It shows how often it was used, what it gave away,
	 * and every order that used it.
	 * @param req The current request.
	 * @returns The Coupons/Show page, or 404.
	 */
	async show(req: BunRequest<"/coupons/:id">) {
		const { shop } = ctx(req);
		const coupon = await this.coupons.find(HttpRequest.idOf(req), shop.id);
		if (!coupon) return HttpResponse.notFoundText();
		const { page, perPage } = Paginate.params(req, "coupon_history");
		return inertia(req, "Coupons/Show", {
			coupon,
			history: await this.coupons.history(coupon.id, shop.id, page, perPage),
		});
	}

	/**
	 * POST /coupons — add a code.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async store(req: Request) {
		const { shop } = ctx(req);
		const v = validate(CouponInput, await HttpRequest.body(req));
		const r = v.errors
			? { errors: v.errors }
			: await this.coupons.create(shop.id, v.data);
		return this.#done(req, r.errors);
	}

	/**
	 * PUT /coupons/:id — edit a code.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async update(req: BunRequest<"/coupons/:id">) {
		const { shop } = ctx(req);
		const v = validate(CouponInput, await HttpRequest.body(req));
		const r = v.errors
			? { errors: v.errors }
			: await this.coupons.update(HttpRequest.idOf(req), shop.id, v.data);
		return this.#done(req, r.errors);
	}

	/**
	 * DELETE /coupons/:id — remove a code.
	 * Orders that used it keep the code as text.
	 * @param req The current request.
	 * @returns A redirect to the list.
	 */
	async destroy(req: BunRequest<"/coupons/:id">) {
		const { shop } = ctx(req);
		await this.coupons.remove(HttpRequest.idOf(req), shop.id);
		return redirect("/coupons");
	}

	/**
	 * One product as the scope picker lists it.
	 * @param p The product.
	 * @returns `{ id, name }`.
	 */
	#productOption(p: { id: number; name: string }) {
		return { id: p.id, name: p.name };
	}

	/**
	 * The answer after a save.
	 * @param req The current request.
	 * @param errors What was refused, if anything.
	 * @returns Back to the list, or the list with errors.
	 */
	#done(req: Request, errors?: Errors) {
		return errors ? this.index(req, errors) : back(req, "/coupons");
	}
}
