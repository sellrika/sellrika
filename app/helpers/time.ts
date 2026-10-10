import { DAY_MS } from "@constants/Time.Constant";

/**
 * Shop-local time helpers.
 * The DB stores UTC: "YYYY-MM-DD HH:MM:SS" text in SQLite,
 * a timestamp in Postgres.
 * "Today", date ranges and report buckets are worked out in the shop's
 * IANA time zone with Intl (no tz library).
 */

/** One formatter per time zone: building one is slow. */
const fmtCache = new Map<string, Intl.DateTimeFormat>();

/**
 * The formatter that splits a moment into its fields in a time zone.
 * @param tz The IANA time zone.
 * @returns The formatter, built once per zone.
 */
function partsIn(tz: string) {
	let f = fmtCache.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			weekday: "short",
		});
		fmtCache.set(tz, f);
	}
	return f;
}

/**
 * The calendar fields of a moment.
 * `wd` is the weekday, 0 = Sunday.
 */
export type Parts = {
	y: number;
	m: number;
	d: number;
	h: number;
	mi: number;
	s: number;
	wd: number;
};
/** Intl's short weekday name → its number, 0 = Sunday. */
const WD: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

/**
 * Calendar fields of a moment as seen in a time zone.
 * @param date The moment.
 * @param tz The IANA time zone.
 * @returns Year, month, day, hour, minute, second and weekday.
 */
export function inZone(date: Date, tz: string): Parts {
	const o: Record<string, string> = {};
	for (const p of partsIn(tz).formatToParts(date)) o[p.type] = p.value;
	return {
		y: +o.year!,
		m: +o.month!,
		d: +o.day!,
		h: +o.hour! % 24,
		mi: +o.minute!,
		s: +o.second!,
		wd: WD[o.weekday!] ?? 0,
	};
}

/**
 * The instant at which `y-m-d h:mi:s` happens on the wall clock of `tz`.
 * DST-safe: it re-checks the offset once.
 * @param tz The IANA time zone.
 * @param y The year.
 * @param m The month, 1 to 12.
 * @param d The day of the month. A day past the month's end rolls over.
 * @param h The hour.
 * @param mi The minute.
 * @param s The second.
 * @returns The instant.
 */
export function zonedToUtc(
	tz: string,
	y: number,
	m: number,
	d: number,
	h = 0,
	mi = 0,
	s = 0,
): Date {
	const guess = Date.UTC(y, m - 1, d, h, mi, s);
	const off1 = offsetMs(new Date(guess), tz);
	const t = guess - off1;
	const off2 = offsetMs(new Date(t), tz);
	return new Date(off1 === off2 ? t : guess - off2);
}

/**
 * How far a time zone's wall clock is ahead of UTC at a moment.
 * @param date The moment.
 * @param tz The IANA time zone.
 * @returns The offset in milliseconds.
 */
function offsetMs(date: Date, tz: string) {
	const p = inZone(date, tz);
	return (
		Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) -
		Math.floor(date.getTime() / 1000) * 1000
	);
}

/**
 * A day as text.
 * @param y The year.
 * @param m The month, 1 to 12.
 * @param d The day of the month.
 * @returns "YYYY-MM-DD".
 */
export function formatYmd(y: number, m: number, d: number) {
	return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Read a "YYYY-MM-DD" day.
 * @param s The text.
 * @returns The year, the month (1 to 12) and the day.
 */
export function parseYmd(s: string) {
	return s.split("-").map(Number) as [number, number, number];
}

/**
 * The UTC day of a moment.
 * @param date The moment.
 * @returns "YYYY-MM-DD", read on the UTC clock.
 */
export function utcYmd(date: Date) {
	return date.toISOString().slice(0, 10);
}

/**
 * The day of a moment as seen in a time zone.
 * @param date The moment.
 * @param tz The IANA time zone.
 * @returns "YYYY-MM-DD".
 */
export function ymd(date: Date, tz: string) {
	const p = inZone(date, tz);
	return formatYmd(p.y, p.m, p.d);
}

/**
 * Parse a DB timestamp.
 * @param v SQLite "YYYY-MM-DD HH:MM:SS" UTC text, an ISO string,
 *   or a Date from Postgres.
 * @returns The moment.
 */
export function dbDate(v: string | Date): Date {
	if (v instanceof Date) return v;
	return new Date(
		/^\d{4}-\d{2}-\d{2} /.test(v) ? `${v.replace(" ", "T")}Z` : v,
	);
}
/**
 * A moment as the database stores it.
 * Use it to compare with `created_at` and to write a timestamp.
 * @param d The moment.
 * @returns UTC "YYYY-MM-DD HH:MM:SS".
 */
export function sqlStamp(d: Date) {
	return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Start of the shop's current day.
 * @param tz The shop's IANA time zone.
 * @param now The moment "today" is read from.
 * @returns The UTC instant of 00:00 on the shop's clock.
 */
export function startOfToday(tz: string, now = new Date()) {
	const p = inZone(now, tz);
	return zonedToUtc(tz, p.y, p.m, p.d);
}

/**
 * A range of whole days in a time zone, as UTC instants.
 * It runs from 00:00 of `from` to 24:00 of `to`.
 * @param tz The IANA time zone.
 * @param from The first day, "YYYY-MM-DD".
 * @param to The last day, "YYYY-MM-DD".
 * @returns `start` and `end`. The end is exclusive.
 */
export function dayRange(tz: string, from: string, to: string) {
	const [fy, fm, fd] = parseYmd(from);
	const [ty, tm, td] = parseYmd(to);
	return {
		start: zonedToUtc(tz, fy, fm, fd),
		end: zonedToUtc(tz, ty, tm, td + 1),
	};
}

/** The size of one bar of a report's time series. */
export type Bucket = "day" | "week" | "month";

/**
 * The bucket an instant falls in, by the shop's wall clock.
 * @param date The instant.
 * @param tz The shop's IANA time zone.
 * @param by The bucket size.
 * @returns "YYYY-MM-DD" of the day, of the week's Monday,
 *   or "YYYY-MM-01" of the month.
 */
export function bucketKey(date: Date, tz: string, by: Bucket) {
	return partsBucketKey(inZone(date, tz), by);
}

/**
 * The bucket of a moment whose calendar fields are already known.
 * For a caller that needs the fields anyway and asks `inZone` once.
 * @param p The moment's fields in the shop's zone, from `inZone`.
 * @param by The bucket size.
 * @returns The same key `bucketKey` gives.
 */
export function partsBucketKey(p: Parts, by: Bucket) {
	if (by === "month") return formatYmd(p.y, p.m, 1);
	if (by === "day") return formatYmd(p.y, p.m, p.d);
	// days since Monday
	const back = (p.wd + 6) % 7;
	const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - back));
	return utcYmd(monday);
}

/**
 * Every bucket key between two days, so charts show empty days too.
 * @param from The first day, "YYYY-MM-DD".
 * @param to The last day, "YYYY-MM-DD". It is included.
 * @param by The bucket size.
 * @returns The keys in order, at most 1000.
 */
export function bucketKeys(from: string, to: string, by: Bucket) {
	const [fy, fm, fd] = parseYmd(from);
	const [ty, tm, td] = parseYmd(to);
	const end = Date.UTC(ty, tm - 1, td);
	const keys: string[] = [];
	let cur = new Date(Date.UTC(fy, fm - 1, fd));
	if (by === "week")
		cur = new Date(Date.UTC(fy, fm - 1, fd - ((cur.getUTCDay() + 6) % 7)));
	if (by === "month") cur = new Date(Date.UTC(fy, fm - 1, 1));
	while (cur.getTime() <= end && keys.length < 1000) {
		keys.push(utcYmd(cur));
		if (by === "day") cur = new Date(cur.getTime() + DAY_MS);
		else if (by === "week") cur = new Date(cur.getTime() + 7 * DAY_MS);
		else
			cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
	}
	return keys;
}
