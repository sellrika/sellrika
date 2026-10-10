import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { inertia } from "@xcore/view/Inertia";
import { HttpRequest } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { DailyReportService } from "@services/sales/DailyReport.Service";
import { ReportService } from "@services/sales/Report.Service";
import { ReportScheduleInput } from "@validators/Report.Validator";
import { validate } from "@validators/validate";

/**
 * Admin-only sales reporting.
 */
@Service()
export class ReportController {
	constructor(
		private reports: ReportService,
		private daily: DailyReportService,
	) {}

	/**
	 * GET /reports?preset=&from=&to=&by= — the whole report for the active shop.
	 * @param req The request; its query string picks the period and bucket size.
	 * @returns The Reports/Index page.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		const q = ReportService.resolveQuery(
			new URL(req.url).searchParams,
			shop.timezone,
		);
		return inertia(req, "Reports/Index", {
			report: await this.reports.build(shop.id, shop.timezone, q),
			schedule: await this.daily.settings(shop),
		});
	}

	/**
	 * JSON: PUT /reports/schedule — the daily report's switch, time and
	 * channels for the active shop.
	 * @param req The current request.
	 * @returns 200 `{ ok }`, or 422 `{ errors }`.
	 */
	async schedule(req: Request) {
		const { shop } = ctx(req);
		const v = validate(ReportScheduleInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const errors = await this.daily.save(shop, v.data);
		if (errors) return HttpResponse.unprocessable(errors);
		return json({ ok: true });
	}
}
