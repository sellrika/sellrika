import { expect, test } from "bun:test";
import {
	bucketKey,
	bucketKeys,
	dayRange,
	startOfToday,
	zonedToUtc,
	ymd,
} from "@helpers/time";

test("zone math", () => {
	// Bangkok is UTC+7 all year: local midnight = 17:00 UTC the day before
	expect(zonedToUtc("Asia/Bangkok", 2026, 3, 10).toISOString()).toBe(
		"2026-03-09T17:00:00.000Z",
	);
	expect(ymd(new Date("2026-03-09T17:00:00Z"), "Asia/Bangkok")).toBe(
		"2026-03-10",
	);
	expect(ymd(new Date("2026-03-09T16:59:59Z"), "Asia/Bangkok")).toBe(
		"2026-03-09",
	);
	// DST: New York switches on 2026-03-08; midnight before = 05:00Z, midnight after = 04:00Z
	expect(zonedToUtc("America/New_York", 2026, 3, 8).toISOString()).toBe(
		"2026-03-08T05:00:00.000Z",
	);
	expect(zonedToUtc("America/New_York", 2026, 3, 9).toISOString()).toBe(
		"2026-03-09T04:00:00.000Z",
	);
	const r = dayRange("America/New_York", "2026-03-08", "2026-03-08");
	expect(r.end.getTime() - r.start.getTime()).toBe(23 * 3600_000); // the 23-hour day
	expect(
		startOfToday(
			"Asia/Bangkok",
			new Date("2026-03-09T17:30:00Z"),
		).toISOString(),
	).toBe("2026-03-09T17:00:00.000Z");
});

test("buckets", () => {
	const d = new Date("2026-03-09T17:30:00Z"); // Tue 2026-03-10 00:30 Bangkok
	expect(bucketKey(d, "Asia/Bangkok", "day")).toBe("2026-03-10");
	expect(bucketKey(d, "Asia/Bangkok", "week")).toBe("2026-03-09"); // Monday
	expect(bucketKey(d, "Asia/Bangkok", "month")).toBe("2026-03-01");
	expect(bucketKey(d, "UTC", "day")).toBe("2026-03-09");
	expect(bucketKeys("2026-03-30", "2026-04-02", "day")).toEqual([
		"2026-03-30",
		"2026-03-31",
		"2026-04-01",
		"2026-04-02",
	]);
	expect(bucketKeys("2026-03-11", "2026-03-24", "week")).toEqual([
		"2026-03-09",
		"2026-03-16",
		"2026-03-23",
	]);
	expect(bucketKeys("2026-01-15", "2026-03-01", "month")).toEqual([
		"2026-01-01",
		"2026-02-01",
		"2026-03-01",
	]);
});
