import { tmpdir } from "node:os"; // Bun has no equivalent
import { deflateRawSync } from "node:zlib"; // to build a real deflated zip fixture (Bun has no raw deflate)
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";

process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { PostalCodeService: _PostalCodeService } = await import(
	"../PostalCode.Service"
);
const PostalCodeService = Container.get(_PostalCodeService);
const { PostalCodeRepository: _PostalCodeRepository } = await import(
	"@repositories/PostalCode.Repository"
);
const PostalCodeRepository = Container.get(_PostalCodeRepository);
const { unzip } = await import("@helpers/zip");

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);

/** A zip archive the way GeoNames ships them (deflated entries, a readme next to the data). */
function zip(files: Record<string, string>, method: 0 | 8 = 8): Uint8Array {
	const enc = new TextEncoder();
	const parts: Uint8Array[] = [],
		central: Uint8Array[] = [];
	let offset = 0;
	const u16 = (n: number) => [n & 255, (n >> 8) & 255],
		u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
	for (const [name, text] of Object.entries(files)) {
		const raw = enc.encode(text),
			data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw,
			n = enc.encode(name);
		const head = [
			...u16(20),
			...u16(0),
			...u16(method),
			...u16(0),
			...u16(0),
			...u32(0),
			...u32(data.length),
			...u32(raw.length),
			...u16(n.length),
			...u16(0),
		];
		parts.push(new Uint8Array([0x50, 0x4b, 3, 4, ...head]), n, data);
		central.push(
			new Uint8Array([
				0x50,
				0x4b,
				1,
				2,
				...u16(20),
				...head,
				...u16(0),
				...u16(0),
				...u16(0),
				...u32(0),
				...u32(offset),
			]),
			n,
		);
		offset += 30 + n.length + data.length;
	}
	const cdSize = central.reduce((s, c) => s + c.length, 0);
	const eocd = new Uint8Array([
		0x50,
		0x4b,
		5,
		6,
		...u16(0),
		...u16(0),
		...u16(central.length / 2),
		...u16(central.length / 2),
		...u32(cdSize),
		...u32(offset),
		...u16(0),
	]);
	const all = [...parts, ...central, eocd],
		out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
	let at = 0;
	for (const c of all) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}
const TH = [
	"TH\t10200\tPhra Nakhon\tBangkok\t40\tPhra Nakhon\t1001\t\t\t13.75\t100.49\t4",
	"TH\t50000\tChiang Mai\tChiang Mai\t50\tMueang Chiang Mai\t5001\t\t\t18.79\t98.98\t4",
	"",
	"bad line",
].join("\n");
/** Serve `files` by path under `/export/` (`zip/TH.zip`, `dump/MM.zip`; 404 otherwise), the way GeoNames does: HEAD first, then the streamed body. */
const serve =
	(files: Record<string, Uint8Array>) =>
	async (url: string, init?: RequestInit) => {
		const body = files[url.split("/export/")[1]!];
		if (!body) return new Response("Not found", { status: 404 });
		return new Response(init?.method === "HEAD" ? null : (body as BodyInit), {
			headers: { "content-length": String(body.length) },
		});
	};

test("zip + parse: GeoNames archives (deflated or stored) open, the data file is the one that isn't the readme, junk lines are skipped", () => {
	for (const method of [8, 0] as const) {
		const entries = unzip(zip({ "readme.txt": "hello", "TH.txt": TH }, method));
		expect(entries.map((e) => e.name)).toEqual(["readme.txt", "TH.txt"]);
		expect(new TextDecoder().decode(entries[1]!.data)).toBe(TH);
	}
	expect(_PostalCodeService.parse(TH)).toEqual([
		{
			country: "TH",
			postal_code: "10200",
			place: "Phra Nakhon",
			admin1: "Bangkok",
			admin2: "Phra Nakhon",
		},
		{
			country: "TH",
			postal_code: "50000",
			place: "Chiang Mai",
			admin1: "Chiang Mai",
			admin2: "Mueang Chiang Mai",
		},
	]);
	expect(() => unzip(new TextEncoder().encode("nope"))).toThrow(/Not a zip/);
});

test("download: the shop's country → its rows, with progress along the way; a redo replaces them; all countries wipes the table first", async () => {
	PostalCodeService.fetcher = serve({
		"zip/TH.zip": zip({ "readme.txt": "r", "TH.txt": TH }),
		"zip/allCountries.zip": zip({
			"allCountries.txt": `${TH}\nSG\t018956\tSingapore\t\t\t\t\t\t\t1.28\t103.85\t4`,
		}),
	});
	expect(await PostalCodeService.status()).toMatchObject({
		status: "none",
		countries: [],
	});
	expect((await PostalCodeService.start("country", "")).error).toMatch(
		/Choose a country/,
	);
	expect((await PostalCodeService.start("country", "Narnia")).error).toMatch(
		/Choose a country/,
	);
	const started = await PostalCodeService.start("country", "Thailand");
	expect(started.status).toMatchObject({
		scope: "country",
		country: "Thailand",
		code: "TH",
	});
	expect(["downloading", "importing"]).toContain(started.status!.status); // the stub answers at once, so it may be past the download already
	expect((await PostalCodeService.start("all")).error).toMatch(
		/already running/,
	); // one at a time
	await PostalCodeService.wait();
	const ready = await PostalCodeService.status();
	expect(ready).toMatchObject({
		status: "ready",
		scope: "country",
		code: "TH",
		rows: 2,
		error: null,
	});
	expect(ready.updated_at).toBeTruthy();
	expect(ready.countries).toEqual([
		{ code: "TH", name: "Thailand", rows: 2, updated_at: ready.updated_at },
	]);
	expect(await PostalCodeRepository.count("TH")).toBe(2);
	expect(await PostalCodeRepository.places(["TH"], "chi")).toEqual({
		places: ["Chiang Mai"],
		more: false,
	});
	expect(await PostalCodeRepository.places([], "chi")).toEqual({
		places: ["Chiang Mai"],
		more: false,
	}); // a rest-of-world zone searches every country
	expect(await PostalCodeRepository.places(["SG"], "chi")).toEqual({
		places: [],
		more: false,
	});
	expect(await PostalCodeRepository.places(["TH"], "", 1)).toEqual({
		places: ["Chiang Mai"],
		more: true,
	}); // the first page A–Z, and there's more to type for
	// the guided address: states of a country, then a state's cities with a postal code each
	expect(await PostalCodeRepository.states("TH")).toEqual([
		"Bangkok",
		"Chiang Mai",
	]);
	expect(await PostalCodeRepository.cities("TH", "Bangkok")).toEqual({
		cities: [{ place: "Phra Nakhon", postal_code: "10200" }],
		more: false,
	});
	expect(await PostalCodeRepository.cities("TH", "Bangkok", "xyz")).toEqual({
		cities: [],
		more: false,
	});
	expect(await PostalCodeRepository.states("SG")).toEqual([]);
	expect(await PostalCodeRepository.placesOf("TH", " 10200 ")).toEqual([
		"Phra Nakhon",
	]);
	expect(await PostalCodeRepository.placesOf("TH", "99999")).toEqual([]);

	// a redo (by ISO code this time) replaces the country's rows (no duplicates), leaving other countries alone
	await sql`insert into postal_codes (country, postal_code, place) values ('SG', '018956', 'Singapore')`;
	await PostalCodeService.start("country", "th");
	await PostalCodeService.wait();
	expect([
		await PostalCodeRepository.count("TH"),
		await PostalCodeRepository.count("SG"),
	]).toEqual([2, 1]);
	expect(
		(await PostalCodeService.status()).countries.map((c) => [
			c.code,
			c.rows,
			!!c.updated_at,
		]),
	).toEqual([
		["SG", 1, false],
		["TH", 2, true],
	]); // SG was never downloaded

	// every country: the whole table is rebuilt from that one file, and every country in it counts as downloaded now
	await PostalCodeService.start("all");
	await PostalCodeService.wait();
	expect(await PostalCodeService.status()).toMatchObject({
		status: "ready",
		scope: "all",
		country: null,
		code: null,
		rows: 3,
	});
	expect(await PostalCodeRepository.count()).toBe(3);
	expect(
		(await PostalCodeService.status()).countries.map((c) => [
			c.name,
			c.rows,
			!!c.updated_at,
		]),
	).toEqual([
		["Singapore", 1, true],
		["Thailand", 2, true],
	]);

	// remove: the country's rows and date go, the others stay; the "last download" line no longer names it
	await PostalCodeService.start("country", "th");
	expect((await PostalCodeService.remove("TH")).error).toMatch(
		/download is running/,
	);
	await PostalCodeService.wait();
	expect((await PostalCodeService.remove("th")).status).toMatchObject({
		status: "none",
		countries: [{ code: "SG", rows: 1 }],
	});
	expect(await PostalCodeRepository.count("TH")).toBe(0);
	await PostalCodeService.start("country", "Thailand"); // back again, as new
	await PostalCodeService.wait();
	expect(
		(await PostalCodeService.status()).countries.map((c) => c.code),
	).toEqual(["SG", "TH"]);
});

test("download: a country with no postal-code file (Myanmar) takes its populated places from the place-name dump — no codes, the admin1 code turned into the state name", async () => {
	const MM = [
		"1298824\tYangon\tYangon\tRangoon\t16.80528\t96.15611\tP\tPPLA\tMM\t\t17\t\t\t\t4477638\t\t33\tAsia/Yangon\t2019-09-05",
		"1327811\tBago\tBago\t\t17.33521\t96.48135\tP\tPPLA\tMM\t\t16\t\t\t\t244376\t\t14\tAsia/Yangon\t2012-01-16",
		"1327810\tBago River\tBago River\t\t17.2\t96.5\tH\tSTM\tMM\t\t16\t\t\t\t0\t\t1\tAsia/Yangon\t2012-01-16", // not a place
		"1300000\tNowhere\tNowhere\t\t0\t0\tP\tPPL\tMM\t\t99\t\t\t\t0\t\t1\tAsia/Yangon\t2012-01-16", // an admin1 the names file lacks → no state
		"1300001\tGone\tGone\t\t0\t0\tP\tPPLQ\tMM\t\t17\t\t\t\t0\t\t1\tAsia/Yangon\t2012-01-16", // abandoned
	].join("\n");
	PostalCodeService.fetcher = serve({
		"zip/TH.zip": zip({ "TH.txt": TH }),
		"dump/MM.zip": zip({ "readme.txt": "r", "MM.txt": MM }),
		"dump/admin1CodesASCII.txt": new TextEncoder().encode(
			"MM.17\tYangon\tYangon\t1298824\nMM.16\tBago\tBago\t1327811\nTH.40\tBangkok\tBangkok\t1609350",
		),
	});
	await PostalCodeService.start("country", "Myanmar");
	await PostalCodeService.wait();
	expect(await PostalCodeService.status()).toMatchObject({
		status: "ready",
		code: "MM",
		rows: 3,
		error: null,
	});
	expect(await PostalCodeRepository.states("MM")).toEqual(["Bago", "Yangon"]);
	expect(await PostalCodeRepository.cities("MM", "Yangon")).toEqual({
		cities: [{ place: "Yangon", postal_code: "" }],
		more: false,
	});
	expect(await PostalCodeRepository.placesOf("MM", "")).toEqual([]); // nothing to match a code on — city prices go by name
	expect(await PostalCodeRepository.count("TH")).toBe(2); // the neighbours are untouched
	await PostalCodeService.remove("MM");
});

test("download: a country GeoNames doesn't cover, or a broken file, ends as failed with the reason — the rows already there stay", async () => {
	PostalCodeService.fetcher = serve({});
	await PostalCodeService.start("country", "Japan");
	await PostalCodeService.wait();
	expect(await PostalCodeService.status()).toMatchObject({ status: "failed" });
	expect((await PostalCodeService.status()).error).toMatch(
		/^GeoNames has no cities or postal codes for Japan yet/,
	);
	PostalCodeService.fetcher = serve({
		"zip/JP.zip": new TextEncoder().encode("not a zip"),
	});
	await PostalCodeService.start("country", "Japan");
	await PostalCodeService.wait();
	expect((await PostalCodeService.status()).error).toMatch(/Not a zip/);
	expect(await PostalCodeRepository.count()).toBe(3); // untouched by the failures
	expect(
		(await PostalCodeService.status()).countries.map((c) => c.code),
	).toEqual(["SG", "TH"]);
});

test("a run that stops making progress is given up after the stall timeout: reported as failed, and a new download may start", async () => {
	// a run that never answers (the fetch hangs) — as after a dev-server reload mid-run
	PostalCodeService.fetcher = () => new Promise(() => {});
	expect(
		(await PostalCodeService.start("country", "Thailand")).status?.status,
	).toBe("downloading");
	expect((await PostalCodeService.start("country", "Thailand")).error).toMatch(
		/already running/,
	);
	(PostalCodeService as any).touchedAt = Date.now() - 6 * 60_000; // pretend nothing moved for 6 minutes
	expect(await PostalCodeService.status()).toMatchObject({
		status: "failed",
		error: "The download stopped making progress — try again",
	});
	expect(
		(await PostalCodeService.status()).countries.map((c) => c.code),
	).toEqual(["SG", "TH"]); // the table and its dates are untouched
	// …and the next run is allowed
	PostalCodeService.fetcher = serve({ "zip/TH.zip": zip({ "TH.txt": TH }) });
	expect(
		(await PostalCodeService.start("country", "Thailand")).error,
	).toBeUndefined();
	await PostalCodeService.wait();
	expect((await PostalCodeService.status()).status).toBe("ready");
});

test("cancel stops a stuck run at once: reported as failed, remove and a new download work again", async () => {
	PostalCodeService.fetcher = () => new Promise(() => {});
	await PostalCodeService.start("country", "Thailand");
	expect((await PostalCodeService.remove("TH")).error).toMatch(/running/);
	expect(await PostalCodeService.cancel()).toMatchObject({
		status: "failed",
		error: "The download was cancelled",
	});
	PostalCodeService.fetcher = serve({ "zip/TH.zip": zip({ "TH.txt": TH }) });
	expect(
		(await PostalCodeService.start("country", "Thailand")).error,
	).toBeUndefined();
	await PostalCodeService.wait();
	expect((await PostalCodeService.status()).status).toBe("ready");
});
