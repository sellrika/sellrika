import { tmpdir } from "node:os"; // Bun has no equivalent
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`; // before any app import
process.env.APP_KEY ??= "test-app-key-for-extensions";
// EXTENSION_UPLOAD_DIR (a temp folder, never storage/) is pinned for the whole run by app/test.preload.ts
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { ExtensionService: _ExtensionService } = await import(
	"../extensions/Extension.Service"
);
const ExtensionService = Container.get(_ExtensionService);
const { OrderService: _OrderService } = await import(
	"@services/sales/Order.Service"
);
const OrderService = Container.get(_OrderService);
const { ProductService: _ProductService } = await import(
	"@services/catalog/Product.Service"
);
const ProductService = Container.get(_ProductService);
const { CustomerService: _CustomerService } = await import(
	"@services/sales/Customer.Service"
);
const CustomerService = Container.get(_CustomerService);
const { StockService: _StockService } = await import(
	"@services/catalog/Stock.Service"
);
const StockService = Container.get(_StockService);
const { UserService: _UserService } = await import("../User.Service");
const UserService = Container.get(_UserService);
const { OrderRepository: _OrderRepository } = await import(
	"@repositories/Order.Repository"
);
const OrderRepository = Container.get(_OrderRepository);
const { PaymentMethodRepository: _PaymentMethodRepository } = await import(
	"@repositories/PaymentMethod.Repository"
);
const PaymentMethodRepository = Container.get(_PaymentMethodRepository);
const { DailyReportService: _DailyReportService } = await import(
	"@services/sales/DailyReport.Service"
);
const DailyReportService = Container.get(_DailyReportService);
const { EXTENSION_EVENTS } = await import("@constants/Extension.Constant");
const { zip } = await import("@helpers/zip");
const { ExtensionFiles } = await import("@xcore/extensions/ExtensionFiles");

await migrate(true);
afterAll(() => ExtensionFiles.remove(process.env.EXTENSION_UPLOAD_DIR!));

// a shop with one recorder extension that listens for every event, and a second shop to prove staff events reach every shop of the account
const [s] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, slug) values ('Events Shop', 'USD', 'UTC', 'events-shop')`,
	sql`id`,
);
const S = s.id as number;
const [s2] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, slug) values ('Events Shop 2', 'USD', 'UTC', 'events-shop-2')`,
	sql`id`,
);
const S2 = s2.id as number;
if (!(await PaymentMethodRepository.count(S)))
	await PaymentMethodRepository.seedDefaults(S);
const [u] = await Db.insert(
	sql,
	"users",
	sql`insert into users (name, email, password_hash, role) values ('Ev Cashier', ${`ev${S}@x.io`}, 'x', 'admin')`,
	sql`id, name, email, role, active, created_at, password_hash`,
);
const U = u.id as number;
// both shops are U's: staff events go to every shop of the owner's account
await sql`update shops set owner_id = ${U} where id in (${S}, ${S2})`;
const recorder = `export default { ${EXTENSION_EVENTS.map((e) => `"${e}": async ({ shop, ...data }) => { (globalThis.__events ??= []).push(["${e}", shop.id, data]); }`).join(", ")} };`;
expect(
	await ExtensionService.upload(
		new File(
			[
				zip({
					"extension.json": JSON.stringify({
						key: "recorder",
						name: "Recorder",
					}),
					"index.js": recorder,
				}).slice().buffer as ArrayBuffer,
			],
			"r.zip",
		),
	),
).toEqual({ key: "recorder" });
// on for all shops, then each shop enables it
await ExtensionService.setGlobal("recorder", true);
for (const shop of [S, S2])
	expect(
		await ExtensionService.save(shop, "recorder", { enabled: true }),
	).toEqual({});
type Seen = [string, number, any];
const seen = (): Seen[] => (globalThis as any).__events ?? [];
const reset = () => ((globalThis as any).__events = []);
/** emit() is never awaited by the services — `idle()` waits for every one in flight, then the count must be exact. */
async function events(n: number): Promise<Seen[]> {
	await ExtensionService.idle();
	const out = seen().sort((a, b) => a[0].localeCompare(b[0]));
	if (out.length !== n)
		throw new Error(
			`expected ${n} events, got: ${out.map((e) => e[0]).join(", ")}`,
		);
	return out;
}
const names = (list: Seen[]) => list.map((e) => e[0]);

const base = {
	description: "",
	images: [],
	barcode: null,
	category_ids: [],
	low_stock_at: 1,
	featured: false,
	active: true,
	original_price: null,
	variants: [],
	purchase_price: null,
	sku: null,
	unit: null,
	kind: "item",
	bundle_items: [],
};

test("product events, with the opening count as a stock movement", async () => {
	reset();
	const mug = await ProductService.create(
		S,
		{ ...base, name: "Mug", price: 1000, track_stock: true, stock: 5 } as any,
		U,
	);
	let list = await events(2);
	expect(names(list)).toEqual(["product.created", "stock.updated"]);
	expect(list[0]![2].product.name).toBe("Mug");
	expect(list[1]![2].movement).toMatchObject({
		product_id: mug.id,
		qty: 5,
		type: "adjustment",
	});
	reset();
	await ProductService.update(
		mug.id,
		S,
		{
			...base,
			name: "Big mug",
			price: 1200,
			track_stock: true,
			stock: 5,
		} as any,
		U,
	);
	await ProductService.setFeatured(mug.id, S, true);
	list = await events(2);
	expect(names(list)).toEqual(["product.updated", "product.updated"]);
	expect(list[1]![2].product.featured).toBe(true);
	reset();
	const gone = await ProductService.create(
		S,
		{ ...base, name: "Gone", price: 100, track_stock: false, stock: 0 } as any,
		U,
	);
	await events(1);
	reset();
	expect(await ProductService.remove(gone.id, S)).toBeNull();
	list = await events(1);
	expect(list[0]![0]).toBe("product.deleted");
	expect(list[0]![2].product.name).toBe("Gone");
});

test("customer events", async () => {
	reset();
	const c = await CustomerService.create(S, {
		name: "Ann",
		phone: "0912",
		email: "ann@x.io",
		note: "",
	} as any);
	await CustomerService.update(c.id, S, {
		name: "Ann B",
		phone: "0912",
		email: "ann@x.io",
		note: "",
	} as any);
	await CustomerService.remove(c.id, S);
	const list = await events(3);
	expect(names(list)).toEqual([
		"customer.created",
		"customer.deleted",
		"customer.updated",
	]);
	expect(list[1]![2].customer.name).toBe("Ann B"); // the row as it was
});

test("stock adjustment → stock.updated for that unit only", async () => {
	reset();
	const p = await ProductService.create(
		S,
		{ ...base, name: "Tee", price: 2000, track_stock: true, stock: 2 } as any,
		U,
	);
	await events(2);
	reset();
	expect(
		await StockService.adjust(S, U, {
			product_id: p.id,
			variant_id: null,
			reason: "count",
			note: "",
			delta: 3,
			set: null,
		} as any),
	).toBeNull();
	const list = await events(1);
	expect(list[0]![2].movement).toMatchObject({
		product_id: p.id,
		variant_id: null,
		qty: 3,
		type: "adjustment",
	});
	expect(list[0]![2].unit).toEqual({
		name: "Tee",
		variant: null,
		stock: 5,
		low_stock_at: 1,
	});
	reset();
	expect(
		await StockService.adjust(S, U, {
			product_id: p.id,
			variant_id: null,
			reason: "count",
			note: "",
			delta: 0,
			set: null,
		} as any),
	).toBeNull(); // no-op → nothing
	await ExtensionService.idle();
	expect(seen()).toEqual([]);
});

test("order events: POS sale → created + paid + stock (with the customer on the order); refund, void, fulfillment and a manual payment", async () => {
	reset();
	const p = await ProductService.create(
		S,
		{ ...base, name: "Pen", price: 500, track_stock: true, stock: 10 } as any,
		U,
	);
	const ann = await CustomerService.create(S, {
		name: "Ann",
		phone: "0913",
		email: "",
		note: "",
	} as any);
	await events(3);
	reset();
	const r = await OrderService.checkout(S, U, {
		items: [{ product_id: p.id, variant_id: null, qty: 2 }],
		paid: 1000,
		payment_method: "Cash",
		customer_id: ann.id,
		discount_type: null,
		discount_value: 0,
	} as any);
	expect(r.errors).toBeUndefined();
	let list = await events(3);
	expect(names(list)).toEqual(["order.created", "order.paid", "stock.updated"]);
	expect(list[0]![2].order.customer).toMatchObject({ id: ann.id, name: "Ann" }); // the re-read order, not the bare inserted row
	expect(list[0]![2].order.cashier).toBe("Ev Cashier");
	expect(list[2]![2].movement).toMatchObject({
		order_id: r.order!.id,
		qty: -2,
		type: "sale",
	});

	reset();
	const rf = await OrderService.refund(r.order!.id, S, U, {
		amount: 500,
		reason: "one back",
		restock: true,
		items: [{ order_item_id: r.order!.items[0]!.id, qty: 1 }],
	} as any);
	expect(rf.errors).toBeUndefined();
	list = await events(4);
	expect(names(list)).toEqual([
		"order.refunded",
		"order.status_changed",
		"order.updated",
		"stock.updated",
	]);
	expect(list[1]![2]).toMatchObject({
		field: "status",
		from: "completed",
		to: "partially_refunded",
	});
	expect(list[3]![2].movement).toMatchObject({
		order_id: r.order!.id,
		qty: 1,
		type: "refund",
	});

	// a void puts the rest back
	reset();
	const r2 = await OrderService.checkout(S, U, {
		items: [{ product_id: p.id, variant_id: null, qty: 1 }],
		paid: 500,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	} as any);
	await events(3);
	reset();
	expect(
		await OrderService.void(r2.order!.id, S, U, { reason: "mistake" }),
	).toBeNull();
	list = await events(4);
	expect(names(list)).toEqual([
		"order.status_changed",
		"order.updated",
		"order.voided",
		"stock.updated",
	]);
	expect(list[0]![2]).toMatchObject({
		field: "status",
		from: "completed",
		to: "voided",
	});
	expect(list[2]![2].reason).toBe("mistake");

	// an unpaid online order: delivery stage, then the money arrives in two parts — paid only on the last one
	const online = await OrderRepository.create(
		{
			shop_id: S,
			user_id: U,
			customer_id: null,
			subtotal: 1000,
			discount_type: null,
			discount_value: 0,
			discount: 0,
			delivery_fee: 0,
			tax: 0,
			tax_rate: 0,
			tax_label: "",
			tax_included: false,
			total: 1000,
			paid: 0,
			change: 0,
			payment_method: "Cash on delivery",
			payment_status: "unpaid",
			fulfillment: "new",
			note: "",
		},
		[
			{
				product_id: p.id,
				variant_id: null,
				name: "Pen",
				price: 500,
				cost: null,
				qty: 2,
				track_stock: false,
			},
		],
	);
	reset();
	expect(
		await OrderService.setFulfillment(online.id, S, {
			fulfillment: "packing",
			tracking: "",
		}),
	).toBeNull();
	list = await events(2);
	expect(names(list)).toEqual(["order.status_changed", "order.updated"]);
	expect(list[0]![2]).toMatchObject({
		field: "fulfillment",
		from: "new",
		to: "packing",
	});
	reset();
	expect(
		(await OrderService.recordPayment(online.id, S, { amount: 400 }))
			.payment_status,
	).toBe("partial");
	list = await events(2);
	expect(names(list)).toEqual(["order.status_changed", "order.updated"]);
	expect(list[0]![2]).toMatchObject({
		field: "payment_status",
		from: "unpaid",
		to: "partial",
	});
	reset();
	expect(
		(await OrderService.recordPayment(online.id, S, { amount: 600 }))
			.payment_status,
	).toBe("paid");
	list = await events(3);
	expect(names(list)).toEqual([
		"order.paid",
		"order.status_changed",
		"order.updated",
	]);
	expect(list[1]![2]).toMatchObject({
		field: "payment_status",
		from: "partial",
		to: "paid",
	});
});

test("staff events reach every shop of the account and never carry the password hash", async () => {
	reset();
	const actor = { id: U, role: "admin", owner_id: null } as any;
	expect(
		await UserService.create(
			{
				name: "New Staff",
				email: `new-${S}@x.io`,
				role: "cashier",
				password: "secret123",
			},
			actor,
		),
	).toBeNull();
	let list = await events(2);
	expect(
		list.map((e) => [e[0], e[1]]).sort((a, b) => Number(a[1]) - Number(b[1])),
	).toEqual([
		["staff.created", S],
		["staff.created", S2],
	]);
	expect(list[0]![2].user).toMatchObject({
		name: "New Staff",
		role: "cashier",
	});
	expect(list[0]![2].user.password_hash).toBeUndefined();
	const id = list[0]![2].user.id as number;
	reset();
	expect(
		await UserService.update(
			id,
			{
				name: "Renamed",
				email: `new-${S}@x.io`,
				role: "cashier",
				active: true,
				password: "",
			} as any,
			actor,
		),
	).toBeNull();
	list = await events(2);
	expect(names(list)).toEqual(["staff.updated", "staff.updated"]);
	expect(list[0]![2].user.name).toBe("Renamed");
	reset();
	expect(await UserService.remove(id, actor)).toBeNull();
	list = await events(2);
	expect(names(list)).toEqual(["staff.deleted", "staff.deleted"]);
});

test("report.daily carries the shop's day and the picked channels, once per day", async () => {
	reset();
	await sql`update shops set report_enabled = ${true}, report_time = '00:00', report_channels = 'slack,line', report_sent_on = '' where id = ${S}`;
	// the shop's clock is UTC, and the orders above were made today
	const now = new Date();
	expect(await DailyReportService.run(now)).toBe(1);
	expect(await DailyReportService.run(now)).toBe(0);
	const list = await events(1);
	expect(list[0]![0]).toBe("report.daily");
	expect(list[0]![1]).toBe(S);
	expect(list[0]![2].channels).toEqual(["slack", "line"]);
	const { report } = list[0]![2];
	expect(report.date).toBe(now.toISOString().slice(0, 10));
	// voided orders are left out, like on the page
	expect(report.summary.orders).toBeGreaterThan(0);
	expect(report.summary.revenue).toBe(
		report.summary.sales - report.summary.refunds,
	);
	expect(report.top_products[0]).toEqual({
		name: expect.any(String),
		qty: expect.any(Number),
		revenue: expect.any(Number),
	});
	expect(report.by_method[0]).toMatchObject({ orders: expect.any(Number) });
	await sql`update shops set report_enabled = ${false} where id = ${S}`;
});
