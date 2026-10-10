import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ymd } from "@helpers/time";
import { ReportService } from "@services/sales/Report.Service";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse } from "@xcore/http/Response";
import { back, inertia } from "@xcore/view/Inertia";
import { UserService } from "@services/settings/User.Service";
import { SalesStaffService } from "@services/settings/SalesStaff.Service";
import { EditUserInput, NewUserInput } from "@validators/User.Validator";
import { SalesStaffInput } from "@validators/SalesStaff.Validator";
import { validate, type Errors } from "@validators/validate";

/**
 * Admin-only staff management (see routes/web.ts).
 */
@Service()
export class UserController {
	constructor(
		private users: UserService,
		private salesStaff: SalesStaffService,
	) {}

	/**
	 * GET /users — the staff list.
	 * @param req The current request.
	 * @returns The Users/Index page.
	 */
	index(req: Request) {
		return this.#page(req);
	}

	/**
	 * POST /users — add a staff account.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async store(req: Request) {
		const v = validate(NewUserInput, await HttpRequest.body(req));
		const errors = v.errors ?? (await this.users.create(v.data, ctx(req).user));
		return this.#done(req, errors);
	}

	/**
	 * PUT /users/:id — edit a staff account.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async update(req: BunRequest<"/users/:id">) {
		const v = validate(EditUserInput, await HttpRequest.body(req));
		const errors =
			v.errors ??
			(await this.users.update(HttpRequest.idOf(req), v.data, ctx(req).user));
		return this.#done(req, errors);
	}

	/**
	 * DELETE /users/:id — delete a staff account with no sales history.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async destroy(req: BunRequest<"/users/:id">) {
		const errors = await this.users.remove(
			HttpRequest.idOf(req),
			ctx(req).user,
		);
		return this.#done(req, errors);
	}

	/**
	 * GET /sales-staff/:id?preset=&from=&to= — one sales person.
	 * It shows what they sold in a period, the commission due,
	 * and their payment history.
	 * The period works like the one on /reports.
	 * @param req The current request.
	 * @returns The Users/SalesStaff page, or 404.
	 */
	async showSales(req: BunRequest<"/sales-staff/:id">) {
		const { shop } = ctx(req);
		const query = ReportService.resolveQuery(
			new URL(req.url).searchParams,
			shop.timezone,
		);
		const detail = await this.salesStaff.detail(
			HttpRequest.idOf(req),
			shop.id,
			shop.timezone,
			query,
		);
		if (!detail) return HttpResponse.notFoundText();
		return inertia(req, "Users/SalesStaff", {
			...detail,
			query: { preset: query.preset, from: query.from, to: query.to },
			today: ymd(new Date(), shop.timezone),
		});
	}

	/**
	 * POST /sales-staff — add a sales person (no login) to the active shop.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async storeSales(req: Request) {
		const v = validate(SalesStaffInput, await HttpRequest.body(req));
		if (v.errors) return this.#page(req, v.errors);
		const r = await this.salesStaff.create(ctx(req).shop.id, v.data);
		if (r.errors) return this.#page(req, r.errors);
		return back(req, "/users");
	}

	/**
	 * PUT /sales-staff/:id — change a sales person's name, commission or
	 * active switch.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async updateSales(req: BunRequest<"/sales-staff/:id">) {
		const v = validate(SalesStaffInput, await HttpRequest.body(req));
		const errors =
			v.errors ??
			(await this.salesStaff.update(
				HttpRequest.idOf(req),
				ctx(req).shop.id,
				v.data,
			));
		return this.#done(req, errors);
	}

	/**
	 * POST /sales-staff/:id/pay — pay a sales person's commission.
	 * It is saved to the history, and the count starts again.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async paySales(req: BunRequest<"/sales-staff/:id/pay">) {
		const errors = await this.salesStaff.pay(
			HttpRequest.idOf(req),
			ctx(req).shop.id,
		);
		return this.#done(req, errors);
	}

	/**
	 * DELETE /sales-staff/:id — delete a sales person no sale names.
	 * @param req The current request.
	 * @returns Back to the list, or the list with errors.
	 */
	async destroySales(req: BunRequest<"/sales-staff/:id">) {
		const errors = await this.salesStaff.remove(
			HttpRequest.idOf(req),
			ctx(req).shop.id,
		);
		return this.#done(req, errors);
	}

	/**
	 * Render the staff list, optionally with form errors on it.
	 * @param req The current request.
	 * @param errors Inertia errors to show, if any.
	 * @returns The Users/Index page.
	 */
	async #page(req: Request, errors?: Errors) {
		const { user, shop } = ctx(req);
		return inertia(req, "Users/Index", {
			users: await this.users.list(user),
			sales_staff: await this.salesStaff.list(shop.id),
			...(errors && { errors }),
		});
	}

	/**
	 * The answer after a change on the staff page.
	 * @param req The current request.
	 * @param errors What was refused, if anything.
	 * @returns Back to the list, or the list with errors.
	 */
	#done(req: Request, errors?: Errors | null) {
		return errors ? this.#page(req, errors) : back(req, "/users");
	}
}
