import { tmpdir } from "node:os"; // Bun has no equivalent
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`; // before any app import
process.env.APP_KEY ??= "test-app-key-for-extensions";
// EXTENSION_UPLOAD_DIR (a temp folder, never storage/) is pinned for the whole run by app/test.preload.ts
const { Db, sql } = await import("@xcore/database/Database");
const { migrate, migrationDb } = await import("@database/migrate");
const { ExtensionService: _ExtensionService } = await import(
	"../extensions/Extension.Service"
);
const ExtensionService = Container.get(_ExtensionService);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { ProductRepository: _ProductRepository } = await import(
	"@repositories/Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);
const { ExtensionHandles } = await import(
	"@controllers/support/Extension.Handles"
);
const { ExtensionMail } = await import(
	"@services/settings/extensions/Extension.Mail"
);
const { ApiCall } = await import("@xcore/api/ApiCall");
const { apiDocs } = await import("@xcore/api/OpenApi");
const { apiRoutes } = await import("@routes/api");
// an extension's functions are the API's own routes: load them once (another test file may have)
if (!apiDocs.length) apiRoutes();
const { CustomerService: _CustomerService } = await import(
	"@services/sales/Customer.Service"
);
const CustomerService = Container.get(_CustomerService);
const { PaymentMethodService: _PaymentMethodService } = await import(
	"@services/settings/PaymentMethod.Service"
);
const { SalesStaffService: _SalesStaffService } = await import(
	"@services/settings/SalesStaff.Service"
);
const { OrderService: _OrderService } = await import(
	"@services/sales/Order.Service"
);
const OrderService = Container.get(_OrderService);
const { DailyReportService: _DailyReportService } = await import(
	"@services/sales/DailyReport.Service"
);
const DailyReportService = Container.get(_DailyReportService);
const { zip } = await import("@helpers/zip");
const { ExtensionFiles } = await import("@xcore/extensions/ExtensionFiles");

await migrate(true);

const [s] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Ext Store', 'USD', 'UTC', 'ext-store', ${true})`,
	sql`id`,
);
const S = s.id as number;
const shop = (await ShopRepository.find(S))!;
const order = {
	id: 9,
	reference: "P8J4-MJSQ-4Z8T",
	total: 1450,
	items: [{ name: "Mug", qty: 2 }],
} as any;
const admin = { id: 1, name: "Admin", email: "a@x.io", role: "admin" } as any;

/**
 * The functions of shop S that have no API route, as the controller builds them.
 * @returns `products.idBySku`, `orders.openFor` and `customers`.
 */
function own(userId?: number) {
	return new ExtensionHandles(
		ProductRepository,
		OrderService,
		CustomerService,
		Container.get(_PaymentMethodService),
		Container.get(_SalesStaffService),
	).for(S, userId);
}

/**
 * Everything an extension route gets, called as one user of shop S.
 * @param user Who the functions run as.
 * @returns The API's functions joined with the ones that have no route.
 */
function functionsAs(user: unknown) {
	const api = ApiCall.functions(async () => ({ shop, user: user as never }));
	const extra = own();
	return {
		...api,
		products: { ...api.products, ...extra.products },
		orders: { ...api.orders, ...extra.orders },
		customers: extra.customers,
	} as any;
}

const realFetch = globalThis.fetch;
const realLookup = Bun.dns.lookup;
// every name is public here, except intranet.example.com (the webhook's checked sender asks)
Bun.dns.lookup = (async (host: string) => [
	{
		address: host.startsWith("intranet") ? "10.0.0.5" : "93.184.216.34",
		family: 4,
		ttl: 1,
	},
]) as any;
afterAll(async () => {
	globalThis.fetch = realFetch;
	Bun.dns.lookup = realLookup;
	await ExtensionFiles.remove(process.env.EXTENSION_UPLOAD_DIR!);
});
const calls: { url: string; headers: Record<string, string>; body: string }[] =
	[];
globalThis.fetch = (async (url: any, init: any) => {
	calls.push({ url: String(url), headers: init.headers, body: init.body });
	return new Response("", { status: 200 });
}) as any;

const asFile = (bytes: Uint8Array, name = "ext.zip") =>
	new File([bytes.slice().buffer as ArrayBuffer], name, {
		type: "application/zip",
	});
/**
 * Zip one of the example folders as an admin would.
 * @param name The folder in extensions/.
 * @param skip A file to leave out, to test a broken upload.
 * @returns The zip as an uploaded file.
 */
async function example(name: string, skip = "") {
	const dir = `${import.meta.dir}/../../../../extensions/${name}`;
	const files: Record<string, Uint8Array> = {};
	for await (const rel of new Bun.Glob("**/*").scan({ cwd: dir }))
		if (!rel.startsWith("dist/") && rel !== skip)
			files[rel] = new Uint8Array(
				await Bun.file(`${dir}/${rel}`).arrayBuffer(),
			);
	return asFile(zip(files));
}
const manifest = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		key: "greeter",
		name: "Greeter",
		version: "1.0.0",
		description: "Says hi",
		fields: [{ name: "greeting", label: "Greeting", required: true }],
		...over,
	});
/** A listener that writes what it saw to `globalThis.__seen` — the test reads it back. */
const module = (tag: string) =>
	`export default { "order.created": async ({ shop, config, order }) => { (globalThis.__seen ??= []).push("${tag}:" + config.greeting + ":" + order.id + ":" + shop.name); } };`;
const seen = () => ((globalThis as any).__seen ?? []) as string[];

/**
 * Put an extension to work in shop S the way it happens in the app.
 * The platform admin adds the zip and switches it on for all shops.
 * The shop owner then enables it: on at once when there is nothing to set up.
 * @param answer What the upload answered.
 * @returns The same answer.
 */
async function enableFor<A extends { key?: string }>(answer: A): Promise<A> {
	if (!answer.key) return answer;
	await ExtensionService.setGlobal(answer.key, true);
	const row = (await ExtensionService.list(S)).find(
		(e) => e.key === answer.key,
	)!;
	if (!row.installed)
		await ExtensionService.save(S, answer.key, {
			enabled: !row.payment && row.fields.every((f) => !f.required),
		});
	return answer;
}

/**
 * Add a zip to the platform and enable it for shop S.
 * @param file The zip.
 * @returns What the upload answered.
 */
async function install(file: File) {
	return enableFor(await ExtensionService.upload(file));
}

/**
 * The same from an https link.
 * @param url The link.
 * @returns What the download answered.
 */
install.url = async function installUrl(url: string) {
	return enableFor(await ExtensionService.fromUrl(url));
};

/**
 * Delete an uploaded extension from the platform and forget shop S's settings.
 * @param key The extension key.
 */
async function uninstall(key: string) {
	expect(await ExtensionService.remove(key)).toEqual({});
	await sql`delete from shop_extensions where ${sql("key")} = ${key}`;
}
const req = (method: string, path: string) =>
	new Request(`http://pos.test${path}`, { method });

test("the list starts empty; bad zips are refused with a reason and leave nothing behind", async () => {
	expect(await ExtensionService.list(S)).toEqual([]);
	expect(
		(await ExtensionService.save(S, "nope", { enabled: true, config: {} }))
			.errors,
	).toEqual({ key: "Unknown extension" });
	const err = async (bytes: Uint8Array) =>
		(await install(asFile(bytes))).errors?.file;
	expect(await err(new TextEncoder().encode("not a zip"))).toBe(
		"Not a zip file",
	);
	expect(await err(zip({ "index.js": "export default {}" }))).toBe(
		"The zip has no extension.json at its root",
	);
	expect(await err(zip({ "extension.json": "{ nope", "index.js": "" }))).toBe(
		"extension.json is not valid JSON",
	);
	expect(
		await err(
			zip({ "extension.json": manifest({ key: "Bad Key" }), "index.js": "" }),
		),
	).toBe("extension.json: key: 2–50 lower-case letters, digits and dashes");
	expect(
		await err(
			zip({
				"extension.json": manifest({
					fields: [{ name: "rows", label: "Rows", type: "list" }],
				}),
				"index.js": "",
			}),
		),
	).toBe("extension.json: fields are required for list, and only there");
	expect(
		await err(
			zip({
				"extension.json": manifest({
					fields: [{ name: "wide", label: "Wide", grid: 9 }],
				}),
				"index.js": "",
			}),
		),
	).toMatch(/^extension\.json: /); // grid is 1–8
	expect(
		await err(
			zip({
				"extension.json": manifest({
					fields: [
						{
							name: "rows",
							label: "Rows",
							type: "list",
							fields: [{ name: "k", label: "K", secret: true }],
						},
					],
				}),
				"index.js": "",
			}),
		),
	).toBe("extension.json: a list's fields can't be secret or another list");
	expect(
		await err(
			zip({
				"extension.json": manifest({
					slots: [{ name: "nope.slot", script: "assets/x.js" }],
				}),
				"index.js": "",
			}),
		),
	).toMatch(/^extension\.json: /);
	expect(
		await err(
			zip({
				"extension.json": manifest({
					pages: [{ path: "p", title: "P", script: "p.js" }],
				}),
				"index.js": "",
				"p.js": "",
			}),
		),
	).toBe(
		"extension.json: script must be a .js, .ts or .tsx file under assets/",
	);
	expect(
		await err(
			zip({
				"extension.json": manifest({
					pages: [{ path: "p", title: "P", script: "assets/p.js" }],
				}),
				"index.js": "",
			}),
		),
	).toBe("extension.json points at assets/p.js, which is not in the zip");
	expect(
		await err(
			zip({ "extension.json": manifest(), "index.js": "", "../evil.js": "" }),
		),
	).toBe("Unsafe file name in the zip: ../evil.js");
	expect(
		await err(
			zip({
				"extension.json": manifest({ main: "lib/run.js" }),
				"index.js": "",
			}),
		),
	).toBe("extension.json points at lib/run.js, which is not in the zip");
	expect(
		await err(
			zip({
				"extension.json": manifest(),
				"index.js": "export const nothing = 1;",
			}),
		),
	).toBe(
		"index.js: index.js must `export default` listeners, or `export const routes` / `publicRoutes` / `payment`",
	);
	expect(
		await err(
			zip({
				"extension.json": manifest(),
				"index.js": "this is not javascript (",
			}),
		),
	).toMatch(/^index\.js: /);
	expect(await ExtensionService.list(S)).toEqual([]);
	expect(
		await Array.fromAsync(
			new Bun.Glob("**/*").scan({
				cwd: process.env.EXTENSION_UPLOAD_DIR!,
				onlyFiles: true,
			}),
		),
	).toEqual([]);
});

test("webhook example: uploaded, needs a webhook row (URL + events), secrets encrypted and never echoed, blank keeps them, signed POST on emit() to the rows that picked the event", async () => {
	expect(await install(await example("webhook"))).toEqual({
		key: "webhook",
	});
	let [row] = await ExtensionService.list(S);
	expect([row!.installed, row!.enabled, row!.ready]).toEqual([
		true,
		false,
		false,
	]); // has a required field → starts off
	expect(
		(await ExtensionService.save(S, "webhook", { enabled: true, config: {} }))
			.errors,
	).toEqual({ "config.hooks": "Webhooks is required" });
	// a row is checked like top-level fields, the error names the row and the sub-field
	expect(
		(
			await ExtensionService.save(S, "webhook", {
				enabled: true,
				config: { hooks: [{ url: "ftp://x", events: ["order.created"] }] },
			})
		).errors,
	).toEqual({ "config.hooks.0.url": "Enter a full http(s) URL" });
	expect(
		(
			await ExtensionService.save(S, "webhook", {
				enabled: false,
				config: { hooks: [{ url: "https://hooks.example.com/pos" }] },
			})
		).errors,
	).toEqual({ "config.hooks.0.events": "Events is required" });
	expect(
		(
			await ExtensionService.save(S, "webhook", {
				enabled: true,
				config: {
					hooks: [{ url: "https://hooks.example.com/pos", events: ["nope"] }],
				},
			})
		).errors,
	).toEqual({ "config.hooks.0.events": "Pick from the options" });
	expect(
		await ExtensionService.save(S, "webhook", {
			enabled: false,
			config: { secret: "s3cret" },
		}),
	).toEqual({}); // off → may stay half-filled
	[row] = await ExtensionService.list(S);
	expect(row!.config).toEqual({ secret: "", hooks: [] }); // secret never echoed
	expect(row!.secret_set).toEqual({ secret: true });
	expect(
		(await sql`select config from shop_extensions where shop_id = ${S}`)[0]
			.config,
	).not.toContain("s3cret"); // stored encrypted
	const hooks = [
		{ url: "https://hooks.example.com/pos", events: ["order.created"] },
		{
			url: "https://hooks.example.com/paid",
			events: ["order.paid", "order.created"],
		},
	];
	expect(
		await ExtensionService.save(S, "webhook", {
			enabled: true,
			config: { secret: "", hooks },
		}),
	).toEqual({});
	[row] = await ExtensionService.list(S);
	expect([row!.enabled, row!.ready, row!.config.hooks]).toEqual([
		true,
		true,
		hooks,
	]);
	expect(
		(await ExtensionService.running(S, "order.created"))[0]!.config,
	).toEqual({ secret: "s3cret", hooks }); // blank kept the secret, decrypted for the listener
	await ExtensionService.save(S, "webhook", { enabled: false }); // the switch alone: config left out keeps everything
	expect(await ExtensionService.running(S, "order.created")).toEqual([]);
	await ExtensionService.save(S, "webhook", { enabled: true });

	await ExtensionService.emit("order.created", shop, { order });
	expect(calls.map((c) => c.url).sort()).toEqual([
		"https://hooks.example.com/paid",
		"https://hooks.example.com/pos",
	]); // both rows picked it
	calls.sort((a, b) => a.url.localeCompare(b.url)).reverse();
	expect(calls[0]!.url).toBe("https://hooks.example.com/pos");
	expect(calls[0]!.headers["x-pos-event"]).toBe("order.created");
	const body = JSON.parse(calls[0]!.body);
	expect(body.shop).toEqual({ id: S, name: "Ext Store", currency: "USD" });
	expect(body.order.reference).toBe("P8J4-MJSQ-4Z8T");
	expect(calls[0]!.headers["x-pos-signature"]).toBe(
		`sha256=${new Bun.CryptoHasher("sha256", "s3cret").update(calls[0]!.body).digest("hex")}`,
	);
	await ExtensionService.emit("order.paid", shop, { order }); // only the second row ticked it
	expect(calls.length).toBe(3);
	expect(calls[2]!.url).toBe("https://hooks.example.com/paid");
	await ExtensionService.emit("order.voided", shop, { order, reason: "x" }); // nobody ticked it → no POST
	expect(calls.length).toBe(3);
	globalThis.fetch = (async () => {
		throw new Error("offline");
	}) as any; // the receiver is down: logged, not thrown
	await expect(
		ExtensionService.emit("order.created", shop, { order }),
	).resolves.toBeUndefined();
	globalThis.fetch = (async () => {
		throw new Error("must not be called");
	}) as any;
	await uninstall("webhook");
	expect(await ExtensionService.list(S)).toEqual([]);
	await expect(
		ExtensionService.emit("order.created", shop, { order }),
	).resolves.toBeUndefined();
});

test("chat-alerts example: one text per ticked event to every filled channel (Slack, Discord, LINE); low stock only when the unit crosses its line; the daily report goes once a day to the picked channels", async () => {
	calls.length = 0;
	globalThis.fetch = (async (url: any, init: any) => {
		calls.push({ url: String(url), headers: init.headers, body: init.body });
		return new Response("", { status: 200 });
	}) as any;
	expect(await install(await example("chat-alerts"))).toEqual({
		key: "chat-alerts",
	});
	// a field's hint is a dictionary key too, shown under the box in the request's language
	expect(
		(await ExtensionService.list(S))
			.find((e) => e.key === "chat-alerts")!
			.fields.find((x) => x.name === "line_token")?.hint,
	).toBe("LINE Official Account › Messaging API › long-lived token");
	expect(
		(
			await ExtensionService.save(S, "chat-alerts", {
				enabled: true,
				config: { events: ["order.pos"], slack_url: "https://example.com/x" },
			})
		).errors,
	).toEqual({
		"config.slack_url":
			"Slack — incoming webhook URLs start with https://hooks.slack.com/",
	});
	const config = {
		events: ["order.online", "order.paid", "stock.low"],
		slack_url: "https://hooks.slack.com/services/T/B/x",
		discord_url: "https://discord.com/api/webhooks/1/y",
		line_token: "line-secret",
		line_to: "",
	};
	expect(
		await ExtensionService.save(S, "chat-alerts", { enabled: true, config }),
	).toEqual({});
	const online = {
		...order,
		fulfillment: "new",
		payment_status: "unpaid",
		payment_method: "Bank transfer",
		note: "Ann, 12 Main St",
	};
	await ExtensionService.emit("order.created", shop, { order: online });
	expect(calls.map((c) => new URL(c.url).host).sort()).toEqual([
		"api.line.me",
		"discord.com",
		"hooks.slack.com",
	]);
	const text = JSON.parse(
		calls.find((c) => c.url.startsWith("https://hooks.slack.com"))!.body,
	).text;
	expect(text).toBe(
		"🛒 New online order P8J4-MJSQ-4Z8T — Ext Store\n$14.50 · UNPAID — Bank transfer\n\n2 × Mug\n\nAnn, 12 Main St",
	);
	expect(
		JSON.parse(
			calls.find((c) => c.url.startsWith("https://discord.com"))!.body,
		),
	).toEqual({ content: text });
	const line = calls.find((c) => c.url.startsWith("https://api.line.me"))!;
	expect([line.url, line.headers.authorization, JSON.parse(line.body)]).toEqual(
		[
			"https://api.line.me/v2/bot/message/broadcast",
			"Bearer line-secret",
			{ messages: [{ type: "text", text }] },
		],
	); // no ID → broadcast
	calls.length = 0;
	await ExtensionService.emit("order.created", shop, { order }); // a POS sale, not ticked
	await ExtensionService.emit("order.paid", shop, { order }); // "paid later" listens to the status change, not to order.paid
	await ExtensionService.emit("order.status_changed", shop, {
		order,
		field: "fulfillment",
		from: "new",
		to: "packing",
	});
	expect(calls.length).toBe(0);
	await ExtensionService.emit("order.status_changed", shop, {
		order: { ...order, payment_method: "Cash on delivery" },
		field: "payment_status",
		from: "unpaid",
		to: "paid",
	});
	expect(JSON.parse(calls[0]!.body).text).toBe(
		"💰 Order P8J4-MJSQ-4Z8T paid — $14.50 with Cash on delivery — Ext Store",
	);
	calls.length = 0;
	const movement = {
		product_id: 1,
		variant_id: 2,
		type: "sale",
		qty: -2,
	} as any;
	await ExtensionService.emit("stock.updated", shop, {
		movement,
		unit: { name: "Tee", variant: "Red", stock: 1, low_stock_at: 2 },
	}); // 3 → 1 crosses the line
	expect(JSON.parse(calls[0]!.body).text).toBe(
		"⚠️ Low stock: Tee — Red — 1 left (low at 2) — Ext Store",
	);
	calls.length = 0;
	await ExtensionService.emit("stock.updated", shop, {
		movement: { ...movement, qty: -1 },
		unit: { name: "Tee", variant: "Red", stock: 1, low_stock_at: 2 },
	}); // 2 → 1: already low, no repeat
	await ExtensionService.emit("stock.updated", shop, {
		movement: { ...movement, qty: 5, type: "adjustment" },
		unit: { name: "Tee", variant: "Red", stock: 6, low_stock_at: 2 },
	}); // restocked
	expect(calls.length).toBe(0);
	await ExtensionService.emit("stock.updated", shop, {
		movement: { ...movement, variant_id: null, qty: -1 },
		unit: { name: "Mug", variant: null, stock: 0, low_stock_at: 0 },
	}); // the default line: out of stock
	expect(JSON.parse(calls[0]!.body).text).toBe(
		"⚠️ Out of stock: Mug — Ext Store",
	);
	calls.length = 0;

	// the daily report: only the channels the shop picked on /reports get it
	await ExtensionService.emit("report.daily", shop, {
		report: {
			date: "2026-10-06",
			summary: {
				orders: 3,
				sales: 4500,
				refunds: 500,
				revenue: 4000,
				profit: 1800,
			} as any,
			top_products: [{ name: "Mug", qty: 4, revenue: 2900 }],
			by_method: [{ method: "Cash", orders: 3, sales: 4500 }],
		},
		channels: ["slack"],
	});
	expect(calls.map((c) => new URL(c.url).host)).toEqual(["hooks.slack.com"]);
	expect(JSON.parse(calls[0]!.body).text).toBe(
		"📊 Daily report 2026-10-06 — Ext Store\nSales: $45 · 3 orders\nRefunds: $5\nNet revenue: $40\nGross profit: $18\n\nTop products\n4 × Mug — $29\n\nPayment methods\nCash: $45 (3)",
	);
	calls.length = 0;

	// the settings on /reports: a channel must be filled in Chat alerts
	expect(await DailyReportService.channels(shop)).toEqual([
		"slack",
		"discord",
		"line",
	]);
	const at = (hhmm: string, day = "06") =>
		new Date(`2026-10-${day}T${hhmm}:00Z`); // the shop's clock is UTC
	expect(
		await DailyReportService.save(
			shop,
			{ enabled: true, time: "22:00", channels: [] },
			at("21:00"),
		),
	).toEqual({ channels: "Pick at least one channel." });
	expect(
		await DailyReportService.save(
			shop,
			{ enabled: true, time: "22:00", channels: ["discord"] },
			at("21:00"),
		),
	).toBeNull();
	expect(
		await DailyReportService.settings((await ShopRepository.find(S))!),
	).toMatchObject({
		enabled: true,
		time: "22:00",
		channels: ["discord"],
	});
	// not yet time; then once at the time; never twice on one day; again the next day
	expect(await DailyReportService.run(at("21:59"))).toBe(0);
	expect(await DailyReportService.run(at("22:00"))).toBe(1);
	await ExtensionService.idle();
	expect(calls.map((c) => new URL(c.url).host)).toEqual(["discord.com"]);
	expect(JSON.parse(calls[0]!.body).content).toBe(
		"📊 Daily report 2026-10-06 — Ext Store\nNo sales today.",
	);
	expect(await DailyReportService.run(at("22:05"))).toBe(0);
	expect(await DailyReportService.run(at("21:00", "07"))).toBe(0);
	expect(await DailyReportService.run(at("23:30", "07"))).toBe(1); // late (server was down): still that day's
	await ExtensionService.idle();
	// saved after today's time has passed: the first one goes out tomorrow
	const fresh = (await ShopRepository.find(S))!;
	expect(
		await DailyReportService.save(
			fresh,
			{ enabled: true, time: "08:00", channels: ["discord"] },
			at("09:00", "08"),
		),
	).toBeNull();
	expect(await DailyReportService.run(at("09:01", "08"))).toBe(0);
	expect(await DailyReportService.run(at("08:00", "09"))).toBe(1);
	await ExtensionService.idle();
	// switched off: nothing goes out
	expect(
		await DailyReportService.save(
			fresh,
			{ enabled: false, time: "08:00", channels: [] },
			at("09:00", "09"),
		),
	).toBeNull();
	expect(await DailyReportService.run(at("08:00", "10"))).toBe(0);
	await uninstall("chat-alerts");
	// without the extension no channel works, so it can't be switched on
	expect(await DailyReportService.channels(shop)).toEqual([]);
	expect(
		await DailyReportService.save(
			shop,
			{ enabled: true, time: "22:00", channels: ["slack"] },
			at("21:00"),
		),
	).toEqual({ channels: "Pick at least one channel." });
	calls.length = 0;
});

test("upload: per shop, a re-upload upgrades and keeps the settings, a handler that throws answers 500, remove deletes the files", async () => {
	// GitHub-style zip with one top folder: stripped
	const boom = `export const routes = { "GET /boom": () => { throw new Error("kaboom"); } };`;
	expect(
		await install(
			asFile(
				zip({
					"greeter-main/extension.json": manifest(),
					"greeter-main/index.js": module("v1") + boom,
				}),
			),
		),
	).toEqual({ key: "greeter" });
	expect(
		(await ExtensionService.list(S)).map((e) => [
			e.key,
			e.version,
			e.installed,
			e.enabled,
			e.ready,
		]),
	).toEqual([["greeter", "1.0.0", true, false, false]]);
	const [other] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, slug) values ('Other', 'USD', 'UTC', 'other-ext')`,
		sql`id`,
	);
	expect(
		(await ExtensionService.list(other.id)).map((e) => [e.key, e.installed]),
	).toEqual([["greeter", false]]); // on for all shops, but each shop enables it itself
	expect(
		await ExtensionService.save(S, "greeter", {
			enabled: true,
			config: { greeting: "Hi" },
		}),
	).toEqual({});
	await ExtensionService.emit("order.created", shop, { order });
	expect(seen()).toEqual(["v1:Hi:9:Ext Store"]);
	expect(
		(
			await ExtensionService.handle(
				"routes",
				shop,
				"greeter",
				req("GET", "/ext/greeter/boom"),
				"/boom",
				{ user: admin },
			)
		).status,
	).toBe(500);

	expect(
		await install(
			asFile(
				zip({
					"extension.json": manifest({ version: "1.1.0" }),
					"index.js": module("v2"),
				}),
			),
		),
	).toEqual({ key: "greeter" });
	const [row] = await ExtensionService.list(S);
	expect([row!.version, row!.enabled, row!.ready]).toEqual([
		"1.1.0",
		true,
		true,
	]);
	await ExtensionService.emit("order.created", shop, { order });
	expect(seen()).toEqual(["v1:Hi:9:Ext Store", "v2:Hi:9:Ext Store"]);
	const home = `${process.env.EXTENSION_UPLOAD_DIR}/platform/greeter`;
	expect(
		await Array.fromAsync(
			new Bun.Glob("*").scan({ cwd: home, onlyFiles: false }),
		),
	).toHaveLength(1); // the old version is gone

	expect(
		await install(
			asFile(
				zip({
					"extension.json": manifest({
						key: "plain",
						name: "Plain",
						fields: [],
					}),
					"index.js": "export default {}",
				}),
			),
		),
	).toEqual({ key: "plain" });
	expect(
		(await ExtensionService.list(S)).find((e) => e.key === "plain"),
	).toMatchObject({ installed: true, enabled: true, ready: true }); // nothing to set up → on at once
	await uninstall("greeter");
	await uninstall("plain");
	expect(await ExtensionService.list(S)).toEqual([]);
	expect(await Bun.file(`${home}/extension.json`).exists()).toBe(false);
});

test("field types: each control's value is checked against the manifest and stored by type; the listener gets typed config", async () => {
	const fields = [
		{ name: "note", label: "Note", multiline: true },
		{ name: "hook", label: "Hook", type: "url" },
		{
			name: "markup",
			label: "Markup",
			type: "number",
			min: 0,
			max: 100,
			required: true,
		},
		{
			name: "region",
			label: "Region",
			type: "select",
			options: [
				{ value: "eu", label: "EU" },
				{ value: "us", label: "US" },
			],
			required: true,
		},
		{
			name: "tags",
			label: "Tags",
			type: "multiselect",
			options: [
				{ value: "new", label: "New" },
				{ value: "sale", label: "Sale" },
			],
		},
		{ name: "featured", label: "Featured", type: "switch" },
		{ name: "agree", label: "Agree", type: "checkbox", required: true },
		{ name: "accent", label: "Accent", type: "color" },
		{ name: "banner", label: "Banner", type: "image" },
	];
	const bad = async (over: Record<string, unknown>) =>
		(
			await install(
				asFile(
					zip({
						"extension.json": manifest({
							key: "typed",
							fields: [{ ...fields[2], ...over }],
						}),
						"index.js": "export default {}",
					}),
				),
			)
		).errors?.file;
	expect(await bad({ type: "rainbow" })).toMatch(/^extension\.json: /);
	expect(await bad({ type: "select" })).toBe(
		"extension.json: options are required for select and multiselect, and only there",
	);
	expect(
		await bad({ type: "number", options: [{ value: "a", label: "A" }] }),
	).toBe(
		"extension.json: options are required for select and multiselect, and only there",
	);
	expect(await bad({ type: "switch", secret: true })).toBe(
		"extension.json: secret is only for text and url fields",
	);
	const seenCfg = `export default { "order.created": async ({ config }) => { globalThis.__cfg = config; } };`;
	expect(
		await install(
			asFile(
				zip({
					"extension.json": manifest({ key: "typed", fields }),
					"index.js": seenCfg,
				}),
			),
		),
	).toEqual({ key: "typed" });
	let [row] = (await ExtensionService.list(S)).filter((e) => e.key === "typed");
	expect(row!.config).toEqual({
		note: "",
		hook: "",
		markup: "",
		region: "",
		tags: [],
		featured: false,
		agree: false,
		accent: "",
		banner: "",
	}); // blanks by type
	const err = async (config: Record<string, unknown>) =>
		(
			await ExtensionService.save(S, "typed", {
				enabled: true,
				config: config as any,
			})
		).errors;
	const ok = { markup: "12", region: "eu", agree: true };
	expect(await err({ ...ok, markup: "lots" })).toEqual({
		"config.markup": "Enter a number",
	});
	expect(await err({ ...ok, markup: 250 })).toEqual({
		"config.markup": "Must be at most 100",
	});
	expect(await err({ ...ok, markup: "" })).toEqual({
		"config.markup": "Markup is required",
	});
	expect(await err({ ...ok, region: "asia" })).toEqual({
		"config.region": "Pick one of the options",
	});
	expect(await err({ ...ok, region: "" })).toEqual({
		"config.region": "Region is required",
	});
	expect(await err({ ...ok, tags: ["new", "old"] })).toEqual({
		"config.tags": "Pick from the options",
	});
	expect(await err({ ...ok, hook: "nope" })).toEqual({
		"config.hook": "Enter a full http(s) URL",
	});
	expect(await err({ ...ok, accent: "reddish" })).toEqual({
		"config.accent": "Pick a colour",
	});
	// a picture is an upload of this site or an https link — never javascript: in a src
	expect(await err({ ...ok, banner: "javascript:alert(1)" })).toEqual({
		"config.banner": "Enter a full http(s) URL",
	});
	expect(await err({ ...ok, agree: false })).toBeUndefined(); // a checkbox is always "filled": required only means "the field exists"
	expect(
		await ExtensionService.save(S, "typed", {
			enabled: true,
			config: {
				...ok,
				note: " hi ",
				tags: ["sale", "sale"],
				featured: "1",
				hook: "https://x.io/h",
				accent: "#5B6CFF",
				banner: "/uploads/hero.png",
			},
		}),
	).toEqual({});
	[row] = (await ExtensionService.list(S)).filter((e) => e.key === "typed");
	expect(row!.config).toEqual({
		note: "hi",
		hook: "https://x.io/h",
		markup: 12,
		region: "eu",
		tags: ["sale"],
		featured: true,
		agree: true,
		accent: "#5b6cff",
		banner: "/uploads/hero.png",
	}); // stored by type, trimmed, de-duplicated
	expect(row!.ready).toBe(true);
	await ExtensionService.emit("order.created", shop, { order });
	expect((globalThis as any).__cfg).toEqual({
		note: "hi",
		hook: "https://x.io/h",
		markup: 12,
		region: "eu",
		tags: ["sale"],
		featured: true,
		agree: true,
		accent: "#5b6cff",
		banner: "/uploads/hero.png",
	});
	await uninstall("typed");
});

test("fromUrl: https only, size and status checked, then the same install as an upload", async () => {
	expect(await install.url("http://x.io/a.zip")).toEqual({
		errors: { url: "Enter an https:// link to a .zip file" },
	});
	expect(await install.url("not a link")).toEqual({
		errors: { url: "Enter an https:// link to a .zip file" },
	});
	const bytes = zip({
		"extension.json": manifest({ key: "linked", name: "Linked", fields: [] }),
		"index.js": "export default {}",
	}).slice().buffer as ArrayBuffer;
	const was = globalThis.fetch;
	let answer: () => Response = () =>
		new Response(bytes, { headers: { "content-type": "application/zip" } });
	globalThis.fetch = (async () => answer()) as any;
	try {
		expect(await install.url("https://x.io/linked.zip")).toEqual({
			key: "linked",
		});
		expect(
			(await ExtensionService.list(S)).find((e) => e.key === "linked"),
		).toMatchObject({ installed: true, enabled: true });
		answer = () => new Response("nope", { status: 404 });
		expect(await install.url("https://x.io/gone.zip")).toEqual({
			errors: { url: "The link answered HTTP 404" },
		});
		answer = () =>
			new Response(bytes, {
				headers: { "content-length": String(6 * 1024 * 1024) },
			});
		expect(await install.url("https://x.io/big.zip")).toEqual({
			errors: { url: "The zip must be 5 MB or smaller" },
		});
		answer = () => new Response("not a zip");
		expect(
			(await install.url("https://x.io/text.zip")).errors?.url,
		).toBeString(); // upload's refusal, under url
	} finally {
		globalThis.fetch = was;
	}
	await uninstall("linked");
});

test("the logo is served while the extension is off; secrets saved under another APP_KEY show as a problem instead of Ready", async () => {
	const icon = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // a PNG header is enough for a file
	const m = manifest({
		key: "keyed",
		name: "Keyed",
		icon: "assets/icon.png",
		fields: [{ name: "token", label: "Token", secret: true, required: true }],
	});
	expect(
		await install(
			asFile(
				zip({
					"extension.json": m,
					"index.js": "export default {}",
					"assets/icon.png": icon,
					"assets/app.js": "export default () => {};",
				}),
			),
		),
	).toEqual({ key: "keyed" });
	/**
	 * Staff ask for the extension's page script.
	 * @returns The response.
	 */
	function script() {
		return ExtensionService.handle(
			"routes",
			shop,
			"keyed",
			req("GET", "/ext/keyed/assets/app.js"),
			"/assets/app.js",
			{ user: admin },
		);
	}
	const asset = () =>
		ExtensionService.handle(
			"routes",
			shop,
			"keyed",
			req("GET", "/ext/keyed/assets/icon.png"),
			"/assets/icon.png",
			{ user: admin },
		);
	expect(
		(await ExtensionService.list(S)).find((e) => e.key === "keyed"),
	).toMatchObject({
		icon: "/ext/keyed/assets/icon.png?v=1.0.0",
		enabled: false,
		ready: false,
		problem: null,
	});
	expect((await asset()).status).toBe(200); // the list shows the logo of an extension that is still off
	expect(
		(
			await ExtensionService.handle(
				"routes",
				shop,
				"keyed",
				req("GET", "/ext/keyed/x"),
				"/x",
				{ user: admin },
			)
		).status,
	).toBe(404); // routes still need it running
	expect((await script()).status).toBe(404); // and so do its other files
	expect(
		await ExtensionService.save(S, "keyed", {
			enabled: true,
			config: { token: "t0k" },
		}),
	).toEqual({});
	expect(
		(await ExtensionService.list(S)).find((e) => e.key === "keyed"),
	).toMatchObject({ enabled: true, ready: true, problem: null });
	expect((await script()).status).toBe(200);
	const key = process.env.APP_KEY;
	process.env.APP_KEY = "a-different-key-after-a-redeploy";
	try {
		const row = (await ExtensionService.list(S)).find(
			(e) => e.key === "keyed",
		)!;
		expect([row.enabled, row.ready]).toEqual([true, false]);
		expect(row.problem).toContain("APP_KEY changed");
		expect(await ExtensionService.active(S, "keyed")).toBeNull(); // nothing runs, but the page now says why
		expect((await asset()).status).toBe(200); // the logo still shows
	} finally {
		process.env.APP_KEY = key;
	}
	expect(
		(await ExtensionService.list(S)).find((e) => e.key === "keyed"),
	).toMatchObject({ ready: true, problem: null });
	await uninstall("keyed");
});

test("payment gateways: the module must be able to take money, one runs per shop, and its checkout script is served from the store URL", async () => {
	const gw = (key: string, over: Record<string, unknown> = {}) =>
		manifest({
			key,
			name: key === "gw-a" ? "Gateway A" : "Gateway B",
			fields: [
				{
					name: "secret_key",
					label: "Secret key",
					secret: true,
					required: true,
				},
			],
			payment: { mode: "hosted" },
			...over,
		});
	const hosted = `export const payment = { createCheckout: async () => ({ id: "1", url: "u" }), getPayment: async () => ({ paid: true, buyer: null }) };`;
	const up = (
		key: string,
		module: string,
		over: Record<string, unknown> = {},
		extra: Record<string, string | Uint8Array> = {},
	) =>
		install(
			asFile(
				zip({ "extension.json": gw(key, over), "index.js": module, ...extra }),
			),
		);

	// a gateway that can't take money is refused at the upload, not when a buyer tries to pay
	// (each attempt gets its own key: a re-upload of the same key inside one millisecond would reuse the cached module)
	expect((await up("gw-none", "export default {}")).errors?.file).toBe(
		"index.js: a hosted payment must `export const payment` with createCheckout, getPayment",
	);
	expect(
		(
			await up(
				"gw-half",
				`export const payment = { createCheckout: async () => ({ id: "1", url: "u" }) };`,
			)
		).errors?.file,
	).toMatch(/with getPayment$/);
	expect(
		(
			await up(
				"gw-wrong",
				`export const payment = { createCheckout: async () => ({}), getPayment: async () => ({}) };`,
				{
					payment: {
						mode: "tokenize",
						public_field: "public_key",
						script: "assets/checkout.js",
					},
				},
				{ "assets/checkout.js": "export default () => {};" },
			)
		).errors?.file,
	).toBe(
		"index.js: a tokenize payment must `export const payment` with amount, charge",
	);
	expect(await ExtensionService.payments(S)).toEqual([]);

	// uploaded, it waits for the admin: a gateway is never switched on by the upload alone, even with its keys filled in later
	expect(await up("gw-a", hosted)).toEqual({ key: "gw-a" });
	expect(await up("gw-b", hosted)).toEqual({ key: "gw-b" });
	const row = async (key: string) =>
		(await ExtensionService.list(S)).find((e) => e.key === key)!;
	expect(await row("gw-a")).toMatchObject({
		installed: true,
		enabled: false,
		ready: false,
		payment: { mode: "hosted" },
	});
	expect(await ExtensionService.onlinePayment(S)).toBeNull();

	// switched on and configured, it runs — with its secret decrypted
	expect(
		await ExtensionService.save(S, "gw-a", {
			enabled: true,
			config: { secret_key: "sk_a" },
		}),
	).toEqual({});
	const running = await ExtensionService.payments(S);
	expect(running.map((p) => [p.ext.key, p.config.secret_key])).toEqual([
		["gw-a", "sk_a"],
	]);
	expect(typeof (running[0]!.payment as any).createCheckout).toBe("function");
	expect((await ExtensionService.onlinePayment(S))?.ext.name).toBe("Gateway A");

	// one shop takes money through one gateway: switching the second on switches the first off, keys kept
	expect(
		await ExtensionService.save(S, "gw-b", {
			enabled: true,
			config: { secret_key: "sk_b" },
		}),
	).toEqual({});
	expect((await ExtensionService.payments(S)).map((p) => p.ext.key)).toEqual([
		"gw-b",
	]);
	expect(await row("gw-a")).toMatchObject({ enabled: false, ready: true }); // its keys are still there for a switch back
	expect((await ExtensionService.payments(S))[0]!.config.secret_key).toBe(
		"sk_b",
	);

	// a tokenize gateway's checkout script is always loaded from the shop's /store/<slug> path, cache-busted by version
	const tok = {
		payment: {
			mode: "tokenize",
			public_field: "public_key",
			script: "assets/checkout.js",
		},
		version: "2.1.0",
	};
	expect(
		await up(
			"gw-tok",
			`export const payment = { amount: (c) => c, charge: async () => ({}), getPayment: async () => ({}) };`,
			tok,
			{ "assets/checkout.js": "export default () => {};" },
		),
	).toEqual({ key: "gw-tok" });
	const ext = (await ExtensionService.available()).find(
		(e) => e.key === "gw-tok",
	)!;
	expect(ExtensionService.paymentScript(ext, "ext-store")).toBe(
		"/store/ext-store/ext/gw-tok/assets/checkout.js?v=2.1.0",
	);

	for (const key of ["gw-a", "gw-b", "gw-tok"]) await uninstall(key);
});

test("languages: i18n/<locale>.ts translates the manifest, the listener's and route's t(), and the browser strings; English is the fallback", async () => {
	const { I18n } = await import("@xcore/i18n/I18n");
	const enc = new TextEncoder();
	const r = await install(
		asFile(
			zip({
				"extension.json": enc.encode(
					manifest({
						key: "polyglot",
						name: "name",
						description: "description",
						fields: [
							{
								name: "greeting",
								label: "field.greeting",
								placeholder: "field.greeting_hint",
								required: true,
								type: "select",
								options: [{ value: "hi", label: "option.hi" }],
							},
						],
						pages: [
							{ path: "home", title: "page.home", script: "assets/home.js" },
						],
					}),
				),
				"index.js": enc.encode(
					`export default { "order.created": async ({ t, locale, order }) => { (globalThis.__seen ??= []).push("polyglot:" + locale + ":" + t("hello", { id: order.id })); } };
export const routes = { "GET /hello": ({ t, locale }) => ({ locale, text: t("hello", { id: 1 }), missing: t("nope") }) };`,
				),
				"assets/home.js": enc.encode("export default () => {};"),
				"i18n/en.ts": enc.encode(
					`export default { name: "Polyglot", description: "Speaks", "field.greeting": "Greeting", "field.greeting_hint": "Pick one", "option.hi": "Hi", "page.home": "Home", hello: "Order {id}", "only.en": "Only English" };`,
				),
				"i18n/de.ts": enc.encode(
					`export default { name: "Polyglott", description: "Spricht", "field.greeting": "Begrüßung", "field.greeting_hint": "Eine wählen", "option.hi": "Hallo", "page.home": "Start", hello: "Bestellung {id}" };`,
				),
			}),
		),
	);
	expect(r).toEqual({ key: "polyglot" });
	await ExtensionService.save(S, "polyglot", {
		enabled: true,
		config: { greeting: "hi" },
	});
	// the manifest reads in the request's language; the ExtensionInfo itself stays English (what orders store)
	const rowIn = async (locale: "en" | "de") =>
		I18n.withLocale(
			locale,
			async () =>
				(await ExtensionService.list(S)).find((e) => e.key === "polyglot")!,
		);
	const en = await rowIn("en"),
		de = await rowIn("de");
	expect([en.name, en.description, en.fields[0]!.label]).toEqual([
		"Polyglot",
		"Speaks",
		"Greeting",
	]);
	expect([
		de.name,
		de.description,
		de.fields[0]!.label,
		de.fields[0]!.placeholder,
		de.fields[0]!.options![0]!.label,
		de.pages[0]!.title,
	]).toEqual([
		"Polyglott",
		"Spricht",
		"Begrüßung",
		"Eine wählen",
		"Hallo",
		"Start",
	]);
	const info = (await ExtensionService.available()).find(
		(e) => e.key === "polyglot",
	)!;
	expect(info.name).toBe("Polyglot");
	expect(info.raw.name).toBe("name");
	// a required field missing: the message names the field in the admin's language
	const bad = await I18n.withLocale("de", () =>
		ExtensionService.save(S, "polyglot", { enabled: true, config: {} }),
	);
	expect(bad.errors?.["config.greeting"]).toContain("Begrüßung");
	// the sidebar and the page carry the strings for api.t, in the page's language (English filled in)
	const ui = await I18n.withLocale("de", () => ExtensionService.ui(S, "admin"));
	const mine = ui.find((u) => u.key === "polyglot")!;
	expect(mine.name).toBe("Polyglott");
	expect(mine.pages[0]!.title).toBe("Start");
	expect(mine.strings.hello).toBe("Bestellung {id}");
	expect(mine.strings["only.en"]).toBe("Only English");
	const page = await I18n.withLocale("de", () =>
		ExtensionService.page(S, "polyglot", "home", "admin"),
	);
	expect(page && page !== "forbidden" && page.strings["page.home"]).toBe(
		"Start",
	);
	// listeners: t() in the language of the request that caused the event; a language the extension lacks → English
	await I18n.withLocale("de", () =>
		ExtensionService.emit("order.created", S, { order }),
	);
	await ExtensionService.emit("order.created", S, { order });
	await ExtensionService.idle();
	expect(seen().filter((x) => x.startsWith("polyglot:"))).toEqual([
		"polyglot:de:Bestellung 9",
		"polyglot:en:Order 9",
	]);
	// routes: the same t(); a key nobody has comes back as the key
	const res = await I18n.withLocale("de", () =>
		ExtensionService.handle(
			"routes",
			shop,
			"polyglot",
			req("GET", "/ext/polyglot/hello"),
			"/hello",
			{ user: admin },
		),
	);
	expect(await res.json()).toEqual({
		locale: "de",
		text: "Bestellung 1",
		missing: "nope",
	});
	await uninstall("polyglot");
});

test("built-in extensions: listed on the platform, live-edited, never deletable, and an upload with their key is refused", async () => {
	const dir = `${process.env.EXTENSION_BUILTIN_DIR}/greeter`;
	const manifest = (name: string) => ({
		key: "dev-greeter",
		name,
		version: "0.1.0",
		main: "index.ts",
	});
	await Bun.write(`${dir}/extension.json`, JSON.stringify(manifest("Greeter")));
	await Bun.write(
		`${dir}/index.ts`,
		`export default { "order.created": () => {} };`,
	);
	// new = off for all shops: the platform lists it, no shop does
	expect(
		(await ExtensionService.platformList()).find(
			(e) => e.key === "dev-greeter",
		),
	).toMatchObject({ name: "Greeter", builtin: true, enabled: false });
	expect(
		(await ExtensionService.list(S)).find((e) => e.key === "dev-greeter"),
	).toBeUndefined();
	expect(
		(await ExtensionService.save(S, "dev-greeter", { enabled: true })).errors,
	).toEqual({ key: "Unknown extension" });
	expect(await ExtensionService.setGlobal("nope", true)).toEqual({
		errors: { key: "Unknown extension" },
	});
	expect(await ExtensionService.setGlobal("dev-greeter", true)).toEqual({});
	let row = (await ExtensionService.list(S)).find(
		(e) => e.key === "dev-greeter",
	);
	expect(row).toMatchObject({ installed: false, enabled: false });
	// the shop enables it through the same save as any other
	expect(
		await ExtensionService.save(S, "dev-greeter", {
			enabled: true,
			config: {},
		}),
	).toEqual({});
	expect(
		(await ExtensionService.running(S, "order.created")).map((r) => r.key),
	).toContain("dev-greeter");
	// no restart: the edited manifest is what the next call shows
	await Bun.write(
		`${dir}/extension.json`,
		JSON.stringify(manifest("Greeter 2")),
	);
	row = (await ExtensionService.list(S)).find((e) => e.key === "dev-greeter");
	expect(row?.name).toBe("Greeter 2");
	// built in: no delete, and a zip with its key is refused
	expect(await ExtensionService.remove("dev-greeter")).toEqual({
		errors: { key: "A built-in extension can't be deleted" },
	});
	expect(
		(
			await ExtensionService.upload(
				asFile(
					zip({
						"extension.json": JSON.stringify(manifest("Mine")),
						"index.ts": "export default {};",
					}),
				),
			)
		).errors?.file,
	).toBe("dev-greeter is built in — its updates ship with the app");
	// off for all shops: gone from the shop's list and it stops running, the shop's settings stay
	expect(await ExtensionService.setGlobal("dev-greeter", false)).toEqual({});
	expect(
		(await ExtensionService.list(S)).find((e) => e.key === "dev-greeter"),
	).toBeUndefined();
	expect(
		(await ExtensionService.running(S, "order.created")).map((r) => r.key),
	).not.toContain("dev-greeter");
	expect(await ExtensionService.active(S, "dev-greeter")).toBeNull();
	await ExtensionService.setGlobal("dev-greeter", true);
	expect(await ExtensionService.active(S, "dev-greeter")).not.toBeNull();
	await sql`delete from shop_extensions where ${sql("key")} = 'dev-greeter'`;
	await sql`delete from platform_extensions where ${sql("key")} = 'dev-greeter'`;
	await ExtensionFiles.remove(process.env.EXTENSION_BUILTIN_DIR!);
	expect(
		(await ExtensionService.platformList()).find(
			(e) => e.key === "dev-greeter",
		),
	).toBeUndefined();
});

test("available to some users only: their shops list and run it, other owners' shops don't, [] opens it to everyone", async () => {
	const dir = `${process.env.EXTENSION_BUILTIN_DIR}/vip`;
	await Bun.write(
		`${dir}/extension.json`,
		JSON.stringify({
			key: "vip",
			name: "VIP",
			version: "1.0.0",
			main: "index.ts",
		}),
	);
	await Bun.write(
		`${dir}/index.ts`,
		`export default { "order.created": () => {} };`,
	);
	const [a] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('A', 'vip-a@ext.io', 'x', 'admin')`,
		sql`id`,
	);
	const [b] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('B', 'vip-b@ext.io', 'x', 'admin')`,
		sql`id`,
	);
	const [staff] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role, owner_id) values ('S', 'vip-staff@ext.io', 'x', 'cashier', ${a.id})`,
		sql`id`,
	);
	const [shopA] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, slug, owner_id) values ('VIP A', 'USD', 'UTC', 'vip-a', ${a.id})`,
		sql`id`,
	);
	const [shopB] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, slug, owner_id) values ('VIP B', 'USD', 'UTC', 'vip-b', ${b.id})`,
		sql`id`,
	);
	await ExtensionService.setGlobal("vip", true);
	for (const shop of [shopA.id, shopB.id])
		await ExtensionService.save(shop, "vip", { enabled: true, config: {} });

	// only owners can be picked; an unknown email or a staff member is refused
	expect(await ExtensionService.setUsers("vip", ["vip-staff@ext.io"])).toEqual({
		errors: { users: "vip-staff@ext.io is not a user" },
	});
	expect(await ExtensionService.setUsers("nope", [])).toEqual({
		errors: { key: "Unknown extension" },
	});
	expect(await ExtensionService.setUsers("vip", ["vip-a@ext.io"])).toEqual({});
	expect(
		(await ExtensionService.platformList()).find((e) => e.key === "vip")?.users,
	).toEqual(["vip-a@ext.io"]);

	/**
	 * Whether the extension is on a shop's list and runs there.
	 * @param shopId The shop.
	 * @returns [listed, running].
	 */
	async function seen(shopId: number) {
		return [
			(await ExtensionService.list(shopId)).some((e) => e.key === "vip"),
			(await ExtensionService.running(shopId, "order.created")).some(
				(r) => r.key === "vip",
			),
		];
	}
	expect(await seen(shopA.id)).toEqual([true, true]);
	expect(await seen(shopB.id)).toEqual([false, false]);
	expect(await ExtensionService.active(shopB.id, "vip")).toBeNull();
	expect(
		(await ExtensionService.save(shopB.id, "vip", { enabled: true })).errors,
	).toEqual({ key: "Unknown extension" });
	// the picker offers owners, never staff
	const choices = await ExtensionService.userChoices("vip-");
	expect(choices.places).toContain("vip-a@ext.io");
	expect(choices.places).not.toContain("vip-staff@ext.io");
	// [] = every user again
	expect(await ExtensionService.setUsers("vip", [])).toEqual({});
	expect(await seen(shopB.id)).toEqual([true, true]);

	await sql`delete from shop_extensions where ${sql("key")} = 'vip'`;
	await sql`delete from platform_extensions where ${sql("key")} = 'vip'`;
	await sql`delete from shops where id in (${shopA.id}, ${shopB.id})`;
	await sql`delete from users where id in (${a.id}, ${b.id}, ${staff.id})`;
	await ExtensionFiles.remove(process.env.EXTENSION_BUILTIN_DIR!);
});

test("uploads a shop made before the platform catalog move into it on boot: newest version wins, built-in keys stay out", async () => {
	const up = process.env.EXTENSION_UPLOAD_DIR!;
	const put = (path: string, name: string) =>
		Promise.all([
			Bun.write(
				`${up}/${path}/extension.json`,
				JSON.stringify({ key: name.split(":")[0], name, version: "1.0.0" }),
			),
			Bun.write(`${up}/${path}/index.js`, "export default {};"),
		]);
	await put("7001/oldie/1000", "oldie:v1");
	await put("7002/oldie/2000", "oldie:v2");
	await put("7001/shipped/1000", "shipped:upload");
	await Bun.write(
		`${process.env.EXTENSION_BUILTIN_DIR}/shipped/extension.json`,
		JSON.stringify({ key: "shipped", name: "Shipped", version: "2.0.0" }),
	);
	await Bun.write(
		`${process.env.EXTENSION_BUILTIN_DIR}/shipped/index.js`,
		"export default {};",
	);
	await ExtensionService.adoptShopUploads();
	await ExtensionService.adoptShopUploads(); // a second boot moves nothing
	const list = await ExtensionService.platformList();
	expect(list.find((e) => e.key === "oldie")).toMatchObject({
		name: "oldie:v2",
		builtin: false,
	});
	expect(list.find((e) => e.key === "shipped")).toMatchObject({
		name: "Shipped",
		builtin: true,
	});
	expect(
		await Bun.file(`${up}/platform/oldie/2000/extension.json`).exists(),
	).toBe(true);
	expect(await ExtensionService.remove("oldie")).toEqual({});
	expect(await ExtensionService.remove("oldie")).toEqual({
		errors: { key: "Unknown extension" },
	});
	await ExtensionFiles.remove(`${up}/7001`);
	await ExtensionFiles.remove(`${up}/7002`);
	await ExtensionFiles.remove(process.env.EXTENSION_BUILTIN_DIR!);
});

test("migration 0055: every key a shop uses is switched on for all shops", async () => {
	const { up } = await import("@database/migrations/0055_platform_extensions");
	await sql`drop table platform_extensions`;
	await sql`insert into shop_extensions (shop_id, ${sql("key")}, enabled, config) values (${S}, 'in-use', ${false}, '{}')`;
	await up(migrationDb(sql));
	expect(
		!!(
			await sql`select enabled from platform_extensions where ${sql("key")} = 'in-use'`
		)[0]?.enabled,
	).toBe(true);
	await sql`delete from shop_extensions where ${sql("key")} = 'in-use'`;
	await sql`delete from platform_extensions where ${sql("key")} = 'in-use'`;
	// the table was rebuilt from 0055 alone: add what the later migrations add
	const users = await import("@database/migrations/0056_extension_users");
	await users.up(migrationDb(sql));
});

test("a theme extension dresses the storefront: the picker lists it, the page gets its Edge templates", async () => {
	// a theme must ship every store page: one missing is refused at upload
	const partial = await example("aurora", "views/track.edge");
	expect((await ExtensionService.upload(partial)).errors).toEqual({
		file: "extension.json points at views/track.edge, which is not in the zip",
	});

	expect(await ExtensionService.themes(S)).toEqual([]);
	expect(await install(await example("aurora"))).toEqual({
		key: "aurora",
	});
	// a theme asks for nothing, so the upload switches it on and the picker offers it right away
	// the shop makes it its own on /extensions — a colour and a hero, no HTML
	await ExtensionService.save(S, "aurora", {
		enabled: true,
		config: { accent: "#e07a20", hero_title: "Fresh every morning" },
	});
	expect(await ExtensionService.themes(S)).toEqual([
		{
			key: "ext:aurora",
			label: "Aurora",
			description: "Photo cards, one accent colour, plenty of air.",
		},
	]);

	// a shop on a built-in template has no theme on its pages
	expect(await ExtensionService.storeTheme(shop)).toBeNull();
	await sql`update shops set online_template = 'ext:aurora' where id = ${S}`;
	const themed = (await ShopRepository.find(S))!;
	const theme = (await ExtensionService.storeTheme(themed))!;
	expect(theme).toEqual({
		name: "ext:aurora",
		// its templates are registered as ext/aurora/<file>
		views: "ext/aurora",
		layout: "ext/aurora/layout",
		css: "/store/ext-store/ext/aurora/assets/theme.css?v=2.0.0",
		script: "/store/ext-store/ext/aurora/assets/script.js?v=2.0.0",
		assets: "/store/ext-store/ext/aurora/assets", // its own pictures and fonts
		scheme: "light",
		featured: 6, // the shop's picks for its "picked for you" rail
		// what the shop set rides to every visitor; secrets never do
		config: {
			accent: "#e07a20",
			hero_off: false,
			hero_title: "Fresh every morning",
			hero_text: "",
			hero_cta: "",
			hero_image: "",
		},
		strings: expect.any(Object),
	});
	// the dictionary rewords the app's own storefront text (the header cart button)
	expect(theme.strings["store_ui.cart"]).toBe("Bag");

	// a colour that is not a hex colour never reaches the page's <style>
	expect(
		await ExtensionService.save(S, "aurora", {
			enabled: true,
			config: { accent: "red;}body{display:none" },
		}),
	).toEqual({ errors: { "config.accent": "Pick a colour" } });

	// switched off, the storefront falls back to a built-in template
	await ExtensionService.save(S, "aurora", { enabled: false, config: {} });
	expect(await ExtensionService.storeTheme(themed)).toBeNull();
	await sql`update shops set online_template = 'classic' where id = ${S}`;
	await uninstall("aurora");
});

test("an extension's functions: the API's own routes by name, the ones with no route beside them, and refusals are thrown", async () => {
	const dish = await ProductRepository.create(S, {
		name: "Ext Dish",
		description: "",
		images: [],
		barcode: null,
		category_ids: [],
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		variants: [],
		price: 700,
		purchase_price: 200,
		track_stock: true,
		stock: 3,
	} as any);
	const [boss] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Ext Boss', ${`ext-boss-${S}@x.io`}, 'x', 'admin')`,
	);
	const fx = functionsAs(boss);
	// every area of the API is there
	expect(Object.keys(fx).sort()).toEqual([
		"account",
		"categories",
		"coupons",
		"customers",
		"marketing",
		"orders",
		"paymentMethods",
		"products",
		"reports",
		"salesStaff",
		"staff",
		"stock",
	]);
	const line = { product_id: dish.id, qty: 1 };

	// orders: no `paid` = written unpaid; it grows, shrinks and is paid
	const opened = await fx.orders.create({ items: [line], note: "Table 2" });
	expect(opened).toMatchObject({
		payment_status: "unpaid",
		note: "Table 2",
		subtotal: 700,
	});
	const grown = await fx.orders.add(opened.id, {
		items: [{ ...line, note: "spicy" }],
	});
	expect(grown.items.map((i: { note: string }) => i.note)).toEqual([
		"",
		"spicy",
	]);
	const less = await fx.orders.remove(opened.id, {
		items: [{ order_item_id: grown.items[0].id, qty: 1 }],
	});
	expect(less.items).toHaveLength(1);
	expect((await fx.orders.get(opened.id)).subtotal).toBe(700);
	expect(await fx.orders.pay(opened.id, { amount: 700 })).toMatchObject({
		payment_status: "paid",
	});
	expect((await fx.orders.list({ q: String(opened.id) })).page).toBe(1);

	// categories, stock, coupons: the same functions the API has
	const cat = await fx.categories.create({ name: "Ext Starters" });
	expect((await fx.categories.get(cat.id)).name).toBe("Ext Starters");
	expect((await fx.categories.update(cat.id, { name: "Ext Mains" })).name).toBe(
		"Ext Mains",
	);
	expect(
		await fx.stock.adjust({
			product_id: dish.id,
			delta: 5,
			reason: "received",
		}),
	).toMatchObject({ stock: 7 }); // 3 − 1 sold + 5
	const coupon = await fx.coupons.create({
		code: "EXT10",
		type: "percent",
		value: 10,
	});
	expect((await fx.coupons.list()).data.map((c: any) => c.code)).toContain(
		"EXT10",
	);
	expect(await fx.coupons.delete(coupon.id)).toMatchObject({ id: coupon.id });
	expect(await fx.categories.delete(cat.id)).toMatchObject({ id: cat.id });

	// a read of a record that is not there is null; any other refusal is thrown with the API's own error
	expect(await fx.products.get(999999)).toBeNull();
	expect(fx.orders.add(opened.id, { items: [] })).rejects.toMatchObject({
		name: "ApiError",
		status: 422,
	});
	expect(fx.orders.create({ items: [{ ...line, qty: 99 }] })).rejects.toThrow(); // more than is in stock
	// with `paid` it is a sale, and a sale needs a payment method
	expect(fx.orders.create({ items: [line], paid: 700 })).rejects.toMatchObject({
		fields: { payment_method: expect.any(String) },
	});
	// the role of the caller is checked like a key's role
	const cashier = functionsAs({ ...boss, role: "cashier" });
	expect(cashier.products.delete(dish.id)).rejects.toMatchObject({
		status: 403,
		type: "forbidden",
	});
	expect((await cashier.orders.list()).page).toBe(1); // cashier work stays allowed
	// the ones with no API route
	expect(await fx.orders.openFor(0)).toBeNull();
	expect(await fx.products.idBySku("no-such-sku")).toBeNull();
});

test("the restaurant extension: managers add and remove tables, a table's QR code puts every round on one bill, a new code or a paid bill kills the old one; its store script, page, words, hidden link and main button are offered", async () => {
	expect(await install(await example("restaurant"))).toEqual({
		key: "restaurant",
	});
	// nothing to fill in: it runs once switched on
	await ExtensionService.save(S, "restaurant", { enabled: true, config: {} });

	// the storefront loads its script (slot `store.page`) with its public mount and its texts
	const [script] = await ExtensionService.storeScripts(shop);
	expect(script).toMatchObject({
		key: "restaurant",
		base: "/store/ext-store/ext/restaurant",
		strings: { "store.send": "Send to kitchen" },
	});
	expect(script!.script).toMatch(
		/^\/store\/ext-store\/ext\/restaurant\/assets\/store\.(ts|js)\?v=/,
	);
	// the staff app (cashiers too) gets the Tables and Kitchen pages under Sales, no slot of its own,
	// the Customers link hidden, its `app.*` texts that make the Sell screen's customer
	// picker a table picker, and Pay later as the checkout's main button (a blank select = its first option)
	const ui = (await ExtensionService.ui(S, "cashier")).find(
		(one) => one.key === "restaurant",
	)!;
	expect(ui.pages).toEqual([
		{
			path: "tables",
			title: "Tables",
			href: "/extensions/restaurant/tables",
			group: "Restaurant", // its own section, above Sales
			before: "Sales",
			icon: expect.stringMatching(/\/assets\/icon\.svg\?v=/) as never, // the extension's logo
		},
		{
			path: "kitchen",
			title: "Kitchen",
			href: "/extensions/restaurant/kitchen",
			group: "Restaurant", // its own section, above Sales
			before: "Sales",
			icon: expect.stringMatching(/\/assets\/kitchen\.svg\?v=/) as never, // its own
		},
	]);
	// its one slot in the staff app: the product form's "Send to kitchen" card
	expect(Object.keys(ui.slots)).toEqual(["product.side"]);
	expect(ui.hide_nav).toEqual(["/customers"]);
	expect(ui.strings).toMatchObject({
		"app.pos.add_customer": "Select table",
		"app.pos.customer_picker_title": "Table",
	});
	expect(ui.strings["app.orders.online"]).toBe("QR Scan"); // the Orders list's Online tab
	expect(ui.app).toEqual({
		"pos.primary": "pay_later",
		"orders.delivery": "hide", // set outright by the manifest: no delivery steps on the Orders list
	});

	const [u] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Rest Waiter', ${`rest-waiter-${S}@x.io`}, 'x', 'cashier')`,
	);
	const dish = await ProductRepository.create(S, {
		name: "Rest Soup",
		description: "",
		images: [],
		barcode: null,
		category_ids: [],
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		variants: [],
		price: 600,
		purchase_price: 200,
		track_stock: false,
	} as any);
	// a public route: nobody is signed in, the route names who the functions run as
	const extra = {
		actor: async () => ({ ...u, role: "admin" }) as never,
		handles: own(),
	};

	/**
	 * Call one of the extension's routes the way the controller does.
	 * @param kind Staff or storefront routes.
	 * @param method The HTTP method.
	 * @param path The path below the mount, with its query.
	 * @param body A JSON body, if any.
	 * @param role Who is signed in, on a staff route.
	 * @returns The status and the JSON answer.
	 */
	async function call(
		kind: "routes" | "publicRoutes",
		method: string,
		path: string,
		body?: unknown,
		role = "manager",
	) {
		const res = await ExtensionService.handle(
			kind,
			shop,
			"restaurant",
			new Request(`http://x${path}`, {
				method,
				...(body ? { body: JSON.stringify(body) } : {}),
			}),
			path.split("?")[0]!,
			kind === "routes"
				? { user: { ...u, role } as never, handles: own(u.id) }
				: extra,
		);
		return { status: res.status, body: await res.json() };
	}

	// no tables yet; a cashier may not add any
	expect((await call("routes", "GET", "/tables")).body).toMatchObject({
		tables: [],
		can_manage: true,
	});
	expect(
		(await call("routes", "POST", "/tables", { names: "1" }, "cashier")).status,
	).toBe(403);
	expect(
		(await call("routes", "GET", "/tables", undefined, "cashier")).body
			.can_manage,
	).toBe(false);
	// a manager adds a range and a name: each one a customer at once; repeats are skipped
	await call("routes", "POST", "/tables", { names: "1, 10, Terrace" });
	expect(
		(await call("routes", "POST", "/tables", { names: "1, 10" })).body.error,
	).toBe("Those tables are there already.");
	expect(
		(
			await sql`select name from customers where shop_id = ${S} and (name like 'Table %' or name = 'Terrace') order by name`
		).map((c: { name: string }) => c.name),
	).toEqual(["Table 1", "Table 10", "Terrace"]);
	// removing a table keeps its customer
	const removed = await call("routes", "DELETE", "/tables/Terrace");
	expect(removed.body.tables.map((t: any) => t.name)).toEqual([
		"Table 1",
		"Table 10",
	]);

	// the Tables page: each table with its customer, no QR code yet, nothing ordered
	const page = await call("routes", "GET", "/tables");
	expect(page.body).toMatchObject({ currency: "USD", store_on: true });
	expect(page.body.tables.map((t: any) => [t.name, t.qr, t.order])).toEqual([
		["Table 1", null, null],
		["Table 10", null, null],
	]);
	const [table] =
		await sql`select id, note from customers where shop_id = ${S} and name = 'Table 1'`;
	expect(table.note).toBe("Restaurant table");
	expect(page.body.tables[0].customer_id).toBe(table.id);

	/**
	 * "New QR code" for a table.
	 * @param name The table.
	 * @returns The token its link holds.
	 */
	async function newCode(name: string) {
		const made = await call(
			"routes",
			"POST",
			`/tables/${encodeURIComponent(name)}/qr`,
		);
		expect(made.status).toBe(200);
		const link = new URL(made.body.url);
		expect(link.searchParams.get("table")).toBe(name);
		return link.searchParams.get("t")!;
	}
	const line = { product_id: dish.id, variant_id: null, qty: 1 };
	const order = (t: string, items: unknown[] = [line]) =>
		call("publicRoutes", "POST", "/order", { table: "Table 1", t, items });

	// a first code, then a new one: the first stops working at once
	const old = await newCode("Table 1");
	const t = await newCode("Table 1");
	expect(t).not.toBe(old);
	expect((await order(old)).status).toBe(422);
	const ten = await newCode("Table 10");
	expect((await call("routes", "POST", "/tables/Table%2099/qr")).status).toBe(
		422,
	);
	// the table list and the two codes are kept in the extension's own data, not the settings
	expect(
		Number(
			(
				await sql`select count(*) as n from extension_data where shop_id = ${S} and ext_key = 'restaurant'`
			)[0].n,
		),
	).toBe(3);

	// first round: the table's customer gets an unpaid order
	const first = await order(t, [{ ...line, note: "no onions" }]);
	expect(first.status).toBe(200);
	expect(first.body.order).toMatchObject({
		total: 600,
		items: [{ name: "Rest Soup", qty: 1, price: 600, note: "no onions" }],
	});
	const open = (await OrderService.openFor(S, table.id))!;
	expect(open).toMatchObject({ payment_status: "unpaid", note: "Table 1" });

	// second round: the same order grows, and the history keeps it
	const second = await order(t, [{ ...line, qty: 2 }]);
	expect(second.body.order).toMatchObject({
		reference: first.body.order.reference,
		total: 1800,
	});
	expect((await OrderService.find(open.id, S))!.history).toHaveLength(1);
	// the kitchen: both rounds land in To do, oldest first; a line moves on and back
	const kitchen = (await call("routes", "GET", "/kitchen")).body.items;
	expect(kitchen.map((i: any) => [i.table, i.qty, i.note, i.step])).toEqual([
		["Table 1", 1, "no onions", "todo"],
		["Table 1", 2, "", "todo"],
	]);
	const [soup] = kitchen;
	const moved = await call(
		"routes",
		"POST",
		`/kitchen/${soup.order_id}/${soup.item_id}`,
		{ step: "preparing" },
	);
	expect(moved.body.items.map((i: any) => i.step)).toEqual([
		"preparing",
		"todo",
	]);
	expect(
		(
			await call(
				"routes",
				"POST",
				`/kitchen/${soup.order_id}/${soup.item_id}`,
				{
					step: "eaten",
				},
			)
		).status,
	).toBe(422);
	expect(
		(
			await call("routes", "POST", `/kitchen/${soup.order_id}/999999`, {
				step: "done",
			})
		).status,
	).toBe(422);

	// "Send to kitchen" off for the product: its lines leave the kitchen (not as cancelled); a cashier may not switch it
	expect(
		(
			await call(
				"routes",
				"POST",
				`/products/${dish.id}/kitchen`,
				{ on: false },
				"cashier",
			)
		).status,
	).toBe(403);
	await call("routes", "POST", `/products/${dish.id}/kitchen`, { on: false });
	expect(
		(await call("routes", "GET", `/products/${dish.id}/kitchen`)).body,
	).toEqual({ on: false });
	expect((await call("routes", "GET", "/kitchen")).body).toEqual({
		items: [],
		cancelled: [],
	});
	await call("routes", "POST", `/products/${dish.id}/kitchen`, { on: true });
	expect((await call("routes", "GET", "/kitchen")).body.items).toHaveLength(2);

	// a waiter adds a dish, the kitchen starts it, then the waiter takes it off: cancelled at that step, until Got it
	await OrderService.addItems(open.id, S, u.id, { items: [line] });
	const third = (await call("routes", "GET", "/kitchen")).body.items[2];
	await call("routes", "POST", `/kitchen/${open.id}/${third.item_id}`, {
		step: "preparing",
	});
	await OrderService.removeItems(open.id, S, u.id, {
		items: [{ order_item_id: third.item_id, qty: 1 }],
	});
	const stopped = (await call("routes", "GET", "/kitchen")).body;
	expect(stopped.items).toHaveLength(2);
	expect(stopped.cancelled).toMatchObject([
		{ table: "Table 1", name: "Rest Soup", qty: 1, step: "preparing" },
	]);
	expect(
		(
			await call(
				"routes",
				"POST",
				`/kitchen/cancelled/${stopped.cancelled[0].id}/ack`,
			)
		).body.cancelled,
	).toEqual([]);

	// a table with an open bill can't be removed
	expect((await call("routes", "DELETE", "/tables/Table%201")).body.error).toBe(
		"This table has an open bill. Take the money first.",
	);
	// the guest reads the bill, and so does the Tables page
	const bill = await call(
		"publicRoutes",
		"GET",
		`/bill?table=Table%201&t=${t}`,
	);
	expect(bill.body.order.items).toHaveLength(2);
	const busy = await call("routes", "GET", "/tables");
	expect(busy.body.tables[0].order).toMatchObject({ id: open.id, total: 1800 });
	expect(busy.body.tables[1].order).toBeNull(); // "Table 10" is another table

	// a guessed token, another table's token, a table that is not set up, an empty cart
	for (const bad of [
		{ table: "Table 1", t: "nope", items: [line] },
		{ table: "Table 1", t: ten, items: [line] },
		{ table: "Table 99", t, items: [line] },
	])
		expect((await call("publicRoutes", "POST", "/order", bad)).status).toBe(
			422,
		);
	expect(
		(await call("publicRoutes", "GET", "/bill?table=Table%201&t=x")).body.error,
	).toBe("This QR code has expired. Please ask the staff for a new one.");
	expect((await order(t, [])).body.error).toBe("Your cart is empty");

	// paid: the code dies with the bill; Table 10's code lives on; a new code starts a new bill
	await OrderService.recordPayment(open.id, S, { amount: 1800 });
	await ExtensionService.idle();
	expect((await order(t)).status).toBe(422);
	// the paid bill left the kitchen, and its steps are forgotten
	expect((await call("routes", "GET", "/kitchen")).body.items).toEqual([]);
	expect(
		Number(
			(
				await sql`select count(*) as n from extension_data where shop_id = ${S} and name = ${`kitchen:${open.id}`}`
			)[0].n,
		),
	).toBe(0);
	expect(
		(await call("publicRoutes", "GET", `/bill?table=Table%2010&t=${ten}`))
			.status,
	).toBe(200);
	const after = await call("routes", "GET", "/tables");
	expect(after.body.tables[0]).toMatchObject({ qr: null, order: null });
	const next = await order(await newCode("Table 1"));
	expect(next.body.order.reference).not.toBe(first.body.order.reference);

	// the table's customer deleted and made again (the next order does it): paying still kills the code
	await sql`delete from customers where shop_id = ${S} and name = 'Table 10'`;
	const again = await call("publicRoutes", "POST", "/order", {
		table: "Table 10",
		t: ten,
		items: [line],
	});
	expect(again.status).toBe(200);
	const tenOrder = (
		await sql`select id from orders where shop_id = ${S} and reference = ${again.body.order.reference}`
	)[0];
	await OrderService.recordPayment(tenOrder.id, S, { amount: 600 });
	await ExtensionService.idle();
	expect(
		(await call("publicRoutes", "GET", `/bill?table=Table%2010&t=${ten}`))
			.status,
	).toBe(422);

	// move: Table 1's new bill goes to the free Table 10, with its kitchen lines
	const bills = (body: any) =>
		body.tables.map((t: any) => [t.name, t.order?.total ?? null]);
	const moved10 = await call("routes", "POST", "/tables/Table%201/move", {
		to: "Table 10",
	});
	expect(bills(moved10.body)).toEqual([
		["Table 1", null],
		["Table 10", 600],
	]);
	expect(
		(await call("routes", "GET", "/kitchen")).body.items.map(
			(i: any) => i.table,
		),
	).toEqual(["Table 10"]);
	// join: new guests at Table 1 order, then sit with Table 10 — one bill of both, two kitchen tickets
	expect((await order(await newCode("Table 1"))).status).toBe(200);
	const joined = await call("routes", "POST", "/tables/Table%201/move", {
		to: "Table 10",
	});
	expect(bills(joined.body)).toEqual([
		["Table 1", null],
		["Table 10", 1200],
	]);
	expect(
		(await call("routes", "GET", "/kitchen")).body.items.map(
			(i: any) => i.table,
		),
	).toEqual(["Table 10", "Table 10"]);
	// a table with no bill has nothing to move; a table can't move to itself
	for (const [from, to] of [
		["Table 1", "Table 10"],
		["Table 10", "Table 10"],
	])
		expect(
			(
				await call(
					"routes",
					"POST",
					`/tables/${encodeURIComponent(from!)}/move`,
					{ to },
				)
			).status,
		).toBe(422);

	// the Pay dialog's discount (a cashier may): set, refused for a wrong code, taken off again
	const billOf10 = (body: any) =>
		body.tables.find((t: any) => t.name === "Table 10").order;
	const off = await call(
		"routes",
		"POST",
		"/tables/Table%2010/discount",
		{ type: "percent", value: 10 },
		"cashier",
	);
	expect(billOf10(off.body)).toMatchObject({
		discount_type: "percent",
		discount_value: 10,
	});
	expect(billOf10(off.body).total).toBeLessThan(1200);
	expect(
		(
			await call("routes", "POST", "/tables/Table%2010/discount", {
				coupon: "NOPE",
			})
		).status,
	).toBe(422);
	const back = await call("routes", "POST", "/tables/Table%2010/discount", {});
	expect(billOf10(back.body)).toMatchObject({ discount: 0, total: 1200 });
	// the bill's remove buttons: one call takes the drafted units off; the last unit is refused
	const lines = billOf10(back.body).items as { id: number; qty: number }[];
	const units = lines.reduce((n, l) => n + l.qty, 0);
	expect(
		(
			await call("routes", "POST", "/tables/Table%2010/items/remove", {
				items: lines.map((l) => ({ order_item_id: l.id, qty: l.qty })),
			})
		).status,
	).toBe(422);
	expect(billOf10(back.body).count).toBe(units);

	// pay (a cashier may), with one of the shop's methods, which the page is offered:
	// part of it leaves the bill open, the rest frees the table
	await sql`insert into payment_methods (shop_id, name, icon, color, tendered, position) values (${S}, 'Cash', 'Banknote', null, true, 0)`;
	expect(
		(await call("routes", "GET", "/tables", undefined, "cashier")).body.methods,
	).toMatchObject([{ name: "Cash", tendered: true }]);
	const part = await call(
		"routes",
		"POST",
		"/tables/Table%2010/pay",
		{ received: 200, method: "Cash" },
		"cashier",
	);
	expect(bills(part.body)[1]).toEqual(["Table 10", 1200]);
	const paid = await call("routes", "POST", "/tables/Table%2010/pay", {
		received: 1500,
		method: "Cash",
	});
	await ExtensionService.idle();
	expect(bills(paid.body)[1]).toEqual(["Table 10", null]);
	expect((await call("routes", "GET", "/kitchen")).body.items).toEqual([]);

	// every role works on both pages: a cashier and a manager open them and read their lists
	for (const role of ["cashier", "manager", "admin"] as const) {
		for (const path of ["tables", "kitchen"]) {
			expect(
				await ExtensionService.page(S, "restaurant", path, role),
			).toMatchObject({
				page: {
					path,
					fullscreen: path === "kitchen",
					fill: path === "kitchen",
					breadcrumb: false,
				},
			});
			expect(
				(await call("routes", "GET", `/${path}`, undefined, role)).status,
			).toBe(200);
		}
	}
	// rename (managers and admins): the table and its customer get the new name, in the same place
	expect(
		(
			await call(
				"routes",
				"POST",
				"/tables/Table%2010/rename",
				{ to: "Terrace" },
				"cashier",
			)
		).status,
	).toBe(403);
	expect(
		(
			await call("routes", "POST", "/tables/Table%2010/rename", {
				to: "table 1",
			})
		).status,
	).toBe(422);
	const renamed = await call("routes", "POST", "/tables/Table%2010/rename", {
		to: "Terrace",
	});
	expect(renamed.body.tables.map((t: any) => t.name)).toEqual([
		"Table 1",
		"Terrace",
	]);
	// the table is still a customer, under its new name
	expect(renamed.body.tables[1].customer_id).toBeGreaterThan(0);
	expect(
		(await CustomerService.search(S, "Terrace")).map((c) => c.name),
	).toContain("Terrace");

	await uninstall("restaurant");
	expect(await ExtensionService.storeScripts(shop)).toEqual([]);
});

test("routes and listeners get the API's functions: as the staff member, else as the shop's owner", async () => {
	// the probe asks who its functions run as
	const probe = `
const who = (account) => account.me().then((me) => ({ role: me.key.role }));
export const routes = { "GET /who": ({ account }) => who(account) };
export const publicRoutes = routes;
export default { "order.created": async ({ account }) => { globalThis.__api = await who(account); } };`;
	expect(
		await install(
			asFile(
				zip({
					"extension.json": manifest({ key: "api-probe", fields: [] }),
					"index.js": probe,
				}),
			),
		),
	).toEqual({ key: "api-probe" });
	const [boss] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Probe Owner', ${`probe-owner-${S}@x.io`}, 'x', 'admin')`,
		sql`id`,
	);
	await sql`update shops set owner_id = ${boss.id} where id = ${S}`;
	const owned = (await ShopRepository.find(S))!;
	/**
	 * What the probe should answer for a caller of this role.
	 * @param role The caller's role.
	 * @returns The probe's answer.
	 */
	function expected(role: string) {
		return { role };
	}
	/**
	 * Call the probe's route.
	 * @param kind Staff or storefront routes.
	 * @param extra The staff member, on a staff route.
	 * @returns The JSON answer.
	 */
	async function who(kind: "routes" | "publicRoutes", extra = {}) {
		const res = await ExtensionService.handle(
			kind,
			owned,
			"api-probe",
			req("GET", "/who"),
			"/who",
			extra,
		);
		return res.json();
	}
	// a staff route: the signed-in staff member's role
	expect(
		await who("routes", { user: { ...admin, id: boss.id, role: "cashier" } }),
	).toEqual(expected("cashier"));
	// a public route and a listener: nobody is signed in, so the shop's owner
	expect(await who("publicRoutes")).toEqual(expected("admin"));
	await ExtensionService.emit("order.created", owned, { order });
	expect((globalThis as any).__api).toEqual(expected("admin"));
	await uninstall("api-probe");
});

test("labels example: its page sits in Catalog for every role, the route lists products as units", async () => {
	expect(await install(await example("labels"))).toEqual({ key: "labels" });
	expect(
		(await ExtensionService.ui(S, "cashier")).find((e) => e.key === "labels")!
			.pages,
	).toMatchObject([
		{ title: "Labels", href: "/extensions/labels/print", group: "Catalog" },
	]);
	await ProductRepository.create(S, {
		name: "Label Mug",
		description: "",
		images: [],
		barcode: "8850001112223",
		category_ids: [],
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		variants: [],
		price: 1800,
		purchase_price: null,
		track_stock: false,
		stock: 0,
	} as any);
	const res = await ExtensionService.handle(
		"routes",
		shop,
		"labels",
		req("GET", "/ext/labels/products?q=Label%20Mug"),
		"/products",
		{ user: admin },
	);
	expect(await res.json()).toEqual({
		items: [
			{
				key: expect.any(String),
				name: "Label Mug",
				variant: "",
				price: 1800,
				code: "8850001112223",
				image: "",
			},
		],
	});
	await uninstall("labels");
});

test("tax-invoice example: the order.show slot, a paid order with tax gets a number once, the buyer is kept", async () => {
	expect(await install(await example("tax-invoice"))).toEqual({
		key: "tax-invoice",
	});
	await ExtensionService.save(S, "tax-invoice", {
		enabled: true,
		config: {
			seller_name: "Mug Co., Ltd.",
			seller_address: "1 Sukhumvit Rd, Bangkok",
			seller_tax_id: "DE 123 456 789",
		},
	});
	// the slot: every role sees the button on the order page
	const ui = (await ExtensionService.ui(S, "cashier")).find(
		(one) => one.key === "tax-invoice",
	)!;
	expect(ui.slots["order.show"]).toMatch(
		/^\/ext\/tax-invoice\/assets\/order\.tsx\?v=/,
	);

	const [u] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Tax Clerk', ${`tax-clerk-${S}@x.io`}, 'x', 'cashier')`,
	);
	const mug = await ProductRepository.create(S, {
		name: "Tax Mug",
		description: "",
		images: [],
		barcode: null,
		category_ids: [],
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		variants: [],
		price: 10700,
		purchase_price: null,
		track_stock: false,
		stock: 0,
	} as any);
	const fx = functionsAs({ ...u, role: "admin" });
	const order = await fx.orders.create({
		items: [{ product_id: mug.id, qty: 1 }],
	});
	/**
	 * Call one staff route of the extension as the clerk.
	 * @param method The HTTP method.
	 * @param body The JSON body, if any.
	 * @returns The status and the JSON answer.
	 */
	async function call(method: string, body?: unknown) {
		const path = `/orders/${order.id}`;
		const res = await ExtensionService.handle(
			"routes",
			shop,
			"tax-invoice",
			new Request(`http://x/ext/tax-invoice${path}`, {
				method,
				...(body ? { body: JSON.stringify(body) } : {}),
			}),
			path,
			{ user: u as never, handles: own(u.id) },
		);
		return { status: res.status, body: await res.json() };
	}
	const buyer = {
		name: "Buyer Co., Ltd.",
		address: "9 Rama IV Rd, Bangkok",
		tax_id: "",
		branch: "",
	};

	// nothing issued yet; the seller's tax ID is kept as typed
	expect((await call("GET")).body).toEqual({
		seller: {
			name: "Mug Co., Ltd.",
			address: "1 Sukhumvit Rd, Bangkok",
			tax_id: "DE 123 456 789",
			branch: "",
		},
		invoice: null,
		customer: null, // no customer on the order
		addresses: [],
	});
	// with a customer on the order, the buyer form starts with their details
	const client = await fx.customers.create({ name: "Client GmbH" });
	await sql`insert into customer_addresses (customer_id, shop_id, label, address_1, city, postal_code, country, tax_id) values (${client.id}, ${S}, 'Office', 'Hauptstr. 1', 'Berlin', '10115', 'Germany', 'DE999999999')`;
	await sql`update orders set customer_id = ${client.id} where id = ${order.id}`;
	expect(await call("GET")).toMatchObject({
		body: {
			customer: { name: "Client GmbH" },
			// their saved addresses, for the dialog's list
			addresses: [
				{
					label: "Office",
					text: "Hauptstr. 1\nBerlin, 10115\nGermany",
					tax_id: "DE999999999", // the tax ID is kept with the address
				},
			],
		},
	});
	// not paid yet, then paid but with no tax on it
	expect(await call("POST", buyer)).toMatchObject({
		status: 422,
		body: { error: "Only a paid order gets a tax invoice." },
	});
	await sql`update orders set payment_status = 'paid', paid = total where id = ${order.id}`;
	expect((await call("POST", buyer)).body.error).toMatch(/has no tax/);
	await sql`update orders set tax = 700, tax_rate = 700, tax_label = 'VAT', tax_included = ${true} where id = ${order.id}`;
	// the buyer needs a name and an address; the tax ID may stay empty
	expect((await call("POST", { ...buyer, address: "" })).status).toBe(422);

	const first = (await call("POST", buyer)).body;
	// the number is the prefix and the order's public code
	expect(first.invoice).toMatchObject({
		number: `INV-${order.reference}`,
		buyer,
	});
	// saved again with a corrected buyer: the same number and date
	const again = (await call("POST", { ...buyer, tax_id: "GB123456789" })).body;
	expect(again.invoice).toEqual({
		...first.invoice,
		buyer: { ...buyer, tax_id: "GB123456789" },
	});
	expect((await call("GET")).body.invoice).toEqual(again.invoice);
	await sql`update orders set customer_id = null where id = ${order.id}`;
	await uninstall("tax-invoice");
});

test("promptpay example: switching it on adds its payment method, off switches it off, the route hands over the ID as digits", async () => {
	const methods = Container.get(_PaymentMethodService);
	const own = async () =>
		(await methods.list(S)).filter((m) => m.extension === "promptpay");
	expect(await install(await example("promptpay"))).toEqual({
		key: "promptpay",
	});
	// it needs the PromptPay ID first, so it is still off: no method yet
	expect(await own()).toEqual([]);
	expect(
		await ExtensionService.save(S, "promptpay", {
			enabled: true,
			config: { promptpay_id: "080-123-4567" },
		}),
	).toEqual({});
	expect(await own()).toMatchObject([
		{ name: "PromptPay", icon: "QrCode", enabled: true, tendered: false },
	]);
	// saved again: still one method
	await ExtensionService.save(S, "promptpay", { enabled: true });
	expect(await own()).toHaveLength(1);
	const res = await ExtensionService.handle(
		"routes",
		shop,
		"promptpay",
		req("GET", "/ext/promptpay/config"),
		"/config",
		{ user: admin },
	);
	expect(await res.json()).toEqual({ id: "0801234567", name: "", account: "" });
	// off: the method stays in the list, switched off, so checkout stops offering it
	await ExtensionService.save(S, "promptpay", { enabled: false });
	expect(await own()).toMatchObject([{ enabled: false }]);
	await sql`delete from payment_methods where extension = 'promptpay'`;
	await uninstall("promptpay");
});

test("a method the shop already has under the extension's name becomes the extension's", async () => {
	const methods = Container.get(_PaymentMethodService);
	const mine = await methods.create(S, {
		name: "PromptPay",
		icon: "Smartphone",
		color: null,
		image: null,
		tendered: false,
		enabled: false,
	});
	await install(await example("promptpay"));
	await ExtensionService.save(S, "promptpay", {
		enabled: true,
		config: { promptpay_id: "0801234567" },
	});
	// no second "PromptPay": the shop's own row is taken over, its icon kept
	expect(
		(await methods.list(S)).filter((m) => m.name === "PromptPay"),
	).toMatchObject([
		{ id: mine.id, extension: "promptpay", icon: "Smartphone", enabled: true },
	]);
	await sql`delete from payment_methods where id = ${mine.id}`;
	await uninstall("promptpay");
});

test("the pos.display slot: a manifest may name it and ui() hands the staff app its script", async () => {
	expect(
		await install(
			asFile(
				zip({
					"extension.json": manifest({
						key: "second-screen",
						name: "Second Screen",
						fields: [],
						slots: [{ name: "pos.display", script: "assets/display.js" }],
					}),
					"index.js": "export default {}",
					"assets/display.js": "export default () => {}",
				}),
			),
		),
	).toEqual({ key: "second-screen" });
	// cashiers sell, so they get it too
	const ui = (await ExtensionService.ui(S, "cashier")).find(
		(one) => one.key === "second-screen",
	)!;
	expect(ui.slots["pos.display"]).toMatch(
		/^\/ext\/second-screen\/assets\/display\.js\?v=/,
	);
	// no payment method of its own: nothing for a pay dialog to wait for
	expect(ui.payment_confirm).toBe(false);
	await uninstall("second-screen");
});

test("stripe-terminal example: it adds the Card reader method, which a pay dialog must wait for, and its two slots", async () => {
	const methods = Container.get(_PaymentMethodService);
	expect(await install(await example("stripe-terminal"))).toEqual({
		key: "stripe-terminal",
	});
	// the key must look like a Stripe secret key
	expect(
		await ExtensionService.save(S, "stripe-terminal", {
			enabled: true,
			config: { secret_key: "pk_test_1" },
		}),
	).toMatchObject({ errors: { "config.secret_key": expect.any(String) } });
	expect(
		await ExtensionService.save(S, "stripe-terminal", {
			enabled: true,
			config: { secret_key: "sk_test_1" },
		}),
	).toEqual({});
	expect(
		(await methods.list(S)).filter((m) => m.extension === "stripe-terminal"),
	).toMatchObject([
		{ name: "Card reader", icon: "Nfc", enabled: true, tendered: false },
	]);
	const ui = (await ExtensionService.ui(S, "cashier")).find(
		(one) => one.key === "stripe-terminal",
	)!;
	// manifest `payment_method.confirm`: every pay dialog keeps its button off until the extension approves
	expect(ui.payment_confirm).toBe(true);
	expect(Object.keys(ui.slots).sort()).toEqual(["order.show", "pos.display"]);
	await sql`delete from payment_methods where extension = 'stripe-terminal'`;
	await uninstall("stripe-terminal");
});

test("ctx.data: a collection keeps rows per shop, extension and list, pages them newest first and finds them by ref; lock runs one job at a time", async () => {
	const { ExtensionRuntime } = await import("../extensions/Extension.Runtime");
	const runtime = Container.get(ExtensionRuntime);
	const data = runtime.dataOf(S, "rows-test");
	const notes = data.collection("notes");

	const a = await notes.add({ text: "a" }, "customer:1");
	const b = await notes.add({ text: "b" }, "customer:2");
	const c = await notes.add({ text: "c" }, "customer:1");
	// newest first, with the counts every list of the app has
	expect(await notes.list()).toMatchObject({
		data: [{ id: c }, { id: b }, { id: a }],
		total: 3,
		page: 1,
		per_page: 20,
		last_page: 1,
	});
	// by ref, and paged
	const page = await notes.list({ ref: "customer:1", per_page: 1, page: 2 });
	expect(page).toMatchObject({
		data: [{ id: a, ref: "customer:1", value: { text: "a" } }],
		total: 2,
		last_page: 2,
	});
	// a page size from outside is kept between 1 and 100
	expect((await notes.list({ per_page: 100000 })).per_page).toBe(100);
	expect((await notes.list({ per_page: -5, page: -1 })).page).toBe(1);

	await notes.update(a, { text: "a2" });
	expect((await notes.get(a))?.value).toEqual({ text: "a2" });

	// only its own: another list, another extension and another shop see nothing and change nothing
	const others = [
		data.collection("other"),
		runtime.dataOf(S, "someone-else").collection("notes"),
		runtime.dataOf(S + 100000, "rows-test").collection("notes"),
	];
	for (const other of others) {
		expect(await other.get(a)).toBeNull();
		expect((await other.list()).total).toBe(0);
		await other.update(a, { text: "stolen" });
		await other.delete(a);
		await other.clear("customer:1");
	}
	expect((await notes.get(a))?.value).toEqual({ text: "a2" });

	await notes.delete(b);
	expect(await notes.get(b)).toBeNull();
	await notes.clear("customer:1");
	expect((await notes.list()).total).toBe(0);

	// lock: two "read, change, save" jobs with one name never overlap
	await data.set("count", 0);
	/**
	 * Add one to the kept count, slowly.
	 */
	async function addOne() {
		const n = (await data.get("count")) as number;
		await Bun.sleep(5);
		await data.set("count", n + 1);
	}
	await Promise.all([data.lock("count", addOne), data.lock("count", addOne)]);
	expect(await data.get("count")).toBe(2);
	// a job that throws hands its error on and frees the lock
	expect(
		data.lock("count", async () => {
			throw new Error("boom");
		}),
	).rejects.toThrow("boom");
	expect(await data.lock("count", async () => "free")).toBe("free");
	await data.delete("count");

	// a deleted shop takes its rows with it
	const [gone] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, slug) values ('Rows Gone', 'USD', 'UTC', 'rows-gone')`,
		sql`id`,
	);
	await runtime.dataOf(gone.id, "rows-test").collection("notes").add({});
	await ShopRepository.delete(gone.id);
	const [left] =
		await sql`select count(*) as n from extension_rows where shop_id = ${gone.id}`;
	expect(Number(left.n)).toBe(0);
});

test("loyalty example: a paid order with a customer earns points once, the goal gives a one-use discount code, a refund and a void take points back, a deleted customer is forgotten", async () => {
	expect(await install(await example("loyalty"))).toEqual({ key: "loyalty" });
	// it can't run before its four settings are filled
	expect(
		(await ExtensionService.save(S, "loyalty", { enabled: true, config: {} }))
			.errors,
	).toBeDefined();
	await ExtensionService.save(S, "loyalty", {
		enabled: true,
		config: { spend: 1, goal: 30, reward_type: "fixed", reward_value: 5 },
	});
	// its page sits in the Sales group, for every role
	const ui = (await ExtensionService.ui(S, "cashier")).find(
		(one) => one.key === "loyalty",
	)!;
	expect(ui.pages).toMatchObject([{ path: "members", group: "Sales" }]);
	// its slots: the Sell screen's cart and the receipt. The settings form
	// is not one of the app's places: the Configure dialog gets its script.
	expect(Object.keys(ui.slots).sort()).toEqual(["order.receipt", "pos.cart"]);
	expect(ui.slots["pos.cart"]).toContain("/ext/loyalty/assets/till.tsx");
	const row = (await ExtensionService.list(S)).find(
		(one) => one.key === "loyalty",
	)!;
	expect(row.config_script).toContain("/ext/loyalty/assets/config.tsx");
	expect(row.strings["config.on"]).toBe("Loyalty points is on");

	const [u] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Loyal Boss', ${`loyal-boss-${S}@x.io`}, 'x', 'admin')`,
	);
	// a listener runs as the shop's owner
	await sql`update shops set owner_id = ${u.id} where id = ${S}`;
	const owned = (await ShopRepository.find(S))!;
	await sql`insert into payment_methods (shop_id, name) values (${S}, 'Loyal Cash')`;
	const mug = await ProductRepository.create(S, {
		name: "Loyal Mug",
		description: "",
		images: [],
		barcode: null,
		category_ids: [],
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		variants: [],
		price: 2590,
		purchase_price: null,
		track_stock: false,
		stock: 0,
	} as any);
	const fx = functionsAs(u);
	const ann = await fx.customers.create({ name: "Ann", phone: "0811111111" });

	/**
	 * Ring up paid mugs and tell the extension, as the app does.
	 * The app's own event is not awaited, so the test fires it once more:
	 * the second one must change nothing.
	 * @param qty How many mugs.
	 * @param customer_id The customer, or null.
	 * @returns The order.
	 */
	async function sell(qty: number, customer_id: number | null) {
		const made = await fx.orders.create({
			items: [{ product_id: mug.id, qty }],
			paid: 2590 * qty,
			payment_method: "Loyal Cash",
			customer_id,
		});
		const order = await fx.orders.get(made.id);
		await ExtensionService.emit("order.paid", owned, { order });
		await ExtensionService.emit("order.paid", owned, { order });
		return order;
	}
	/**
	 * Call one staff route of the extension as a cashier.
	 * @param path The path under the mount.
	 * @returns The JSON answer.
	 */
	async function call(path: string) {
		const res = await ExtensionService.handle(
			"routes",
			owned,
			"loyalty",
			new Request(`http://x/ext/loyalty${path}`),
			path.split("?")[0]!,
			{ user: { ...u, role: "cashier" } as never, handles: own(u.id) },
		);
		expect(res.status).toBe(200);
		return res.json();
	}

	// no customer, no points
	await sell(1, null);
	expect((await call("/members")).total).toBe(0);

	// 25.90 paid at 1 per point = 25 points, counted once
	const first = await sell(1, ann.id);
	expect(await call("/members")).toMatchObject({
		data: [
			{
				customer_id: ann.id,
				name: "Ann",
				phone: "0811111111",
				points: 25,
				total: 25,
			},
		],
		total: 1,
		goal: 30,
	});

	// 25 more passes the goal of 30: 20 left and a code that works once
	const second = await sell(1, ann.id);
	expect((await call("/members")).data[0]).toMatchObject({
		points: 20,
		total: 50,
	});
	const history = await call(`/members/${ann.id}/history`);
	expect(history.data.map((line: any) => [line.type, line.points])).toEqual([
		["reward", -30],
		["earn", 25],
		["earn", 25],
	]);
	expect(history.data[1].reference).toMatch(/^[A-Z0-9-]+$/);
	expect(Number.isNaN(Date.parse(history.data[0].at))).toBe(false);
	const code = history.data[0].code as string;
	expect(code).toMatch(/^LOYAL-[2-9A-HJ-NP-Z]{8}$/);
	const coupon = (await fx.coupons.list({ q: code })).data[0];
	expect(coupon).toMatchObject({
		code,
		type: "fixed",
		value: 500,
		usage_limit: 1,
	});

	// the till, the receipt and the store's account page read the same
	// standing: the points, the goal and the reward not used yet
	const reward = { code, type: "fixed", value: 500 };
	expect(await call(`/customers/${ann.id}/standing`)).toEqual({
		points: 20,
		goal: 30,
		rewards: [reward],
	});
	expect(await call(`/orders/${second.id}/receipt`)).toEqual({
		points: 20,
		goal: 30,
		rewards: [reward],
		earned: 25,
		pending: false,
	});
	/**
	 * Call the store's `/me` route as a signed-in customer or a guest.
	 * @param customer The store's customer, or null.
	 * @returns The JSON answer.
	 */
	async function me(customer: { id: number } | null) {
		const res = await ExtensionService.handle(
			"publicRoutes",
			owned,
			"loyalty",
			new Request("http://x/store/s/ext/loyalty/me"),
			"/me",
			{
				customer: customer && { id: customer.id, name: "Ann", email: null },
				handles: own(u.id),
			},
		);
		expect(res.status).toBe(200);
		return res.json();
	}
	expect(await me(ann)).toEqual({ points: 20, goal: 30, rewards: [reward] });
	expect(await me(null)).toBeNull();
	// an order that carries the code uses the reward up; a void gives it back
	await ExtensionService.emit("order.created", owned, {
		order: { ...second, coupon_code: code },
	});
	expect((await call(`/customers/${ann.id}/standing`)).rewards).toEqual([]);
	await ExtensionService.emit("order.updated", owned, {
		order: { ...second, coupon_code: code, status: "voided" },
	});
	expect((await call(`/customers/${ann.id}/standing`)).rewards).toEqual([
		reward,
	]);
	// an extension writes only to a customer of the shop, and Ann has no email
	const mail = Container.get(ExtensionMail).for(owned);
	expect(await mail.customer(ann.id, { subject: "Hi", text: "Hello" })).toBe(
		"This customer has no email",
	);
	expect(await mail.customer(ann.id, { subject: " ", text: "Hello" })).toBe(
		"The note needs a subject and a text",
	);

	// the search finds a member by name, and nobody else
	expect((await call("/members?q=Ann")).data).toMatchObject([
		{ customer_id: ann.id, points: 20 },
	]);
	expect((await call("/members?q=nobody-like-this")).data).toEqual([]);

	// a refund of 10.00 takes 10 points back
	await fx.orders.refund(first.id, { amount: 1000, restock: false });
	const refunded = await fx.orders.get(first.id);
	await ExtensionService.emit("order.refunded", owned, {
		order: refunded,
		refund: {} as never,
	});
	expect((await call("/members")).data[0]).toMatchObject({
		points: 10,
		total: 40,
	});
	// a void takes all 25 points of its order; points never go below 0
	await fx.orders.void(second.id, { reason: "test" });
	await ExtensionService.emit("order.voided", owned, {
		order: await fx.orders.get(second.id),
		reason: "test",
	});
	expect((await call("/members")).data[0]).toMatchObject({
		points: 0,
		total: 15,
	});

	// a deleted customer is forgotten
	await ExtensionService.emit("customer.deleted", owned, { customer: ann });
	expect((await call("/members")).total).toBe(0);
	expect((await call(`/members/${ann.id}/history`)).total).toBe(0);
	expect((await call(`/customers/${ann.id}/standing`)).rewards).toEqual([]);

	await sql`delete from coupons where shop_id = ${S} and code like 'LOYAL-%'`;
	await sql`delete from payment_methods where shop_id = ${S} and name = 'Loyal Cash'`;
	await sql`delete from extension_rows where shop_id = ${S} and ext_key = 'loyalty'`;
	await sql`update shops set owner_id = ${shop.owner_id} where id = ${S}`;
	await uninstall("loyalty");
});
