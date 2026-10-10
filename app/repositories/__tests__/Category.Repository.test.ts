import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { CategoryRepository: _CategoryRepository } = await import(
	"../Category.Repository"
);
const CategoryRepository = Container.get(_CategoryRepository);
const { ProductRepository: _ProductRepository } = await import(
	"../Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);
const [shop] =
	await sql`insert into shops (name, currency) values ('Cat', 'USD') returning id`;
const S = shop.id as number;

test("categories: CRUD scoped to the shop, product_count, delete unlinks products", async () => {
	const drinks = await CategoryRepository.create(S, {
		name: "Drinks",
		color: "#112233",
		image: null,
	});
	const food = await CategoryRepository.create(S, {
		name: "Food",
		color: null,
		image: null,
	});
	await CategoryRepository.create(S + 1000, {
		name: "Elsewhere",
		color: null,
		image: null,
	});
	const p = await ProductRepository.create(S, {
		name: "Tea",
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
		kind: "item",
		bundle_items: [],
		category_ids: [drinks.id, drinks.id],
		variants: [],
	});
	const list = await CategoryRepository.allForShop(S);
	expect(list.map((c) => [c.name, Number(c.product_count)])).toEqual([
		["Drinks", 1],
		["Food", 0],
	]);
	expect(await CategoryRepository.find(drinks.id, S + 1000)).toBeNull();
	expect(
		(
			await CategoryRepository.update(food.id, S, {
				name: "Snacks",
				color: "#abcdef",
				image: null,
			})
		)?.name,
	).toBe("Snacks");
	expect(
		await CategoryRepository.update(food.id, S + 1000, {
			name: "Nope",
			color: null,
			image: null,
		}),
	).toBeNull();
	// another shop can't delete the category, nor its links, nor the product's variants / links
	await CategoryRepository.delete(drinks.id, S + 1000);
	await ProductRepository.delete(p.id, S + 1000);
	expect(
		(await ProductRepository.find(p.id, S))!.categories.map((c) => c.id),
	).toEqual([drinks.id]);
	await CategoryRepository.delete(drinks.id, S);
	expect((await ProductRepository.find(p.id, S))!.categories).toEqual([]);
	expect((await CategoryRepository.allForShop(S)).map((c) => c.name)).toEqual([
		"Snacks",
	]);
});
