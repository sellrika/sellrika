import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { ProductService: _ProductService } = await import("../Product.Service");
const ProductService = Container.get(_ProductService);

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
	await sql`insert into shops (name, currency) values ('Prod', 'USD') returning id`;
const S = shop.id as number;
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
const v = (name: string, barcode: string | null) => ({
	name,
	price: 100,
	purchase_price: null,
	attributes: null,
	sku: null,
	barcode,
	images: [],
	stock: 0,
});

test("products: barcode uniqueness (product + variants, per shop), search by name/barcode, variants upsert keeps ids", async () => {
	const cola = await ProductService.create(
		S,
		{
			...base,
			name: "Cola",
			price: 150,
			sku: "COL-1",
			barcode: "111",
			unit: "pcs",
			variants: [],
		},
		1,
	);
	const found = (await ProductService.find(cola.id, S))!;
	expect([found.unit, found.sku]).toEqual(["pcs", "COL-1"]); // custom/predefined unit and optional SKU round-trip
	const tee = await ProductService.create(
		S,
		{
			...base,
			name: "Tee",
			price: 900,
			barcode: null,
			variants: [v("S", "222"), v("M", "333")],
		},
		1,
	);
	await ProductService.create(
		S + 1000,
		{ ...base, name: "Far", price: 1, barcode: "111", variants: [] },
		1,
	); // other shop may reuse
	expect(
		await ProductService.barcodeErrors(S, {
			...base,
			name: "X",
			price: 1,
			barcode: "111",
			variants: [],
		}),
	).toEqual({ barcode: "Barcode already used by “Cola”" });
	expect(
		await ProductService.barcodeErrors(
			S,
			{ ...base, name: "X", price: 1, barcode: "111", variants: [] },
			cola.id,
		),
	).toBeNull(); // editing itself
	expect(
		await ProductService.barcodeErrors(S, {
			...base,
			name: "X",
			price: 1,
			barcode: null,
			variants: [v("A", "333"), v("B", "333")],
		}),
	).toEqual({
		"variants.0.barcode": "Barcode already used by “Tee”",
		"variants.1.barcode": "Duplicate barcode in this product",
	});
	// with variants the product-level barcode is ignored
	expect(
		await ProductService.barcodeErrors(S, {
			...base,
			name: "X",
			price: 1,
			barcode: "111",
			variants: [v("A", "999")],
		}),
	).toBeNull();

	expect(
		(await ProductService.page(S, "333", 1, 10)).data.map((p) => p.name),
	).toEqual(["Tee"]);
	expect(
		(await ProductService.page(S, "col", 1, 10)).data.map((p) => p.name),
	).toEqual(["Cola"]);
	expect(
		(await ProductService.page(S, "col-1", 1, 10)).data.map((p) => p.name),
	).toEqual(["Cola"]); // search matches SKU too
	expect((await ProductService.page(S, "", 1, 1)).last_page).toBe(2);

	const before = (await ProductService.find(tee.id, S))!;
	const sId = before.variants[0]!.id;
	await ProductService.update(
		tee.id,
		S,
		{
			...base,
			name: "Tee",
			price: 900,
			barcode: null,
			unit: "boxes of 3",
			variants: [{ ...v("Small", "222"), id: sId }, v("L", "444")],
		},
		1,
	);
	const after = (await ProductService.find(tee.id, S))!;
	expect(after.variants.map((x) => [x.id === sId, x.name])).toEqual([
		[true, "Small"],
		[false, "L"],
	]);
	expect(after.unit).toBe("boxes of 3");
	await ProductService.remove(tee.id, S);
	expect(await ProductService.find(tee.id, S)).toBeNull();
	expect(
		await ProductService.barcodeErrors(S, {
			...base,
			name: "X",
			price: 1,
			barcode: "222",
			variants: [],
		}),
	).toBeNull();
});

test("products: the rich-text description is sanitised on create and update", async () => {
	const bad =
		`<h2>Menu</h2><p><b>Hot</b></p><script>evil()</` +
		`script><ul><li onclick="x()">one</li></ul>`;
	const p = await ProductService.create(
		S,
		{
			...base,
			name: "Desc",
			price: 100,
			description: bad,
			barcode: null,
			variants: [],
		},
		1,
	);
	expect((await ProductService.find(p.id, S))!.description).toBe(
		`<h2>Menu</h2><p><b>Hot</b></p><ul><li>one</li></ul>`,
	);
	await ProductService.update(
		p.id,
		S,
		{
			...base,
			name: "Desc",
			price: 100,
			description: `<p>ok</p><iframe src="https://x"></iframe>`,
			barcode: null,
			variants: [],
		},
		1,
	);
	expect((await ProductService.find(p.id, S))!.description).toBe(`<p>ok</p>`);
});

test("packages: availability comes from the components, contents are validated, delete/variant guards hold", async () => {
	const pen = await ProductService.create(
		S,
		{
			...base,
			name: "Pen",
			price: 250,
			barcode: null,
			track_stock: true,
			variants: [
				{ ...v("Red", null), stock: 20 },
				{ ...v("Blue", null), stock: 20 },
			],
		},
		1,
	);
	const note = await ProductService.create(
		S,
		{
			...base,
			name: "Notebook",
			price: 500,
			barcode: null,
			track_stock: true,
			stock: 5,
			variants: [],
		},
		1,
	);
	const far = await ProductService.create(
		S + 1000,
		{ ...base, name: "Far pen", price: 1, barcode: null, variants: [] },
		1,
	);
	const [red, blue] = (await ProductService.find(pen.id, S))!.variants;
	// a package normalises away its own stock/cost/variants…
	const pack = await ProductService.create(
		S,
		{
			...base,
			name: "Pen pack",
			price: 2800,
			barcode: null,
			kind: "bundle",
			purchase_price: 999,
			track_stock: true,
			stock: 99,
			variants: [],
			bundle_items: [
				{ product_id: pen.id, variant_ids: [red!.id, blue!.id], qty: 12 },
				{ product_id: note.id, variant_ids: null, qty: 1 },
			],
		},
		1,
	);
	const [raw] =
		await sql`select track_stock, stock, purchase_price, kind from products where id = ${pack.id}`;
	expect([
		!!raw.track_stock,
		Number(raw.stock),
		raw.purchase_price,
		raw.kind,
	]).toEqual([false, 0, null, "bundle"]);
	// …and gets them back computed: best option 20 Red / 12 = 1 package, and the 5 notebooks cover 5
	const p = (await ProductService.find(pack.id, S))!;
	expect([p.track_stock, p.stock, p.variants.length]).toEqual([true, 1, 0]);
	expect(
		p.bundle_items.map((b) => [
			b.name,
			b.qty,
			b.options.map((o) => [o.name, o.stock]),
		]),
	).toEqual([
		[
			"Pen",
			12,
			[
				["Red", 20],
				["Blue", 20],
			],
		],
		["Notebook", 1, [["Notebook", 5]]],
	]);

	const errs = (bundle_items: any[]) =>
		ProductService.bundleErrors(S, {
			...base,
			name: "X",
			price: 1,
			barcode: null,
			variants: [],
			kind: "bundle",
			bundle_items,
		});
	expect(await errs([])).toEqual({
		bundle_items: "Add at least one product to the package",
	});
	expect(
		await errs([{ product_id: pack.id, variant_ids: null, qty: 1 }]),
	).toEqual({
		"bundle_items.0.product_id": "A package can't contain another package",
	});
	expect(
		await errs([{ product_id: far.id, variant_ids: null, qty: 1 }]),
	).toEqual({ "bundle_items.0.product_id": "That product no longer exists" }); // another shop
	expect(
		await errs([{ product_id: pen.id, variant_ids: null, qty: 1 }]),
	).toEqual({ "bundle_items.0.variant_ids": "Choose at least one variant" });
	expect(
		await errs([
			{ product_id: pen.id, variant_ids: [red!.id, 999999], qty: 1 },
		]),
	).toEqual({
		"bundle_items.0.variant_ids": "That variant doesn't belong to this product",
	});
	expect(
		await errs([{ product_id: note.id, variant_ids: [red!.id], qty: 1 }]),
	).toEqual({
		"bundle_items.0.variant_ids": "That variant doesn't belong to this product",
	});
	// the same slot twice is fine — that's how "6 red + 6 blue" is built (the customer answers each slot separately)
	expect(
		await errs([
			{ product_id: pen.id, variant_ids: [red!.id, blue!.id], qty: 6 },
			{ product_id: pen.id, variant_ids: [blue!.id, red!.id], qty: 6 },
		]),
	).toBeNull();
	expect(
		await errs([
			{ product_id: pen.id, variant_ids: [red!.id], qty: 1 },
			{ product_id: pen.id, variant_ids: [blue!.id], qty: 2 },
		]),
	).toBeNull();

	// a product inside a package can't be deleted, and neither can a variant the package points at
	expect(await ProductService.remove(pen.id, S)).toMatch(
		/“Pen” is used in package “Pen pack” — remove it there first/,
	);
	expect(await ProductService.find(pen.id, S)).not.toBeNull();
	const keepBoth = {
		...base,
		name: "Pen",
		price: 250,
		barcode: null,
		track_stock: true,
		variants: [
			{ ...v("Red", null), id: red!.id, stock: 20 },
			{ ...v("Blue", null), id: blue!.id, stock: 20 },
		],
	};
	expect(await ProductService.variantErrors(pen.id, S, keepBoth)).toBeNull();
	expect(
		(
			await ProductService.variantErrors(pen.id, S, {
				...keepBoth,
				variants: [keepBoth.variants[0]!],
			})
		)?.variants,
	).toMatch(/“Blue” is used in package “Pen pack”/);

	// deleting the package takes its slots with it and frees the components
	expect(await ProductService.remove(pack.id, S)).toBeNull();
	expect(
		Number(
			(
				await sql`select count(*) as n from bundle_items where bundle_id = ${pack.id}`
			)[0].n,
		),
	).toBe(0);
	expect(await ProductService.remove(pen.id, S)).toBeNull();
});

test("a save without `stock` (the product form) keeps the count; CSV-style saves with it still record an adjustment", async () => {
	const jar = await ProductService.create(
		S,
		{
			...base,
			name: "Jar",
			price: 100,
			barcode: null,
			track_stock: true,
			stock: 5,
			variants: [],
		},
		1,
	);
	const { stock: _omit, ...noStock } = base;
	await ProductService.update(
		jar.id,
		S,
		{
			...noStock,
			name: "Jar!",
			price: 100,
			barcode: null,
			track_stock: true,
			variants: [],
		} as any,
		1,
	);
	expect((await ProductService.find(jar.id, S))!.stock).toBe(5);
	expect(
		Number(
			(
				await sql`select count(*) as n from stock_movements where product_id = ${jar.id}`
			)[0].n,
		),
	).toBe(1); // only the +5 from create
});

test("products: slug from the name, unique per shop, follows a rename", async () => {
	const a = await ProductService.create(
		S,
		{ ...base, name: "Corner Mug!", price: 100, barcode: null, variants: [] },
		1,
	);
	const b = await ProductService.create(
		S,
		{ ...base, name: "Corner mug", price: 100, barcode: null, variants: [] },
		1,
	);
	const other = await ProductService.create(
		S + 2000,
		{ ...base, name: "Corner Mug", price: 100, barcode: null, variants: [] },
		1,
	); // another shop may reuse
	expect([a.slug, b.slug, other.slug]).toEqual([
		"corner-mug",
		"corner-mug-2",
		"corner-mug",
	]);
	expect(
		(
			await ProductService.create(
				S,
				{ ...base, name: "店", price: 100, barcode: null, variants: [] },
				1,
			)
		).slug,
	).toMatch(/^p-\d+$/); // no latin letters → id-based
	// same name → same slug; a rename moves the page
	expect(
		(await ProductService.update(
			a.id,
			S,
			{ ...base, name: "Corner Mug!", price: 100, barcode: null, variants: [] },
			1,
		))!.slug,
	).toBe("corner-mug");
	expect(
		(await ProductService.update(
			a.id,
			S,
			{ ...base, name: "Big Mug", price: 100, barcode: null, variants: [] },
			1,
		))!.slug,
	).toBe("big-mug");
	await ProductService.remove(a.id, S);
	await ProductService.remove(b.id, S);
});

test("products: every https image link is copied into our storage, on the product and on a variant", async () => {
	const link = "https://cdn.example.com/mug.jpg";
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
	const real = globalThis.fetch;
	let calls = 0;
	const fake = Object.assign(
		async function fake(url: string | URL | Request) {
			calls++;
			return String(url).includes("dead")
				? new Response("gone", { status: 404 })
				: new Response(png);
		},
		{ preconnect: real.preconnect },
	);
	globalThis.fetch = fake as typeof fetch;
	// the fake host must resolve to a public address, or Outbound.fetch refuses it
	const lookup = Bun.dns.lookup;
	Bun.dns.lookup = (async () => [
		{ address: "93.184.216.34", family: 4, ttl: 1 },
	]) as unknown as typeof lookup;
	try {
		const d = {
			...base,
			name: "Mug",
			price: 500,
			barcode: null,
			images: [
				"/uploads/a1.jpg",
				link,
				`data:image/png;base64,${png.toBase64()}`,
			],
			variants: [{ ...v("Blue", null), images: [link] }],
		};
		expect(await ProductService.copyImages(S, d)).toBeNull();
		// a base64 picture is stored like a link
		expect(d.images[2]).toMatch(
			new RegExp(`^/uploads/${S}/products/[\\w-]+\\.png$`),
		);
		// base64 that is no picture is refused, named by its place
		expect(
			await ProductService.copyImages(S, { ...d, images: ["aGVsbG8="] }),
		).toEqual({ images: expect.stringMatching(/: #1$/) });
		expect(calls).toBe(1); // the same link twice is downloaded once
		expect(d.images[0]).toBe("/uploads/a1.jpg"); // our own upload stays as it is
		expect(d.images[1]).toMatch(
			new RegExp(`^/uploads/${S}/products/[\\w-]+\\.png$`),
		);
		expect(d.variants[0]!.images).toEqual([d.images[1]!]);
		const dead = {
			...base,
			name: "Cup",
			price: 500,
			barcode: null,
			images: [],
			variants: [
				{ ...v("Red", null), images: ["https://cdn.example.com/dead.jpg"] },
			],
		};
		expect(await ProductService.copyImages(S, dead)).toEqual({
			variants:
				"Could not load the image from that link: https://cdn.example.com/dead.jpg",
		});
	} finally {
		globalThis.fetch = real;
		Bun.dns.lookup = lookup;
	}
});

/**
 * Save one real picture into the test's upload folder.
 * @returns Its `/uploads/…` path.
 */
async function upload(): Promise<string> {
	const { Storage } = await import("@xcore/storage/Storage");
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
	const r = await Storage.storeImage(new File([png], "p.png"), S, "products");
	if ("error" in r) throw new Error(r.error);
	return r.url;
}

/**
 * Is the picture still in storage?
 * @param url An `/uploads/…` path.
 * @returns True while the file can be read.
 */
async function exists(url: string): Promise<boolean> {
	const { Storage } = await import("@xcore/storage/Storage");
	return (await Storage.readBytes(url)) !== null;
}

test("products: a picture the product drops is deleted, unless something else still uses it", async () => {
	const [a, b, c, shared, logo, page, text, va, vb] = await Promise.all(
		Array.from({ length: 9 }, upload),
	);
	const d = {
		...base,
		name: "Pic",
		price: 100,
		barcode: null,
		description: `<p><img src="${text}"></p>`,
		images: [a!, b!, c!, shared!, logo!, page!],
		variants: [
			{ ...v("Red", null), images: [va!] },
			{ ...v("Blue", null), images: [vb!] },
		],
	};
	const p = await ProductService.create(S, structuredClone(d), 1);
	const other = await ProductService.create(
		S,
		{
			...base,
			name: "Other",
			price: 1,
			barcode: null,
			images: [shared!],
			variants: [],
		},
		1,
	);
	await sql`update shops set logo = ${logo!} where id = ${S}`;
	await sql`insert into store_pages (shop_id, slug, title, body) values (${S}, 'pic-page', 'Pic', ${`<img src="${page}">`})`;
	const full = (await ProductService.find(p.id, S))!;
	const red = full.variants.find((x) => x.name === "Red")!;

	// fewer images, one variant's image changed, the other variant removed
	await ProductService.update(
		p.id,
		S,
		{
			...d,
			images: [a!],
			variants: [{ ...v("Red", null), id: red.id, images: [] }],
		},
		1,
	);
	// the save does not wait for the clean-up, so the test does
	await ProductService.picturesDropped();
	expect(await exists(a!)).toBe(true); // kept
	expect(await exists(b!)).toBe(false);
	expect(await exists(c!)).toBe(false);
	expect(await exists(va!)).toBe(false); // variant image removed
	expect(await exists(vb!)).toBe(false); // variant removed
	expect(await exists(shared!)).toBe(true); // another product uses it
	expect(await exists(logo!)).toBe(true); // the shop logo
	expect(await exists(page!)).toBe(true); // a store page
	expect(await exists(text!)).toBe(true); // still in this product's description

	// a product's description keeps a file another product dropped
	await ProductService.update(
		other.id,
		S,
		{
			...base,
			name: "Other",
			price: 1,
			barcode: null,
			description: `<img src="${a}">`,
			images: [],
			variants: [],
		},
		1,
	);
	await ProductService.remove(p.id, S);
	await ProductService.picturesDropped();
	expect(await exists(a!)).toBe(true); // in Other's description
	expect(await exists(text!)).toBe(false); // deleted with the product
	expect(await exists(shared!)).toBe(false); // Other dropped it earlier, now nobody uses it

	await ProductService.remove(other.id, S);
	await ProductService.picturesDropped();
	expect(await exists(a!)).toBe(false);
	await sql`update shops set logo = null where id = ${S}`;
	await sql`delete from store_pages where shop_id = ${S} and slug = 'pic-page'`;
});

test("products: deleteUpload never deletes an order picture", async () => {
	const { Storage } = await import("@xcore/storage/Storage");
	const { OrderImages } = await import("@xcore/storage/OrderImages");
	const url = (await OrderImages.put(
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]),
		S,
	))!;
	await Storage.delete(url);
	expect(await exists(url)).toBe(true);
});

test("products: a failing clean-up does not break the save", async () => {
	const { UploadRepository } = await import("@repositories/Upload.Repository");
	const uploads = Container.get(UploadRepository);
	const pic = await upload();
	const p = await ProductService.create(
		S,
		{
			...base,
			name: "Safe",
			price: 1,
			barcode: null,
			images: [pic],
			variants: [],
		},
		1,
	);
	const real = uploads.inUse;
	uploads.inUse = async function broken() {
		throw new Error("db down");
	};
	try {
		const saved = await ProductService.update(
			p.id,
			S,
			{
				...base,
				name: "Safe",
				price: 1,
				barcode: null,
				images: [],
				variants: [],
			},
			1,
		);
		expect(saved?.id).toBe(p.id);
		expect(await exists(pic)).toBe(true); // not deleted when we can't tell
	} finally {
		uploads.inUse = real;
	}
	await ProductService.dropPictures([pic]);
	expect(await exists(pic)).toBe(false);
	await ProductService.remove(p.id, S);
});

test("a picture used only in a campaign email is still in use", async () => {
	const { UploadRepository } = await import("@repositories/Upload.Repository");
	const uploads = Container.get(UploadRepository);
	const pic = "/uploads/campaign-only-pic.png";
	expect(await uploads.inUse(pic)).toBe(false);
	const [c] =
		await sql`insert into campaigns (shop_id, subject, body) values (${S}, 'Sale', ${`<p><img src="${pic}"></p>`}) returning id`;
	expect(await uploads.inUse(pic)).toBe(true);
	await sql`delete from campaigns where id = ${c.id}`;
});
