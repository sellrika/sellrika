import { I18n, t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { ShopRepository } from "@repositories/Shop.Repository";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import type { ExtensionEvents } from "@services/settings/extensions/types/Extension.Events.Types";
import type { Shop } from "@models/Shop";
import type { Errors } from "@validators/validate";
import type { ReportScheduleInput } from "@validators/Report.Validator";
import { formatYmd, inZone } from "@helpers/time";
import {
	REPORT_CHANNELS,
	REPORT_DAILY_TOP,
	REPORT_EXTENSION,
	type ReportChannel,
} from "@constants/Report.Constant";
import { ReportService } from "./Report.Service";

/** The numbers and lists one daily report carries. */
type DailyReport = ExtensionEvents["report.daily"]["report"];

/**
 * The daily sales report of a shop.
 * The shop picks a time and channels on /reports.
 * The Chat alerts extension holds the channels and does the posting.
 */
@Service()
export class DailyReportService {
	constructor(
		private shops: ShopRepository,
		private reports: ReportService,
		private extensions: ExtensionService,
	) {}

	/**
	 * What the settings dialog on /reports shows.
	 * @param shop The active shop.
	 * @returns The saved settings, and the channels filled in Chat alerts.
	 */
	async settings(shop: Shop) {
		return {
			enabled: shop.report_enabled,
			time: shop.report_time,
			channels: shop.report_channels,
			available: await this.channels(shop),
		};
	}

	/**
	 * The channels the shop can get a report on right now.
	 * A channel counts when Chat alerts runs and has all its settings
	 * filled in.
	 * @param shop The shop.
	 * @returns The channel names; empty while the extension does not run.
	 */
	async channels(shop: Shop): Promise<ReportChannel[]> {
		const active = await this.extensions.active(shop.id, REPORT_EXTENSION);
		if (!active) return [];
		const names = Object.keys(REPORT_CHANNELS) as ReportChannel[];
		return names.filter(function filled(name) {
			return REPORT_CHANNELS[name].every((field) => !!active.config[field]);
		});
	}

	/**
	 * Save the settings of the dialog.
	 * Switching it on needs at least one channel that works.
	 * A time that already passed today starts tomorrow.
	 * @param shop The active shop.
	 * @param input The switch, the time and the channels.
	 * @param now The clock (injectable for tests).
	 * @returns Field errors, or null when saved.
	 */
	async save(
		shop: Shop,
		input: ReportScheduleInput,
		now = new Date(),
	): Promise<Errors | null> {
		const available = await this.channels(shop);
		const channels = input.channels.filter(function works(name) {
			return available.includes(name);
		});
		if (input.enabled && !channels.length)
			return { channels: t("reports.daily_no_channel") };
		const { day, time } = this.#clock(shop, now);
		await this.shops.updateReport(
			shop.id,
			{ ...input, channels },
			time >= input.time ? day : null,
		);
		return null;
	}

	/**
	 * The job: hand out the report of every shop whose time has come.
	 * Each shop gets it once per day of its own clock.
	 * @param now The clock (injectable for tests).
	 * @returns How many reports were handed out.
	 */
	async run(now = new Date()) {
		let sent = 0;
		for (const shop of await this.shops.withReport()) {
			const { day, time } = this.#clock(shop, now);
			if (time < shop.report_time || shop.report_sent_on === day) continue;
			if (!(await this.shops.claimReport(shop.id, day))) continue;
			try {
				await this.#send(shop, day);
				sent++;
			} catch (error) {
				console.warn(`[daily-report] shop #${shop.id}:`, error);
			}
		}
		return sent;
	}

	/**
	 * Build one shop's report of the day and hand it to its extensions.
	 * The posting is not awaited, so a slow chat service holds nobody up.
	 * ponytail: one try, no retry. A failed post is only in the log.
	 * Keep a row per report with a retry count if a missed day matters.
	 * @param shop The shop.
	 * @param day The shop's day, `YYYY-MM-DD`.
	 */
	async #send(shop: Shop, day: string) {
		const full = await this.reports.build(shop.id, shop.timezone, {
			preset: "today",
			from: day,
			to: day,
			by: "day",
		});
		const report: DailyReport = {
			date: day,
			summary: full.summary,
			top_products: full.top_products
				.slice(0, REPORT_DAILY_TOP)
				.map(function line(p) {
					return { name: p.name, qty: p.qty, revenue: p.revenue };
				}),
			by_method: full.by_method,
		};
		const extensions = this.extensions;
		// the text is written in the shop's main language: a job has no request
		I18n.withLocale(shop.languages[0] ?? "en", function emit() {
			void extensions.emit("report.daily", shop, {
				report,
				channels: shop.report_channels,
			});
		});
	}

	/**
	 * The day and the time on the shop's own clock.
	 * @param shop The shop.
	 * @param now The moment.
	 * @returns The day as `YYYY-MM-DD` and the time as `HH:MM`.
	 */
	#clock(shop: Shop, now: Date) {
		const p = inZone(now, shop.timezone);
		const two = (n: number) => String(n).padStart(2, "0");
		return { day: formatYmd(p.y, p.m, p.d), time: `${two(p.h)}:${two(p.mi)}` };
	}
}
