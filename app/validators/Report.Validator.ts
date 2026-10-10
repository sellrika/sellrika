import { z } from "zod";
import {
	REPORT_CHANNELS,
	REPORT_TIME_PATTERN,
	type ReportChannel,
} from "@constants/Report.Constant";

/**
 * The daily report's switch, its time and its channels.
 * PUT /reports/schedule.
 */
export const ReportScheduleInput = z.object({
	/** True = the shop gets the report every day. */
	enabled: z.boolean().default(false),
	/** When it goes out, `HH:MM` on the shop's clock. */
	time: z.string().regex(REPORT_TIME_PATTERN, "reports.daily_time_invalid"),
	/** The Chat alerts channels it goes to. */
	channels: z
		.array(z.enum(Object.keys(REPORT_CHANNELS) as [ReportChannel]))
		.max(Object.keys(REPORT_CHANNELS).length)
		.default([]),
});
/** A checked `ReportScheduleInput`. */
export type ReportScheduleInput = z.infer<typeof ReportScheduleInput>;
