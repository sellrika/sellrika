import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import type { z } from "zod";
import { Container } from "@xcore/di";
import {
	API_PREFIX,
	MCP_PATH,
	MCP_PROTOCOL_VERSIONS,
	MCP_SERVER_NAME,
} from "@constants/Api.Constant";
import {
	OAUTH_AUTHORIZE_PATH,
	OAUTH_REGISTER_PATH,
	OAUTH_RESOURCE_PATH,
	OAUTH_SERVER_PATH,
	OAUTH_TOKEN_PATH,
} from "@constants/OAuth.Constant";
import type { Role } from "@constants/User.Constant";

// Temp SQLite DB and upload folder (never the real ones); db.ts reads DB_FILE at import.
process.env.DB_FILE = `${tmpdir()}/pos-api-test-${process.pid}.db`;
process.env.APP_KEY ??= "test-app-key-for-api";
process.env.UPLOAD_DIR ??= `${tmpdir()}/pos-api-test-${process.pid}-uploads`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { router } = await import("@xcore/http/Router");
const { app } = await import("@config/app");
const { Url } = await import("@xcore/http/Url");
const { RateLimit } = await import("@xcore/http/RateLimit");
const { apiDocs, OpenApi } = await import("@xcore/api/OpenApi");
const { apiRoutes } = await import("@routes/api");
const { ApiSchemas, GuideAnswer } = await import(
	"@validators/ApiResponse.Validator"
);
const { ApiKeyService: _ApiKeyService } = await import(
	"@services/settings/ApiKey.Service"
);
const ApiKeyService = Container.get(_ApiKeyService);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);
const { PaymentMethodRepository: _PaymentMethodRepository } = await import(
	"@repositories/PaymentMethod.Repository"
);
const PaymentMethodRepository = Container.get(_PaymentMethodRepository);

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);
// another test file may have loaded the routes already: register them once
if (!apiDocs.length) apiRoutes();

const tag = `${process.pid}-${Date.now()}`;
const owner = await UserRepository.create(
	{
		name: "Owner",
		email: `api-owner-${tag}@x.io`,
		role: "admin",
		password: "",
	},
	"x",
	null,
);
const [shop] =
	await sql`insert into shops (name, currency, timezone, owner_id) values ('Api Shop', 'USD', 'UTC', ${owner.id}) returning id`;
const S = shop.id as number;
await PaymentMethodRepository.seedDefaults(S);

/**
 * A fresh key of the test shop.
 * @param role The key's role.
 * @returns The key to send.
 */
async function keyFor(role: Role) {
	const r = await ApiKeyService.create(S, owner, { name: role, role });
	if (r.errors) throw new Error("no key");
	return r.token;
}
const KEYS = {
	admin: await keyFor("admin"),
	manager: await keyFor("manager"),
	cashier: await keyFor("cashier"),
};

/**
 * Call an API route the way Bun would: find the route by its pattern, fill `params`, run its handler.
 * @param method HTTP method.
 * @param path The path after the prefix, with its query string.
 * @param o The key's role (null = no key) and a JSON body.
 * @returns The status and the parsed JSON.
 */
async function call(
	method: "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS",
	path: string,
	o: {
		as?: Role | null;
		body?: unknown;
		headers?: Record<string, string>;
	} = {},
) {
	const url = new URL(`http://pos.test${API_PREFIX}${path}`);
	let handler: ((req: never) => Response | Promise<Response>) | undefined;
	let params: Record<string, string> = {};
	let fallback: typeof handler;
	for (const [pattern, entry] of Object.entries(router.routes)) {
		if (entry instanceof Response || !entry[method]) continue;
		if (pattern === `${API_PREFIX}/*`) {
			fallback = entry[method] as typeof handler;
			continue;
		}
		const names: string[] = [];
		const re = new RegExp(
			`^${pattern.replace(/:(\w+)/g, function name(_m, n: string) {
				names.push(n);
				return "([^/]+)";
			})}$`,
		);
		const m = re.exec(url.pathname);
		if (!m) continue;
		// a static path wins over a `:param` twin, like in Bun's router
		if (handler && names.length) continue;
		handler = entry[method] as typeof handler;
		params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]!]));
		if (!names.length) break;
	}
	const as = o.as === undefined ? "admin" : o.as;
	const req = Object.assign(
		new Request(url, {
			method,
			headers: {
				"Content-Type": "application/json",
				...(as && { Authorization: `Bearer ${KEYS[as]}` }),
				...o.headers,
			},
			...(o.body !== undefined && { body: JSON.stringify(o.body) }),
		}),
		{ params, cookies: new Bun.CookieMap() },
	);
	const res = await (handler ?? fallback)!(req as never);
	const text = await res.text();
	return {
		status: res.status,
		body: (text ? JSON.parse(text) : null) as any,
		res,
	};
}

/**
 * Check an answer against the schema the docs show for it.
 * @param name The model's name in the docs.
 * @param value The answer.
 */
function matches(name: keyof typeof ApiSchemas, value: unknown) {
	const r = (ApiSchemas[name] as z.ZodType).safeParse(value);
	if (!r.success)
		throw new Error(`${name}: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
}

/** A page of rows, each checked against a model. */
function matchesPage(name: keyof typeof ApiSchemas, body: { data: unknown[] }) {
	expect(body).toMatchObject({ page: 1 });
	expect(Array.isArray(body.data)).toBe(true);
	for (const row of body.data) matches(name, row);
}

test("keys and roles: 401 without a key, 403 below the route's role, a JSON 404, one error shape", async () => {
	RateLimit.reset();
	const none = await call("GET", "/me", { as: null });
	expect(none.status).toBe(401);
	matches("Error", none.body);
	expect(none.body.error.type).toBe("unauthorized");

	const me = await call("GET", "/me", { as: "cashier" });
	expect(me.status).toBe(200);
	matches("Me", me.body);
	expect(me.body).toMatchObject({ key: { role: "cashier" }, shop: { id: S } });

	// the user guide is an MCP tool only: the API has no such route
	expect((await call("GET", "/guide", { as: "cashier" })).status).toBe(404);

	// a cashier key sells and reads orders, nothing else
	expect((await call("GET", "/orders", { as: "cashier" })).status).toBe(200);
	for (const path of ["/products", "/stock", "/reports", "/coupons", "/staff"])
		expect((await call("GET", path, { as: "cashier" })).status).toBe(403);
	// a manager key gets the catalogue, not the coupons
	expect((await call("GET", "/products", { as: "manager" })).status).toBe(200);
	const refused = await call("GET", "/coupons", { as: "manager" });
	expect(refused.status).toBe(403);
	expect(refused.body.error.type).toBe("forbidden");

	const missing = await call("GET", "/nothing-here");
	expect(missing.status).toBe(404);
	expect(missing.body.error.type).toBe("not_found");
	// a cookie session is not a key: only the header counts
	expect((await call("POST", "/categories", { as: null })).status).toBe(401);
	RateLimit.reset();
});

test("catalogue: categories, products with the form's rules, stock through the ledger", async () => {
	const cat = await call("POST", "/categories", {
		body: { name: "Drinks", color: "#f9c13b" },
	});
	expect(cat.status).toBe(201);
	matches("Category", cat.body);
	expect(cat.body.image).toBeNull();
	// a picture sent as base64 is stored as our own upload
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
	const pictured = await call("PUT", `/categories/${cat.body.id}`, {
		body: { name: "Drinks", color: "#f9c13b", image: png.toBase64() },
	});
	expect(pictured.body.image).toMatch(
		/^\/uploads\/\d+\/categories\/[\w-]+\.\w+$/,
	);
	// base64 that is no picture is refused
	const noPicture = await call("PUT", `/categories/${cat.body.id}`, {
		body: { name: "Drinks", image: "aGVsbG8=" },
	});
	expect(noPicture.status).toBe(422);
	expect(noPicture.body.error.fields.image).toBeTruthy();
	const bad = await call("POST", "/categories", { body: { name: "" } });
	expect(bad.status).toBe(422);
	expect(bad.body.error).toMatchObject({ type: "validation_error" });
	expect(bad.body.error.fields.name).toBeTruthy();
	const cats = await call("GET", "/categories");
	for (const c of cats.body) matches("CategoryWithCount", c);
	expect((await call("GET", "/categories/999999")).status).toBe(404);

	const made = await call("POST", "/products", {
		as: "manager",
		body: {
			name: "Iced Latte",
			price: 450,
			purchase_price: 120,
			barcode: `B${tag}`,
			track_stock: true,
			stock: 24,
			category_ids: [cat.body.id],
		},
	});
	expect(made.status).toBe(201);
	matches("Product", made.body);
	expect(made.body).toMatchObject({ name: "Iced Latte", stock: 24 });
	expect(made.body.categories[0].id).toBe(cat.body.id);
	const id = made.body.id as number;

	// the form's rules apply: a barcode is unique per shop, a category must be the shop's own
	const twin = await call("POST", "/products", {
		body: { name: "Twin", price: 100, barcode: `B${tag}` },
	});
	expect(twin.status).toBe(422);
	expect(twin.body.error.fields.barcode).toMatch(/Iced Latte/);
	const foreign = await call("POST", "/products", {
		body: { name: "Lost", price: 100, category_ids: [999999] },
	});
	expect(foreign.status).toBe(422);

	const list = await call("GET", "/products?q=Iced&per_page=5");
	expect(list.status).toBe(200);
	matchesPage("Product", list.body);
	expect(list.body.total).toBe(1);
	expect((await call("GET", "/products?per_page=abc")).status).toBe(422);

	const edited = await call("PUT", `/products/${id}`, {
		body: { name: "Iced Latte L", price: 480, track_stock: true },
	});
	expect(edited.status).toBe(200);
	matches("Product", edited.body);
	// an edit without `stock` keeps the count
	expect(edited.body).toMatchObject({ price: 480, stock: 24 });
	expect((await call("PUT", "/products/999999", { body: {} })).status).toBe(
		404,
	);

	const up = await call("POST", "/stock/adjustments", {
		as: "manager",
		body: { product_id: id, delta: 6, reason: "received" },
	});
	expect(up.status).toBe(201);
	matches("StockLevel", up.body);
	expect(up.body.stock).toBe(30); // 24 + 6
	const tooFar = await call("POST", "/stock/adjustments", {
		body: { product_id: id, delta: -31, reason: "damaged" },
	});
	expect(tooFar.status).toBe(422);
	matchesPage("StockItem", (await call("GET", "/stock")).body);
	matches("StockSummary", (await call("GET", "/stock/summary")).body);
	const moves = await call("GET", `/stock/movements?product_id=${id}`);
	matchesPage("StockMovement", moves.body);
	expect(moves.body.total).toBe(2); // the opening count + the adjustment
	expect((await call("GET", "/stock/movements")).status).toBe(422);
});

test("orders: create like the till, pay, refund and void by role; never a delete", async () => {
	const p = await call("POST", "/products", {
		body: { name: "Mug", price: 900, track_stock: true, stock: 5 },
	});
	const id = p.body.id as number;

	const sale = await call("POST", "/orders", {
		as: "cashier",
		body: {
			items: [{ product_id: id, qty: 2, note: "gift wrap" }],
			payment_method: "Cash",
			paid: 2000,
		},
	});
	expect(sale.status).toBe(201);
	matches("Order", sale.body);
	expect(sale.body.items[0].note).toBe("gift wrap"); // a line may carry a note
	// the price comes from the product: 2 × 900 = 1800, change 200
	expect(sale.body).toMatchObject({ total: 1800, change: 200 });
	const orderId = sale.body.id as number;

	const noStock = await call("POST", "/orders", {
		as: "cashier",
		body: {
			items: [{ product_id: id, qty: 9 }],
			payment_method: "Cash",
			paid: 9000,
		},
	});
	expect(noStock.status).toBe(422);
	const noMethod = await call("POST", "/orders", {
		body: {
			items: [{ product_id: id, qty: 1 }],
			payment_method: "Shells",
			paid: 900,
		},
	});
	expect(noMethod.status).toBe(422);

	matchesPage("Order", (await call("GET", "/orders", { as: "cashier" })).body);
	const shown = await call("GET", `/orders/${orderId}`, { as: "cashier" });
	matches("OrderDetail", shown.body);
	expect((await call("GET", "/orders/999999")).status).toBe(404);
	expect(
		(await call("GET", "/orders?fulfillment=nope", { as: "cashier" })).status,
	).toBe(422);

	// a paid order takes no more money; a POS sale has no delivery step
	const paidUp = await call("POST", `/orders/${orderId}/payments`, {
		as: "cashier",
		body: { amount: 100 },
	});
	expect(paidUp.status).toBe(422);
	const step = await call("PUT", `/orders/${orderId}/fulfillment`, {
		as: "cashier",
		body: { fulfillment: "shipped" },
	});
	expect(step.status).toBe(422);

	// money back is admin work
	const refundBody = {
		amount: 900,
		reason: "Chipped",
		items: [{ order_item_id: shown.body.items[0].id, qty: 1 }],
	};
	const denied = await call("POST", `/orders/${orderId}/refunds`, {
		as: "manager",
		body: refundBody,
	});
	expect(denied.status).toBe(403);
	const refund = await call("POST", `/orders/${orderId}/refunds`, {
		body: refundBody,
	});
	expect(refund.status).toBe(201);
	matches("Refund", refund.body);
	const after = await call("GET", `/orders/${orderId}`);
	expect(after.body).toMatchObject({
		status: "partially_refunded",
		refunded: 900,
	});
	expect(after.body.refunds).toHaveLength(1);
	// a refunded order can not be voided
	expect(
		(await call("POST", `/orders/${orderId}/void`, { body: {} })).status,
	).toBe(422);

	const second = await call("POST", "/orders", {
		body: {
			items: [{ product_id: id, qty: 1 }],
			payment_method: "Card",
			paid: 900,
		},
	});
	const voided = await call("POST", `/orders/${second.body.id}/void`, {
		body: { reason: "Rang up twice" },
	});
	expect(voided.status).toBe(200);
	matches("OrderDetail", voided.body);
	expect(voided.body.status).toBe("voided");
	// stock: 5 − 2 sold + 1 restocked − 1 sold + 1 voided back = 4
	const level = await call("GET", `/products/${id}`);
	expect(level.body.stock).toBe(4);

	// no route deletes an order
	const del = await call("DELETE", `/orders/${orderId}`);
	expect(del.status).toBe(404);
});

test("coupons, payment methods, staff, sales staff, marketing and the report", async () => {
	const coupon = await call("POST", "/coupons", {
		body: { code: `api${Date.now() % 100000}`, type: "percent", value: 10 },
	});
	expect(coupon.status).toBe(201);
	matches("Coupon", coupon.body);
	expect(coupon.body.code).toMatch(/^API/); // stored upper-case
	const cid = coupon.body.id as number;
	const dup = await call("POST", "/coupons", {
		body: { code: coupon.body.code, type: "fixed", value: 100 },
	});
	expect(dup.status).toBe(422);
	matchesPage("CouponWithStats", (await call("GET", "/coupons")).body);
	matches("CouponWithStats", (await call("GET", `/coupons/${cid}`)).body);
	const edited = await call("PUT", `/coupons/${cid}`, {
		body: { code: coupon.body.code, type: "fixed", value: 250 },
	});
	matches("Coupon", edited.body);
	expect(edited.body).toMatchObject({ type: "fixed", value: 250 });
	matchesPage(
		"CouponRedemption",
		(await call("GET", `/coupons/${cid}/redemptions`)).body,
	);
	const gone = await call("DELETE", `/coupons/${cid}`);
	matches("Deleted", gone.body);
	expect((await call("GET", `/coupons/${cid}`)).status).toBe(404);

	const methods = await call("GET", "/payment-methods", { as: "manager" });
	expect(methods.body).toHaveLength(3);
	for (const m of methods.body) matches("PaymentMethod", m);
	const method = await call("POST", "/payment-methods", {
		body: { name: "Voucher" },
	});
	expect(method.status).toBe(201);
	matches("PaymentMethod", method.body);
	expect(
		(await call("DELETE", `/payment-methods/${method.body.id}`)).status,
	).toBe(200);
	expect((await call("DELETE", "/payment-methods/999999")).status).toBe(404);

	// staff: read only, and never a password
	const staff = await call("GET", "/staff", { as: "manager" });
	for (const u of staff.body) matches("Staff", u);
	expect(JSON.stringify(staff.body)).not.toContain("password");
	expect((await call("POST", "/staff", { body: {} })).status).toBe(404);

	const person = await call("POST", "/sales-staff", {
		as: "manager",
		body: { name: "Mia", commission: 250 },
	});
	expect(person.status).toBe(201);
	matches("SalesStaff", person.body);
	const sid = person.body.id as number;
	for (const s of (await call("GET", "/sales-staff")).body)
		matches("SalesStaff", s);
	matches("SalesStaffDetail", (await call("GET", `/sales-staff/${sid}`)).body);
	const renamed = await call("PUT", `/sales-staff/${sid}`, {
		body: { name: "Mia K", commission: 300 },
	});
	expect(renamed.body).toMatchObject({ name: "Mia K", commission: 300 });
	// nothing sold yet, so nothing to pay
	expect((await call("POST", `/sales-staff/${sid}/pay`)).status).toBe(422);
	expect((await call("DELETE", `/sales-staff/${sid}`)).status).toBe(200);
	expect((await call("GET", `/sales-staff/${sid}`)).status).toBe(404);

	matches(
		"AbandonedCart",
		(await call("GET", "/marketing/abandoned-cart", { as: "manager" })).body,
	);
	const abandoned = await call("PUT", "/marketing/abandoned-cart", {
		body: { enabled: true, hours: 12 },
	});
	expect(abandoned.body).toEqual({ enabled: true, hours: 12 });
	expect(
		(
			await call("PUT", "/marketing/abandoned-cart", {
				body: { enabled: true, hours: 5 },
			})
		).status,
	).toBe(422);

	const campaign = await call("POST", "/marketing/campaigns", {
		as: "manager",
		body: { subject: "Hello", body: "<p>Hi</p><script>x()</script>" },
	});
	expect(campaign.status).toBe(201);
	matches("Campaign", campaign.body);
	expect(campaign.body.body).not.toContain("script"); // sanitised like the form
	expect(campaign.body.status).toBe("draft");
	const mid = campaign.body.id as number;
	matchesPage("Campaign", (await call("GET", "/marketing/campaigns")).body);
	// "send now" sends real email: an admin key only
	const now = await call("POST", `/marketing/campaigns/${mid}/schedule`, {
		as: "manager",
		body: { now: true },
	});
	expect(now.status).toBe(403);
	// the shop has no online store, so even an admin can not schedule it
	const later = await call("POST", `/marketing/campaigns/${mid}/schedule`, {
		body: { date: "2999-01-01", time: "09:00" },
	});
	expect(later.status).toBe(422);
	expect(
		(await call("POST", `/marketing/campaigns/${mid}/cancel`)).status,
	).toBe(200);
	expect((await call("DELETE", `/marketing/campaigns/${mid}`)).status).toBe(
		200,
	);

	const report = await call("GET", "/reports?preset=today", { as: "manager" });
	expect(report.status).toBe(200);
	matches("Report", report.body);
	// today: 1800 + 900 sold, the 900 one voided (left out), 900 refunded
	expect(report.body.summary).toMatchObject({
		orders: 1,
		sales: 1800,
		refunds: 900,
	});
});

/** The address the test requests are sent to, as the server sees it. */
const HOST = app.url ? new URL(app.url).origin : "http://pos.test";

/**
 * Call a route outside the API prefix the way Bun would.
 * @param method HTTP method.
 * @param path The route's path.
 * @param init Headers and body.
 * @returns The answer.
 */
async function hit(
	method: "GET" | "POST" | "OPTIONS",
	path: string,
	init: RequestInit = {},
) {
	const entry = router.routes[path];
	if (!entry || entry instanceof Response) throw new Error(`no route ${path}`);
	const req = Object.assign(
		new Request(`http://pos.test${path}`, { method, ...init }),
		{ params: {}, cookies: new Bun.CookieMap() },
	);
	return entry[method]!(req as never) as Promise<Response>;
}

test("OAuth: a client finds the sign-in, registers itself, and a wrong code gets no key", async () => {
	RateLimit.reset();
	// the two discovery files, readable from any site
	const resource = await hit("GET", `${OAUTH_RESOURCE_PATH}${MCP_PATH}`);
	expect(resource.headers.get("Access-Control-Allow-Origin")).toBe("*");
	expect(await resource.json()).toMatchObject({
		resource: `${HOST}${MCP_PATH}`,
		authorization_servers: [Url.appOrigin()],
	});
	const server = await (await hit("GET", OAUTH_SERVER_PATH)).json();
	expect(server).toMatchObject({
		issuer: Url.appOrigin(),
		authorization_endpoint: `${Url.appOrigin()}${OAUTH_AUTHORIZE_PATH}`,
		token_endpoint: `${Url.appOrigin()}${OAUTH_TOKEN_PATH}`,
		registration_endpoint: `${Url.appOrigin()}${OAUTH_REGISTER_PATH}`,
		code_challenge_methods_supported: ["S256"],
	});
	expect((await hit("OPTIONS", OAUTH_TOKEN_PATH)).status).toBe(204);

	// register: a signed id back, a bad address refused
	const json = { "Content-Type": "application/json" };
	const made = await hit("POST", OAUTH_REGISTER_PATH, {
		headers: json,
		body: JSON.stringify({
			client_name: "Claude",
			redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
		}),
	});
	expect(made.status).toBe(201);
	const client = (await made.json()) as { client_id: string };
	expect(client.client_id).toContain(".");
	const refused = await hit("POST", OAUTH_REGISTER_PATH, {
		headers: json,
		body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
	});
	expect(refused.status).toBe(400);
	expect(await refused.json()).toMatchObject({ error: "invalid_redirect_uri" });
	// several addresses are fine: Gemini registers 6 at once
	const six = await hit("POST", OAUTH_REGISTER_PATH, {
		headers: json,
		body: JSON.stringify({
			redirect_uris: [1, 2, 3, 4, 5, 6].map(
				(n) => `https://oauth-redirect.googleusercontent.com/r/${n}`,
			),
		}),
	});
	expect(six.status).toBe(201);
	// a body that is not a client at all is a different error
	const broken = await hit("POST", OAUTH_REGISTER_PATH, {
		headers: json,
		body: "{}",
	});
	expect(await broken.json()).toMatchObject({
		error: "invalid_client_metadata",
	});

	// the token endpoint takes a form, like every OAuth client sends
	const form = { "Content-Type": "application/x-www-form-urlencoded" };
	const swap = await hit("POST", OAUTH_TOKEN_PATH, {
		headers: form,
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: "no-such-code",
			code_verifier: "v".repeat(43),
			redirect_uri: "https://claude.ai/api/mcp/auth_callback",
			client_id: client.client_id,
		}).toString(),
	});
	expect(swap.status).toBe(400);
	expect(await swap.json()).toEqual({ error: "invalid_grant" });
	const empty = await hit("POST", OAUTH_TOKEN_PATH, {
		headers: form,
		body: "",
	});
	expect(await empty.json()).toEqual({ error: "invalid_request" });

	// the consent page is for a signed-in admin: a guest goes to the sign-in,
	// and the page is remembered for after it
	const cookies = new Bun.CookieMap();
	const page = router.routes[OAUTH_AUTHORIZE_PATH];
	if (!page || page instanceof Response) throw new Error("no consent route");
	const guest = await page.GET!(
		Object.assign(
			new Request(`http://pos.test${OAUTH_AUTHORIZE_PATH}?client_id=x`),
			{ params: {}, cookies },
		) as never,
	);
	expect(guest.status).toBe(302);
	expect(guest.headers.get("Location")).toBe("/login");
	expect(cookies.get("next")).toBe(`${OAUTH_AUTHORIZE_PATH}?client_id=x`);
	// allowing needs a session too
	const post = await page.POST!(
		Object.assign(
			new Request(`http://pos.test${OAUTH_AUTHORIZE_PATH}`, { method: "POST" }),
			{ params: {}, cookies: new Bun.CookieMap() },
		) as never,
	);
	expect(post.status).toBe(303);
});

/**
 * Send JSON-RPC to the MCP endpoint the way Bun would.
 * @param message One message, a list of them, or raw text.
 * @param o The key's role (null = no key) and extra headers.
 * @returns The status and the parsed JSON (null when there is no body).
 */
async function mcp(
	message: unknown,
	o: { as?: Role | null; headers?: Record<string, string> } = {},
) {
	const entry = router.routes[MCP_PATH];
	if (!entry || entry instanceof Response) throw new Error("no MCP route");
	const as = o.as === undefined ? "admin" : o.as;
	const req = Object.assign(
		new Request(`http://pos.test${MCP_PATH}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(as && { "X-API-Key": KEYS[as] }),
				...o.headers,
			},
			body: typeof message === "string" ? message : JSON.stringify(message),
		}),
		{ params: {}, cookies: new Bun.CookieMap() },
	);
	const res = await entry.POST!(req as never);
	const text = await res.text();
	return {
		status: res.status,
		body: (text ? JSON.parse(text) : null) as any,
		res,
	};
}

/**
 * Call one MCP tool and read the API answer inside it.
 * @param name The tool.
 * @param args Its arguments.
 * @param as The key's role.
 * @returns `isError` and the parsed answer of the API.
 */
async function tool(name: string, args: unknown = {}, as: Role = "admin") {
	const r = await mcp(
		{
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		},
		{ as },
	);
	const result = r.body.result;
	return {
		isError: result.isError as boolean,
		data: JSON.parse(result.content[0].text) as any,
	};
}

test("MCP: the same key, the routes as tools, the API's own rules behind every call", async () => {
	RateLimit.reset();
	// no key: the same 401 as the API, and it says where a client finds the sign-in
	const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
	const none = await mcp(ping, { as: null });
	expect(none.status).toBe(401);
	expect(none.res.headers.get("WWW-Authenticate")).toBe(
		`Bearer resource_metadata="${HOST}${OAUTH_RESOURCE_PATH}"`,
	);
	// a client that signed in through OAuth sends the key as a Bearer key
	const bearer = await mcp(ping, {
		as: null,
		headers: { Authorization: `Bearer ${KEYS.admin}` },
	});
	expect(bearer.status).toBe(200);
	const wrong = await mcp(ping, {
		as: null,
		headers: { Authorization: "Bearer srk_wrong" },
	});
	expect(wrong.status).toBe(401);

	const init = await mcp({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: { protocolVersion: "2025-03-26", capabilities: {} },
	});
	expect(init.status).toBe(200);
	expect(init.body).toMatchObject({
		jsonrpc: "2.0",
		id: 1,
		result: {
			protocolVersion: "2025-03-26", // the client's own, when this server speaks it
			capabilities: { tools: {} },
			serverInfo: {
				name: MCP_SERVER_NAME,
				icons: [
					{ src: `${Url.appOrigin()}/android-chrome-192x192.png` },
					{ src: `${Url.appOrigin()}/android-chrome-512x512.png` },
				],
			},
		},
	});
	// a version this server does not know: it offers its newest
	const future = await mcp({
		jsonrpc: "2.0",
		id: 2,
		method: "initialize",
		params: { protocolVersion: "2999-01-01" },
	});
	expect(future.body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
	expect(
		(
			await mcp(
				{ jsonrpc: "2.0", id: 3, method: "ping" },
				{ headers: { "MCP-Protocol-Version": "1999-01-01" } },
			)
		).status,
	).toBe(400);

	// a notification gets no answer; a list of messages gets a list of answers
	const note = await mcp({
		jsonrpc: "2.0",
		method: "notifications/initialized",
	});
	expect(note.status).toBe(202);
	expect(note.body).toBeNull();
	const batch = await mcp([
		{ jsonrpc: "2.0", id: "a", method: "ping" },
		{ jsonrpc: "2.0", method: "notifications/initialized" },
		{ jsonrpc: "2.0", id: "b", method: "nope" },
	]);
	expect(batch.body).toHaveLength(2);
	expect(batch.body[0]).toEqual({ jsonrpc: "2.0", id: "a", result: {} });
	expect(batch.body[1].error.code).toBe(-32601);
	const broken = await mcp("{not json");
	expect(broken.status).toBe(400);
	expect(broken.body.error.code).toBe(-32700);

	// one tool per documented route, named from its summary; a weaker key sees fewer
	const all = await mcp({ jsonrpc: "2.0", id: 4, method: "tools/list" });
	const names: string[] = all.body.result.tools.map(
		(t: { name: string }) => t.name,
	);
	expect(names).toHaveLength(apiDocs.length);
	expect(new Set(names).size).toBe(names.length);
	// pinned: a reworded summary would rename a tool under a client that saved it
	expect(names).toEqual(
		expect.arrayContaining([
			"who_am_i",
			"read_user_guide",
			"list_products",
			"create_product",
			"update_product",
			"adjust_stock",
			"create_order",
			"refund_order",
			"list_redemptions_of_coupon",
			"pay_commission",
			"schedule_campaign",
			"get_sales_report",
		]),
	);
	// a tool that takes money, stock or emails for good is marked, so a client asks the person first
	const hints = Object.fromEntries(
		all.body.result.tools.map((t: any) => [
			t.name,
			t.annotations.destructiveHint,
		]),
	);
	for (const name of [
		"refund_order",
		"void_order",
		"record_payment",
		"adjust_stock",
		"schedule_campaign",
		"delete_product",
	])
		expect(hints[name]).toBe(true);
	expect([hints.list_products, hints.create_product]).toEqual([false, false]);
	const cashier = await mcp(
		{ jsonrpc: "2.0", id: 5, method: "tools/list" },
		{ as: "cashier" },
	);
	const cashierNames: string[] = cashier.body.result.tools.map(
		(t: { name: string }) => t.name,
	);
	expect(cashierNames).toContain("create_order");
	expect(cashierNames).not.toContain("create_product");
	expect(cashierNames).not.toContain("refund_order");

	// a tool's arguments: the path's id, the query string and the body's fields side by side
	const update = all.body.result.tools.find(
		(t: { name: string }) => t.name === "update_product",
	);
	expect(update.inputSchema.required).toEqual(["id", "name", "price"]);
	expect(update.annotations).toMatchObject({
		readOnlyHint: false,
		idempotentHint: true,
	});
	const list = all.body.result.tools.find(
		(t: { name: string }) => t.name === "list_products",
	);
	expect(Object.keys(list.inputSchema.properties)).toEqual(
		expect.arrayContaining(["q", "page", "per_page"]),
	);
	expect(list.annotations.readOnlyHint).toBe(true);

	// calls go through the API's own routes: same answers, same rules
	const me = await tool("who_am_i", {}, "manager");
	expect(me.isError).toBe(false);
	matches("Me", me.data);
	expect(me.data.key.role).toBe("manager");
	// the guide is a tool only (no API route), open to a cashier key: the overview by default
	expect(cashierNames).toContain("read_user_guide");
	const help = await tool("read_user_guide", {}, "cashier");
	expect(help.isError).toBe(false);
	GuideAnswer.parse(help.data);
	expect(help.data.topic).toBe("overview");
	for (const row of help.data.topics) {
		const one = await tool("read_user_guide", { topic: row.topic }, "cashier");
		GuideAnswer.parse(one.data);
		// a guide file starts with its title, and is more than a title
		expect(one.data.title).toBe(row.title);
		expect(row.title.length).toBeGreaterThan(2);
		expect(one.data.text.startsWith(`# ${row.title}`)).toBe(true);
		expect(one.data.text.length).toBeGreaterThan(500);
	}
	// an unknown topic is refused
	expect((await tool("read_user_guide", { topic: "nope" })).isError).toBe(true);
	const made = await tool("create_category", { name: "From MCP" });
	expect(made.isError).toBe(false);
	matches("Category", made.data);
	const product = await tool("create_product", {
		name: "MCP Mug",
		price: 700,
		category_ids: [made.data.id],
	});
	matches("Product", product.data);
	// path id + body fields in one argument list
	const edited = await tool("update_product", {
		id: product.data.id,
		name: "MCP Mug XL",
		price: 900,
	});
	expect(edited.data).toMatchObject({ id: product.data.id, price: 900 });
	// query arguments reach the query string
	const found = await tool("list_products", { q: "MCP Mug", per_page: 5 });
	expect(found.data.total).toBe(1);
	expect(found.data.per_page).toBe(5);

	// refusals come back as the API's own error, marked as an error
	const invalid = await tool("create_category", { name: "" });
	expect(invalid.isError).toBe(true);
	expect(invalid.data.error.type).toBe("validation_error");
	const gone = await tool("get_product", { id: 999999 });
	expect(gone.data.error.type).toBe("not_found");
	// a tool the key's role may not use is refused by the route itself, listed or not
	const denied = await tool(
		"create_product",
		{ name: "No", price: 1 },
		"cashier",
	);
	expect(denied.isError).toBe(true);
	expect(denied.data.error.type).toBe("forbidden");
	const unknown = await mcp({
		jsonrpc: "2.0",
		id: 6,
		method: "tools/call",
		params: { name: "drop_everything", arguments: {} },
	});
	expect(unknown.body.error.code).toBe(-32602);
	RateLimit.reset();
});

test("MCP on a shop's own host: that shop's keys only", async () => {
	RateLimit.reset();
	await sql`update shops set slug = 'api-shop' where id = ${S}`;
	await sql`insert into shops (name, currency, timezone, owner_id, slug) values ('Other Shop', 'USD', 'UTC', ${owner.id}, 'other-shop')`;
	const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
	const at = (slug: string) =>
		mcp(ping, { headers: { host: `${slug}.${app.domains.store}` } });
	expect((await at("api-shop")).status).toBe(200);
	const wrong = await at("other-shop");
	expect(wrong.status).toBe(401);
	expect(wrong.body.error.type).toBe("unauthorized");
	RateLimit.reset();
});

test("docs host: its address, and CORS for that host only", async () => {
	const before = { developer: app.domains.developer, url: app.url };
	const allowed = (res: Response) =>
		res.headers.get("Access-Control-Allow-Origin");
	const host = (name: string) =>
		new Request("http://x/", { headers: { host: name } });
	try {
		// no docs host set: no address, no CORS for anyone
		app.domains.developer = "";
		expect(Url.developerOrigin()).toBeNull();
		expect(Url.isDeveloperHost(host("developer.sellrika.com"))).toBe(false);
		const off = await call("OPTIONS", "/products", {
			as: null,
			headers: { Origin: "https://developer.sellrika.com" },
		});
		expect(off.status).toBe(204);
		expect(allowed(off.res)).toBeNull();

		// a real domain is https with no port, whatever the app's own address is
		app.domains.developer = "developer.sellrika.com";
		app.url = "https://sellrika.com";
		expect(Url.developerOrigin()).toBe("https://developer.sellrika.com");
		expect(Url.appOrigin()).toBe("https://sellrika.com");
		expect(Url.isDeveloperHost(host("developer.sellrika.com"))).toBe(true);
		expect(Url.isDeveloperHost(host("developer.sellrika.com:443"))).toBe(true);
		expect(Url.isDeveloperHost(host("www.developer.sellrika.com"))).toBe(false);
		expect(Url.isDeveloperHost(host("sellrika.com"))).toBe(false);
		expect(Url.isDeveloperHost(host("evil-developer.sellrika.com"))).toBe(
			false,
		);

		// the docs host may read the API; nobody else, and never by a near match
		for (const origin of ["https://developer.sellrika.com"]) {
			const pre = await call("OPTIONS", "/products/:id".replace(":id", "1"), {
				as: null,
				headers: { Origin: origin },
			});
			expect(pre.status).toBe(204);
			expect(allowed(pre.res)).toBe(origin);
			expect(pre.res.headers.get("Access-Control-Allow-Headers")).toMatch(
				/Authorization/,
			);
			const me = await call("GET", "/me", { headers: { Origin: origin } });
			expect(me.status).toBe(200);
			expect(allowed(me.res)).toBe(origin);
			// a refusal is readable too, so the docs can show the 401
			const refused = await call("GET", "/me", {
				as: null,
				headers: { Origin: origin },
			});
			expect(refused.status).toBe(401);
			expect(allowed(refused.res)).toBe(origin);
		}
		for (const origin of [
			"https://sellrika.com",
			"https://www.developer.sellrika.com", // no www form
			"http://developer.sellrika.com", // the scheme counts
			"https://developer.sellrika.com.evil.io",
			"https://xdeveloper.sellrika.com",
		]) {
			const me = await call("GET", "/me", { headers: { Origin: origin } });
			expect(me.status).toBe(200);
			expect(allowed(me.res)).toBeNull();
		}

		// dev: a localhost docs host takes the scheme and port of the app
		app.domains.developer = "developer.localhost";
		app.url = "http://localhost:3000";
		expect(Url.developerOrigin()).toBe("http://developer.localhost:3000");
		RateLimit.reset();
	} finally {
		app.domains.developer = before.developer;
		app.url = before.url;
	}
});

test("the OpenAPI file is built from the routes: every route is in it, with its body, role and models", () => {
	const spec = OpenApi.build({
		title: "T",
		version: "1",
		description: "",
		server: "http://pos.test/api/v1",
		tags: [],
		schemas: ApiSchemas,
		docs: apiDocs,
	});
	const operations = Object.values(spec.paths).flatMap((p) => Object.values(p));
	// a tool that only the MCP server has is not in the file, and not a route
	const routes = apiDocs.filter((d) => !d.mcpOnly);
	expect(routes).toHaveLength(apiDocs.length - 1);
	expect(JSON.stringify(spec)).not.toContain("guide");
	expect(operations).toHaveLength(routes.length);
	expect(routes.length).toBeGreaterThan(45);
	// every documented route is a real route, and every real API route is documented
	const documented = new Set(
		routes.map((d) => `${d.method.toUpperCase()} ${API_PREFIX}${d.path}`),
	);
	const real = new Set<string>();
	for (const [pattern, entry] of Object.entries(router.routes)) {
		if (entry instanceof Response || !pattern.startsWith(`${API_PREFIX}/`))
			continue;
		if (pattern.endsWith("/*") || pattern.endsWith("openapi.json")) continue;
		// a preflight (OPTIONS) is not an API call: it has no docs
		for (const m of Object.keys(entry))
			if (m !== "OPTIONS") real.add(`${m} ${pattern}`);
	}
	expect([...real].sort()).toEqual([...documented].sort());
	// every answer points at a model that exists
	const text = JSON.stringify(spec);
	for (const m of text.matchAll(/#\/components\/schemas\/(\w+)/g))
		expect(Object.keys(spec.components.schemas)).toContain(m[1]!);
	expect(text).not.toContain("$schema");
	expect(text).not.toContain(String(Number.MAX_SAFE_INTEGER));

	const paths = spec.paths as any;
	const create = paths["/products"].post;
	expect(
		create.requestBody.content["application/json"].schema.required,
	).toEqual(["name", "price"]);
	expect(create.responses["201"]).toBeTruthy();
	expect(create.description).toMatch(/\*\*manager\*\* or above/);
	expect(paths["/orders/{id}/refunds"].post.description).toMatch(
		/\*\*admin\*\*\./,
	);
	expect(paths["/orders/{id}"].get.parameters[0]).toMatchObject({
		name: "id",
		in: "path",
	});
	const page = paths["/orders"].get.parameters.map(
		(p: { name: string }) => p.name,
	);
	expect(page).toEqual(expect.arrayContaining(["status", "page", "per_page"]));
	expect(spec.security).toEqual([{ apiKey: [] }]);
});

// last in the file: the report test above counts the shop's orders
test("open orders: an order made without `paid` is unpaid, items are added and removed with a history, closed once paid", async () => {
	const p = await call("POST", "/products", {
		body: { name: "Noodles", price: 500, track_stock: true, stock: 4 },
	});
	const id = p.body.id as number;

	// the same route as a sale: no `paid` = written unpaid
	const opened = await call("POST", "/orders", {
		as: "cashier",
		body: { items: [{ product_id: id, qty: 1, note: "no onions" }] },
	});
	expect(opened.status).toBe(201);
	matches("OrderDetail", opened.body);
	expect(opened.body).toMatchObject({
		payment_status: "unpaid",
		payment_method: "Pay later",
		total: 500,
		paid: 0,
		history: [],
	});
	expect(opened.body.items[0].note).toBe("no onions");
	// an unpaid order takes no discount; a paid one needs a payment method
	const discounted = await call("POST", "/orders", {
		body: {
			items: [{ product_id: id, qty: 1 }],
			discount_type: "percent",
			discount_value: 10,
		},
	});
	expect(discounted.status).toBe(422);
	const noMethod = await call("POST", "/orders", {
		body: { items: [{ product_id: id, qty: 1 }], paid: 500 },
	});
	expect(noMethod.body.error.fields).toHaveProperty("payment_method");
	const orderId = opened.body.id as number;

	const added = await call("POST", `/orders/${orderId}/items`, {
		as: "cashier",
		body: { items: [{ product_id: id, qty: 2 }] },
	});
	expect(added.status).toBe(200);
	matches("OrderDetail", added.body);
	expect(added.body.total).toBe(1500);
	expect(added.body.history[0]).toMatchObject({
		type: "items_added",
		data: {
			changed: [{ name: "Noodles", qty: 2, price: 500 }],
			before: { total: 500 },
			after: { total: 1500 },
		},
	});

	const line = added.body.items[1].id as number;
	const removed = await call("POST", `/orders/${orderId}/items/remove`, {
		as: "cashier",
		body: { items: [{ order_item_id: line, qty: 1 }] },
	});
	expect(removed.status).toBe(200);
	matches("OrderDetail", removed.body);
	expect(removed.body.total).toBe(1000);
	expect(removed.body.history[1]).toMatchObject({
		type: "items_removed",
		data: { changed: [{ name: "Noodles", qty: 1, price: 500 }] },
	});

	// refusals: too many, an empty list, an order that is not there
	expect(
		(
			await call("POST", `/orders/${orderId}/items`, {
				body: { items: [{ product_id: id, qty: 9 }] },
			})
		).status,
	).toBe(422);
	expect(
		(await call("POST", `/orders/${orderId}/items`, { body: { items: [] } }))
			.status,
	).toBe(422);
	expect(
		(
			await call("POST", "/orders/999999/items/remove", {
				body: { items: [{ order_item_id: 1, qty: 1 }] },
			})
		).status,
	).toBe(404);

	// paid in full: the order is closed
	await call("POST", `/orders/${orderId}/payments`, { body: { amount: 1000 } });
	const closed = await call("POST", `/orders/${orderId}/items`, {
		body: { items: [{ product_id: id, qty: 1 }] },
	});
	expect(closed.status).toBe(422);
	expect(closed.body.error.fields.order).toContain("closed");
});

test("every API route is also a function for extensions, under a name of its own", () => {
	const routes = apiDocs.filter((doc) => !doc.mcpOnly);
	// a route can not ship without its function…
	expect(
		routes.every((doc) =>
			/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/.test(doc.fn ?? ""),
		),
	).toBe(true);
	expect(routes.every((doc) => typeof doc.run === "function")).toBe(true);
	// …and no two routes share one
	expect(new Set(routes.map((doc) => doc.fn)).size).toBe(routes.length);
	expect(routes.map((doc) => doc.fn)).toContain("orders.setFulfillment");
});

test("MCP: a running extension adds its own tools and its own guide topic", async () => {
	RateLimit.reset();
	const { ExtensionService: _ExtensionService } = await import(
		"@services/settings/extensions/Extension.Service"
	);
	const ExtensionService = Container.get(_ExtensionService);
	const { ExtensionFiles } = await import("@xcore/extensions/ExtensionFiles");
	const dir = `${process.env.EXTENSION_BUILTIN_DIR}/mcp-notes`;
	await Bun.write(
		`${dir}/extension.json`,
		JSON.stringify({
			key: "mcp-notes",
			name: "Notes",
			main: "index.ts",
			guide: "guide.md",
			tools: [
				{
					name: "get_note",
					summary: "Read a product's note",
					route: "GET /products/:id/note",
					role: "cashier",
					input: { id: { type: "integer" } },
				},
				{
					name: "set_note",
					summary: "Set a product's note",
					route: "POST /products/:id/note",
					role: "manager",
					input: { id: { type: "integer" }, note: { type: "string" } },
					required: ["note"],
				},
			],
		}),
	);
	await Bun.write(
		`${dir}/index.ts`,
		`export const routes = {
			"GET /products/:id/note": async (ctx) => ({
				note: (await ctx.data.get("note:" + ctx.params.id)) ?? "",
				role: ctx.user.role,
				loud: ctx.url.searchParams.get("loud"),
			}),
			"POST /products/:id/note": async (ctx) => {
				const body = await ctx.req.json();
				await ctx.data.set("note:" + ctx.params.id, body.note);
				return { note: body.note };
			},
		};`,
	);
	await Bun.write(`${dir}/guide.md`, "# Notes\n\nHow to keep a note.\n");
	const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
	/**
	 * The names of the tools a key sees.
	 * @param as The key's role.
	 * @returns The names.
	 */
	async function names(as: Role) {
		const r = await mcp(list, { as });
		return r.body.result.tools.map((t: { name: string }) => t.name) as string[];
	}

	// not switched on for the shop: no tool, no topic
	expect(await names("admin")).not.toContain("mcp_notes_set_note");
	expect((await tool("read_user_guide", { topic: "mcp-notes" })).isError).toBe(
		true,
	);
	const unknown = await mcp({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: "mcp_notes_get_note", arguments: { id: 7 } },
	});
	expect(unknown.body.error.code).toBe(-32602);

	await ExtensionService.setGlobal("mcp-notes", true);
	await ExtensionService.save(S, "mcp-notes", { enabled: true, config: {} });

	// its tools come after the API's own, with the key in front; a weaker key sees fewer
	const all = await mcp(list);
	expect(all.body.result.tools).toHaveLength(apiDocs.length + 2);
	const set = all.body.result.tools.find(
		(t: { name: string }) => t.name === "mcp_notes_set_note",
	);
	expect(set).toMatchObject({
		title: "Set a product's note",
		inputSchema: {
			properties: { id: { type: "integer" }, note: { type: "string" } },
			required: ["id", "note"],
		},
		annotations: { readOnlyHint: false },
	});
	const cashier = await names("cashier");
	expect(cashier).toContain("mcp_notes_get_note");
	expect(cashier).not.toContain("mcp_notes_set_note");

	// a call runs the extension's own staff route, as the key's user
	const saved = await tool("mcp_notes_set_note", { id: 7, note: "cold" });
	expect(saved).toEqual({ isError: false, data: { note: "cold" } });
	// a GET's other arguments are its query string
	expect(
		await tool("mcp_notes_get_note", { id: 7, loud: true }, "cashier"),
	).toEqual({
		isError: false,
		data: { note: "cold", role: "cashier", loud: "true" },
	});
	// the tool's role is checked on the call too, not only in the list
	const refused = await tool(
		"mcp_notes_set_note",
		{ id: 7, note: "x" },
		"cashier",
	);
	expect(refused.isError).toBe(true);
	expect(refused.data.error.type).toBe("forbidden");

	// its guide is a topic named by its key, listed after the app's own
	const guide = await tool(
		"read_user_guide",
		{ topic: "mcp-notes" },
		"cashier",
	);
	GuideAnswer.parse(guide.data);
	expect(guide.data).toMatchObject({ topic: "mcp-notes", title: "Notes" });
	expect(guide.data.topics.at(-1)).toEqual({
		topic: "mcp-notes",
		title: "Notes",
	});

	// switched off: both are gone again
	await ExtensionService.save(S, "mcp-notes", { enabled: false });
	expect(await names("admin")).not.toContain("mcp_notes_get_note");
	expect((await tool("read_user_guide", {})).data.topics).toHaveLength(13);
	await sql`delete from shop_extensions where key = 'mcp-notes'`;
	await sql`delete from platform_extensions where key = 'mcp-notes'`;
	await ExtensionFiles.remove(process.env.EXTENSION_BUILTIN_DIR!);
});

test("MCP: a tool call takes one hit from the key's budget, not two", async () => {
	const { id } = (await call("GET", "/me")).body.key;
	RateLimit.reset();
	expect((await tool("who_am_i")).isError).toBe(false);
	// one hit taken: with room for two, one more goes through and the next does not
	expect(RateLimit.take(`api:${id}`, 2, 60_000).allowed).toBe(true);
	expect(RateLimit.take(`api:${id}`, 2, 60_000).allowed).toBe(false);
	RateLimit.reset();
});

test("MCP: a list is capped, and every tool call after the first costs one hit of the key", async () => {
	const { RateLimit } = await import("@xcore/http/RateLimit");
	const { MCP_BATCH_MAX } = await import("@constants/Api.Constant");
	const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
	const many = await mcp(Array(MCP_BATCH_MAX + 1).fill(ping));
	expect(many.status).toBe(400);
	expect(many.body.error.message).toContain(String(MCP_BATCH_MAX));
	expect((await mcp(Array(MCP_BATCH_MAX).fill(ping))).status).toBe(200);

	// count the hits taken from the key's budget
	const take = RateLimit.take;
	let hits = 0;
	let allow = true;
	RateLimit.take = function counted(key, ...rest) {
		if (!key.startsWith("api:")) return take.call(RateLimit, key, ...rest);
		hits++;
		return { allowed: allow || hits === 1, retryAfter: 1 };
	};
	const call = {
		jsonrpc: "2.0",
		method: "tools/call",
		params: { name: "who_am_i", arguments: {} },
	};
	try {
		await mcp([
			ping,
			{ ...call, id: 1 },
			{ ...call, id: 2 },
			{ ...call, id: 3 },
		]);
		expect(hits).toBe(3); // the request, then the second and the third call
		// the budget is used up: the first call still runs, the next is refused as a tool error
		hits = 0;
		allow = false;
		const r = await mcp([
			{ ...call, id: 1 },
			{ ...call, id: 2 },
		]);
		expect(r.body.map((a: any) => !!a.result.isError)).toEqual([false, true]);
		expect(r.body[1].result.content[0].text).toContain("rate_limited");
	} finally {
		RateLimit.take = take;
	}
});

test("build files: a path with an empty part is not served", async () => {
	const { fileRoutes } = await import("@routes/files");
	fileRoutes();
	const entry = router.routes["/build/*"] as Record<string, any>;
	const res = await entry.GET(
		new Request("http://pos.test/build//manifest.json"),
	);
	expect(res.status).toBe(404);
});
