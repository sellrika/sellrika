import { ctx } from "@xcore/http/Context";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { back, inertia } from "@xcore/view/Inertia";
import { Service } from "@xcore/di";
import { StockService } from "@services/catalog/Stock.Service";
import { StockAdjustInput } from "@validators/Stock.Validator";
import { validate, type Errors } from "@validators/validate";
import { STOCK_FILTERS } from "@constants/Stock.Constant";

/**
 * Admin-only inventory screen.
 */
@Service()
export class StockController {
	constructor(private stock: StockService) {}

	/**
	 * GET /stock?filter=&q=&page= — the tracked units of the active shop.
	 * @param req The current request.
	 * @param errors Inertia errors to show on the page.
	 *   A failed adjustment re-renders through here.
	 * @returns The Stock/Index page.
	 */
	async index(req: Request, errors?: Errors) {
		const { shop } = ctx(req);
		const q = new Query(req);
		const f = q.raw("filter") ?? "all";
		const filters = {
			q: q.text("q"),
			filter: (STOCK_FILTERS.has(f) ? f : "all") as "all" | "low" | "out",
		};
		const { page, perPage } = Paginate.params(req, "stock");
		return inertia(req, "Stock/Index", {
			items: await this.stock.page(
				shop.id,
				filters.filter,
				filters.q,
				page,
				perPage,
			),
			summary: await this.stock.summary(shop.id),
			filters,
			...(errors && { errors }),
		});
	}

	/**
	 * POST /stock/adjust (Inertia) — a manual +/− or "set to" adjustment.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async adjust(req: Request) {
		const { shop, user } = ctx(req);
		const v = validate(StockAdjustInput, await HttpRequest.body(req));
		const errors =
			v.errors ?? (await this.stock.adjust(shop.id, user.id, v.data));
		return errors ? this.index(req, errors) : back(req, "/stock");
	}

	/**
	 * JSON: GET /stock/movements?product_id=&variant_id=&page=
	 * — the ledger of one unit.
	 * @param req The current request.
	 * @returns A paginated movement list, or 422 `{ errors }` without a product.
	 */
	async movements(req: Request) {
		const { shop } = ctx(req);
		const q = new Query(req);
		const productId = Number(q.raw("product_id"));
		const variantId = q.raw("variant_id") ? Number(q.raw("variant_id")) : null;
		if (!productId)
			return HttpResponse.unprocessable({
				product_id: t("server.stock_missing_product"),
			});
		const { page } = Paginate.params(req, "movements");
		return json(
			await this.stock.movements(shop.id, productId, variantId, page, 25),
		);
	}
}
