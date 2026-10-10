import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { ShopService: _ShopService } = await import("../Shop.Service");
const ShopService = Container.get(_ShopService);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { PaymentMethodRepository: _PaymentMethodRepository } = await import(
	"@repositories/PaymentMethod.Repository"
);
const PaymentMethodRepository = Container.get(_PaymentMethodRepository);
const { ProductRepository: _ProductRepository } = await import(
	"@repositories/Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);
const { ShopInput } = await import("@validators/Shop.Validator");
const { StoreDeliveryInput } = await import("@validators/Store.Validator");

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);

// this file's own owner, so other files' shops never count here
const OWNER = 9101;

test("shops: create seeds payment methods + timezone; delete rules", async () => {
	const a = await ShopService.create(
		{
			name: "A",
			currency: "THB",
			logo: null,
			timezone: "Asia/Bangkok",
			tax_rate: 700,
			tax_label: "VAT",
			tax_included: true,
		},
		OWNER,
	);
	const b = await ShopService.create(
		{
			name: "B",
			currency: "USD",
			logo: null,
			timezone: "UTC",
			tax_rate: 0,
			tax_label: "Tax",
			tax_included: false,
		},
		OWNER,
	);
	expect([
		a.tax_rate,
		a.tax_label,
		a.tax_included,
		b.tax_rate,
		b.tax_included,
	]).toEqual([700, "VAT", true, 0, false]); // sqlite's 0/1 comes back as a boolean
	expect(a.timezone).toBe("Asia/Bangkok");
	expect([a.support_email, b.support_email]).toEqual([null, null]); // set on /online-store › Banner & contact, not here
	// delivery starts as one zone (everywhere, free) and is set apart, on /online-store › Delivery
	expect([a.country, a.pickup, a.guided_address, a.delivery_zones]).toEqual([
		null,
		false,
		true,
		[
			{
				name: "Everywhere",
				countries: [],
				states: [],
				cities: [],
				fee: 0,
				free_delivery_min: null,
			},
		],
	]);
	const zones = [
		{
			name: "Bangkok",
			countries: ["Thailand"],
			states: ["Bangkok"],
			cities: [],
			fee: 100,
			free_delivery_min: 5000,
		},
		{
			name: "Domestic",
			countries: ["Thailand"],
			states: [],
			cities: [],
			fee: 300,
			free_delivery_min: 5000,
		},
		{
			name: "Rest of world",
			countries: [],
			states: [],
			cities: [],
			fee: 1500,
			free_delivery_min: null,
		},
	];
	await ShopRepository.updateDelivery(a.id, {
		country: "Thailand",
		pickup: true,
		guided_address: false,
		delivery_zones: zones,
	});
	const withDelivery = (await ShopRepository.find(a.id))!;
	expect([
		withDelivery.country,
		withDelivery.pickup,
		withDelivery.guided_address,
		withDelivery.delivery_zones,
	]).toEqual(["Thailand", true, false, zones]); // JSON column → array
	expect(await PaymentMethodRepository.count(a.id)).toBe(3);
	const updated = await ShopService.update(a.id, {
		name: "A2",
		currency: "EUR",
		logo: null,
		timezone: "Europe/Paris",
		tax_rate: 2000,
		tax_label: "TVA",
		tax_included: false,
	});
	expect([
		updated?.tax_rate,
		updated?.tax_label,
		updated?.tax_included,
	]).toEqual([2000, "TVA", false]);
	expect(updated?.timezone).toBe("Europe/Paris");
	expect([
		updated?.country,
		updated?.delivery_zones.length,
		updated?.pickup,
	]).toEqual(["Thailand", 3, true]); // the general settings leave delivery alone
	await ProductRepository.create(a.id, {
		name: "P",
		description: "",
		price: 1,
		purchase_price: null,
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
	expect(await ShopService.remove(a.id, OWNER)).toBe(
		"Delete or move this shop's products first",
	);
	// deleting a shop takes its rows with it — Postgres enforces those foreign keys, so leftovers mean a 500 there
	await sql`insert into categories (shop_id, name) values (${b.id}, 'Cat')`;
	expect(await ShopService.remove(b.id, OWNER)).toBeNull();
	expect(await ShopRepository.find(b.id)).toBeNull();
	expect(await PaymentMethodRepository.count(b.id)).toBe(0);
	expect(
		await sql`select count(*) as n from categories where shop_id = ${b.id}`.then(
			(r) => Number(r[0].n),
		),
	).toBe(0);
	// the owner's very last shop can't go
	const all = await ShopRepository.all(OWNER);
	for (const s of all.slice(1))
		await sql`delete from products where shop_id = ${s.id}`.then(() =>
			ShopService.remove(s.id, OWNER),
		);
	expect(await ShopService.remove(all[0]!.id, OWNER)).toBe(
		"You need at least one shop",
	);
});

test("shops: each owner sees only their own shops", async () => {
	const form = {
		name: "Mine",
		currency: "USD",
		logo: null,
		timezone: "UTC",
		tax_rate: 0,
		tax_label: "Tax",
		tax_included: false,
	};
	const mine = await ShopService.create(form, 9102);
	const theirs = await ShopService.create({ ...form, name: "Theirs" }, 9103);
	expect((await ShopService.list(9102)).map((s) => s.name)).toEqual(["Mine"]);
	expect(mine.owner_id).toBe(9102);
	expect(await ShopRepository.findOwned(theirs.id, 9102)).toBeNull();
	expect((await ShopRepository.findOwned(mine.id, 9102))?.id).toBe(mine.id);
	expect((await ShopRepository.first(9103))?.id).toBe(theirs.id);
	// one shop each: neither owner may delete theirs
	expect(await ShopService.remove(theirs.id, 9103)).toBe(
		"You need at least one shop",
	);
});

test('shop + delivery validators: the country must be on the list, blank means "not set", zones don\'t overlap, fees are non-negative cents', () => {
	const form = { name: "V", currency: "usd", timezone: "UTC" };
	expect(ShopInput.safeParse(form).data).toEqual({
		...form,
		currency: "USD",
		logo: null,
		tax_rate: 0,
		tax_label: "Tax",
		tax_included: false,
	}); // defaults; no delivery / support email here
	expect(
		StoreDeliveryInput.safeParse({ country: "Narnia" }).error?.issues[0]
			?.message,
	).toMatch(/choose_country/);
	expect(StoreDeliveryInput.safeParse({ country: "" }).data).toEqual({
		country: null,
		pickup: false,
		guided_address: true,
		delivery_zones: [],
	});
	expect(StoreDeliveryInput.safeParse({}).data).toEqual({
		country: null,
		pickup: false,
		guided_address: true,
		delivery_zones: [],
	}); // defaults
	const zones = (...zs: object[]) =>
		StoreDeliveryInput.safeParse({ delivery_zones: zs });
	expect(
		zones({ fee: 250, free_delivery_min: "" }).data?.delivery_zones,
	).toEqual([
		{
			name: "",
			countries: [],
			states: [],
			cities: [],
			fee: 250,
			free_delivery_min: null,
		},
	]); // a rest-of-world zone
	expect(zones({ fee: -1 }).success).toBe(false);
	expect(
		zones({ countries: ["Narnia"], fee: 1 }).error?.issues[0]?.message,
	).toMatch(/choose_countries/);
	expect(
		zones({ countries: ["Thailand"], cities: ["  "], fee: 100 }).error
			?.issues[0]?.message,
	).toMatch(/enter_city_name/);
	// a place belongs to one zone
	expect(
		zones(
			{ countries: ["Thailand"], cities: ["Bangkok"], fee: 100 },
			{ countries: ["Thailand"], cities: ["Pattaya", "bangkok"], fee: 200 },
		).error?.issues[0]?.message,
	).toBe("bangkok is already in another zone");
	expect(
		zones(
			{ countries: ["Thailand"], fee: 100 },
			{ countries: ["Japan", "Thailand"], fee: 200 },
		).error?.issues[0]?.message,
	).toBe("Thailand is already in another zone");
	expect(
		zones(
			{ countries: ["Thailand"], states: ["Bangkok"], fee: 100 },
			{ countries: ["Thailand"], states: ["bangkok", "Phuket"], fee: 200 },
		).error?.issues[0]?.message,
	).toBe("bangkok is already in another zone");
	expect(
		zones(
			{ countries: ["Thailand"], states: ["Bangkok"], fee: 100 },
			{
				countries: ["Thailand"],
				states: ["Bangkok"],
				cities: ["Bang Rak"],
				fee: 50,
			},
			{ countries: ["Thailand"], fee: 200 },
		).success,
	).toBe(true); // a city inside a state inside the country
	expect(zones({ fee: 100 }, { fee: 200 }).error?.issues[0]?.message).toMatch(
		/Only one zone/,
	);
	expect(
		zones(
			{ countries: ["Thailand"], cities: ["Bangkok"], fee: 100 },
			{ countries: ["Thailand"], fee: 200 },
			{ fee: 300 },
		).success,
	).toBe(true); // a city zone inside a country zone inside the rest of the world
	expect(
		ShopInput.safeParse({ ...form, tax_rate: 10001 }).error?.issues[0]?.message,
	).toMatch(/tax_rate_max/);
	expect(
		ShopInput.safeParse({
			...form,
			tax_rate: 750,
			tax_label: "  GST ",
			tax_included: true,
		}).data,
	).toMatchObject({ tax_rate: 750, tax_label: "GST", tax_included: true });
});

test("shops: deleting a shop names every table that holds its rows", async () => {
	// A new table with a `shop_id` must be added to `ShopRepository.#drop`,
	// or a deleted shop leaves buyer data behind (and Postgres refuses the delete).
	const source = await Bun.file("app/repositories/Shop.Repository.ts").text();
	const tables: { name: string }[] =
		await sql`select name from sqlite_master where type = 'table'`;
	const missing: string[] = [];
	for (const { name } of tables) {
		const columns: { name: string }[] = await sql.unsafe(
			`pragma table_info(${name})`,
		);
		// `sessions` only forgets the shop; a shop with products can not be deleted
		if (!columns.some((c) => c.name === "shop_id")) continue;
		if (["sessions", "products"].includes(name)) continue;
		if (!source.includes(`delete from ${name} `)) missing.push(name);
	}
	expect(missing).toEqual([]);
});
