import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { StockService } from "@services/catalog/Stock.Service";
import { StockAdjustInput } from "@validators/Stock.Validator";
import { StockMovementQuery, StockQuery } from "@validators/ApiQuery.Validator";
import { validate } from "@validators/validate";

/**
 * API: the stock of the key's shop.
 * Every change is a row in the ledger.
 */
@Service()
export class StockApiController {
	constructor(private stock: StockService) {}

	/**
	 * GET /stock?q=&filter=&page=&per_page= — one page of tracked units.
	 * @param req The current request.
	 * @returns A page of units with their count.
	 */
	async index(req: Request) {
		const v = ApiResponse.query(req, StockQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		const f = v.data;
		return json(
			await this.stock.page(
				ctx(req).shop.id,
				f.filter,
				f.q,
				f.page,
				f.per_page,
			),
		);
	}

	/**
	 * GET /stock/summary — how many units are tracked, low and out.
	 * @param req The current request.
	 * @returns `{ tracked, low, out }`.
	 */
	async summary(req: Request) {
		return json(await this.stock.summary(ctx(req).shop.id));
	}

	/**
	 * GET /stock/movements?product_id=&variant_id=&page=&per_page= — the
	 * ledger of one unit, newest first.
	 * @param req The current request.
	 * @returns A page of movements, or 422.
	 */
	async movements(req: Request) {
		const v = ApiResponse.query(req, StockMovementQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		const f = v.data;
		return json(
			await this.stock.movements(
				ctx(req).shop.id,
				f.product_id,
				f.variant_id ?? null,
				f.page,
				f.per_page,
			),
		);
	}

	/**
	 * POST /stock/adjustments — add or remove units (`delta`), or set the
	 * count (`set`).
	 * @param req The current request.
	 * @returns 201 `{ product_id, variant_id, stock }` with the new count, or 422.
	 */
	async adjust(req: Request) {
		const { shop, user } = ctx(req);
		const v = validate(StockAdjustInput, await HttpRequest.body(req));
		if (v.errors) return ApiResponse.invalid(v.errors);
		const errors = await this.stock.adjust(shop.id, user.id, v.data);
		if (errors) return ApiResponse.invalid(errors);
		const { product_id, variant_id } = v.data;
		return ApiResponse.created({
			product_id,
			variant_id,
			stock: await this.stock.level(shop.id, product_id, variant_id),
		});
	}
}
