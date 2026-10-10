import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { ProductCsvService: _ProductCsvService } = await import(
	"../ProductCsv.Service"
);
const { CSV_COLUMNS } = await import("@constants/Product.Constant");
const ProductCsvService = Container.get(_ProductCsvService);
const { ProductService: _ProductService } = await import("../Product.Service");
const ProductService = Container.get(_ProductService);
const { CategoryRepository: _CategoryRepository } = await import(
	"@repositories/Category.Repository"
);
const CategoryRepository = Container.get(_CategoryRepository);
const { parseCsv } = await import("@helpers/csv");

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);
const [a] =
	await sql`insert into shops (name, currency) values ('CsvA', 'USD') returning id`;
const [b] =
	await sql`insert into shops (name, currency) values ('CsvB', 'USD') returning id`;
const A = a.id as number,
	B = b.id as number;
const base = {
	description: "",
	purchase_price: null,
	images: [],
	sku: null,
	unit: null,
	category_ids: [],
	track_stock: false,
	stock: 0,
	low_stock_at: 0,
	featured: false,
	active: true,
	original_price: null,
	kind: "item" as const,
	bundle_items: [],
};

test("export: v1 header, decimal prices, string barcodes, variant rows share a group", async () => {
	const drinks = await CategoryRepository.create(A, {
		name: "Drinks",
		color: null,
		image: null,
	});
	await ProductService.create(
		A,
		{
			...base,
			name: "Cola",
			description: "Fizzy",
			price: 150,
			purchase_price: 90,
			sku: "COL-1",
			barcode: "00123",
			unit: "pcs",
			track_stock: true,
			stock: 7,
			low_stock_at: 2,
			category_ids: [drinks.id],
			variants: [],
		},
		1,
	);
	await ProductService.create(
		A,
		{
			...base,
			name: "Tee",
			price: 100,
			barcode: null,
			track_stock: true,
			variants: [
				{
					name: "S",
					price: 900,
					purchase_price: null,
					attributes: null,
					sku: "TEE-S",
					barcode: "222",
					images: [],
					stock: 3,
				},
				{
					name: "M",
					price: 950,
					purchase_price: null,
					attributes: null,
					sku: null,
					barcode: null,
					images: [],
					stock: 0,
				},
			],
		},
		1,
	);

	const rows = parseCsv(await ProductCsvService.export(A, "USD"));
	expect(rows[0]).toEqual([...CSV_COLUMNS]);
	const col = (name: string) => rows[0]!.indexOf(name);
	const colaRow = rows.find((r) => r[col("name")] === "Cola")!;
	expect(colaRow[col("sku")]).toBe("COL-1"); // real SKU wins over the generated fallback
	expect(colaRow[col("price")]).toBe("1.50");
	expect(colaRow[col("cost")]).toBe("0.90");
	expect(colaRow[col("barcode")]).toBe("00123"); // leading zero survives
	expect(colaRow[col("currency")]).toBe("USD");
	expect(colaRow[col("category")]).toBe("Drinks");
	expect([
		colaRow[col("track_stock")],
		colaRow[col("stock_quantity")],
		colaRow[col("low_stock_threshold")],
	]).toEqual(["true", "7", "2"]);
	const tees = rows.filter((r) => r[col("name")] === "Tee");
	expect(
		tees.map((r) => [
			r[col("variant_name")],
			r[col("price")],
			r[col("barcode")],
		]),
	).toEqual([
		["S", "9.00", "222"],
		["M", "9.50", ""],
	]);
	expect(tees.map((r) => r[col("sku")])).toEqual([
		"TEE-S",
		expect.stringMatching(/^P\d+-\d+$/),
	]); // fallback sku when none is set
	expect(new Set(tees.map((r) => r[col("variant_group")])).size).toBe(1);
	expect(tees[0]![col("variant_group")]).not.toBe("");
});

test("import: round-trips an export into another shop (variants regrouped, category auto-created)", async () => {
	const csv = await ProductCsvService.export(A, "USD");
	expect(await ProductCsvService.import(B, "USD", csv, 1)).toEqual({
		created: 2,
		errors: [],
	});
	const list = await ProductService.list(B);
	const cola = list.find((p) => p.name === "Cola")!;
	expect([
		cola.sku,
		cola.barcode,
		cola.price,
		cola.purchase_price,
		cola.track_stock,
		cola.stock,
		cola.low_stock_at,
		cola.unit,
	]).toEqual(["COL-1", "00123", 150, 90, true, 7, 2, "pcs"]);
	expect(cola.categories.map((c) => c.name)).toEqual(["Drinks"]);
	const tee = list.find((p) => p.name === "Tee")!;
	expect(tee.variants.map((v) => [v.name, v.price, v.stock, v.sku])).toEqual([
		["S", 900, 3, "TEE-S"],
		["M", 950, 0, expect.stringMatching(/^P\d+-\d+$/)],
	]);
	// stock typed in via import still lands in the ledger
	expect(
		(
			await sql`select sum(qty) as s from stock_movements where shop_id = ${B}`
		)[0].s,
	).toBe(10);
});

test("import: bad rows are skipped with row numbers, good rows still land; barcode clashes are refused", async () => {
	const csv = [
		"name,price,barcode",
		"Good Bar,2.00,555",
		",1.00,", // no name
		"Bad Price,abc,",
		"Clash,3.00,00123", // used by the imported Cola
	].join("\n");
	const r = await ProductCsvService.import(B, "USD", csv, 1);
	expect(r.created).toBe(1);
	expect(r.errors).toEqual([
		"Row 3: Name is required",
		'Row 4: price "abc" is not a valid amount',
		"Row 5 (Clash): Barcode already used by “Cola”",
	]);
});

test("import: wrong currency and missing header columns abort with nothing created", async () => {
	const eur = await ProductCsvService.import(
		B,
		"USD",
		"name,price,currency\nEuroThing,2.00,EUR\n",
		1,
	);
	expect(eur.created).toBe(0);
	expect(eur.errors[0]).toMatch(/"EUR" doesn't match/);
	expect(
		(await ProductCsvService.import(B, "USD", "name,cost\nX,1\n", 1)).errors[0],
	).toMatch(/header/);
	expect((await ProductService.page(B, "EuroThing", 1, 10)).total).toBe(0);
});

test("import: a row that fails for an unplanned reason is reported, the rows after it still import", async () => {
	const real = ProductService.create;
	ProductService.create = async function failing(shopId, d, userId) {
		if (d.name === "Boom") throw new Error("database is on fire");
		return real.call(ProductService, shopId, d, userId);
	};
	const log = console.error;
	console.error = () => {};
	try {
		const r = await ProductCsvService.import(
			B,
			"USD",
			"name,price\nBefore Boom,1.00\nBoom,2.00\nAfter Boom,3.00\n",
			1,
		);
		expect(r.created).toBe(2);
		expect(r.errors).toEqual(["Row 3 (Boom): Something went wrong"]);
		expect((await ProductService.page(B, "After Boom", 1, 10)).total).toBe(1);
	} finally {
		ProductService.create = real;
		console.error = log;
	}
});
