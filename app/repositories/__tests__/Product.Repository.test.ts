import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import { SQL } from "bun";
// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
// The module cache is shared across test files, so never `sql.close()` here — other tests reuse this connection.
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { dialect, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const registry = await import("@database/migrations");
const { ProductRepository: _ProductRepository } = await import(
	"../Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);
const ordered = Object.entries(registry).sort(([a], [b]) => a.localeCompare(b));

// its own SQLite file: only when the run's migrations are written for SQLite
test.skipIf(dialect !== "sqlite")(
	"0007 keeps the old single image (fresh DB, migrations replayed one by one)",
	async () => {
		// migrations take the connection as a parameter, so this runs on its own throw-away file
		const db = new SQL(`sqlite://${tmpdir()}/pos-test-0007-${process.pid}.db`);
		for (const [k, up] of ordered) {
			if (k === "m0007_product_images")
				await db`insert into products (shop_id, name, price, image) values (1, 'Old', 100, '/uploads/old.png')`;
			await up(db);
		}
		expect(
			(await db`select images from products`).map((p: any) =>
				JSON.parse(p.images),
			),
		).toEqual([["/uploads/old.png"]]);
		await db.close();
	},
);

test("product + variant images round-trip; variants upsert by id", async () => {
	await migrate(true);
	const d: any = {
		name: "New",
		description: "",
		price: 5,
		images: ["/uploads/a.jpg", "/uploads/b.jpg"],
		barcode: null,
		category_ids: [],
		track_stock: false,
		stock: 0,
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		variants: [
			{
				name: "S",
				price: 5,
				attributes: null,
				barcode: null,
				images: ["/uploads/s.jpg"],
				stock: 0,
			},
			{
				name: "M",
				price: 6,
				attributes: { Size: "M" },
				barcode: null,
				images: [],
				stock: 0,
			},
		],
	};
	const p = await ProductRepository.create(1, d);
	const f = (await ProductRepository.find(p.id, 1))!;
	expect(f.images).toEqual(["/uploads/a.jpg", "/uploads/b.jpg"]);
	expect(f.variants.map((v) => v.images)).toEqual([["/uploads/s.jpg"], []]);
	await ProductRepository.update(p.id, 1, {
		...d,
		images: ["/uploads/b.jpg"],
		variants: [{ ...d.variants[0], id: f.variants[0]!.id, images: [] }],
	});
	const g = (await ProductRepository.find(p.id, 1))!;
	expect(g.images).toEqual(["/uploads/b.jpg"]);
	expect(g.variants.map((v) => [v.id, v.images])).toEqual([
		[f.variants[0]!.id, []],
	]);
});

test("lists are ordered featured first, then most recently updated (SQLite ticks by the second, so id breaks ties)", async () => {
	await migrate(true);
	const S = 99; // own shop: the other tests use shop 1
	const d: any = {
		name: "",
		description: "",
		price: 100,
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
		category_ids: [],
		variants: [],
	};
	const old = await ProductRepository.create(S, {
		...d,
		name: "Old",
		amount: 50,
		unit: "g",
		extra: [{ title: "Darreichungsform", value: "Tabletten" }],
	});
	expect((await ProductRepository.find(old.id, S))!.amount).toBe(50); // how much one unit holds, next to `unit`
	expect((await ProductRepository.find(old.id, S))!.extra).toEqual([
		{ title: "Darreichungsform", value: "Tabletten" },
	]); // "Additional data" rows round-trip
	await ProductRepository.update(old.id, S, { ...d, name: "Old", extra: [] });
	expect((await ProductRepository.find(old.id, S))!.extra).toEqual([]);
	const mid = await ProductRepository.create(S, { ...d, name: "Mid" });
	const fresh = await ProductRepository.create(S, { ...d, name: "Fresh" });
	for (const [p, t] of [
		[old, "2024-01-01 00:00:00"],
		[mid, "2024-06-01 00:00:00"],
		[fresh, "2024-12-01 00:00:00"],
	] as const) {
		await sql`update products set updated_at = ${t} where id = ${p.id}`;
	}
	const names = async () =>
		(await ProductRepository.allForShop(S)).map((p) => p.name);
	expect(await names()).toEqual(["Fresh", "Mid", "Old"]);

	await ProductRepository.setFeatured(old.id, S, true);
	expect(await names()).toEqual(["Old", "Fresh", "Mid"]);
	expect((await ProductRepository.find(old.id, S))!.featured).toBe(true);
	expect(
		(await ProductRepository.pageForShop(S, "", 1, 2)).data.map((p) => p.name),
	).toEqual(["Old", "Fresh"]);

	await ProductRepository.setFeatured(old.id, S, false);
	expect(await names()).toEqual(["Fresh", "Mid", "Old"]);

	// switched off: still on the admin list, gone from the POS page and refused at checkout
	await ProductRepository.setActive(mid.id, S, false);
	expect(await names()).toEqual(["Fresh", "Mid", "Old"]);
	expect((await ProductRepository.find(mid.id, S))!.active).toBe(false);
	const pos = await ProductRepository.pageForShop(S, "", 1, 10, {
		active: true,
	});
	expect(pos.data.map((p) => p.name)).toEqual(["Fresh", "Old"]);
	expect(pos.total).toBe(2);
	expect(await ProductRepository.priceLine(mid.id, null, S)).toBeNull();
	await ProductRepository.setActive(mid.id, S, true);
	expect(await ProductRepository.priceLine(mid.id, null, S)).not.toBeNull();
});

test("saving a product bumps updated_at, so an edit moves it to the front", async () => {
	const S = 98;
	const d: any = {
		name: "Edited",
		description: "",
		price: 100,
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
		category_ids: [],
		variants: [],
	};
	const p = await ProductRepository.create(S, d);
	await sql`update products set updated_at = '2020-01-01 00:00:00' where id = ${p.id}`;
	await ProductRepository.update(p.id, S, { ...d, name: "Edited again" });
	const [row] = await sql`select updated_at from products where id = ${p.id}`;
	expect(String(row.updated_at) > "2020-01-01 00:00:00").toBe(true);
});
