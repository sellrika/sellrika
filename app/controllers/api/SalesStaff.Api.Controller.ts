import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { ReportService } from "@services/sales/Report.Service";
import { SalesStaffService } from "@services/settings/SalesStaff.Service";
import { SalesStaffInput } from "@validators/SalesStaff.Validator";
import { ApiController } from "./Api.Controller";

/**
 * API: the sales staff of the key's shop.
 * They are people named on a sale, with a commission and no login.
 */
@Service()
export class SalesStaffApiController extends ApiController<object> {
	constructor(private staff: SalesStaffService) {
		super();
	}

	/**
	 * GET /sales-staff — every sales person with their sales count and the
	 * commission due.
	 * @param req The current request.
	 * @returns The sales staff, A–Z.
	 */
	async index(req: Request) {
		return json(await this.staff.list(ctx(req).shop.id));
	}

	/**
	 * GET /sales-staff/:id?preset=&from=&to= — one sales person:
	 * what they sold in a period, and their payments.
	 * The period is read like the one of the report.
	 * @param req The current request.
	 * @returns `{ person, period, totals, payments }`, or 404.
	 */
	async show(req: BunRequest) {
		const { shop } = ctx(req);
		const q = ReportService.resolveQuery(
			new URL(req.url).searchParams,
			shop.timezone,
		);
		const detail = await this.staff.detail(
			HttpRequest.idOf(req),
			shop.id,
			shop.timezone,
			q,
		);
		if (!detail) return ApiResponse.notFound();
		return json({
			...detail,
			period: { preset: q.preset, from: q.from, to: q.to },
		});
	}

	/**
	 * POST /sales-staff — add a sales person.
	 * @param req The current request.
	 * @returns 201 with the sales person, or 422.
	 */
	async store(req: Request) {
		const data = await this.input(req, SalesStaffInput);
		if (data instanceof Response) return data;
		const r = await this.staff.create(ctx(req).shop.id, data);
		return r.errors
			? ApiResponse.invalid(r.errors)
			: ApiResponse.created(r.staff);
	}

	/**
	 * PUT /sales-staff/:id — change the name, commission or active switch.
	 * @param req The current request.
	 * @returns The sales person, 404 or 422.
	 */
	async update(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, SalesStaffInput);
		if (data instanceof Response) return data;
		const errors = await this.staff.update(id, shop.id, data);
		return errors
			? ApiResponse.invalid(errors)
			: json(await this.staff.find(id, shop.id));
	}

	/**
	 * POST /sales-staff/:id/pay — pay the commission due:
	 * one row in the history, and the count starts again.
	 * @param req The current request.
	 * @returns The sales person after the payment, 404, or 422 when nothing is due.
	 */
	async pay(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const errors = await this.staff.pay(id, shop.id);
		return errors
			? ApiResponse.invalid(errors)
			: json(await this.staff.find(id, shop.id));
	}

	/**
	 * DELETE /sales-staff/:id — delete a sales person and their payment
	 * history.
	 * Their sales stay.
	 * @param req The current request.
	 * @returns `{ deleted, id }`, or 404.
	 */
	async destroy(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const errors = await this.staff.remove(id, shop.id);
		return errors ? ApiResponse.invalid(errors) : ApiResponse.deleted(id);
	}

	/**
	 * One sales person of a shop.
	 * @param id The record's id.
	 * @param shopId The key's shop.
	 * @returns The sales person, or nothing when the shop has none with this id.
	 */
	protected find(id: number, shopId: number) {
		return this.staff.find(id, shopId);
	}
}
