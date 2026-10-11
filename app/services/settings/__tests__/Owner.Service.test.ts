import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { OwnerService: _OwnerService } = await import("../Owner.Service");
const OwnerService = Container.get(_OwnerService);
const { ShopService: _ShopService } = await import("../Shop.Service");
const ShopService = Container.get(_ShopService);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);

await migrate(true);

const form = {
	currency: "EUR",
	logo: null,
	timezone: "UTC",
	tax_rate: 0,
	tax_label: "Tax",
	tax_included: false,
};
const run = Date.now().toString(36);

/**
 * A new owner with one staff member and one shop that sold something.
 * @param tag Makes the names unique in the shared test database.
 * @returns The owner, their shop and the staff member.
 */
async function account(tag: string) {
	const owner = await UserRepository.create(
		{
			name: `Owner ${tag}`,
			email: `${tag}-${run}@owners.io`,
			password: "",
			role: "admin",
		},
		"x",
		null,
	);
	const staff = await UserRepository.create(
		{
			name: `Staff ${tag}`,
			email: `${tag}-staff-${run}@owners.io`,
			password: "",
			role: "cashier",
		},
		"x",
		owner.id,
	);
	const shop = await ShopService.create(
		{ ...form, name: `Shop ${tag}` },
		owner.id,
	);
	await sql`insert into products (shop_id, name, price) values (${shop.id}, 'Tea', 500)`;
	await sql`insert into orders (shop_id, user_id, subtotal, total, paid, payment_method, status) values (${shop.id}, ${staff.id}, 1000, 1000, 1000, 'Cash', 'completed')`;
	await sql`insert into orders (shop_id, user_id, subtotal, total, paid, payment_method, status) values (${shop.id}, ${staff.id}, 700, 700, 700, 'Cash', 'voided')`;
	return { owner, staff, shop };
}

test("owners: the list has owners only, with their counts, and can be searched", async () => {
	const a = await account("alpha");
	const page = await OwnerService.list(`alpha-${run}`, 1, 20);
	expect(page.total).toBe(1);
	expect(page.data[0]).toMatchObject({
		id: a.owner.id,
		shops: 1,
		staff: 1,
		invited: false,
	});
	expect(page.data[0]!.last_order_at).not.toBeNull();
	// staff are never on the list
	expect((await OwnerService.list(`alpha-staff-${run}`, 1, 20)).total).toBe(0);
	expect(await OwnerService.show(a.staff.id)).toBeNull();
});

test("owners: one owner shows their shops with totals; voided orders never count", async () => {
	const b = await account("beta");
	const data = (await OwnerService.show(b.owner.id))!;
	expect(data.staff.map((u) => u.email)).toEqual([
		`beta-staff-${run}@owners.io`,
	]);
	expect(data.shops).toHaveLength(1);
	expect(data.shops[0]).toMatchObject({
		name: "Shop beta",
		products: 1,
		orders: 1,
		sales: 1000,
	});
});

test("owners: a shop page has totals and the report, and only for its own owner", async () => {
	const c = await account("gamma");
	const other = await account("delta");
	const data = (await OwnerService.shop(
		c.owner.id,
		c.shop.id,
		new URLSearchParams("preset=this_year"),
	))!;
	expect(data.totals).toMatchObject({
		products: 1,
		active_products: 1,
		orders: 1,
		sales: 1000,
		refunds: 0,
	});
	expect(data.report.query.preset).toBe("this_year");
	expect(data.report.summary.orders).toBe(1);
	expect(data.report.summary.sales).toBe(1000);
	// another owner's shop is not reachable through this owner
	expect(
		await OwnerService.shop(c.owner.id, other.shop.id, new URLSearchParams()),
	).toBeNull();
});

test("owners: a shop's product list, searchable, only through its own owner", async () => {
	const e = await account("epsilon");
	const other = await account("zeta");
	const page = (await OwnerService.shopProducts(
		e.owner.id,
		e.shop.id,
		"",
		1,
		20,
	))!;
	expect(page.products.data.map((p) => p.name)).toEqual(["Tea"]);
	expect(
		(await OwnerService.shopProducts(e.owner.id, e.shop.id, "coffee", 1, 20))!
			.products.total,
	).toBe(0);
	expect(
		await OwnerService.shopProducts(e.owner.id, other.shop.id, "", 1, 20),
	).toBeNull();
});
