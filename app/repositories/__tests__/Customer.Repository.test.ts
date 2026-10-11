import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { CustomerRepository: _CustomerRepository } = await import(
	"../Customer.Repository"
);
const CustomerRepository = Container.get(_CustomerRepository);
const { CustomerService: _CustomerService } = await import(
	"@services/sales/Customer.Service"
);
const CustomerService = Container.get(_CustomerService);
const { CustomerAddressRepository: _CustomerAddressRepository } = await import(
	"../CustomerAddress.Repository"
);
const CustomerAddressRepository = Container.get(_CustomerAddressRepository);

await migrate(true);
const [shop] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency) values ('C', 'USD')`,
	sql`id`,
);
const S = shop.id as number;

test("customers: search, unique phone per shop, stats, delete keeps orders", async () => {
	const ann = await CustomerRepository.create(S, {
		name: "Ann Lee",
		phone: "0911",
		email: null,
		note: "",
	});
	const bob = await CustomerRepository.create(S, {
		name: "Bob",
		phone: null,
		email: "bob@x.io",
		note: "vip",
	});
	// a real second shop: Postgres checks the foreign key
	const [other] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency) values ('C2', 'USD')`,
		sql`id`,
	);
	await CustomerRepository.create(Number(other.id), {
		name: "Other shop",
		phone: "0911",
		email: null,
		note: "",
	}); // same phone, other shop: fine
	expect(
		await CustomerService.phoneErrors(S, {
			name: "X",
			phone: "0911",
			email: null,
			note: "",
		}),
	).toEqual({ phone: "Phone already used by “Ann Lee”" });
	expect(
		await CustomerService.phoneErrors(
			S,
			{ name: "X", phone: "0911", email: null, note: "" },
			ann.id,
		),
	).toBeNull();
	expect((await CustomerRepository.search(S, "09")).map((c) => c.name)).toEqual(
		["Ann Lee"],
	);
	expect((await CustomerRepository.search(S, "b")).map((c) => c.name)).toEqual([
		"Bob",
	]); // name-prefix first; "Bob" only (Ann has no b)
	expect((await CustomerRepository.search(S, "")).length).toBe(2);

	const [u] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash) values ('U', ${`u${S}@x.io`}, 'x')`,
		sql`id`,
	);
	await sql`insert into orders (shop_id, user_id, customer_id, subtotal, total, paid, payment_method, status, refunded) values (${S}, ${u.id}, ${ann.id}, 500, 500, 500, 'Cash', 'completed', 100)`;
	await sql`insert into orders (shop_id, user_id, customer_id, subtotal, total, paid, payment_method, status) values (${S}, ${u.id}, ${ann.id}, 900, 900, 900, 'Cash', 'voided')`;
	const a = (await CustomerRepository.find(ann.id, S))!;
	expect([a.orders_count, a.total_spent]).toEqual([1, 400]);
	const page = await CustomerRepository.pageForShop(S, "lee", 1, 10);
	expect(page.total).toBe(1);
	expect(page.data[0]!.orders_count).toBe(1);
	expect((await CustomerRepository.pageForShop(S, "bob@", 1, 10)).total).toBe(
		1,
	);

	await CustomerRepository.delete(ann.id, S);
	expect(await CustomerRepository.find(ann.id, S)).toBeNull();
	expect(
		Number(
			(
				await sql`select count(*) as n from orders where shop_id = ${S} and customer_id is null`
			)[0].n,
		),
	).toBe(2);
	expect(
		await CustomerRepository.update(bob.id, S, {
			name: "Bobby",
			phone: "0922",
			email: null,
			note: "",
		}),
	).toMatchObject({ name: "Bobby", phone: "0922" });
});

test("staff add, change and remove a customer's addresses; another shop's customer gets none", async () => {
	const who = await CustomerRepository.create(S, {
		name: "Two Homes",
		phone: null,
		email: null,
		note: "",
	});
	const home = {
		label: "Home",
		phone: "",
		address_1: "1 Main St",
		address_2: "",
		city: "Berlin",
		state: "",
		country: "Germany",
		postal_code: "10115",
		tax_id: "DE999999999", // goes with the address, for invoices
	};
	expect(await CustomerService.addAddress(who.id, S, home)).toEqual({});
	await CustomerService.addAddress(who.id, S, {
		...home,
		label: "Office",
		address_1: "9 Work Rd",
	});
	const [first, second] = await CustomerService.addresses(who.id, S);
	expect([first!.label, second!.label]).toEqual(["Home", "Office"]); // several, oldest first
	expect(
		await CustomerService.updateAddress(who.id, S, first!.id, {
			...home,
			city: "Hamburg",
		}),
	).toMatchObject({ city: "Hamburg", tax_id: "DE999999999" });
	// the store account changes an address without a tax ID: it is kept
	const { tax_id: _none, ...fromStore } = home;
	expect(
		await CustomerAddressRepository.update(first!.id, who.id, fromStore),
	).toMatchObject({ city: "Berlin", tax_id: "DE999999999" });
	await CustomerService.removeAddress(who.id, S, second!.id);
	expect(await CustomerService.addresses(who.id, S)).toHaveLength(1);
	// not this shop's customer: nothing is added
	expect(await CustomerService.addAddress(who.id, S + 999, home)).toBeNull();
});

test("customers: the email is stored lower-case and found in any case", async () => {
	const made = await CustomerRepository.create(S, {
		name: "Cara",
		phone: null,
		email: " Cara@X.IO ",
		note: "",
	});
	expect(made.email).toBe("cara@x.io");
	const found = await CustomerRepository.byEmail(S, "CARA@x.io");
	expect(found?.id).toBe(made.id);
	const edited = await CustomerRepository.update(made.id, S, {
		name: "Cara",
		phone: null,
		email: "New@X.io",
		note: "",
	});
	expect(edited?.email).toBe("new@x.io");
});
