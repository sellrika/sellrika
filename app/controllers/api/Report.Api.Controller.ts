import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { json } from "@xcore/http/Response";
import { ReportService } from "@services/sales/Report.Service";

/**
 * API: the sales report of the key's shop.
 */
@Service()
export class ReportApiController {
	constructor(private reports: ReportService) {}

	/**
	 * GET /reports?preset=&from=&to=&by= — the whole report for a period.
	 * The period is read like the Reports page reads it:
	 * an unknown value falls back to this month.
	 * @param req The current request.
	 * @returns The report.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		const q = ReportService.resolveQuery(
			new URL(req.url).searchParams,
			shop.timezone,
		);
		return json(await this.reports.build(shop.id, shop.timezone, q));
	}
}
