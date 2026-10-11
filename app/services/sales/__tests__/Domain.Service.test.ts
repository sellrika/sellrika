import { tmpdir } from "node:os"; // Bun has no equivalent
import { mkdirSync, rmSync } from "node:fs"; // Bun has no mkdir / rm of its own
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
// The module cache is shared across test files, so never `sql.close()` here.
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { app } = await import("@config/app");
const { domainToken } = await import("@helpers/crypto");
const { DomainService: _DomainService } = await import("../Domain.Service");
const Domains = Container.get(_DomainService);
const { StoreService: _StoreService } = await import("../Store.Service");
const StoreService = Container.get(_StoreService);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);

await migrate(true);

/**
 * The fake DNS: hostname → addresses, null = the lookup fails.
 * Every test sets the answers it needs.
 */
const dns: Record<string, string[] | null> = {};
Domains.lookup = async (host: string) =>
	host in dns ? (dns[host] ?? null) : null;

/**
 * The fake TXT records: hostname → texts.
 */
const txt: Record<string, string[]> = {};
Domains.txt = async (host: string) => txt[host] ?? [];

/**
 * Add the TXT record that proves a shop owns its domain.
 * @param shopId The shop.
 * @param domain Its domain.
 */
function prove(shopId: number, domain: string) {
	txt[`_sellrika.${domain}`] = [domainToken(shopId, domain)];
}

// the platform's setup: stores.test resolves to our one server
const saved = { ...app.domains };
const dir = `${tmpdir()}/pos-traefik-${process.pid}`;
mkdirSync(dir, { recursive: true });
app.domains.cname = "stores.test";
app.domains.traefikFile = `${dir}/sellrika-shops.yaml`;
app.domains.traefikService = "https-0-app@docker";
dns["stores.test"] = ["10.0.0.1"];
afterAll(() => {
	Object.assign(app.domains, saved);
	rmSync(dir, { recursive: true, force: true });
});

/**
 * A shop with a custom domain and a status.
 * @param domain The domain.
 * @param status Its status.
 * @returns The shop id.
 */
async function shopWith(domain: string, status: "pending" | "live") {
	const [s] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug, domain, domain_status) values ('Dom', 'USD', ${`dom-${domain.replaceAll(".", "-")}`}, ${domain}, ${status})`,
		sql`id`,
	);
	return s.id as number;
}

/**
 * The hostnames in the Traefik file now.
 * @returns The https routers' hosts, sorted.
 */
async function routed() {
	const cfg = JSON.parse(await Bun.file(app.domains.traefikFile).text());
	return Object.values(cfg.http.routers as Record<string, any>)
		.filter((r) => r.entryPoints[0] === "https")
		.map((r) => r.rule.slice(6, -2))
		.sort();
}

test("pointsHere: every address must be ours, and there must be one", () => {
	expect(_DomainService.pointsHere(["10.0.0.1"], ["10.0.0.1"])).toBe(true);
	expect(_DomainService.pointsHere([], ["10.0.0.1"])).toBe(false);
	// a leftover AAAA record elsewhere would make Let's Encrypt fail
	expect(
		_DomainService.pointsHere(["10.0.0.1", "2001:db8::1"], ["10.0.0.1"]),
	).toBe(false);
});

test("traefikConfig: with a wildcard, one router and one certificate serve every free store address", () => {
	const cfg = _DomainService.traefikConfig(["a.test"], "svc@docker", {
		domain: "shop.example.com",
		resolver: "cloudflare",
	});
	// a named service: the file brings none of its own
	expect("services" in cfg.http).toBe(false);
	const routers = cfg.http.routers as Record<string, any>;
	const rule = "HostRegexp(`^[a-z0-9-]+\\.shop\\.example\\.com$`)";
	expect(routers["sellrika-shop-wildcard"]).toEqual({
		rule,
		entryPoints: ["https"],
		middlewares: ["sellrika-shop-gzip"],
		service: "svc@docker",
		tls: {
			certResolver: "cloudflare",
			domains: [{ main: "shop.example.com", sans: ["*.shop.example.com"] }],
		},
	});
	expect(routers["sellrika-shop-wildcard-http"].rule).toBe(rule);
	// the pattern takes one label right under the store domain, nothing else
	const pattern = new RegExp(rule.slice("HostRegexp(`".length, -2));
	expect(pattern.test("corner-coffee.shop.example.com")).toBe(true);
	expect(pattern.test("a.b.shop.example.com")).toBe(false);
	expect(pattern.test("shop.example.com")).toBe(false);
	expect(pattern.test("xshopyexample.com")).toBe(false);
	// a custom domain keeps its own router and certificate
	expect(routers["sellrika-shop-a-test"].tls).toEqual({
		certResolver: "letsencrypt",
	});
});

test("traefikConfig: one https router with SSL and one redirect router per host", () => {
	const cfg = _DomainService.traefikConfig(["a.test"], "svc@docker");
	expect(cfg.http.routers).toEqual({
		"sellrika-shop-a-test": {
			rule: "Host(`a.test`)",
			entryPoints: ["https"],
			middlewares: ["sellrika-shop-gzip"],
			service: "svc@docker",
			tls: { certResolver: "letsencrypt" },
		},
		"sellrika-shop-a-test-http": {
			rule: "Host(`a.test`)",
			entryPoints: ["http"],
			middlewares: ["sellrika-shop-redirect"],
			service: "svc@docker",
		},
	});
	// the file brings its own middlewares: nothing is borrowed from the proxy's other files
	expect(cfg.http.middlewares).toEqual({
		"sellrika-shop-redirect": {
			redirectScheme: { scheme: "https", permanent: true },
		},
		"sellrika-shop-gzip": { compress: {} },
	});
});

test("traefikConfig: a plain Traefik gets our own service and its own names", () => {
	const cfg = _DomainService.traefikConfig(
		["a.test"],
		"",
		undefined,
		"http://sellrika:3000",
		{ http: "web", https: "websecure", certResolver: "le" },
	);
	const routers = cfg.http.routers as Record<string, any>;
	expect(routers["sellrika-shop-a-test"]).toMatchObject({
		entryPoints: ["websecure"],
		service: "sellrika-shop-app",
		tls: { certResolver: "le" },
	});
	expect(routers["sellrika-shop-a-test-http"].entryPoints).toEqual(["web"]);
	expect(cfg.http.services).toEqual({
		"sellrika-shop-app": {
			loadBalancer: { servers: [{ url: "http://sellrika:3000" }] },
		},
	});
});

test("run: a domain that points here goes live and into the file; one that doesn't waits", async () => {
	const ready = await shopWith("ready.test", "pending");
	const waiting = await shopWith("waiting.test", "pending");
	const hiccup = await shopWith("hiccup.test", "live");
	dns["ready.test"] = ["10.0.0.1"];
	dns["www.ready.test"] = ["10.0.0.1"];
	dns["waiting.test"] = ["192.0.2.9"];
	dns["hiccup.test"] = null; // the lookup fails: a live store stays live
	prove(ready, "ready.test");
	prove(waiting, "waiting.test");

	await Domains.run();
	expect((await ShopRepository.find(ready))!.domain_status).toBe("live");
	expect((await ShopRepository.find(waiting))!.domain_status).toBe("pending");
	expect((await ShopRepository.find(hiccup))!.domain_status).toBe("live");
	expect(await routed()).toEqual([
		"hiccup.test",
		"ready.test",
		"www.ready.test",
	]);

	// the file is only a copy of the database: deleted, the next run writes it again
	const before = await Bun.file(app.domains.traefikFile).text();
	rmSync(app.domains.traefikFile);
	await Domains.run();
	expect(await Bun.file(app.domains.traefikFile).text()).toBe(before);

	// the DNS moved away: back to pending, out of the file
	dns["ready.test"] = ["192.0.2.9"];
	await Domains.run();
	expect((await ShopRepository.find(ready))!.domain_status).toBe("pending");
	expect(await routed()).toEqual(["hiccup.test"]);
	await sql`delete from shops where id in (${ready}, ${waiting}, ${hiccup})`;
});

test("run: without the mounted folder nothing is written and nothing throws", async () => {
	const file = app.domains.traefikFile;
	app.domains.traefikFile = `${dir}/missing/sellrika-shops.yaml`;
	await Domains.run();
	expect(await Bun.file(app.domains.traefikFile).exists()).toBe(false);
	app.domains.traefikFile = file;
});

test("info: the records to add, and what the domain points at while it waits", async () => {
	dns["stores.test"] = ["10.0.0.1", "2001:db8::2"];
	dns["mine.test"] = ["192.0.2.9"];
	expect(await Domains.info(7, "mine.test", "pending")).toEqual({
		status: "pending",
		cname: "stores.test",
		ips: ["10.0.0.1"], // an A record takes IPv4 only
		found: ["192.0.2.9"],
		txt: { name: "_sellrika.mine.test", value: domainToken(7, "mine.test") },
	});
	expect((await Domains.info(7, "mine.test", "live"))!.found).toEqual([]);
	app.domains.cname = "";
	expect(await Domains.info(7, "mine.test", "pending")).toBeNull(); // nobody manages domains here
	app.domains.cname = "stores.test";
	dns["stores.test"] = ["10.0.0.1"];
});

test("saving the settings: a new domain waits, and goes live at once when its DNS is ready", async () => {
	const [s] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug) values ('Dom Save', 'USD', 'dom-save')`,
		sql`id`,
	);
	const input = (domain: string | null) =>
		({
			enabled: true,
			slug: "dom-save",
			domain,
			google_site_verification: null,
			template: "classic",
			credentials: {},
		}) as Parameters<typeof StoreService.updateSettings>[1];

	dns["later.test"] = null;
	await StoreService.updateSettings(s.id, input("later.test"));
	expect((await ShopRepository.find(s.id))!.domain_status).toBe("pending");

	dns["now.test"] = ["10.0.0.1"];
	prove(s.id, "now.test");
	await StoreService.updateSettings(s.id, input("now.test"));
	expect((await ShopRepository.find(s.id))!.domain_status).toBe("live");
	expect(await routed()).toContain("now.test");
	// saving other settings keeps the status
	await StoreService.updateSettings(s.id, input("now.test"));
	expect((await ShopRepository.find(s.id))!.domain_status).toBe("live");

	// no domain: no status, and out of the file
	await StoreService.updateSettings(s.id, input(null));
	expect((await ShopRepository.find(s.id))!.domain_status).toBe("");
	expect(await routed()).not.toContain("now.test");
	await sql`delete from shops where id = ${s.id}`;
});

test("free subdomain: an open store's <slug>.<store domain> is routed; the host finds the shop", async () => {
	app.domains.store = "shops.test";
	const [open] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug, online_enabled) values ('Sub Open', 'USD', 'sub-open', ${true})`,
		sql`id`,
	);
	const [closed] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug, online_enabled) values ('Sub Closed', 'USD', 'sub-closed', ${false})`,
		sql`id`,
	);
	dns["sub-open.shops.test"] = ["10.0.0.1"]; // the wildcard record
	dns["sub-closed.shops.test"] = ["10.0.0.1"];
	await Domains.run();
	expect(await routed()).toContain("sub-open.shops.test");
	expect(await routed()).not.toContain("sub-closed.shops.test"); // a store that is off gets no certificate

	// the request's host finds the shop: its subdomain, never a deeper or foreign name
	expect((await ShopRepository.findByHost("sub-open.shops.test"))?.id).toBe(
		open.id,
	);
	expect(await ShopRepository.findByHost("x.sub-open.shops.test")).toBeNull();
	expect(await ShopRepository.findByHost("sub-open.other.test")).toBeNull();
	await sql`delete from shops where id in (${open.id}, ${closed.id})`;
	app.domains.store = saved.store;
});

test("free subdomain: one that points here stands for the rest (one wildcard record)", async () => {
	app.domains.store = "shops.test";
	await sql`insert into shops (name, currency, slug, online_enabled) values ('Wild A', 'USD', 'wild-a', ${true}), ('Wild B', 'USD', 'wild-b', ${true})`;
	// only the first is in the fake DNS: the second is never looked up
	dns["wild-a.shops.test"] = ["10.0.0.1"];
	await Domains.run();
	expect(await routed()).toContain("wild-a.shops.test");
	expect(await routed()).toContain("wild-b.shops.test");
	await sql`delete from shops where slug in ('wild-a', 'wild-b')`;
	delete dns["wild-a.shops.test"];
	app.domains.store = saved.store;
});

test("reserved slugs: refused on the form, skipped when a slug is made from a name", async () => {
	const { OnlineStoreInput } = await import("@validators/Store.Validator");
	const { ShopService: _ShopService } = await import(
		"@services/settings/Shop.Service"
	);
	const form = (slug: string) =>
		OnlineStoreInput.safeParse({
			enabled: true,
			slug,
			template: "classic",
			credentials: {},
		}).success;
	expect(form("mail")).toBe(false);
	expect(form("pos")).toBe(false);
	expect(form("corner-coffee")).toBe(true);
	// a shop called "Mail" gets "mail-2", never the mail server's name
	expect(await Container.get(_ShopService).uniqueSlug("Mail")).toBe("mail-2");
});

test("a custom domain with sellrika.com in it is refused", async () => {
	const { OnlineStoreInput } = await import("@validators/Store.Validator");
	const form = (domain: string) =>
		OnlineStoreInput.safeParse({
			enabled: true,
			slug: "corner-coffee",
			domain,
			template: "classic",
			credentials: {},
		}).success;
	expect(form("sellrika.com")).toBe(false);
	expect(form("https://www.sellrika.com")).toBe(false);
	expect(form("cafe.shop.sellrika.com")).toBe(false);
	expect(form("cafe.com")).toBe(true);
});

test("ownership: a domain someone else pointed at us never goes live for a shop without its TXT record", async () => {
	// the real owner pointed victim.test at us but has not saved it; another shop saves it first
	dns["victim.test"] = ["10.0.0.1"];
	const [squatter] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug) values ('Squatter', 'USD', 'dom-squat')`,
		sql`id`,
	);
	const [owner] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug) values ('Owner', 'USD', 'dom-owner')`,
		sql`id`,
	);
	const input = (slug: string) =>
		({
			enabled: true,
			slug,
			domain: "victim.test",
			google_site_verification: null,
			template: "classic",
			credentials: {},
		}) as Parameters<typeof StoreService.updateSettings>[1];
	await StoreService.updateSettings(squatter.id, input("dom-squat"));
	expect((await ShopRepository.find(squatter.id))!.domain_status).toBe(
		"pending",
	);
	// a TXT value made for another shop proves nothing
	prove(owner.id, "victim.test");
	await Domains.run();
	expect((await ShopRepository.find(squatter.id))!.domain_status).toBe(
		"pending",
	);
	expect(await routed()).not.toContain("victim.test");

	// the real owner can still save it: a pending domain blocks nobody, and it goes live with the TXT
	expect(
		await StoreService.updateSettings(owner.id, input("dom-owner")),
	).toEqual({});
	expect((await ShopRepository.find(owner.id))!.domain_status).toBe("live");
	expect((await ShopRepository.find(squatter.id))!.domain).toBeNull();
	// now it is live, nobody else can save it
	expect(
		(await StoreService.updateSettings(squatter.id, input("dom-squat"))).errors
			?.domain,
	).toBeTruthy();
	await sql`delete from shops where id in (${squatter.id}, ${owner.id})`;
});

test("a domain that is not proved serves nothing; the exact host wins; the app's own hosts are refused", async () => {
	const { OnlineStoreInput } = await import("@validators/Store.Validator");
	app.domains.cname = "edge.shops.test";
	app.domains.store = "shops.test";
	const [real] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug, domain, domain_status) values ('Real', 'USD', 'dom-real', 'xyz-shop.test', 'live')`,
		sql`id`,
	);
	const [www] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug, domain, domain_status) values ('Www', 'USD', 'dom-www', 'www.xyz-shop.test', 'live')`,
		sql`id`,
	);
	const [waiting] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug, domain, domain_status) values ('Waiting', 'USD', 'dom-wait', 'waiting-shop.test', 'pending')`,
		sql`id`,
	);
	expect((await ShopRepository.findByHost("xyz-shop.test"))?.id).toBe(real.id);
	expect((await ShopRepository.findByHost("www.xyz-shop.test"))?.id).toBe(
		www.id,
	);
	expect(await ShopRepository.findByHost("waiting-shop.test")).toBeNull();
	// nobody manages domains: the merchant set up DNS alone, so a saved one counts
	app.domains.cname = "";
	expect((await ShopRepository.findByHost("waiting-shop.test"))?.id).toBe(
		waiting.id,
	);

	/**
	 * What the form makes of a typed domain.
	 * @param domain The typed text.
	 * @returns The parsed result.
	 */
	function typed(domain: string) {
		return OnlineStoreInput.safeParse({
			enabled: true,
			slug: "dom-real",
			domain,
			template: "classic",
		});
	}
	const ok = typed("https://www.www.Other-Shop.test/path");
	expect(ok.success && ok.data.domain).toBe("other-shop.test");
	for (const own of ["shops.test", "dom-www.shops.test", "edge.shops.test"]) {
		app.domains.cname = "edge.shops.test";
		expect(typed(own).success).toBe(false);
	}
	await sql`delete from shops where id in (${real.id}, ${www.id}, ${waiting.id})`;
	Object.assign(app.domains, saved);
});
