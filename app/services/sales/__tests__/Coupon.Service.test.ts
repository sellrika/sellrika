import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { CouponService: _CouponService } = await import("../Coupon.Service");
const CouponService = Container.get(_CouponService);
const { CouponRepository: _CouponRepository } = await import(
	"@repositories/Coupon.Repository"
);
const CouponRepository = Container.get(_CouponRepository);
const { CouponInput } = await import("@validators/Coupon.Validator");
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { ymd } = await import("@helpers/time");

await migrate(true);

// fixtures: a shop, two products (one in a category), and a cart of both
const [s] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, slug) values ('Coupon Shop', 'USD', 'UTC', 'coupon-shop')`,
	sql`id`,
);
const S = s.id as number;
const shop = (await ShopRepository.find(S))!;
const [cat] = await Db.insert(
	sql,
	"categories",
	sql`insert into categories (shop_id, name, position) values (${S}, 'Drinks', 0)`,
	sql`id`,
);
const [mug] = await Db.insert(
	sql,
	"products",
	sql`insert into products (shop_id, name, slug, price) values (${S}, 'Mug', 'mug', 1000)`,
	sql`id`,
);
const [tea] = await Db.insert(
	sql,
	"products",
	sql`insert into products (shop_id, name, slug, price) values (${S}, 'Tea', 'tea', 500)`,
	sql`id`,
);
await sql`insert into product_categories (product_id, category_id) values (${tea.id}, ${cat.id})`;
const cart = {
	lines: [
		{ product_id: mug.id, price: 1000, qty: 2 },
		{ product_id: tea.id, price: 500, qty: 1 },
	],
	delivery_fee: 300,
	email: "ann@example.com",
	verified: true,
}; // $25 of goods + $3 delivery

/** The admin form's payload with sensible defaults. */
const input = (over: Record<string, unknown>) => {
	const r = CouponInput.safeParse({
		code: "XYZ",
		type: "percent",
		value: 10,
		...over,
	});
	if (!r.success) throw new Error(JSON.stringify(r.error.issues));
	return r.data;
};
const make = async (over: Record<string, unknown>) =>
	(await CouponService.create(S, input(over))).coupon!;
const apply = (code: string, over: Partial<typeof cart> = {}) =>
	CouponService.resolve(shop, code, { ...cart, ...over });
const error = async (code: string, over: Partial<typeof cart> = {}) =>
	((await apply(code, over)) as { error?: string }).error;

test("couponDiscount: percent is rounded and capped, fixed never exceeds the goods, free delivery waives the fee", () => {
	expect(
		_CouponService.couponDiscount(
			{ type: "percent", value: 15, max_discount: null },
			1005,
			300,
		),
	).toEqual({ discount: 151, delivery_fee: 300 }); // 150.75 → 151
	expect(
		_CouponService.couponDiscount(
			{ type: "percent", value: 50, max_discount: 400 },
			2500,
			300,
		),
	).toEqual({ discount: 400, delivery_fee: 300 });
	expect(
		_CouponService.couponDiscount(
			{ type: "fixed", value: 9999, max_discount: null },
			2500,
			300,
		),
	).toEqual({ discount: 2500, delivery_fee: 300 });
	expect(
		_CouponService.couponDiscount(
			{ type: "free_delivery", value: 0, max_discount: null },
			2500,
			300,
		),
	).toEqual({ discount: 0, delivery_fee: 0 });
});

test("validator: codes are upper-cased, a percent must be 1..100, an amount > 0, dates in order, free delivery clears the value", () => {
	expect(input({ code: " save10 " }).code).toBe("SAVE10");
	expect(
		CouponInput.safeParse({ code: "bad code", type: "percent", value: 10 })
			.success,
	).toBe(false);
	expect(
		CouponInput.safeParse({ code: "XYZ", type: "percent", value: 0 }).success,
	).toBe(false);
	expect(
		CouponInput.safeParse({ code: "XYZ", type: "percent", value: 101 }).success,
	).toBe(false);
	expect(
		CouponInput.safeParse({ code: "XYZ", type: "fixed", value: 0 }).success,
	).toBe(false);
	expect(
		CouponInput.safeParse({
			code: "XYZ",
			type: "percent",
			value: 5,
			starts_at: "2026-09-02",
			ends_at: "2026-09-01",
		}).success,
	).toBe(false);
	expect(
		CouponInput.safeParse({
			code: "XYZ",
			type: "percent",
			value: 5,
			emails: ["not-an-email"],
		}).success,
	).toBe(false);
	expect(
		input({ type: "free_delivery", value: 55, max_discount: 100 }),
	).toMatchObject({ value: 0, max_discount: null });
	expect(
		input({ type: "fixed", value: 500, max_discount: 100 }).max_discount,
	).toBeNull(); // only a percentage has a cap
	expect(
		input({ emails: ["Ann@Example.com", "ann@example.com"] }).emails,
	).toEqual(["ann@example.com"]);
});

test("create/update: the code is unique per shop; another shop may reuse it", async () => {
	const a = await make({ code: "TWICE" });
	expect(
		(await CouponService.create(S, input({ code: "twice" }))).errors?.code,
	).toMatch(/already exists/);
	const b = await make({ code: "OTHER" });
	expect(
		(await CouponService.update(b.id, S, input({ code: "TWICE" }))).errors
			?.code,
	).toMatch(/already exists/);
	expect(
		(
			await CouponService.update(
				a.id,
				S,
				input({ code: "TWICE", description: "same code, new text" }),
			)
		).coupon?.description,
	).toBe("same code, new text");
	const [other] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug) values ('Other', 'USD', 'coupon-other')`,
		sql`id`,
	);
	expect(
		(await CouponService.create(other.id, input({ code: "TWICE" }))).errors,
	).toBeUndefined();
	expect(await CouponRepository.findByCode(other.id, "TWICE")).not.toBeNull();
});

test("resolve: unknown, switched-off, not-yet-started and expired codes all get the same answer", async () => {
	expect(await error("NOPE")).toMatch(/isn't valid/);
	await make({ code: "OFF", active: false });
	expect(await error("off")).toMatch(/isn't valid/);
	const today = ymd(new Date(), "UTC");
	await make({ code: "SOON", starts_at: "2999-01-01" });
	expect(await error("SOON")).toMatch(/isn't valid/);
	await make({ code: "GONE", ends_at: "2000-01-01" });
	expect(await error("GONE")).toMatch(/isn't valid/);
	await make({ code: "TODAY", starts_at: today, ends_at: today }); // both ends inclusive
	expect(await apply("today")).toMatchObject({
		discount: 250,
		delivery_fee: 300,
		saved: 250,
	});
});

test("resolve: customer-only codes match the checkout email, case-insensitively", async () => {
	await make({ code: "VIP", emails: ["Ann@Example.com"] });
	expect(await error("VIP", { email: "" })).toMatch(/isn't valid/);
	// another email gets the same answer as a code that doesn't exist
	expect(await error("VIP", { email: "bob@example.com" })).toMatch(
		/isn't valid/,
	);
	// the right email only counts when it is proven (a signed-in customer, or the cashier)
	expect(
		await error("VIP", { email: "ann@example.com", verified: false }),
	).toMatch(/Sign in/);
	// a typed email that is not on the list gets the same answer: the list stays secret
	for (const email of ["bob@example.com", ""])
		expect(await error("VIP", { email, verified: false })).toMatch(/Sign in/);
	expect(await apply("VIP", { email: " ANN@example.com " })).toMatchObject({
		discount: 250,
	});
});

test("resolve: total and per-customer limits count redemptions; a void gives the use back", async () => {
	const c = await make({
		code: "LIMITED",
		usage_limit: 2,
		per_customer_limit: 1,
	});
	expect(await apply("LIMITED")).toMatchObject({ discount: 250 });
	await CouponService.redeem(
		{ id: c.id, saved: 250 },
		S,
		9001,
		"Ann@example.com",
	);
	expect(await error("LIMITED")).toMatch(/isn't valid/);
	expect(await error("LIMITED", { email: "" })).toMatch(/Enter your email/);
	expect(await apply("LIMITED", { email: "bob@example.com" })).toMatchObject({
		discount: 250,
	});
	await CouponService.redeem(
		{ id: c.id, saved: 250 },
		S,
		9002,
		"bob@example.com",
	);
	expect(await error("LIMITED", { email: "cat@example.com" })).toMatch(
		/isn't valid/,
	);
	await CouponRepository.release(9002);
	expect(await apply("LIMITED", { email: "cat@example.com" })).toMatchObject({
		discount: 250,
	});
	const list = await CouponService.page(S, "limited", "", 1, 10);
	expect(list.data[0]).toMatchObject({
		code: "LIMITED",
		used_count: 1,
		saved_total: 250,
	});
});

test("resolve: minimum order, product / category scope, and the cap", async () => {
	await make({ code: "BIG", min_subtotal: 5000 });
	expect(await error("BIG")).toMatch(/at least \$50/);
	await make({ code: "TEAONLY", value: 20, category_ids: [cat.id] });
	expect(await apply("TEAONLY")).toMatchObject({ discount: 100 }); // 20% of the $5 tea only
	await make({
		code: "MUGONLY",
		type: "fixed",
		value: 5000,
		product_ids: [mug.id],
	});
	expect(await apply("MUGONLY")).toMatchObject({ discount: 2000 }); // capped at the $20 of mugs
	expect(
		await error("MUGONLY", {
			lines: [{ product_id: tea.id, price: 500, qty: 1 }],
		}),
	).toMatch(/doesn't apply/);
	await make({ code: "CAPPED", value: 50, max_discount: 700 });
	expect(await apply("CAPPED")).toMatchObject({ discount: 700 });
});

test("resolve: free delivery waives the fee (and is pointless when there is none)", async () => {
	await make({ code: "SHIPFREE", type: "free_delivery" });
	expect(await apply("SHIPFREE")).toMatchObject({
		discount: 0,
		delivery_fee: 0,
		saved: 300,
	});
	expect(await error("SHIPFREE", { delivery_fee: 0 })).toMatch(/already free/);
});

test("history: every order that used the code, newest first, with the order's code and customer; the header carries the totals", async () => {
	const c = await make({ code: "HIST", usage_limit: 10 });
	const [cust] = await Db.insert(
		sql,
		"customers",
		sql`insert into customers (shop_id, name, email) values (${S}, 'Ann', 'ann@example.com')`,
		sql`id`,
	);
	const [o1] = await Db.insert(
		sql,
		"orders",
		sql`insert into orders (reference, shop_id, user_id, customer_id, subtotal, total, paid, payment_method) values ('HIST-0001-AAAA-BBBB', ${S}, 1, ${cust.id}, 2500, 2250, 2250, 'Cash')`,
		sql`id`,
	);
	const [o2] = await Db.insert(
		sql,
		"orders",
		sql`insert into orders (reference, shop_id, user_id, subtotal, total, paid, payment_method) values ('HIST-0002-AAAA-BBBB', ${S}, 1, 2500, 2250, 2250, 'Cash')`,
		sql`id`,
	);
	await CouponService.redeem(
		{ id: c.id, saved: 250 },
		S,
		o1.id,
		"ann@example.com",
	);
	await CouponService.redeem(
		{ id: c.id, saved: 300 },
		S,
		o2.id,
		"bob@example.com",
	);
	expect(await CouponService.find(c.id, S)).toMatchObject({
		code: "HIST",
		used_count: 2,
		saved_total: 550,
	});
	const h = await CouponService.history(c.id, S, 1, 10);
	expect(h.total).toBe(2);
	expect(
		h.data.map((r) => [
			r.reference,
			r.email,
			r.amount,
			r.order_total,
			r.customer_name,
		]),
	).toEqual([
		["HIST-0002-AAAA-BBBB", "bob@example.com", 300, 2250, null],
		["HIST-0001-AAAA-BBBB", "ann@example.com", 250, 2250, "Ann"],
	]);
	expect((await CouponService.history(c.id, S, 1, 1)).data).toHaveLength(1); // paged
	const [other] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug) values ('Other2', 'USD', 'coupon-other2')`,
		sql`id`,
	);
	expect(await CouponService.find(c.id, other.id)).toBeNull(); // shop-scoped
});

test("summary: uses, discount given and order totals over every code of the shop, and only that shop", async () => {
	const [own] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, slug) values ('Sum', 'USD', 'coupon-sum')`,
		sql`id`,
	);
	expect(await CouponService.summary(own.id)).toEqual({
		uses: 0,
		saved: 0,
		sales: 0,
	});
	const a = (await CouponService.create(own.id, input({ code: "SUMA" })))
		.coupon!;
	const b = (await CouponService.create(own.id, input({ code: "SUMB" })))
		.coupon!;
	const [o] = await Db.insert(
		sql,
		"orders",
		sql`insert into orders (reference, shop_id, user_id, subtotal, total, paid, payment_method) values ('SUMM-0001-AAAA-BBBB', ${own.id}, 1, 2000, 1800, 1800, 'Cash')`,
		sql`id`,
	);
	await CouponService.redeem(
		{ id: a.id, saved: 200 },
		own.id,
		o.id,
		"a@example.com",
	);
	await CouponService.redeem(
		{ id: b.id, saved: 100 },
		own.id,
		99999,
		"b@example.com",
	); // order gone = no sales
	await CouponService.redeem(
		{ id: a.id, saved: 999 },
		S,
		o.id,
		"x@example.com",
	); // another shop
	expect(await CouponService.summary(own.id)).toEqual({
		uses: 2,
		saved: 300,
		sales: 1800,
	});
	await CouponService.redeem(
		{ id: b.id, saved: 100 },
		own.id,
		99998,
		"c@example.com",
	);
	const codes = async (sort: "" | "used") =>
		(await CouponService.page(own.id, "", sort, 1, 10)).data.map((c) => c.code);
	expect(await codes("")).toEqual(["SUMB", "SUMA"]); // newest first
	await CouponService.redeem(
		{ id: a.id, saved: 1 },
		own.id,
		99997,
		"d@example.com",
	);
	await CouponService.redeem(
		{ id: a.id, saved: 1 },
		own.id,
		99996,
		"e@example.com",
	);
	expect(await codes("used")).toEqual(["SUMA", "SUMB"]); // 3 uses before 2
});

test("remove: the coupon and its usage rows go; a code can then be created again", async () => {
	const c = await make({ code: "TEMP" });
	await CouponService.redeem({ id: c.id, saved: 1 }, S, 9003, "x@example.com");
	await CouponService.remove(c.id, S);
	expect(await CouponRepository.findByCode(S, "TEMP")).toBeNull();
	expect(
		Number(
			(
				await sql`select count(*) as n from coupon_redemptions where coupon_id = ${c.id}`
			)[0].n,
		),
	).toBe(0);
	expect(
		(await CouponService.create(S, input({ code: "TEMP" }))).errors,
	).toBeUndefined();
});
