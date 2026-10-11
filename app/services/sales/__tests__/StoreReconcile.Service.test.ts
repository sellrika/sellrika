import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
// The module cache is shared across test files, so never `sql.close()` here.
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
process.env.APP_KEY = process.env.APP_KEY || "store-service-test-key";
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { StoreService: _StoreService } = await import("../Store.Service");
const StoreService = Container.get(_StoreService);
const { StoreReconcileService: _Reconcile } = await import(
	"../StoreReconcile.Service"
);
const Reconcile = Container.get(_Reconcile);
const { useGateway, pay, resetPay } = await import("./fakeGateway"); // the gateway is an extension: this shop uploads a fake one
const { ProductRepository: _ProductRepository } = await import(
	"@repositories/Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { Schedule } = await import("@xcore/schedule/Schedule");

await migrate(true);

const [s] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Rec Store', 'USD', 'UTC', 'rec-store', ${true})`,
	sql`id`,
);
const S = s.id as number;
const shop = () => ShopRepository.find(S).then((x) => x!);
const buyer = {
	name: "Buyer",
	phone: "555-0199",
	email: "rec@x.io",
	address_1: "1 Main St",
	address_2: "",
	city: "Springfield",
	state: "IL",
	country: "United States",
	postal_code: "62701",
};
const settings = await StoreService.settings(S);
await StoreService.updateSettings(S, {
	enabled: true,
	slug: settings.slug,
	domain: null,
	google_site_verification: null,
	template: settings.template as any,
	credentials: {},
});
await useGateway(S);
const mug = await ProductRepository.create(S, {
	name: "Rec Mug",
	description: "",
	price: 1000,
	purchase_price: 400,
	images: [],
	sku: null,
	barcode: null,
	unit: null,
	track_stock: false,
	stock: 0,
	low_stock_at: 0,
	featured: false,
	active: true,
	original_price: null,
	kind: "item",
	bundle_items: [],
	category_ids: [],
	variants: [],
});
// every test file shares this DB and process: carts other files left half-paid must not be swept up here
await sql`update store_carts set next_check_at = '2099-01-01 00:00:00' where shop_id <> ${S} and order_id is null`;

/** Start a checkout the way the storefront does, and hand back the gateway id the cart is keyed by. */
async function startCheckout(sessionId: string) {
	resetPay();
	pay().id = sessionId;
	expect(
		(
			await StoreService.checkout(
				await shop(),
				{
					customer: buyer,
					items: [{ product_id: mug.id, variant_id: null, qty: 1 }],
				},
				"http://x/store/rec-store",
			)
		).url,
	).toBe("https://gw.test/pay");
	return (
		await sql`select * from store_carts where stripe_session_id = ${sessionId}`
	)[0];
}
const { dbDate, sqlStamp } = await import("@helpers/time");
const cartRow = async (id: number) => {
	const [row] = await sql`select * from store_carts where id = ${id}`;
	// a string on SQLite, a Date on a database server: always the same text
	if (row.next_check_at)
		row.next_check_at = sqlStamp(dbDate(row.next_check_at));
	return row;
};
const orders = async () =>
	Number(
		(await sql`select count(*) as n from orders where shop_id = ${S}`)[0].n,
	);

test("reconcile: a paid checkout whose buyer never came back becomes an order — once", async () => {
	const cart = await startCheckout("cs_rec_paid");
	pay().status = { paid: true, buyer: null };
	expect(await Reconcile.run()).toEqual({ checked: 1, fulfilled: 1 });
	const row = await cartRow(cart.id);
	expect(row.order_id).toBeGreaterThan(0);
	expect(await orders()).toBe(1);
	// done: the next sweep has nothing to look at
	expect(await Reconcile.run()).toEqual({ checked: 0, fulfilled: 0 });
	expect(await orders()).toBe(1);
});

test("reconcile: still pending → asked again with a doubling wait (2, 4, 8… min, capped at an hour)", async () => {
	const cart = await startCheckout("cs_rec_pending");
	pay().status = { paid: false, buyer: null };
	const t0 = new Date("2026-01-01T00:00:00Z");
	expect(await Reconcile.run(t0)).toEqual({ checked: 1, fulfilled: 0 });
	expect([
		(await cartRow(cart.id)).checks,
		(await cartRow(cart.id)).next_check_at,
	]).toEqual([1, "2026-01-01 00:02:00"]);
	// not due yet → skipped; due → checked again, and the wait doubles
	expect((await Reconcile.run(new Date("2026-01-01T00:01:00Z"))).checked).toBe(
		0,
	);
	expect((await Reconcile.run(new Date("2026-01-01T00:02:00Z"))).checked).toBe(
		1,
	);
	expect([
		(await cartRow(cart.id)).checks,
		(await cartRow(cart.id)).next_check_at,
	]).toEqual([2, "2026-01-01 00:06:00"]);
	await sql`update store_carts set checks = 9, next_check_at = null where id = ${cart.id}`;
	await Reconcile.run(t0);
	expect((await cartRow(cart.id)).next_check_at).toBe("2026-01-01 01:00:00"); // 2^10 min would be 17 h — capped
	// a gateway that can't be reached counts as pending, never crashes the sweep
	await sql`update store_carts set next_check_at = null where id = ${cart.id}`;
	pay().throws = "connection reset";
	expect(await Reconcile.run(t0)).toEqual({ checked: 1, fulfilled: 0 });
	expect((await cartRow(cart.id)).checks).toBe(11);
	expect(await orders()).toBe(1); // still only the paid one
});

test("reconcile: a failed payment is left alone (no order, no more checks) and a paid one lands even from the back-off queue", async () => {
	const dead = await startCheckout("cs_rec_dead");
	pay().status = { paid: false, buyer: null, failed: true, reason: "expired" };
	expect(await Reconcile.run()).toEqual({ checked: 2, fulfilled: 0 }); // this one + the pending one from above
	expect([
		(await cartRow(dead.id)).checks,
		(await cartRow(dead.id)).order_id,
	]).toEqual([1, null]); // no order, and parked past the sweep's window:
	// the provider is not asked about it again (the run below checks 1 cart, not 2)
	// the pending cart from the previous test finally gets paid
	await sql`update store_carts set next_check_at = null where stripe_session_id = 'cs_rec_pending'`;
	pay().status = { paid: true, buyer: null };
	expect(await Reconcile.run()).toEqual({ checked: 1, fulfilled: 1 });
	expect(await orders()).toBe(2);
});

test("schedule.cron: runs once at boot (catch-up), a failing run is logged not thrown, and the job is a real Bun.cron handle", async () => {
	let runs = 0;
	const job = Schedule.cron("test-job", "0 0 1 1 *", async () => {
		runs++;
		throw new Error("boot run fails");
	});
	await new Promise((r) => setTimeout(r, 10)); // the boot run is fire-and-forget
	expect(runs).toBe(1);
	expect(job.cron).toBe("0 0 1 1 *");
	job.stop();
});
