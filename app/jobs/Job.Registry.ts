import { app } from "@config/app";
import { Container, type Constructable } from "@xcore/di";
import { Schedule } from "@xcore/schedule/Schedule";
import { RATES_CRON } from "@constants/Currency.Constant";
import { DOMAIN_CRON } from "@constants/Domain.Constant";
import { MARKETING_CRON } from "@constants/Marketing.Constant";
import { REPORT_CRON } from "@constants/Report.Constant";
import { STORE_RECONCILE_CRON } from "@constants/Store.Constant";
import { DailyReportService } from "@services/sales/DailyReport.Service";
import { DomainService } from "@services/sales/Domain.Service";
import { MarketingService } from "@services/sales/marketing/Marketing.Service";
import { StoreReconcileService } from "@services/sales/StoreReconcile.Service";
import { ExchangeRateService } from "@services/settings/ExchangeRate.Service";

/** A service a background job can run. */
type Runnable = { run(): Promise<unknown> };

/** One background job: its name in the log, when it runs, and the service. */
export type Job = {
	name: string;
	expression: string;
	service: Constructable<Runnable>;
};

/**
 * The background jobs of the app.
 * This is the one list of what runs on a timer, and when.
 * New job: add a line to `#jobs()`.
 */
export class JobRegistry {
	/** The jobs an add-on added (`JobRegistry.add`). */
	static #extra: Job[] = [];

	/**
	 * Add a background job from outside this file.
	 * Call it before the server starts.
	 * @param job The job.
	 */
	static add(job: Job) {
		JobRegistry.#extra.push(job);
	}

	/**
	 * Start every background job.
	 * Each one also runs once right away, so nothing waits for its first tick.
	 * Call it once, after the server is up.
	 */
	static start() {
		for (const job of JobRegistry.#jobs()) JobRegistry.#schedule(job);
	}

	/**
	 * The jobs, in the order they start.
	 * @returns The list for this server.
	 */
	static #jobs(): Job[] {
		const jobs: Job[] = [
			/**
			 * Paid online checkouts whose buyer never came back to /done
			 * become orders here.
			 * On boot too, so nothing is lost while the server was down.
			 */
			{
				name: "store-reconcile",
				expression: STORE_RECONCILE_CRON,
				service: StoreReconcileService,
			},
			/**
			 * Marketing emails that are due: abandoned-cart reminders
			 * and scheduled campaigns ("Send now" is a campaign due now).
			 */
			{
				name: "marketing",
				expression: MARKETING_CRON,
				service: MarketingService,
			},
			/**
			 * The automatic exchange rates for every store's currency switcher,
			 * fetched when the platform admin's schedule says they are due.
			 */
			{
				name: "exchange-rates",
				expression: RATES_CRON,
				service: ExchangeRateService,
			},
			/**
			 * The daily sales report of every shop whose time has come,
			 * handed to its Chat alerts extension.
			 */
			{
				name: "daily-report",
				expression: REPORT_CRON,
				service: DailyReportService,
			},
		];
		/**
		 * Custom store domains: a domain whose DNS points here goes live
		 * in the Traefik file (Traefik gets its SSL).
		 * Only while DOMAIN_CNAME is set.
		 */
		if (app.domains.cname)
			jobs.push({
				name: "domains",
				expression: DOMAIN_CRON,
				service: DomainService,
			});
		return [...jobs, ...JobRegistry.#extra];
	}

	/**
	 * Start one background job.
	 * The service is taken from the container on each run.
	 * @param job The job.
	 */
	static #schedule(job: Job) {
		Schedule.cron(job.name, job.expression, function runService() {
			return Container.get(job.service).run();
		});
	}
}
