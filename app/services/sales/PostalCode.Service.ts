import { I18n, t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { PostalCodeRepository } from "@repositories/PostalCode.Repository";
import { SettingRepository } from "@repositories/Setting.Repository";
import { COUNTRIES } from "@constants/Country.Constant";
import {
	GEONAMES_ADMIN1,
	GEONAMES_ALL,
	POSTAL_BATCH,
	POSTAL_SETTING_KEY,
	POSTAL_STALL_MS,
	type PostalScope,
} from "@constants/Postal.Constant";
import { app } from "@config/app";
import { unzip } from "@helpers/zip";
import type { PostalCode } from "@models/PostalCode";

/**
 * A country whose postal codes are in the table.
 */
export type PostalCountry = {
	code: string;
	name: string;
	rows: number;
	updated_at: string | null;
};
/**
 * Where the cities / postal codes stand.
 * The run in flight or the last one's outcome, plus what is downloaded.
 * `downloading` / `importing` are live.
 * `ready` / `failed` are what the last run left behind (kept in settings).
 * `none` = never downloaded.
 */
export type PostalStatus = {
	status: "none" | "downloading" | "importing" | "ready" | "failed";
	scope: PostalScope | null;
	/**
	 * The country name for scope "country", null for "all".
	 */
	country: string | null;
	/**
	 * Its ISO code.
	 */
	code: string | null;
	/**
	 * Lines stored by the last successful run.
	 */
	rows: number;
	/**
	 * Progress of a live run: bytes, then characters of the data file.
	 */
	done: number;
	total: number;
	/**
	 * ISO, when the last run finished.
	 */
	updated_at: string | null;
	error: string | null;
	/**
	 * Every country in the table, A–Z.
	 */
	countries: PostalCountry[];
};
type LastRun = Omit<PostalStatus, "countries">;
/**
 * What settings keep.
 * The last run's outcome and when each country was (re)downloaded.
 */
type Stored = { last: LastRun; updated: Record<string, string> };
/**
 * One row of the table, before it has an id.
 */
type PostalRow = Omit<PostalCode, "id">;
/**
 * Turns one line of a data file into a row, or null.
 */
type LineParser = (line: string) => PostalRow | null;
/**
 * Where a run downloads from, and how its lines are read.
 */
type Source = { url: string; head: Response; parse: LineParser };

const NONE: LastRun = {
	status: "none",
	scope: null,
	country: null,
	code: null,
	rows: 0,
	done: 0,
	total: 0,
	updated_at: null,
	error: null,
};

/**
 * Downloads a GeoNames postal-code dump into `postal_codes`.
 * Any one country, or every country.
 * It runs in the background: `start()` returns at once and `status()`
 * reports progress for the page's bar.
 * One run at a time.
 * A run replaces what it covers: that country's rows, or the whole table.
 */
@Service()
export class PostalCodeService {
	/**
	 * The run in flight (null when idle).
	 * It lives in memory: settings only get the outcome.
	 */
	private live: LastRun | null = null;
	private job: Promise<void> | null = null;
	/**
	 * When the run in flight last made progress.
	 * A run that stops moving is given up after POSTAL_STALL_MS.
	 * That can be a dev-server reload mid-run, or a hung connection.
	 */
	private touchedAt = 0;
	/**
	 * HTTP client. Tests hand in a stub.
	 */
	fetcher: (url: string, init?: RequestInit) => Promise<Response> = (
		url,
		init,
	) => fetch(url, init);

	constructor(
		private repo: PostalCodeRepository,
		private settings: SettingRepository,
	) {}

	/**
	 * Where the download stands.
	 * Live progress while a run is on, else the stored outcome of the last
	 * one. Plus the downloaded countries.
	 * @param started A run that began just now: reported even when it is over already.
	 * @returns The status for the Delivery section.
	 */
	async status(started: LastRun | null = null): Promise<PostalStatus> {
		await this.#dropStalled();
		const stored = await this.#stored();
		const countries: PostalCountry[] = [];
		for (const c of await this.repo.countries())
			countries.push({
				code: c.country,
				name: COUNTRIES.find((k) => k.code === c.country)?.name ?? c.country,
				rows: c.rows,
				updated_at: stored.updated[c.country] ?? null,
			});
		countries.sort((a, b) => this.#byName(a, b));
		return { ...(started ?? this.live ?? stored.last), countries };
	}

	/**
	 * Kick off a download (not awaited, see `wait()`).
	 * @param scope `country` = one country, `all` = every country
	 *   GeoNames covers.
	 * @param country For `country`: the country's name (as the country
	 *   list spells it) or ISO code.
	 * @returns The starting status, or `{ error }` when it can't start.
	 */
	async start(
		scope: PostalScope,
		country = "",
	): Promise<{ status?: PostalStatus; error?: string }> {
		await this.#dropStalled();
		if (this.live) return { error: t("server.postal_already_running") };
		const c =
			scope === "country"
				? COUNTRIES.find(
						(k) => k.name === country || k.code === country.toUpperCase(),
					)
				: null;
		if (scope === "country" && !c)
			return { error: t("server.postal_pick_country") };
		this.live = {
			...NONE,
			status: "downloading",
			scope,
			country: c?.name ?? null,
			code: c?.code ?? null,
		};
		this.touchedAt = Date.now();
		const live = this.live;
		// the run outlives the request,
		// so it carries the admin's language with it
		this.job = I18n.withLocale(I18n.current(), () =>
			this.#run(scope, c?.code ?? null),
		).finally(() => this.#release(live));
		// a fast run may be over before the database answers: report its start
		return { status: await this.status(live) };
	}

	/**
	 * Take a downloaded country off the list.
	 * Its rows and its download date go (a later download brings it back).
	 * Refused while a run is on, since that run may be writing the very rows.
	 * @param country ISO code, as the list shows it.
	 * @returns The status after, or `{ error }` when it can't happen now.
	 */
	async remove(
		country: string,
	): Promise<{ status?: PostalStatus; error?: string }> {
		await this.#dropStalled();
		if (this.live) return { error: t("server.postal_wait") };
		const code = country.toUpperCase();
		await this.repo.clear(code);
		const stored = await this.#stored();
		delete stored.updated[code];
		// "Last download: X" would name a country that's gone
		if (stored.last.code === code) stored.last = { ...NONE };
		await this.settings.set(POSTAL_SETTING_KEY, JSON.stringify(stored));
		return { status: await this.status() };
	}

	/**
	 * Stop the run in flight now.
	 * This is the admin's Cancel, e.g. for a run stuck after a server reload.
	 * The run notices at its next step and stops. Rows it already saved stay.
	 * @returns The status after.
	 */
	async cancel(): Promise<PostalStatus> {
		if (this.live) await this.#giveUp(t("server.postal_cancelled"));
		return this.status();
	}

	/**
	 * Wait for the run in flight (tests, shutdown).
	 * @returns A promise that resolves when the run is over.
	 */
	wait(): Promise<void> {
		return this.job ?? Promise.resolve();
	}

	/**
	 * One GeoNames tab-separated line → a row.
	 * Fields: country code, postal code, place name, admin name1,
	 * admin code1, admin name2, … (see their readme).
	 * The rest is ignored.
	 * @param line One line of the data file.
	 * @returns The row, or null for a line that isn't one.
	 */
	static parseLine(line: string): PostalRow | null {
		const f = line.split("\t");
		if (f.length < 3 || !f[0] || !f[1] || !f[2]) return null;
		return {
			country: f[0]!.trim(),
			postal_code: f[1]!.trim(),
			place: f[2]!.trim(),
			admin1: (f[3] ?? "").trim(),
			admin2: (f[5] ?? "").trim(),
		};
	}

	/**
	 * A parser for a place-name dump line (`dump/<ISO>.zip`).
	 * A line has 19 tab fields: id, name, ascii name, alternates, lat, lng,
	 * feature class, feature code, country, cc2, admin1 code, …
	 * Every populated place (class `P`, not in `DUMP_SKIP`) becomes a row
	 * with no postal code.
	 * Its admin1 code is turned into the state name by
	 * `admin1CodesASCII.txt` (`MM.17\tYangon\t…`).
	 * @param country ISO code. Only its admin1 names are kept.
	 * @param admin1Text The admin1 file's text ("" = keep the codes).
	 * @returns The line parser.
	 */
	static dumpParser(country: string, admin1Text: string): LineParser {
		const names = new Map<string, string>();
		for (const line of admin1Text.split("\n")) {
			const f = line.split("\t");
			if (f[0]?.startsWith(`${country}.`) && f[1])
				names.set(f[0].slice(country.length + 1), f[1].trim());
		}
		/**
		 * One dump line → a row.
		 * ponytail: every populated place, villages too.
		 * Population is blank for most rows, so it can't filter.
		 * Filter harder if a country's city list gets too long.
		 * @param line One line of the dump.
		 * @returns The row, or null for a line that is left out.
		 */
		function place(line: string): PostalRow | null {
			const f = line.split("\t");
			if (
				f.length < 11 ||
				f[6] !== "P" ||
				!f[1] ||
				f[8] !== country ||
				DUMP_SKIP.has(f[7]!)
			)
				return null;
			// an admin1 the names file lacks ("00" = unassigned) → no state
			return {
				country,
				postal_code: "",
				place: f[1]!.trim(),
				admin1: names.get(f[10]!) ?? "",
				admin2: "",
			};
		}
		return place;
	}

	/**
	 * Every row of a data file.
	 * For tests: the import itself streams `parseLine`.
	 * @param text The data file.
	 * @returns The rows, lines that aren't one left out.
	 */
	static parse(text: string) {
		return text
			.split("\n")
			.map(PostalCodeService.parseLine)
			.filter((r): r is PostalRow => r !== null);
	}

	/**
	 * What settings hold.
	 * @returns The stored outcome and dates (nothing yet = an empty history).
	 */
	async #stored(): Promise<Stored> {
		const raw = await this.settings.get(POSTAL_SETTING_KEY);
		return raw
			? { last: { ...NONE }, updated: {}, ...JSON.parse(raw) }
			: { last: { ...NONE }, updated: {} };
	}

	/**
	 * A run is over: forget it, unless a newer one took its place.
	 * @param live The run that ended.
	 */
	#release(live: LastRun) {
		if (this.live !== live) return;
		this.live = null;
		this.job = null;
	}

	/**
	 * Abandon a run in flight that hasn't moved for POSTAL_STALL_MS.
	 * Its outcome is recorded as failed.
	 */
	async #dropStalled() {
		if (!this.live || Date.now() - this.touchedAt < POSTAL_STALL_MS) return;
		console.error("[postal-codes] download stalled — giving up");
		await this.#giveUp(t("server.postal_stalled"));
	}

	/**
	 * Drop the run in flight and record it as failed.
	 * @param error Why, as the page shows it.
	 */
	async #giveUp(error: string) {
		const live = this.live;
		if (!live) return;
		this.live = null;
		this.job = null;
		// recorded like any outcome (keeping the per-country dates)
		try {
			const stored = await this.#stored();
			await this.#record(
				live,
				{ status: "failed", error },
				stored.updated,
				new Date().toISOString(),
			);
		} catch (e) {
			console.error("[postal-codes] could not record the outcome:", e);
		}
	}

	/**
	 * Write a run's outcome to settings.
	 * @param live The run.
	 * @param patch What the outcome changes on it (status, rows, error).
	 * @param updated When each country was downloaded.
	 * @param now The time the run finished, ISO.
	 */
	async #record(
		live: LastRun,
		patch: Partial<LastRun>,
		updated: Record<string, string>,
		now: string,
	) {
		const last = { ...live, ...patch, done: 0, total: 0, updated_at: now };
		await this.settings.set(
			POSTAL_SETTING_KEY,
			JSON.stringify({ last, updated } satisfies Stored),
		);
	}

	/**
	 * Was this run cancelled or given up?
	 * A dropped run stops and writes nothing more.
	 * @param live The run, as captured when it started.
	 * @returns True when it is no longer the run in flight.
	 */
	#dropped(live: LastRun) {
		return this.live !== live;
	}

	/**
	 * Record how a run ended, unless it was dropped.
	 * A finished "all" run starts the per-country dates afresh.
	 * @param live The run, as captured when it started.
	 * @param scope What was fetched.
	 * @param patch The outcome: status, rows, error.
	 * @param touched ISO codes of the countries the run wrote.
	 */
	async #finish(
		live: LastRun,
		scope: PostalScope,
		patch: Partial<LastRun>,
		touched: string[] = [],
	) {
		if (this.#dropped(live)) return;
		const stored = await this.#stored();
		const now = new Date().toISOString();
		const updated =
			scope === "all" && patch.status === "ready" ? {} : stored.updated;
		for (const k of touched) updated[k] = now;
		await this.#record(live, patch, updated, now);
	}

	/**
	 * The run itself.
	 * Fetch the zip while counting bytes, then unzip.
	 * Then replace the rows a line at a time, parsed and inserted in
	 * batches. The whole file is never held as rows.
	 * Then write the outcome to settings.
	 * Any failure ends up as `failed` with its reason, never thrown.
	 * @param scope What is being fetched.
	 * @param code ISO code for scope "country".
	 */
	async #run(scope: PostalScope, code: string | null) {
		const live = this.live!;
		try {
			const source = await this.#source(live, scope, code);
			const zip = await this.#download(live, source);
			if (!zip) return;
			const entry = unzip(zip).find(
				(e) => e.name.endsWith(".txt") && e.name !== "readme.txt",
			);
			if (!entry) throw new Error(t("server.postal_no_data_file"));
			const text = new TextDecoder().decode(entry.data);
			const done = await this.#importText(
				live,
				text,
				source.parse,
				scope,
				code,
			);
			if (!done) return;
			if (!done.rows) throw new Error(t("server.postal_no_places"));
			await this.#finish(
				live,
				scope,
				{ status: "ready", rows: done.rows, error: null },
				done.countries,
			);
		} catch (e) {
			console.error("[postal-codes] download failed:", e);
			try {
				await this.#finish(live, scope, {
					status: "failed",
					error: e instanceof Error ? e.message : t("server.postal_failed"),
				});
			} catch (err) {
				console.error("[postal-codes] could not record the outcome:", err);
			}
		}
	}

	/**
	 * Find the file a run downloads, and how its lines are read.
	 * A country with no postal codes (Myanmar…) takes its place names
	 * from the other dump instead.
	 * The checkout still gets State → City lists then, only with no code
	 * to fill in.
	 * @param live The run, as captured when it started.
	 * @param scope What is being fetched.
	 * @param code ISO code for scope "country".
	 * @returns The URL, its HEAD answer and the line parser.
	 * @throws When GeoNames has no data for it, or does not answer well.
	 */
	async #source(
		live: LastRun,
		scope: PostalScope,
		code: string | null,
	): Promise<Source> {
		const file = scope === "all" ? GEONAMES_ALL : code!;
		let url = `${app.geonames.zip}${file}.zip`;
		let head = await this.fetcher(url, { method: "HEAD" });
		let parse: LineParser = PostalCodeService.parseLine;
		if (head.status === 404 && scope === "country") {
			url = `${app.geonames.dump}${file}.zip`;
			head = await this.fetcher(url, { method: "HEAD" });
			if (head.ok)
				parse = PostalCodeService.dumpParser(code!, await this.#admin1Text());
		}
		if (head.status === 404)
			throw new Error(
				t("server.postal_no_country_data", {
					country: live.country ?? file,
				}),
			);
		if (!head.ok)
			throw new Error(
				t("server.postal_geonames_answered", { status: head.status }),
			);
		return { url, head, parse };
	}

	/**
	 * The GeoNames file that names every state / province.
	 * @returns Its text, or "" when it can't be fetched.
	 */
	async #admin1Text() {
		const r = await this.fetcher(`${app.geonames.dump}${GEONAMES_ADMIN1}`);
		return r.ok ? r.text() : "";
	}

	/**
	 * Fetch a run's zip, counting the bytes for the progress bar.
	 * @param live The run, as captured when it started.
	 * @param source The URL and its HEAD answer.
	 * @returns The zip's bytes, or null when the run was dropped.
	 * @throws When GeoNames does not answer well.
	 */
	async #download(live: LastRun, source: Source) {
		const res = await this.fetcher(source.url);
		if (!res.ok || !res.body)
			throw new Error(
				t("server.postal_geonames_answered", { status: res.status }),
			);
		live.total = Number(
			res.headers.get("content-length") ??
				source.head.headers.get("content-length") ??
				0,
		);
		const chunks: Uint8Array[] = [];
		const reader = res.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (this.#dropped(live)) {
				void reader.cancel().catch(() => {});
				return null;
			}
			chunks.push(value);
			live.done += value.length;
			this.touchedAt = Date.now();
		}
		const zip = new Uint8Array(live.done);
		let at = 0;
		for (const c of chunks) {
			zip.set(c, at);
			at += c.length;
		}
		return zip;
	}

	/**
	 * Replace the rows a run covers with the lines of its data file.
	 * That is the country's rows, or everything.
	 * It goes line by line, in short batches, so memory stays flat.
	 * The rest of the app stays served: SQLite answers without leaving the
	 * event loop, hence the sleep.
	 * @param live The run, as captured when it started.
	 * @param text The data file.
	 * @param parse Turns one line into a row.
	 * @param scope What is being fetched.
	 * @param code ISO code for scope "country".
	 * @returns How many rows were stored and for which countries,
	 *   or null when the run was dropped.
	 */
	async #importText(
		live: LastRun,
		text: string,
		parse: LineParser,
		scope: PostalScope,
		code: string | null,
	) {
		live.status = "importing";
		live.done = 0;
		live.total = text.length;
		await this.repo.clear(scope === "all" ? null : code);
		const seen = new Set<string>();
		let batch: PostalRow[] = [],
			rows = 0;
		for (let at = 0; at < text.length; ) {
			let nl = text.indexOf("\n", at);
			if (nl === -1) nl = text.length;
			const row = parse(text.slice(at, nl));
			at = nl + 1;
			if (row) {
				batch.push(row);
				rows++;
				seen.add(row.country);
			}
			if (batch.length >= POSTAL_BATCH || (at >= text.length && batch.length)) {
				if (this.#dropped(live)) return null;
				await this.repo.insert(batch);
				batch = [];
				live.done = Math.min(at, text.length);
				this.touchedAt = Date.now();
				await Bun.sleep(0);
			}
		}
		return { rows, countries: [...seen] };
	}

	/**
	 * Sort two countries by name.
	 * @param a One country.
	 * @param b Another.
	 * @returns The order for `sort`.
	 */
	#byName(a: PostalCountry, b: PostalCountry) {
		return a.name.localeCompare(b.name);
	}
}

/**
 * Feature codes of places a dump import leaves out.
 * Abandoned, destroyed and historical places,
 * and a "section" of a bigger place.
 */
const DUMP_SKIP = new Set(["PPLQ", "PPLW", "PPLX", "PPLH", "PPLCH"]);
