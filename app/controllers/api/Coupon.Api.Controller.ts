import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { CouponService } from "@services/sales/Coupon.Service";
import { CouponInput } from "@validators/Coupon.Validator";
import { CouponQuery, PageQuery } from "@validators/ApiQuery.Validator";
import { ApiController } from "./Api.Controller";

/**
 * API: the discount codes of the key's shop.
 */
@Service()
export class CouponApiController extends ApiController<object> {
	constructor(private coupons: CouponService) {
		super();
	}

	/**
	 * GET /coupons?q=&sort=&page=&per_page= — one page of codes with how often
	 * each was used.
	 * @param req The current request.
	 * @returns A page of coupons.
	 */
	async index(req: Request) {
		const v = ApiResponse.query(req, CouponQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		const f = v.data;
		return json(
			await this.coupons.page(
				ctx(req).shop.id,
				f.q,
				f.sort,
				f.page,
				f.per_page,
			),
		);
	}

	/**
	 * GET /coupons/:id — one code with its usage.
	 * @param req The current request.
	 * @returns The coupon, or 404.
	 */
	async show(req: BunRequest) {
		const coupon = await this.coupons.find(
			HttpRequest.idOf(req),
			ctx(req).shop.id,
		);
		return coupon ? json(coupon) : ApiResponse.notFound();
	}

	/**
	 * GET /coupons/:id/redemptions?page=&per_page= — the orders that used a
	 * code, newest first.
	 * @param req The current request.
	 * @returns A page of redemptions, 404 or 422.
	 */
	async redemptions(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const v = ApiResponse.query(req, PageQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		return json(
			await this.coupons.history(id, shop.id, v.data.page, v.data.per_page),
		);
	}

	/**
	 * POST /coupons — add a code.
	 * @param req The current request.
	 * @returns 201 with the coupon, or 422.
	 */
	async store(req: Request) {
		const data = await this.input(req, CouponInput);
		if (data instanceof Response) return data;
		const r = await this.coupons.create(ctx(req).shop.id, data);
		return r.errors
			? ApiResponse.invalid(r.errors)
			: ApiResponse.created(r.coupon);
	}

	/**
	 * PUT /coupons/:id — edit a code. Send the whole coupon.
	 * @param req The current request.
	 * @returns The coupon, 404 or 422.
	 */
	async update(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, CouponInput);
		if (data instanceof Response) return data;
		const r = await this.coupons.update(id, shop.id, data);
		return r.errors ? ApiResponse.invalid(r.errors) : json(r.coupon);
	}

	/**
	 * DELETE /coupons/:id — delete a code.
	 * Orders that used it keep the code as text.
	 * @param req The current request.
	 * @returns `{ deleted, id }`, or 404.
	 */
	async destroy(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		await this.coupons.remove(id, shop.id);
		return ApiResponse.deleted(id);
	}

	/**
	 * One coupon of a shop.
	 * @param id The record's id.
	 * @param shopId The key's shop.
	 * @returns The coupon, or nothing when the shop has none with this id.
	 */
	protected find(id: number, shopId: number) {
		return this.coupons.find(id, shopId);
	}
}
