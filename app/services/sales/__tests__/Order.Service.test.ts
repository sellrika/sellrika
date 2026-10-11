import { tmpdir } from "node:os"; // Bun has no equivalent
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
// The module cache is shared across test files, so never `sql.close()` here.
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { Db, sql } = await import("@xcore/database/Database");
const { migrate, migrationDb } = await import("@database/migrate");
const { OrderService: _OrderService } = await import("../Order.Service");
const { CartPricer } = await import("../CartPricer.Service");
const { discountAmount } = await import("@helpers/discount");
const OrderService = Container.get(_OrderService);
const { ProductRepository: _ProductRepository } = await import(
	"@repositories/Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);
const { StockRepository: _StockRepository } = await import(
	"@repositories/Stock.Repository"
);
const StockRepository = Container.get(_StockRepository);
const { StockService: _StockService } = await import(
	"@services/catalog/Stock.Service"
);
const StockService = Container.get(_StockService);
const { ReportService: _ReportService } = await import("../Report.Service");
const ReportService = Container.get(_ReportService);
const { PaymentMethodRepository: _PaymentMethodRepository } = await import(
	"@repositories/PaymentMethod.Repository"
);
const PaymentMethodRepository = Container.get(_PaymentMethodRepository);
const { OrderRepository: _OrderRepository } = await import(
	"@repositories/Order.Repository"
);
const OrderRepository = Container.get(_OrderRepository);
const { CustomerRepository: _CustomerRepository } = await import(
	"@repositories/Customer.Repository"
);
const CustomerRepository = Container.get(_CustomerRepository);
const { CouponRepository: _CouponRepository } = await import(
	"@repositories/Coupon.Repository"
);
const CouponRepository = Container.get(_CouponRepository);
const { CouponInput } = await import("@validators/Coupon.Validator");
const { MailService: _MailService } = await import(
	"@services/settings/Mail.Service"
);
const MailService = Container.get(_MailService);
const { MailerRegistry } = await import("@mail/Mailer.Registry");
const MAILERS = Object.fromEntries(
	Container.get(MailerRegistry)
		.all()
		.map((m) => [m.key, m]),
);

await migrate(true);

// fixtures: a shop, a user, Cash, one tracked product (stock 3) and one tracked product with variants
const [shop] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone) values ('T', 'USD', 'UTC')`,
	sql`id`,
);
const S = shop.id as number;
if (!(await PaymentMethodRepository.count(S)))
	await PaymentMethodRepository.seedDefaults(S);
const [u] = await Db.insert(
	sql,
	"users",
	sql`insert into users (name, email, password_hash, role) values ('Cashier', ${`c${S}@x.io`}, 'x', 'cashier')`,
	sql`id`,
);
const U = u.id as number;
const base = {
	description: "",
	images: [],
	barcode: null,
	category_ids: [],
	low_stock_at: 1,
	featured: false,
	active: true,
	original_price: null,
	variants: [] as any[],
};
const mug = await ProductRepository.create(
	S,
	{
		...base,
		name: "Mug",
		price: 1000,
		purchase_price: 400,
		track_stock: true,
		stock: 3,
	} as any,
	U,
);
const tee = await ProductRepository.create(
	S,
	{
		...base,
		name: "Tee",
		price: 2000,
		purchase_price: null,
		track_stock: true,
		stock: 0,
		variants: [
			{
				name: "S",
				price: 2000,
				purchase_price: 800,
				attributes: null,
				barcode: null,
				images: [],
				stock: 2,
			},
			{
				name: "M",
				price: 2500,
				purchase_price: null,
				attributes: null,
				barcode: null,
				images: [],
				stock: 0,
			},
		],
	} as any,
	U,
);
const teeS = (await ProductRepository.find(tee.id, S))!.variants[0]!;
const untracked = await ProductRepository.create(
	S,
	{
		...base,
		name: "Sticker",
		price: 100,
		purchase_price: null,
		track_stock: false,
		stock: 0,
	} as any,
	U,
);

test("discount math", () => {
	expect(discountAmount(1000, null, 50)).toBe(0);
	expect(discountAmount(1000, "percent", 10)).toBe(100);
	expect(discountAmount(999, "percent", 33)).toBe(330);
	expect(discountAmount(1000, "fixed", 5000)).toBe(1000); // never below zero
	expect(
		_OrderService.refundValue({ subtotal: 3000, total: 2700 }, [
			{ price: 1000, qty: 1 },
		]),
	).toBe(900); // pro-rata 10% discount
});

test("checkout: re-priced lines, percent discount, cost snapshot, stock taken through the ledger", async () => {
	const r = await OrderService.checkout(S, U, {
		items: [
			{ product_id: mug.id, variant_id: null, qty: 2 },
			{ product_id: tee.id, variant_id: teeS.id, qty: 1 },
			{ product_id: untracked.id, variant_id: null, qty: 3 },
		],
		paid: 10000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: "percent",
		discount_value: 10,
	});
	expect(r.errors).toBeUndefined();
	const o = r.order!;
	expect(o.subtotal).toBe(2 * 1000 + 2000 + 300);
	expect(o.discount).toBe(430);
	expect(o.total).toBe(3870);
	expect(o.change).toBe(10000 - 3870);
	expect(o.items.map((i) => [i.name, i.cost])).toEqual([
		["Mug", 400],
		["Tee — S", 800],
		["Sticker", null],
	]);
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(1);
	expect(await StockRepository.level(sql, S, tee.id, teeS.id)).toBe(1);
	const moves = await StockRepository.movements(S, mug.id, null, 1, 10);
	expect(moves.data.map((m) => [m.type, m.qty, m.order_id])).toEqual([
		["sale", -2, o.id],
		["adjustment", 3, null],
	]);
});

test("checkout: out of stock is refused and nothing is written; variant products need a variant", async () => {
	const before = Number((await sql`select count(*) as n from orders`)[0].n);
	const r = await OrderService.checkout(S, U, {
		items: [{ product_id: mug.id, variant_id: null, qty: 2 }],
		paid: 5000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(r.errors?.cart).toMatch(/Only 1 × Mug/);
	// duplicate lines are merged before the check
	const r2 = await OrderService.checkout(S, U, {
		items: [
			{ product_id: mug.id, variant_id: null, qty: 1 },
			{ product_id: mug.id, variant_id: null, qty: 1 },
		],
		paid: 5000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(r2.errors?.cart).toMatch(/Only 1 × Mug/);
	const r3 = await OrderService.checkout(S, U, {
		items: [{ product_id: tee.id, variant_id: null, qty: 1 }],
		paid: 5000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(r3.errors?.cart).toMatch(/no longer exists/);
	expect(Number((await sql`select count(*) as n from orders`)[0].n)).toBe(
		before,
	);
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(1);
});

test("refund: partial with restock, then the rest; status and caches follow", async () => {
	const r = await OrderService.checkout(S, U, {
		items: [
			{ product_id: mug.id, variant_id: null, qty: 1 },
			{ product_id: tee.id, variant_id: teeS.id, qty: 1 },
		],
		paid: 3000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: "fixed",
		discount_value: 300,
	});
	const o = r.order!;
	expect(o.total).toBe(2700);
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(0);
	const mugLine = o.items.find((i) => i.name === "Mug")!;
	// too much
	expect(
		(
			await OrderService.refund(o.id, S, U, {
				amount: 5000,
				reason: "",
				restock: true,
				items: [],
			})
		).errors?.amount,
	).toMatch(/At most 2700/);
	expect(
		(
			await OrderService.refund(o.id, S, U, {
				amount: 100,
				reason: "",
				restock: true,
				items: [{ order_item_id: mugLine.id, qty: 2 }],
			})
		).errors,
	).toBeDefined();
	// return the mug: pro-rata value 1000 * 2700/3000 = 900
	const amount = _OrderService.refundValue(o, [{ price: 1000, qty: 1 }]);
	expect(amount).toBe(900);
	const rf = await OrderService.refund(o.id, S, U, {
		amount,
		reason: "changed mind",
		restock: true,
		items: [{ order_item_id: mugLine.id, qty: 1 }],
	});
	expect(rf.errors).toBeUndefined();
	let d = (await OrderService.find(o.id, S))!;
	expect(d.status).toBe("partially_refunded");
	expect(d.refunded).toBe(900);
	expect(d.items.find((i) => i.name === "Mug")!.refunded_qty).toBe(1);
	expect(d.refunds[0]!.items.map((i) => [i.name, i.qty])).toEqual([["Mug", 1]]);
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(1); // back on the shelf
	// can't return it twice
	expect(
		(
			await OrderService.refund(o.id, S, U, {
				amount: 1,
				reason: "",
				restock: true,
				items: [{ order_item_id: mugLine.id, qty: 1 }],
			})
		).errors,
	).toBeDefined();
	// refund the rest without restocking (damaged tee)
	const teeLine = o.items.find((i) => i.name !== "Mug")!;
	expect(
		(
			await OrderService.refund(o.id, S, U, {
				amount: 1800,
				reason: "damaged",
				restock: false,
				items: [{ order_item_id: teeLine.id, qty: 1 }],
			})
		).errors,
	).toBeUndefined();
	d = (await OrderService.find(o.id, S))!;
	expect(d.status).toBe("refunded");
	expect(await StockRepository.level(sql, S, tee.id, teeS.id)).toBe(0); // unchanged (this sale took the last one)
	expect(await OrderService.void(o.id, S, U, { reason: "" })).toMatch(
		/can't be voided/,
	);
});

test("void: stock back, excluded from stats/reports", async () => {
	const r = await OrderService.checkout(S, U, {
		items: [{ product_id: mug.id, variant_id: null, qty: 1 }],
		paid: 1000,
		payment_method: "Card",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	const o = r.order!;
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(0);
	expect(
		await OrderService.void(o.id, S, U, { reason: "wrong item" }),
	).toBeNull();
	const d = (await OrderService.find(o.id, S))!;
	expect(d.status).toBe("voided");
	expect(d.void_reason).toBe("wrong item");
	expect(d.voided_by_name).toBe("Cashier");
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(1);
	expect(await OrderService.void(o.id, S, U, { reason: "" })).toMatch(
		/already voided/,
	);
	const stats = await OrderService.stats(S, "UTC");
	// order 1 (3870) + order 2 (2700) count; the voided one doesn't; today's refunds (900 + 1800) come off
	expect(stats.today_orders).toBe(2);
	expect(stats.today_revenue).toBe(3870 + 2700 - 2700);
});

test("stock adjust + page + summary", async () => {
	expect(
		await StockService.adjust(S, U, {
			product_id: mug.id,
			variant_id: null,
			delta: 5,
			set: null,
			reason: "received",
			note: "box",
		}),
	).toBeNull();
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(6);
	expect(
		await StockService.adjust(S, U, {
			product_id: mug.id,
			variant_id: null,
			delta: null,
			set: 2,
			reason: "count",
			note: "",
		}),
	).toBeNull();
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(2);
	expect(
		(
			await StockService.adjust(S, U, {
				product_id: mug.id,
				variant_id: null,
				delta: -9,
				set: null,
				reason: "damaged",
				note: "",
			})
		)?.delta,
	).toMatch(/Only 2/);
	expect(
		(
			await StockService.adjust(S, U, {
				product_id: untracked.id,
				variant_id: null,
				delta: 1,
				set: null,
				reason: "other",
				note: "",
			})
		)?.product_id,
	).toMatch(/doesn't track/);
	const page = await StockService.page(S, "all", "", 1, 20);
	expect(page.data.map((i) => [i.name, i.variant_name, i.stock])).toEqual([
		["Mug", null, 2],
		["Tee", "S", 0],
		["Tee", "M", 0],
	]);
	expect(
		(await StockService.page(S, "out", "", 1, 20)).data.map(
			(i) => i.variant_name,
		),
	).toEqual(["S", "M"]);
	expect((await StockService.page(S, "low", "mug", 1, 20)).total).toBe(0);
	expect(await StockService.summary(S)).toEqual({ tracked: 3, low: 2, out: 2 }); // low_stock_at = 1 → S (0) and M (0)
});

test("report for today", async () => {
	const today = new Date().toISOString().slice(0, 10);
	const rep = await ReportService.build(S, "UTC", {
		preset: "today",
		from: today,
		to: today,
		by: "day",
	});
	const s = rep.summary;
	expect(s.orders).toBe(2);
	expect(s.sales).toBe(3870 + 2700);
	expect(s.discounts).toBe(430 + 300);
	expect(s.refunds).toBe(2700);
	expect(s.revenue).toBe(3870);
	// cogs: order1 = 2×400 + 800 = 1600; order2 = 400 + 800 = 1200; restocked mug gives 400 back → 2400
	expect(s.cogs).toBe(2400);
	expect(s.profit).toBe(3870 - 2400);
	expect(s.no_cost_lines).toBe(1); // the Sticker line
	expect(rep.series.length).toBe(1);
	expect(rep.series[0]!.sales).toBe(6570);
	expect(rep.by_method.map((m) => [m.method, m.orders])).toEqual([["Cash", 2]]);
	expect(rep.top_products[0]!.name).toBe("Mug"); // most units sold wins, even though Tee — S made more money
	expect(rep.stock.tracked).toBe(3);

	// tomorrow's report: its "previous period" is today,
	// summed in the database, and must match today's own numbers
	const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
	const next = await ReportService.build(S, "UTC", {
		preset: "custom",
		from: tomorrow,
		to: tomorrow,
		by: "day",
	});
	expect(next.previous).toEqual(s);

	// units sold: counted for the page's products only,
	// or joined for every product when the list is sorted by them — same numbers
	const paged = await ProductRepository.pageForShop(S, "", 1, 100, {
		sold: true,
	});
	const sorted = await ProductRepository.pageForShop(S, "", 1, 100, {
		sold: true,
		sort: { by: "sold", dir: "desc" },
	});
	const soldOf = new Map(sorted.data.map((p) => [p.id, p.sold]));
	expect(sorted.data[0]!.sold).toBeGreaterThan(0);
	for (const p of paged.data) expect(p.sold).toBe(soldOf.get(p.id)!);
});

test("packages: component stock moves at checkout, and the snapshot drives refunds and voids", async () => {
	const pen = await ProductRepository.create(
		S,
		{
			...base,
			name: "Pen",
			price: 250,
			purchase_price: 100,
			track_stock: true,
			stock: 0,
			variants: [
				{
					name: "Red",
					price: 250,
					purchase_price: 120,
					attributes: null,
					barcode: null,
					images: [],
					stock: 30,
				},
				{
					name: "Blue",
					price: 250,
					purchase_price: null,
					attributes: null,
					barcode: null,
					images: [],
					stock: 5,
				},
			],
		} as any,
		U,
	);
	const [red, blue] = (await ProductRepository.find(pen.id, S))!.variants;
	const box = await ProductRepository.create(
		S,
		{
			...base,
			name: "Box",
			price: 100,
			purchase_price: 30,
			track_stock: true,
			stock: 4,
		} as any,
		U,
	);
	const pack = await ProductRepository.create(
		S,
		{
			...base,
			name: "Pen dozen",
			price: 2800,
			purchase_price: null,
			track_stock: false,
			stock: 0,
			kind: "bundle",
			bundle_items: [
				{ product_id: pen.id, variant_ids: [red!.id, blue!.id], qty: 12 },
				{ product_id: box.id, variant_ids: null, qty: 1 },
			],
		} as any,
		U,
	);
	const slot = (await ProductRepository.find(pack.id, S))!.bundle_items[0]!;
	// 30 Red / 12 = 2 packages, 4 boxes cover 4 → the package is sellable twice
	expect((await ProductRepository.find(pack.id, S))!.stock).toBe(2);
	// the picked option is part of the merge key: two identical lines merge, a different pick stays its own line
	expect(
		CartPricer.mergeItems([
			{ product_id: 1, variant_id: null, qty: 1, choices: { 7: 2 } },
			{ product_id: 1, variant_id: null, qty: 1, choices: { 7: 3 } },
			{ product_id: 1, variant_id: null, qty: 1, choices: { 7: 2 } },
		]).map((i) => i.qty),
	).toEqual([2, 1]);

	const pick = { [slot.id]: red!.id };
	const r = await OrderService.checkout(S, U, {
		items: [
			{ product_id: pack.id, variant_id: null, qty: 1, choices: pick },
			{ product_id: pack.id, variant_id: null, qty: 1, choices: pick },
		],
		paid: 6000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	const o = r.order!;
	expect(o.items.length).toBe(1);
	expect([o.items[0]!.name, o.items[0]!.qty]).toEqual([
		"Pen dozen (12 × Red)",
		2,
	]); // fixed slots stay out of the name; choice slots say how many of what
	expect(o.items[0]!.cost).toBe(120 * 12 + 30); // Σ component cost × slot qty, per package
	expect(o.items[0]!.components).toEqual([
		{ product_id: pen.id, variant_id: red!.id, qty: 12 },
		{ product_id: box.id, variant_id: null, qty: 1 },
	]);
	expect(await StockRepository.level(sql, S, pen.id, red!.id)).toBe(6); // 30 - 2 × 12
	expect(await StockRepository.level(sql, S, box.id, null)).toBe(2);
	expect(
		(await StockRepository.movements(S, pen.id, red!.id, 1, 5)).data.map(
			(m) => [m.type, m.qty, m.order_id],
		),
	).toEqual([
		["sale", -24, o.id],
		["adjustment", 30, null],
	]);

	// an unpicked / not-allowed slot is refused, and so is a pick the components can't cover — nothing is written
	const before = Number((await sql`select count(*) as n from orders`)[0].n);
	const cart = (choices?: Record<string, number>) =>
		({
			items: [{ product_id: pack.id, variant_id: null, qty: 1, choices }],
			paid: 5000,
			payment_method: "Cash",
			customer_id: null,
			discount_type: null,
			discount_value: 0,
		}) as any;
	expect((await OrderService.checkout(S, U, cart())).errors?.cart).toMatch(
		/Choose an option for “Pen dozen”/,
	);
	expect(
		(await OrderService.checkout(S, U, cart({ [slot.id]: 999999 }))).errors
			?.cart,
	).toMatch(/Choose an option for “Pen dozen”/);
	expect(
		(await OrderService.checkout(S, U, cart({ [slot.id]: blue!.id }))).errors
			?.cart,
	).toMatch(/Pen dozen \(12 × Blue\) is out of stock/); // 5 Blue < 12
	expect(Number((await sql`select count(*) as n from orders`)[0].n)).toBe(
		before,
	);
	expect(await StockRepository.level(sql, S, pen.id, red!.id)).toBe(6);

	// returning one package puts its components back
	expect(
		(
			await OrderService.refund(o.id, S, U, {
				amount: 2800,
				reason: "",
				restock: true,
				items: [{ order_item_id: o.items[0]!.id, qty: 1 }],
			})
		).errors,
	).toBeUndefined();
	expect(await StockRepository.level(sql, S, pen.id, red!.id)).toBe(18);
	expect(await StockRepository.level(sql, S, box.id, null)).toBe(3);

	// …and so does voiding a sale
	const v2 = await OrderService.checkout(S, U, {
		items: [{ product_id: pack.id, variant_id: null, qty: 1, choices: pick }],
		paid: 2800,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(await StockRepository.level(sql, S, pen.id, red!.id)).toBe(6);
	expect(
		await OrderService.void(v2.order!.id, S, U, { reason: "oops" }),
	).toBeNull();
	expect(await StockRepository.level(sql, S, pen.id, red!.id)).toBe(18);
	expect(await StockRepository.level(sql, S, box.id, null)).toBe(3);
});

test("manual online order: unpaid → partly paid → paid; refunds only what came in; delivery stages email the buyer once when shipped", async () => {
	const buyer = await CustomerRepository.create(S, {
		name: "Cod Buyer",
		phone: `+66 9 ${S}00`,
		email: `cod${S}@x.io`,
		note: "",
	});
	const online = (over: Record<string, unknown> = {}) =>
		OrderRepository.create(
			{
				shop_id: S,
				user_id: U,
				customer_id: buyer.id,
				subtotal: 300,
				discount_type: null,
				discount_value: 0,
				discount: 0,
				delivery_fee: 200,
				tax: 0,
				tax_rate: 0,
				tax_label: "Tax",
				tax_included: false,
				total: 500,
				paid: 0,
				change: 0,
				payment_method: "Cash on delivery",
				payment_status: "unpaid",
				fulfillment: "new",
				note: "Deliver to: Cod Buyer",
				...over,
			} as any,
			[
				{
					product_id: untracked.id,
					variant_id: null,
					name: "Sticker",
					price: 100,
					cost: null,
					qty: 3,
					track_stock: false,
				},
			],
		);
	const o = await online();

	// nothing came in yet → no refund; a POS-style full payment → nothing due
	expect(
		(
			await OrderService.refund(o.id, S, U, {
				amount: 100,
				reason: "",
				restock: false,
				items: [],
			})
		).errors?.order,
	).toMatch(/Nothing has been paid/);
	expect(
		(await OrderService.recordPayment(o.id, S, { amount: 600 })).errors?.amount,
	).toMatch(/At most 500/);
	expect(await OrderService.recordPayment(o.id, S, { amount: 200 })).toEqual({
		paid: 200,
		payment_status: "partial",
	});
	// Two payments that both read the order before either was written:
	// the database adds them up on the row as it is, and refuses the one that no longer fits.
	const stale = (await OrderRepository.find(o.id, S))!;
	expect(await OrderRepository.addPayment(stale, 100)).toEqual({
		paid: 300,
		payment_status: "partial",
	});
	expect(await OrderRepository.addPayment(stale, 300)).toBeNull(); // 300 + 300 > 500
	expect((await OrderRepository.find(o.id, S))!.paid).toBe(300);
	await sql`update orders set paid = 200 where id = ${o.id}`; // back to what the lines below expect
	// partly paid: refunds are capped at the 200 that came in
	expect(
		(
			await OrderService.refund(o.id, S, U, {
				amount: 300,
				reason: "",
				restock: false,
				items: [],
			})
		).errors?.amount,
	).toMatch(/At most 200/);
	expect(await OrderService.recordPayment(o.id, S, { amount: 300 })).toEqual({
		paid: 500,
		payment_status: "paid",
	});
	expect(
		(await OrderService.recordPayment(o.id, S, { amount: 1 })).errors?.amount,
	).toMatch(/already paid/);
	expect((await OrderService.find(o.id, S))!.payment_status).toBe("paid");
	// the Orders screen's "unpaid" and "online" filters see it right
	const f = {
		q: "",
		method: "all",
		customerId: buyer.id,
		source: "all",
		fulfillment: "all",
	} as const;
	expect(
		(await OrderService.page(S, { ...f, status: "unpaid" }, 1, 10)).total,
	).toBe(0);
	expect(
		(
			await OrderService.page(
				S,
				{ ...f, status: "all", source: "online", fulfillment: "new" },
				1,
				10,
			)
		).data.map((x) => x.id),
	).toEqual([o.id]);
	expect(
		(
			await OrderService.page(S, { ...f, status: "all", source: "pos" }, 1, 10)
		).data.map((x) => x.id),
	).toEqual([]);
	// the payment filter offers the gateway label too, not only the shop's POS methods
	expect(await OrderService.methodNames(S)).toContain("Cash on delivery");
	expect(
		(
			await OrderService.page(
				S,
				{ ...f, status: "all", method: "Cash on delivery" },
				1,
				10,
			)
		).data.map((x) => x.id),
	).toEqual([o.id]);

	// delivery stages: only online orders have one; reaching "shipped" emails the buyer once (with the tracking number)
	const sent: any[] = [];
	const realSend = MAILERS.resend!.send;
	afterAll(() => {
		MAILERS.resend!.send = realSend;
	});
	MAILERS.resend!.send = async (_creds, msg) => void sent.push(msg);
	await MailService.update({
		driver: "resend",
		from_email: "noreply@x.io",
		credentials: { resend: { api_key: "re_test" } },
	});
	const pos = await OrderService.checkout(S, U, {
		items: [{ product_id: untracked.id, variant_id: null, qty: 1 }],
		paid: 100,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(
		await OrderService.setFulfillment(pos.order!.id, S, {
			fulfillment: "shipped",
			tracking: "",
		}),
	).toMatch(/Only online orders/);
	expect(
		await OrderService.setFulfillment(o.id, S, {
			fulfillment: "packing",
			tracking: "",
		}),
	).toBeNull();
	await Bun.sleep(20);
	expect(sent).toHaveLength(0);
	expect(
		await OrderService.setFulfillment(o.id, S, {
			fulfillment: "shipped",
			tracking: "TH-42",
		}),
	).toBeNull();
	await Bun.sleep(20);
	expect(sent).toHaveLength(1);
	expect(sent[0].to).toBe(`cod${S}@x.io`);
	expect(sent[0].subject).toBe(`Order ${o.reference} is on its way — T`);
	expect(sent[0].text).toContain("Tracking number: TH-42");
	expect(await OrderService.find(o.id, S)).toMatchObject({
		fulfillment: "shipped",
		tracking: "TH-42",
	});
	// saving "shipped" again (a tracking correction) doesn't email again; going back and forth does
	expect(
		await OrderService.setFulfillment(o.id, S, {
			fulfillment: "shipped",
			tracking: "TH-43",
		}),
	).toBeNull();
	await Bun.sleep(20);
	expect(sent).toHaveLength(1);
	await MailService.update({
		driver: "",
		from_email: "",
		credentials: {},
	});
	// a voided online order is frozen
	await OrderService.void(o.id, S, U, { reason: "test" });
	expect(
		await OrderService.setFulfillment(o.id, S, {
			fulfillment: "delivered",
			tracking: "",
		}),
	).toMatch(/voided/);
	expect(
		(await OrderService.recordPayment((await online()).id, S, { amount: 500 }))
			.paid,
	).toBe(500);
});

test("checkout: the shop's tax line — added on top of the total, or backed out of prices that already hold it — is frozen on the order", async () => {
	const [t] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, tax_rate, tax_label, tax_included) values ('Taxed', 'USD', 'UTC', 700, 'VAT', ${false})`,
		sql`id`,
	);
	const T = t.id as number;
	await PaymentMethodRepository.seedDefaults(T);
	const pen = await ProductRepository.create(
		T,
		{
			...base,
			name: "Pen",
			price: 1000,
			purchase_price: 300,
			track_stock: false,
			stock: 0,
		} as any,
		U,
	);
	const sell = (paid: number) =>
		OrderService.checkout(T, U, {
			items: [{ product_id: pen.id, variant_id: null, qty: 2 }],
			paid,
			payment_method: "Cash",
			customer_id: null,
			discount_type: "fixed",
			discount_value: 500,
		});

	// added: 7% of (2000 − 500) = 105 goes on top, and "paid" must cover it
	expect((await sell(1500)).errors?.cart).toMatch(/less than the total/);
	const added = (await sell(2000)).order!;
	expect([
		added.subtotal,
		added.discount,
		added.tax,
		added.tax_rate,
		added.tax_label,
		added.tax_included,
		added.total,
		added.change,
	]).toEqual([2000, 500, 105, 700, "VAT", false, 1605, 395]);

	// included: the same 1500 already holds 1500 − 1500/1.07 = 98 of VAT; the total is unchanged
	await sql`update shops set tax_included = ${true} where id = ${T}`;
	const incl = (await sell(1500)).order!;
	expect([incl.tax, incl.tax_included, incl.total]).toEqual([98, true, 1500]);
	expect((await OrderRepository.find(incl.id, T))?.tax_included).toBe(true); // read back as a boolean, not sqlite's 1

	// off: no line at all
	await sql`update shops set tax_rate = 0 where id = ${T}`;
	expect((await sell(1500)).order).toMatchObject({
		tax: 0,
		tax_rate: 0,
		total: 1500,
	});

	// reports: the tax isn't profit, whether it was on top or inside the price
	const today = new Date().toISOString().slice(0, 10);
	const s = (
		await ReportService.build(T, "UTC", {
			preset: "today",
			from: today,
			to: today,
			by: "day",
		})
	).summary;
	expect([s.orders, s.sales, s.tax, s.cogs, s.profit]).toEqual([
		3,
		1605 + 1500 + 1500,
		105 + 98,
		3 * 600,
		4605 - 1800 - 203,
	]);
});

test("checkout with a discount code: quoted and re-applied by the same rules, replaces the manual discount, counted once; a void gives the use back", async () => {
	const c = CouponInput.safeParse({
		code: "till10",
		type: "percent",
		value: 10,
		max_discount: 100,
		usage_limit: 1,
	});
	expect(c.success).toBe(true);
	await CouponRepository.create(S, c.data!);
	const items = [{ product_id: untracked.id, variant_id: null, qty: 20 }]; // $20.00 of stickers, no stock to worry about
	const sale = { items, paid: 5000, payment_method: "Cash", customer_id: null };

	// quote = the same rules the checkout runs: 10% of $20 = $2, capped at $1
	expect(
		(await OrderService.quote(S, { items, coupon: "nope", customer_id: null }))
			.errors,
	).toEqual({ coupon: "That code isn't valid" });
	expect(
		(
			await OrderService.quote(S, {
				items,
				coupon: " till10 ",
				customer_id: null,
			})
		).quote,
	).toEqual({
		code: "TILL10",
		type: "percent",
		value: 10,
		description: "",
		discount: 100,
	});

	// the code wins over the manual discount and is frozen on the order like a percent discount
	const r = await OrderService.checkout(S, U, {
		...sale,
		discount_type: "fixed",
		discount_value: 999,
		coupon: "till10",
	});
	expect(r.errors).toBeUndefined();
	expect(r.order).toMatchObject({
		subtotal: 2000,
		discount: 100,
		discount_type: "percent",
		discount_value: 10,
		total: 1900,
		change: 3100,
		coupon_code: "TILL10",
	});

	// used up now — both the quote and the checkout say so, and nothing is written
	expect(
		(
			await OrderService.quote(S, {
				items,
				coupon: "TILL10",
				customer_id: null,
			})
		).errors,
	).toEqual({ coupon: "That code isn't valid" });
	expect(
		(
			await OrderService.checkout(S, U, {
				...sale,
				discount_type: null,
				discount_value: 0,
				coupon: "TILL10",
			})
		).errors,
	).toEqual({ coupon: "That code isn't valid" });
	expect(
		Number(
			(
				await sql`select count(*) as n from coupon_redemptions where order_id = ${r.order!.id}`
			)[0].n,
		),
	).toBe(1);

	// a void deletes the use → the code works again
	expect(
		await OrderService.void(r.order!.id, S, U, { reason: "test" }),
	).toBeNull();
	expect(
		(
			await OrderService.quote(S, {
				items,
				coupon: "TILL10",
				customer_id: null,
			})
		).quote?.discount,
	).toBe(100);
});

test("checkout: each line gets the order's own shrunk copy of its picture; the product's later changes leave it alone", async () => {
	const { UPLOAD_DIR } = await import("@constants/Storage.Constant");
	const { Storage } = await import("@xcore/storage/Storage");
	const { OrderEmail } = await import("@emails/Order.Email");
	const { ShopRepository } = await import("@repositories/Shop.Repository");
	const capPic = await upload();
	const redPic = await upload();
	const cap = await ProductRepository.create(
		S,
		{
			...base,
			name: "Cap",
			price: 900,
			purchase_price: null,
			track_stock: false,
			stock: 0,
			// an https link is never kept — the first of our own uploads is
			images: ["https://example.com/cap.jpg", capPic],
			variants: [
				{
					...base,
					name: "Red",
					price: 900,
					purchase_price: null,
					attributes: null,
					barcode: null,
					images: [redPic],
					stock: 0,
				},
				{
					...base,
					name: "Blue",
					price: 900,
					purchase_price: null,
					attributes: null,
					barcode: null,
					images: [],
					stock: 0,
				},
			],
		} as any,
		U,
	);
	const [red, blue] = (await ProductRepository.find(cap.id, S))!.variants;
	const r = await OrderService.checkout(S, U, {
		items: [
			{ product_id: cap.id, variant_id: red!.id, qty: 1 },
			{ product_id: cap.id, variant_id: blue!.id, qty: 1 },
			{ product_id: untracked.id, variant_id: null, qty: 1 },
		],
		paid: 5000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(r.errors).toBeUndefined();
	const pictures = r.order!.items.map((i) => i.image);
	expect(pictures[0]).toMatch(/^\/uploads\/\d+\/orders\/.+\.png$/); // variant's own, copied
	expect(pictures[1]).toMatch(/^\/uploads\/\d+\/orders\/.+\.png$/); // else the product's, copied
	expect(pictures[2]).toBeNull(); // else none
	expect(new Set([...pictures, capPic, redPic]).size).toBe(5); // new files, never the product's
	expect(await size(pictures[0]!)).toEqual([224, 112]); // shrunk to fit 224 px
	await sql`update products set images = ${JSON.stringify([await upload()])} where id = ${cap.id}`;
	await sql`update product_variants set images = ${JSON.stringify([])} where product_id = ${cap.id}`;
	const again = await OrderRepository.find(r.order!.id, S);
	expect(again!.items.map((i) => i.image)).toEqual(pictures);

	// the product's own file is deleted: the order email still carries the line's picture
	await Storage.delete(redPic);
	expect(await Bun.file(`${UPLOAD_DIR}${redPic}`).exists()).toBe(false);
	const shop = (await Container.get(ShopRepository).find(S))!;
	const mail = await new OrderEmail("b@x.io", shop, again!).build();
	expect(mail.inline!.map((i) => i.cid)).toContain("item-0@pos");

	/**
	 * Save a real 600×300 PNG as a new upload.
	 * @returns Its `/uploads/…` path.
	 */
	async function upload() {
		const dot = Uint8Array.fromBase64(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		);
		const name = `${Bun.randomUUIDv7()}.png`;
		await Bun.write(
			`${UPLOAD_DIR}/uploads/${name}`,
			await new Bun.Image(dot).resize(600, 300, { fit: "fill" }).png().bytes(),
		);
		return `/uploads/${name}`;
	}

	/**
	 * The size of an upload.
	 * @param url Its `/uploads/…` path.
	 * @returns Its width and height.
	 */
	async function size(url: string) {
		const { width, height } = await new Bun.Image(
			await Bun.file(`${UPLOAD_DIR}${url}`).bytes(),
		).metadata();
		return [width, height];
	}
});

test("checkout: a picture that can't be copied leaves the line without one; the sale still goes through", async () => {
	const lost = await ProductRepository.create(
		S,
		{
			...base,
			name: "Lost Lamp",
			price: 500,
			purchase_price: null,
			track_stock: false,
			stock: 0,
			images: ["/uploads/gone-lamp-0.png"],
		} as any,
		U,
	);
	const r = await OrderService.checkout(S, U, {
		items: [{ product_id: lost.id, variant_id: null, qty: 1 }],
		paid: 500,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(r.errors).toBeUndefined();
	expect(r.order!.items[0]!.image).toBeNull();
});

test("migration 0059: an old line's product picture becomes an order copy; an order copy is left alone", async () => {
	const { UPLOAD_DIR } = await import("@constants/Storage.Constant");
	const { up } = await import(
		"@database/migrations/0059_order_item_image_copies"
	);
	const product = `/uploads/${Bun.randomUUIDv7()}.png`;
	await Bun.write(
		`${UPLOAD_DIR}${product}`,
		Uint8Array.fromBase64(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		),
	);
	const own = "/uploads/order-0199-already.png";
	const [o] = await sql`select id from orders where shop_id = ${S} limit 1`;
	/**
	 * Add an old-style order line with this picture.
	 * @param image The stored picture path.
	 * @returns The new line's id.
	 */
	async function line(image: string) {
		const [row] = await Db.insert(
			sql,
			"order_items",
			sql`insert into order_items (order_id, product_id, variant_id, name, price, cost, qty, image)
        values (${o.id}, ${mug.id}, ${null}, 'Old', 100, ${null}, 1, ${image})`,
			sql`id`,
		);
		return row.id as number;
	}
	const a = await line(product);
	const b = await line(own);
	await up(migrationDb(sql));
	/**
	 * Read a line's picture back.
	 * @param id The line.
	 * @returns Its stored picture.
	 */
	async function imageOf(id: number) {
		return (await sql`select image from order_items where id = ${id}`)[0]
			.image as string | null;
	}
	const copied = await imageOf(a);
	expect(copied).toMatch(/^\/uploads\/\d+\/orders\/.+\.png$/);
	expect(await Bun.file(`${UPLOAD_DIR}${copied!}`).exists()).toBe(true);
	expect(await imageOf(b)).toBe(own);
	await up(migrationDb(sql)); // a second run changes nothing
	expect(await imageOf(a)).toBe(copied);
	await sql`delete from order_items where id in (${a}, ${b})`;
});

test("orders list: the cashier filter shows only that cashier's sales, and the list offers each cashier once", async () => {
	const [second] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Second Till', ${`c2${S}@x.io`}, 'x', 'cashier')`,
		sql`id`,
	);
	const sale = await OrderService.checkout(S, Number(second.id), {
		items: [{ product_id: untracked.id, variant_id: null, qty: 1 }],
		paid: 10000,
		payment_method: "Cash",
		customer_id: null,
		discount_type: null,
		discount_value: 0,
	});
	expect(sale.errors).toBeUndefined();
	const f = {
		q: "",
		method: "all",
		status: "all" as const,
		customerId: null,
		source: "all" as const,
		fulfillment: "all" as const,
	};
	const mine = await OrderService.page(
		S,
		{ ...f, cashierId: Number(second.id) },
		1,
		100,
	);
	expect(mine.data.map((o) => o.id)).toEqual([sale.order!.id]);
	const everyone = await OrderService.page(S, f, 1, 100);
	expect(everyone.total).toBeGreaterThan(1);
	const names = (await OrderService.cashiers(S)).map((c) => c.name);
	expect(names).toContain("Second Till");
	expect(names).toContain("Cashier");
	expect(new Set(names).size).toBe(names.length);
});

test("a refund or void from a stale read can't go through twice", async () => {
	const cup = await ProductRepository.create(
		S,
		{
			...base,
			name: "Race Cup",
			price: 1000,
			purchase_price: null,
			track_stock: true,
			stock: 5,
		} as any,
		U,
	);
	/**
	 * Sell one cup for cash and read it back, like the service does before it writes.
	 * @returns The order as read before any refund or void.
	 */
	async function sell() {
		const r = await OrderService.checkout(S, U, {
			items: [{ product_id: cup.id, variant_id: null, qty: 1 }],
			paid: 1000,
			payment_method: "Cash",
			customer_id: null,
			discount_type: null,
			discount_value: 0,
		});
		return (await OrderRepository.find(r.order!.id, S))!;
	}
	// two requests both read the order before either wrote: the second must be refused
	const o = await sell();
	const full = {
		amount: 1000,
		reason: "",
		restock: true,
		items: [{ order_item_id: o.items[0]!.id, qty: 1 }],
	};
	expect(await OrderRepository.refund(o, U, full, o.items)).not.toBeNull();
	expect(await OrderRepository.refund(o, U, full, o.items)).toBeNull();
	const d = (await OrderService.find(o.id, S))!;
	expect(d.refunded).toBe(1000);
	expect(d.refunds.length).toBe(1);
	expect(await StockRepository.level(sql, S, cup.id, null)).toBe(5); // back once, not twice
	const v = await sell();
	expect(await OrderRepository.void(v, U, "a", v.items)).toBe(true);
	expect(await OrderRepository.void(v, U, "b", v.items)).toBe(false);
	expect(await StockRepository.level(sql, S, cup.id, null)).toBe(5);
});

test("report: top customers ranks by money spent and skips sales with no customer", async () => {
	const big = await CustomerRepository.create(S, {
		name: "Top Buyer",
		phone: `+66 8 ${S}01`,
		email: `top${S}@x.io`,
		note: "",
	});
	const sell = (customer_id: number | null, total: number) =>
		OrderRepository.create(
			{
				shop_id: S,
				user_id: U,
				customer_id,
				subtotal: total,
				discount_type: null,
				discount_value: 0,
				discount: 0,
				delivery_fee: 0,
				tax: 0,
				tax_rate: 0,
				tax_label: "Tax",
				tax_included: false,
				total,
				paid: total,
				change: 0,
				payment_method: "Cash",
				payment_status: "paid",
				fulfillment: "",
				note: "",
			} as any,
			[
				{
					product_id: untracked.id,
					variant_id: null,
					name: "Sticker",
					price: total,
					cost: null,
					qty: 1,
					track_stock: false,
				},
			],
		);
	await sell(big.id, 900_000);
	await sell(big.id, 100_000);
	await sell(null, 5_000_000); // a walk-in sale: bigger, but no customer

	const today = new Date().toISOString().slice(0, 10);
	const rep = await ReportService.build(S, "UTC", {
		preset: "today",
		from: today,
		to: today,
		by: "day",
	});
	const top = rep.top_customers[0]!;
	expect([top.customer_id, top.name, top.orders, top.sales]).toEqual([
		big.id,
		"Top Buyer",
		2,
		1_000_000,
	]);
	expect(rep.top_customers.every((c) => c.customer_id !== null)).toBe(true);
});

test("delivery steps: a shop adds, renames and reorders its own; orders move along them; a step in use can't be removed", async () => {
	const { ShopRepository } = await import("@repositories/Shop.Repository");
	const { FulfillmentStepsInput } = await import("@validators/Order.Validator");
	const { validate } = await import("@validators/validate");
	const shops = Container.get(ShopRepository);
	const [row] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone) values ('Steps', 'USD', 'UTC')`,
		sql`id`,
	);
	const T = row.id as number;
	// a new shop has the built-in list
	expect((await shops.find(T))!.fulfillment_steps.map((s) => s.key)).toEqual([
		"new",
		"packing",
		"shipped",
		"delivered",
	]);

	expect((await shops.find(T))!.fulfillment_steps[0]?.color).toBe("#0ea5e9");
	// locked steps stay, keys are unique, a shop's own step needs a name — the order is free
	const bad = (
		steps: { key: string; label: string; color?: string | null }[],
	) => validate(FulfillmentStepsInput, { steps }).errors;
	expect(bad([{ key: "new", label: "" }])?.steps).toMatch(/can't be removed/);
	expect(
		bad([
			{ key: "new", label: "" },
			{ key: "new", label: "" },
			{ key: "shipped", label: "" },
			{ key: "delivered", label: "" },
		])?.steps,
	).toMatch(/once only/);
	expect(
		bad([
			{ key: "new", label: "" },
			{ key: "wait", label: " " },
			{ key: "shipped", label: "" },
			{ key: "delivered", label: "" },
		])?.["steps.1"],
	).toMatch(/name/);
	expect(
		bad([
			{ key: "new", label: "", color: "red" },
			{ key: "shipped", label: "" },
			{ key: "delivered", label: "" },
		])?.["steps.0.color"],
	).toMatch(/color/);
	const steps = [
		{ key: "shipped", label: "", color: null },
		{ key: "new", label: "Received", color: null },
		{ key: "packing", label: "", color: null },
		{ key: "courier", label: "Waiting for courier", color: "#f59e0b" },
		{ key: "delivered", label: "", color: null },
	];
	expect(bad(steps)).toBeUndefined();
	const shop = (await shops.find(T))!;
	expect(await OrderService.saveSteps(shop, { steps })).toBeNull();
	expect((await shops.find(T))!.fulfillment_steps).toEqual(steps);

	// an order moves to the shop's own step; a step the shop doesn't have is refused
	const o = await OrderRepository.create(
		{
			shop_id: T,
			user_id: U,
			customer_id: null,
			subtotal: 100,
			discount_type: null,
			discount_value: 0,
			discount: 0,
			delivery_fee: 0,
			tax: 0,
			tax_rate: 0,
			tax_label: "Tax",
			tax_included: false,
			total: 100,
			paid: 100,
			change: 0,
			payment_method: "Card",
			payment_status: "paid",
			fulfillment: "new",
			note: "",
		} as any,
		[
			{
				product_id: null,
				variant_id: null,
				name: "Mug",
				price: 100,
				cost: null,
				qty: 1,
				track_stock: false,
			} as any,
		],
	);
	expect(
		await OrderService.setFulfillment(o.id, T, {
			fulfillment: "courier",
			tracking: "",
		}),
	).toBeNull();
	expect((await OrderService.find(o.id, T))!.fulfillment).toBe("courier");
	expect(
		await OrderService.setFulfillment(o.id, T, {
			fulfillment: "nope",
			tracking: "",
		}),
	).toMatch(/delivery status/);

	// removing the step the order sits on is refused, by its name; after the order moves on it's allowed
	const without = steps.filter((s) => s.key !== "courier");
	expect(
		await OrderService.saveSteps((await shops.find(T))!, { steps: without }),
	).toMatch(/"Waiting for courier"/);
	await OrderService.setFulfillment(o.id, T, {
		fulfillment: "delivered",
		tracking: "",
	});
	expect(
		await OrderService.saveSteps((await shops.find(T))!, { steps: without }),
	).toBeNull();
	// the order list filters by a shop's own step too
	expect(
		(
			await OrderService.page(
				T,
				{
					q: "",
					method: "all",
					status: "all",
					customerId: null,
					cashierId: null,
					source: "all",
					fulfillment: "delivered",
				},
				1,
				10,
			)
		).data.map((x) => x.id),
	).toEqual([o.id]);
});

test("sales staff: named on a sale; the commission is worked out from the sales since the last payment, and each payment is kept", async () => {
	const { SalesStaffService: _SalesStaffService } = await import(
		"@services/settings/SalesStaff.Service"
	);
	const SalesStaff = Container.get(_SalesStaffService);
	const [boss] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role) values ('Boss', ${`sales-boss-${S}@x.io`}, 'x', 'admin')`,
		sql`id`,
	);
	const B = boss.id as number;
	const [row] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, owner_id) values ('Sales', 'USD', 'UTC', ${B})`,
		sql`id`,
	);
	const T = row.id as number;
	await PaymentMethodRepository.seedDefaults(T);
	const pen = await ProductRepository.create(
		T,
		{
			...base,
			name: "Pen",
			price: 10000,
			purchase_price: null,
			track_stock: false,
			stock: 0,
		} as any,
		B,
	);
	/**
	 * Ring up some pens in the test shop.
	 * @param qty How many.
	 * @param sales_staff_id The sales person to name, if any.
	 * @returns The checkout result.
	 */
	function sell(qty: number, sales_staff_id?: number | null) {
		return OrderService.checkout(T, B, {
			items: [{ product_id: pen.id, variant_id: null, qty }],
			paid: 10000 * qty,
			payment_method: "Cash",
			customer_id: null,
			discount_type: null,
			discount_value: 0,
			sales_staff_id,
		});
	}
	const filters = {
		q: "",
		method: "all",
		status: "all",
		customerId: null,
		source: "all",
		fulfillment: "all",
	} as const;

	await SalesStaff.create(T, { name: "Ann", commission: 250, active: true });
	await SalesStaff.create(T, { name: "Bob", commission: 0, active: true });
	/**
	 * Ann and Bob as the Staff page lists them.
	 * @returns Both rows, A–Z.
	 */
	async function staff() {
		const [a, b] = await SalesStaff.list(T);
		return [a!, b!] as const;
	}
	const [ann, bob] = await staff();
	expect([ann.name, ann.commission, ann.orders, ann.due]).toEqual([
		"Ann",
		250,
		0,
		0,
	]);
	expect(await SalesStaff.options(T, true)).toEqual([
		{ id: ann.id, name: "Ann" },
		{ id: bob.id, name: "Bob" },
	]);
	/**
	 * Ann's page for a period.
	 * @param from First day.
	 * @param to Last day.
	 * @returns The page's data.
	 */
	async function page(from = "2019-01-01", to = "2100-01-01") {
		return (await SalesStaff.detail(ann.id, T, "UTC", { from, to }))!;
	}
	// nothing sold yet = nothing to pay
	expect(await SalesStaff.pay(ann.id, T)).toEqual({
		sales: "There is no commission to pay",
	});

	// the sale keeps the sales person; nobody named = a normal sale
	const first = (await sell(2, ann.id)).order!;
	expect(first.sales_staff_id).toBe(ann.id);
	expect((await OrderService.find(first.id, T))!.sales_staff).toBe("Ann");
	expect((await sell(1)).order!.sales_staff_id).toBeNull();
	const second = (await sell(1, ann.id)).order!;
	const voided = (await sell(1, ann.id)).order!;
	await OrderService.void(voided.id, T, B, { reason: "" });
	await OrderService.refund(second.id, T, B, {
		amount: 5000,
		reason: "",
		restock: false,
		items: [],
	});
	// their page: 20000 + (10000 − 5000 refunded) at 2.5%; the voided sale is left out, and so is another period
	expect((await page()).totals).toEqual({
		orders: 2,
		sold: 25000,
		commission: 625,
	});
	expect((await page("2019-01-01", "2019-12-31")).totals).toEqual({
		orders: 0,
		sold: 0,
		commission: 0,
	});
	expect(
		await SalesStaff.detail(ann.id, S, "UTC", {
			from: "2019-01-01",
			to: "2100-01-01",
		}),
	).toBeNull();
	const list = await OrderService.page(
		T,
		{ ...filters, salesStaffId: ann.id },
		1,
		10,
	);
	expect(list.data.map((o) => o.id)).toEqual([voided.id, second.id, first.id]);
	expect(list.data[0]!.sales_staff).toBe("Ann");

	// the commission is worked out from the unpaid sales, at today's rate
	let [a] = await staff();
	expect([a.unpaid_orders, a.unpaid_sales, a.due, a.last_paid_at]).toEqual([
		2,
		25000,
		625,
		null,
	]);
	await SalesStaff.update(ann.id, T, {
		name: "Ann",
		commission: 1000,
		active: true,
	});
	expect((await staff())[0].due).toBe(2500);

	// paying writes a history row, and its date is where the next count starts
	expect(await SalesStaff.pay(ann.id, T)).toBeNull();
	// timestamps step by one second: put the payment between the old sales and the next one
	await sql`update orders set created_at = '2020-01-01 00:00:00' where shop_id = ${T}`;
	await sql`update sales_commissions set created_at = '2021-01-01 00:00:00' where shop_id = ${T}`;
	[a] = await staff();
	expect([a.unpaid_orders, a.unpaid_sales, a.due]).toEqual([0, 0, 0]);
	expect(String(a.last_paid_at)).toContain("2021");
	expect(await SalesStaff.pay(ann.id, T)).toEqual({
		sales: "There is no commission to pay",
	});
	// only the sales after the payment count for the next one
	await sell(1, ann.id);
	[a] = await staff();
	expect([a.orders, a.unpaid_orders, a.unpaid_sales, a.due]).toEqual([
		4, 1, 10000, 1000,
	]);
	expect(await SalesStaff.pay(ann.id, T)).toBeNull();
	expect(
		(await page()).payments.map((p) => [
			p.sales_staff_id,
			p.amount,
			p.sales,
			p.orders,
			p.commission,
		]),
	).toEqual([
		[ann.id, 1000, 10000, 1, 1000],
		[ann.id, 2500, 25000, 2, 1000],
	]);

	// another shop's sales person, an unknown one and a switched-off one are refused
	const [other] = await Db.insert(
		sql,
		"sales_staff",
		sql`insert into sales_staff (shop_id, name) values (${S}, 'Eve')`,
		sql`id`,
	);
	for (const id of [other.id as number, 999999])
		expect((await sell(1, id)).errors?.cart).toBe(
			"That sales person is no longer available",
		);
	await SalesStaff.update(bob.id, T, {
		name: "Bob",
		commission: 0,
		active: false,
	});
	expect((await sell(1, bob.id)).errors?.cart).toBeTruthy();
	expect(await SalesStaff.options(T, true)).toEqual([
		{ id: ann.id, name: "Ann" },
	]);
	// the Orders filter still offers the one switched off
	expect((await SalesStaff.options(T)).map((s) => s.name)).toEqual([
		"Ann",
		"Bob",
	]);

	// only the own shop's rows change
	expect(
		await SalesStaff.update(other.id, T, {
			name: "X",
			commission: 0,
			active: true,
		}),
	).toEqual({
		sales: "Sales person not found",
	});
	expect(await SalesStaff.remove(other.id, T)).toEqual({
		sales: "Sales person not found",
	});
	// deleting one with sales keeps the orders, with nobody named on them
	expect(await SalesStaff.remove(bob.id, T)).toBeNull();
	expect(await SalesStaff.remove(ann.id, T)).toBeNull();
	expect(await SalesStaff.list(T)).toEqual([]);
	const [left] =
		await sql`select count(*) as n from sales_commissions where shop_id = ${T}`;
	expect(Number(left.n)).toBe(0);
	const kept = (await OrderService.find(first.id, T))!;
	expect([kept.sales_staff_id, kept.sales_staff, kept.total]).toEqual([
		null,
		null,
		20000,
	]);
});

test("report periods: last week is the Monday to Sunday before this week", async () => {
	/**
	 * The last-week period as seen on a given day.
	 * @param day The day, as an ISO instant.
	 * @returns First and last day.
	 */
	function lastWeek(day: string) {
		const q = _ReportService.resolveQuery(
			new URLSearchParams("preset=last_week"),
			"UTC",
			new Date(day),
		);
		return [q.preset, q.from, q.to];
	}
	// Thursday 1 Oct 2026, then a Monday and a Sunday
	expect(lastWeek("2026-10-01T12:00:00Z")).toEqual([
		"last_week",
		"2026-09-21",
		"2026-09-27",
	]);
	expect(lastWeek("2026-09-28T00:30:00Z")).toEqual([
		"last_week",
		"2026-09-21",
		"2026-09-27",
	]);
	expect(lastWeek("2026-10-04T23:00:00Z")).toEqual([
		"last_week",
		"2026-09-21",
		"2026-09-27",
	]);
});

test("an open order: opened unpaid, it takes more lines and gives lines back, and keeps its history", async () => {
	// its own shop, with 10% tax added on top, and one dish with 6 in stock
	const [row] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, tax_rate, tax_label) values ('Diner', 'USD', 'UTC', 1000, 'VAT')`,
		sql`id`,
	);
	const D = row.id as number;
	const soup = await ProductRepository.create(
		D,
		{
			...base,
			name: "Soup",
			price: 1000,
			purchase_price: 300,
			track_stock: true,
			stock: 6,
		} as any,
		U,
	);
	const table = await CustomerRepository.create(D, {
		name: "Table 5",
		phone: null,
		email: null,
		note: "",
	});
	const line = (qty: number, note?: string) => ({
		product_id: soup.id,
		variant_id: null,
		qty,
		...(note && { note }),
	});
	const stock = () => StockRepository.level(sql, D, soup.id, null);

	// open: unpaid, tax on top, the stock is taken, the note stays on the line
	expect(await OrderService.openFor(D, table.id)).toBeNull();
	const [waiter] = await Db.insert(
		sql,
		"sales_staff",
		sql`insert into sales_staff (shop_id, name) values (${D}, 'Wes')`,
		sql`id`,
	);
	// a sales person of another shop is refused, and nothing is written
	const wrong = await OrderService.open(D, U, {
		items: [line(1)],
		customer_id: table.id,
		payment_method: "",
		note: "",
		sales_staff_id: 999999,
	});
	expect(wrong.errors).toEqual({ cart: expect.any(String) });
	expect(await stock()).toBe(6);
	const opened = await OrderService.open(D, U, {
		items: [line(1, "no onions")],
		customer_id: table.id,
		payment_method: "",
		note: "",
		sales_staff_id: waiter.id,
	});
	const id = opened.order!.id;
	expect(opened.order).toMatchObject({
		payment_status: "unpaid",
		sales_staff_id: waiter.id,
		payment_method: "Pay later",
		subtotal: 1000,
		tax: 100,
		total: 1100,
		paid: 0,
	});
	expect(opened.order!.items[0]!.note).toBe("no onions");
	expect(await stock()).toBe(5);
	expect((await OrderService.openFor(D, table.id))?.id).toBe(id);

	// add: the totals and the tax follow, and the history keeps before and after
	const more = await OrderService.addItems(id, D, U, { items: [line(2)] });
	expect(more.added).toHaveLength(1);
	expect(more.order).toMatchObject({
		subtotal: 3000,
		tax: 300,
		total: 3300,
		payment_status: "unpaid",
	});
	expect(await stock()).toBe(3);
	let detail = (await OrderService.find(id, D))!;
	expect(detail.history).toHaveLength(1);
	expect(detail.history[0]).toMatchObject({
		type: "items_added",
		by: "Cashier",
		data: {
			changed: [{ name: "Soup", qty: 2, price: 1000 }],
			before: { total: 1100, items: [{ name: "Soup", qty: 1, price: 1000 }] },
			after: {
				total: 3300,
				items: [
					{ name: "Soup", qty: 1, price: 1000 },
					{ name: "Soup", qty: 2, price: 1000 },
				],
			},
		},
	});

	// two rounds sent at the same moment both land
	const both = await Promise.all([
		OrderService.addItems(id, D, U, { items: [line(1)] }),
		OrderService.addItems(id, D, U, { items: [line(1)] }),
	]);
	expect(both.every((r) => !r.errors)).toBe(true);
	detail = (await OrderService.find(id, D))!;
	expect(detail.subtotal).toBe(5000);
	expect(detail.items).toHaveLength(4);
	expect(await stock()).toBe(1);

	// not enough stock: refused, nothing changes
	const short = await OrderService.addItems(id, D, U, { items: [line(2)] });
	expect(short.errors?.cart).toContain("Soup");
	expect((await OrderService.find(id, D))!.subtotal).toBe(5000);
	expect(await stock()).toBe(1);

	// remove: one unit off the 2-unit line, and one whole line
	const [first, second] = detail.items;
	const less = await OrderService.removeItems(id, D, U, {
		items: [
			{ order_item_id: second!.id, qty: 1 },
			{ order_item_id: first!.id, qty: 1 },
		],
	});
	expect(less.order).toMatchObject({ subtotal: 3000, tax: 300, total: 3300 });
	expect(less.order!.items.map((i) => i.qty)).toEqual([1, 1, 1]);
	expect(await stock()).toBe(3);
	detail = (await OrderService.find(id, D))!;
	expect(detail.history.at(-1)).toMatchObject({
		type: "items_removed",
		data: {
			// what left: one unit of each of the two lines
			changed: [
				{ name: "Soup", qty: 1, price: 1000 },
				{ name: "Soup", qty: 1, price: 1000 },
			],
			before: { total: 5500 },
			after: { total: 3300 },
		},
	});
	expect(detail.history.at(-1)!.data.after.items).toHaveLength(3);

	// guards: more than the line holds, a line of another order, every line at once
	const [a, b, c] = detail.items;
	expect(
		(
			await OrderService.removeItems(id, D, U, {
				items: [{ order_item_id: a!.id, qty: 2 }],
			})
		).errors,
	).toHaveProperty(["items.0.qty"]);
	expect(
		(
			await OrderService.removeItems(id, D, U, {
				items: [{ order_item_id: 0, qty: 1 }],
			})
		).errors,
	).toHaveProperty(["items.0.order_item_id"]);
	expect(
		(
			await OrderService.removeItems(id, D, U, {
				items: [a, b, c].map((l) => ({ order_item_id: l!.id, qty: 1 })),
			})
		).errors?.order,
	).toContain("last item");

	// part paid: the order can't drop under the money already taken
	await OrderService.recordPayment(id, D, { amount: 2500 });
	expect(
		(
			await OrderService.removeItems(id, D, U, {
				items: [{ order_item_id: a!.id, qty: 1 }],
			})
		).errors?.order,
	).toContain("already paid");
	// …but it still grows, and stays partly paid
	const grown = await OrderService.addItems(id, D, U, { items: [line(1)] });
	expect(grown.order).toMatchObject({ total: 4400, payment_status: "partial" });

	// paid in full: closed for both
	await OrderService.recordPayment(id, D, { amount: 1900 });
	expect(
		(await OrderService.addItems(id, D, U, { items: [line(1)] })).errors?.order,
	).toContain("closed");
	expect(
		(
			await OrderService.removeItems(id, D, U, {
				items: [{ order_item_id: a!.id, qty: 1 }],
			})
		).errors?.order,
	).toContain("closed");
	expect(await OrderService.openFor(D, table.id)).toBeNull();
	expect(await stock()).toBe(2);

	// another shop's order is not found
	expect(
		(await OrderService.addItems(id, S, U, { items: [line(1)] })).errors?.order,
	).toBe("Order not found");
});

const NO_DISCOUNT = { discount_type: null, discount_value: 0 } as const;

test("open orders move to another customer and join into one: lines, totals and history follow, stock stays, the emptied order is gone", async () => {
	// its own shop with 10% tax on top, one dish with 10 in stock, two tables
	const [row] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, tax_rate, tax_label) values ('Bistro', 'USD', 'UTC', 1000, 'VAT')`,
		sql`id`,
	);
	const B = row.id as number;
	const dish = await ProductRepository.create(
		B,
		{
			...base,
			name: "Pasta",
			price: 1000,
			purchase_price: 300,
			track_stock: true,
			stock: 10,
		} as any,
		U,
	);
	const tables = await Promise.all(
		["Table 1", "Table 2", "Table 3"].map((name) =>
			CustomerRepository.create(B, {
				name,
				phone: null,
				email: null,
				note: "",
			}),
		),
	);
	const [one, two, three] = tables as [any, any, any];
	const open = async (customerId: number, qty: number) =>
		(
			await OrderService.open(B, U, {
				items: [{ product_id: dish.id, variant_id: null, qty }],
				customer_id: customerId,
				payment_method: "",
				note: "",
				sales_staff_id: null,
			})
		).order!;
	const stock = () => StockRepository.level(sql, B, dish.id, null);
	const a = await open(one.id, 1); // 1000 + 100 tax
	const b = await open(two.id, 2); // 2000 + 200 tax
	expect(await stock()).toBe(7);

	// move: Table 1's bill becomes Table 3's; nothing else changes
	const moved = await OrderService.moveTo(a.id, B, three.id);
	expect(moved.order).toMatchObject({ customer_id: three.id, total: 1100 });
	expect(await OrderService.openFor(B, one.id)).toBeNull();
	expect((await OrderService.openFor(B, three.id))!.id).toBe(a.id);
	// a customer of another shop, an order of another shop
	expect((await OrderService.moveTo(a.id, B, 999999)).errors).toBeTruthy();
	expect((await OrderService.moveTo(a.id, S, three.id)).errors?.order).toBe(
		"Order not found",
	);

	// join: Table 3's bill goes into Table 2's — one order, both lines, tax worked out again, no stock moved
	const joined = await OrderService.join(a.id, b.id, B, U);
	expect(joined.order).toMatchObject({
		id: b.id,
		subtotal: 3000,
		tax: 300,
		total: 3300,
		payment_status: "unpaid",
	});
	expect(joined.order!.items.map((i) => i.qty).sort()).toEqual([1, 2]);
	expect(await stock()).toBe(7);
	expect(await OrderService.find(a.id, B)).toBeNull(); // the emptied order is gone
	expect(await OrderService.openFor(B, three.id)).toBeNull();
	const detail = (await OrderService.find(b.id, B))!;
	expect(detail.history).toHaveLength(1);
	expect(detail.history[0]).toMatchObject({ type: "items_added" });
	// the stock records follow the lines: voiding the joined order puts all 3 back
	expect(
		Number(
			(
				await sql`select count(*) as n from stock_movements where order_id = ${a.id}`
			)[0].n,
		),
	).toBe(0);

	// refused: with itself, an order with money on it as the one that goes, a closed order
	expect((await OrderService.join(b.id, b.id, B, U)).errors).toBeTruthy();
	const c = await open(one.id, 1);
	await OrderService.recordPayment(c.id, B, { amount: 100 });
	expect((await OrderService.join(c.id, b.id, B, U)).errors?.order).toMatch(
		/money or a discount/,
	);
	// …the other way round works: the paid-on order stays, with its money
	const other = await OrderService.join(b.id, c.id, B, U);
	expect(other.order).toMatchObject({
		id: c.id,
		total: 4400,
		paid: 100,
		payment_status: "partial",
	});
	// a discount on the open bill: the tax and the total follow; taken off again; never below what was paid
	const off = (discount_type: "percent" | "fixed" | null, discount_value = 0) =>
		OrderService.setDiscount(c.id, B, { discount_type, discount_value });
	expect((await off("percent", 10)).order).toMatchObject({
		discount: 400,
		discount_type: "percent",
		tax: 360,
		total: 3960,
		payment_status: "partial",
	});
	expect((await off("fixed", 5000)).errors?.order).toBeTruthy(); // total 0 < the 100 paid
	expect(
		(
			await OrderService.setDiscount(c.id, B, {
				...NO_DISCOUNT,
				coupon: "NOPE",
			})
		).errors?.coupon,
	).toBeTruthy();
	expect((await off(null)).order).toMatchObject({
		discount: 0,
		discount_type: null,
		total: 4400,
	});
	// paid off like at the till: the method is kept, cash over what is due is the change
	await sql`insert into payment_methods (shop_id, name, icon, color, tendered, position) values (${B}, 'Cash', 'Banknote', null, true, 0)`;
	expect(
		(
			await OrderService.recordPayment(c.id, B, {
				amount: 4300,
				payment_method: "Nope",
			})
		).errors?.payment_method,
	).toBeTruthy();
	expect(
		await OrderService.recordPayment(c.id, B, {
			amount: 4300,
			tendered: 5000,
			payment_method: "Cash",
		}),
	).toMatchObject({ paid: 5100, payment_status: "paid" });
	expect(await OrderService.find(c.id, B)).toMatchObject({
		change: 700,
		payment_method: "Cash",
	});
	await OrderService.void(c.id, B, U, { reason: "test" } as any);
	expect(await stock()).toBe(10);
	expect((await OrderService.join(c.id, c.id + 1, B, U)).errors).toBeTruthy();
});
