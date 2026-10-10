import { tmpdir } from "node:os"; // Bun has no equivalent
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
// The module cache is shared across test files, so never `sql.close()` here.
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
process.env.APP_KEY = process.env.APP_KEY || "store-service-test-key";
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { StoreService: _StoreService } = await import("../Store.Service");
const StoreService = Container.get(_StoreService);
const { OnlineStoreInput } = await import("@validators/Store.Validator");
// the gateways are extensions now: each test shop uploads a fake one (app/services/sales/__tests__/fakeGateway.ts)
const {
	installPayment,
	hostedManifest,
	HOSTED_MODULE,
	pay,
	resetPay,
	useGateway,
} = await import("./fakeGateway");
const { ExtensionService: _ExtensionService } = await import(
	"@services/settings/extensions/Extension.Service"
);
const ExtensionService = Container.get(_ExtensionService);
const { decrypt } = await import("@helpers/crypto");
const { ProductRepository: _ProductRepository } = await import(
	"@repositories/Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { StockRepository: _StockRepository } = await import(
	"@repositories/Stock.Repository"
);
const StockRepository = Container.get(_StockRepository);
const { StorePageRepository: _StorePageRepository } = await import(
	"@repositories/StorePage.Repository"
);
const StorePageRepository = Container.get(_StorePageRepository);
const { CustomerRepository: _CustomerRepository } = await import(
	"@repositories/Customer.Repository"
);
const CustomerRepository = Container.get(_CustomerRepository);
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

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);
/** Install + switch on a fake gateway for a shop (the zip lands in the temp EXTENSION_UPLOAD_DIR from app/test.preload.ts). */
const gateway = (
	id: number,
	kind: "hosted" | "tokenize" = "hosted",
	config: Record<string, string> = {},
) => useGateway(id, kind, config);

// fixtures: an online shop with one tracked product and one variant product
const [s] =
	await sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Svc Store', 'USD', 'UTC', 'svc-store', ${true}) returning id`;
const S = s.id as number;
const shop = () => ShopRepository.find(S).then((x) => x!);
const base = {
	description: "",
	images: [],
	barcode: null,
	unit: null,
	category_ids: [],
	low_stock_at: 0,
	featured: false,
	active: true,
	original_price: null,
	variants: [] as any[],
};
const mug = await ProductRepository.create(S, {
	...base,
	name: "Svc Mug",
	price: 1000,
	purchase_price: 400,
	track_stock: true,
	stock: 3,
} as any);
const tee = await ProductRepository.create(S, {
	...base,
	name: "Svc Tee",
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
} as any);
const teeS = (await ProductRepository.find(tee.id, S))!.variants[0]!;

test("catalog: a switched-off product is not on the storefront", async () => {
	await ProductRepository.setActive(mug.id, S, false);
	expect((await StoreService.catalog(S)).some((p) => p.id === mug.id)).toBe(
		false,
	);
	await ProductRepository.setActive(mug.id, S, true);
	expect((await StoreService.catalog(S)).some((p) => p.id === mug.id)).toBe(
		true,
	);
});

test("catalog: public shape — cheapest variant price, sold-out flags, and no cost fields", async () => {
	const cat = await StoreService.catalog(S);
	const t = cat.find((p) => p.id === tee.id)!;
	expect(t.price).toBe(2000); // cheapest variant
	expect(t.sold_out).toBe(false); // one variant still in stock
	expect(t.variants.map((v) => v.sold_out)).toEqual([false, true]);
	expect(cat.find((p) => p.id === mug.id)!.stock).toBe(3);
	expect(JSON.stringify(cat)).not.toContain("purchase_price");
});

test("catalog: original_price only survives when it beats the shown price", async () => {
	const sale = await ProductRepository.create(S, {
		...base,
		name: "Svc Sale",
		price: 800,
		purchase_price: null,
		track_stock: false,
		stock: 0,
		original_price: 1000,
	} as any);
	const bogus = await ProductRepository.create(S, {
		...base,
		name: "Svc Bogus",
		price: 800,
		purchase_price: null,
		track_stock: false,
		stock: 0,
		original_price: 500,
	} as any);
	// with variants the shown price is the cheapest variant — the "was" price must beat that one
	const vari = await ProductRepository.create(S, {
		...base,
		name: "Svc Vari",
		price: 3000,
		purchase_price: null,
		track_stock: false,
		stock: 0,
		original_price: 2400,
		variants: [
			{
				name: "S",
				price: 2000,
				purchase_price: null,
				attributes: null,
				barcode: null,
				images: [],
				stock: 0,
			},
		],
	} as any);
	const cat = await StoreService.catalog(S);
	expect(cat.find((p) => p.id === sale.id)!.original_price).toBe(1000);
	expect(cat.find((p) => p.id === bogus.id)!.original_price).toBeNull();
	expect(cat.find((p) => p.id === vari.id)!.original_price).toBe(2400);
});

test("browse: ?sort= orders by price or newest, ?stock=1 hides sold-out products, and the page is clamped", async () => {
	const mk = (name: string, price: number, stock: number) =>
		ProductRepository.create(S, {
			...base,
			name,
			price,
			purchase_price: null,
			track_stock: true,
			stock,
		} as any);
	const a = await mk("Svc Sort A", 300, 0); // sold out
	const b = await mk("Svc Sort B", 100, 5);
	const c = await mk("Svc Sort C", 200, 5);
	const names = async (f: Partial<Parameters<typeof StoreService.browse>[1]>) =>
		(
			await StoreService.browse(S, {
				q: "Svc Sort",
				category: null,
				page: 1,
				...f,
			})
		).catalog.data.map((p) => p.name);
	expect(await names({ sort: "newest" })).toEqual([c.name, b.name, a.name]);
	expect(await names({ sort: "price_asc" })).toEqual([b.name, c.name, a.name]);
	expect(await names({ sort: "price_desc" })).toEqual([a.name, c.name, b.name]);
	expect(await names({ sort: "price_asc", stock: true })).toEqual([
		b.name,
		c.name,
	]);
	expect(
		(
			await StoreService.browse(S, {
				q: "Svc Sort",
				category: null,
				page: 9,
				stock: true,
			})
		).catalog.page,
	).toBe(1); // clamped to the last page of the filtered set
});

test("related: same category first, in stock before sold out, never the product itself, capped", async () => {
	const [c] =
		await sql`insert into categories (shop_id, name) values (${S}, 'Svc Rel') returning id`;
	const mk = (name: string, stock: number, cats: number[] = []) =>
		ProductRepository.create(S, {
			...base,
			name,
			price: 100,
			purchase_price: null,
			track_stock: true,
			stock,
			category_ids: cats,
		} as any);
	const me = await mk("Svc Rel Me", 1, [c.id]);
	const sameOut = await mk("Svc Rel Same Out", 0, [c.id]);
	const same = await mk("Svc Rel Same", 1, [c.id]);
	const other = await mk("Svc Rel Other", 1);
	const all = await StoreService.catalog(S);
	const ids = StoreService.related(
		all,
		all.find((p) => p.id === me.id)!,
		3,
	).map((p) => p.id);
	expect(ids.slice(0, 2)).toEqual([same.id, sameOut.id]); // shared category wins, in stock before sold out
	expect(ids).toHaveLength(3);
	expect(ids).not.toContain(me.id);
	expect(ids[2]).not.toBe(sameOut.id);
	expect(
		StoreService.related(all, all.find((p) => p.id === other.id)!, 99),
	).toHaveLength(all.length - 1); // no category → everything else, once
});

/** The settings payload the /online-store form sends: the store's own fields plus the manual options' details. */
const store = (
	over: Partial<Parameters<typeof StoreService.updateSettings>[1]> = {},
) =>
	({
		enabled: true,
		slug: "svc-store",
		domain: null,
		google_site_verification: null,
		template: "classic",
		credentials: {},
		...over,
	}) as Parameters<typeof StoreService.updateSettings>[1];

test("settings: the store's own settings round-trip; taken slugs and domains are refused", async () => {
	expect(
		(await StoreService.updateSettings(S, store({ template: "boutique" })))
			.errors,
	).toBeUndefined();
	expect(await StoreService.settings(S)).toMatchObject({
		enabled: true,
		slug: "svc-store",
		domain: "",
		template: "boutique",
	});
	await StoreService.updateSettings(S, store());
	// another shop can't take this slug
	const [other] =
		await sql`insert into shops (name, currency, slug) values ('Other', 'USD', 'svc-other') returning id`;
	expect(
		(await StoreService.updateSettings(other.id, store({ enabled: false })))
			.errors?.slug,
	).toMatch(/taken/);
	// …nor its custom domain, and the Host lookup finds the shop that owns it (www. included)
	await StoreService.updateSettings(S, store({ domain: "svc.example.com" }));
	expect(
		(
			await StoreService.updateSettings(
				other.id,
				store({ enabled: false, slug: "svc-other", domain: "svc.example.com" }),
			)
		).errors?.domain,
	).toMatch(/already used/);
	expect((await ShopRepository.findByDomain("svc.example.com"))?.id).toBe(S);
	expect((await ShopRepository.findByDomain("www.svc.example.com"))?.id).toBe(
		S,
	);
	expect(await ShopRepository.findByDomain("nobody.example.com")).toBeNull();
	// Google Search Console token: a pasted <meta> tag is trimmed to its content, junk is refused, the value round-trips
	const meta = OnlineStoreInput.safeParse({
		...store(),
		domain: "",
		google_site_verification:
			'<meta name="google-site-verification" content="Ab1_-cdefGHIJ" />',
	});
	expect(meta.success && meta.data.google_site_verification).toBe(
		"Ab1_-cdefGHIJ",
	);
	expect(
		OnlineStoreInput.safeParse({
			...store(),
			domain: "",
			google_site_verification: "not a token",
		}).success,
	).toBe(false);
	await StoreService.updateSettings(
		S,
		store({ google_site_verification: "Ab1_-cdefGHIJ" }),
	);
	expect((await StoreService.settings(S)).google_site_verification).toBe(
		"Ab1_-cdefGHIJ",
	);
	await StoreService.updateSettings(S, store());
	expect((await StoreService.settings(S)).google_site_verification).toBe("");
});

test("settings: the banner and the contact block round-trip, blank = off; links must be https and chat numbers become digits", async () => {
	const raw = {
		...store(),
		domain: "",
		google_site_verification: "",
		banner: " Sale! ",
		banner_type: "warning",
		support_email: " Help@Shop.IO ",
		phone: "+95 9 111",
		address: "12 Main St",
		hours: "Mon–Fri",
		facebook: "https://facebook.com/x",
		instagram: "",
		viber: "+95 9 123 456",
		whatsapp: "",
	};
	const ok = OnlineStoreInput.safeParse(raw);
	expect(
		OnlineStoreInput.safeParse({ ...raw, banner_type: "loud" }).success,
	).toBe(false); // info | success | warning | danger only
	expect(ok.success && ok.data).toMatchObject({
		banner: "Sale!",
		banner_type: "warning",
		viber: "959123456",
		instagram: null,
		whatsapp: null,
		support_email: "help@shop.io",
	}); // the support email is trimmed + lowercased
	expect(
		OnlineStoreInput.safeParse({ ...raw, support_email: "not-an-email" })
			.success,
	).toBe(false);
	expect(
		OnlineStoreInput.safeParse({ ...raw, facebook: "facebook.com/x" }).success,
	).toBe(false); // the full link only
	expect(OnlineStoreInput.safeParse({ ...raw, viber: "abc" }).success).toBe(
		false,
	);
	expect(
		(await StoreService.updateSettings(S, (ok as any).data)).errors,
	).toBeUndefined();
	expect(await StoreService.settings(S)).toMatchObject({
		banner: "Sale!",
		banner_type: "warning",
		support_email: "help@shop.io",
		phone: "+95 9 111",
		address: "12 Main St",
		hours: "Mon–Fri",
		facebook: "https://facebook.com/x",
		viber: "959123456",
		instagram: "",
		whatsapp: "",
	});
	expect(await ShopRepository.find(S)).toMatchObject({
		banner: "Sale!",
		banner_type: "warning",
		viber: "959123456",
		whatsapp: null,
	}); // what pubShop prints in the storefront
	await StoreService.updateSettings(S, store()); // fields left out = off
	expect(await StoreService.settings(S)).toMatchObject({
		banner: "",
		banner_type: "info",
		support_email: "",
		phone: "",
		facebook: "",
		viber: "",
	});
});

test("payments: no gateway switched on → the checkout says so; the one that is on is the gateway extension", async () => {
	const [p] =
		await sql`insert into shops (name, currency, slug) values ('Pay Shop', 'USD', 'svc-pay') returning id`;
	const P = p.id as number;
	const payShop = () => ShopRepository.find(P).then((x) => x!);
	const pin = await ProductRepository.create(P, {
		...base,
		name: "Pay Pin",
		price: 500,
		purchase_price: null,
		track_stock: false,
		stock: 0,
	} as any);
	const cart = {
		customer: buyer,
		items: [{ product_id: pin.id, variant_id: null, qty: 1 }],
	};

	// a shop starts with no gateway at all — checkout says so in plain English, and there is nothing to pay with
	expect(await StoreService.paymentOptions(await payShop())).toEqual([]);
	expect(await StoreService.paymentLabel(await payShop())).toBe("card");
	expect(
		(
			await StoreService.checkout(
				await payShop(),
				cart,
				"http://x/store/svc-pay",
			)
		).errors?.cart,
	).toMatch(/online payments/);

	// uploaded but not configured → still off; the keys make it ready, and only then does it take money
	expect(await installPayment(P, hostedManifest(), HOSTED_MODULE)).toEqual({
		key: "fake-hosted",
	});
	expect(
		(await ExtensionService.list(P)).find((e) => e.key === "fake-hosted"),
	).toMatchObject({
		installed: true,
		enabled: false,
		ready: false,
		payment: { mode: "hosted" },
	});
	expect(
		(
			await StoreService.checkout(
				await payShop(),
				cart,
				"http://x/store/svc-pay",
			)
		).errors?.cart,
	).toMatch(/online payments/);
	expect(
		(
			await ExtensionService.save(P, "fake-hosted", {
				enabled: true,
				config: {},
			})
		).errors,
	).toEqual({ "config.secret_key": "Secret key is required" });
	expect(
		await ExtensionService.save(P, "fake-hosted", {
			enabled: true,
			config: { secret_key: "sk_live_1" },
		}),
	).toEqual({});
	// the secret is stored encrypted and handed to the gateway decrypted
	expect(
		(await sql`select config from shop_extensions where shop_id = ${P}`)[0]
			.config,
	).not.toContain("sk_live_1");
	expect(
		decrypt(
			JSON.parse(
				(await sql`select config from shop_extensions where shop_id = ${P}`)[0]
					.config,
			).secret_key,
		),
	).toBe("sk_live_1");
	expect(await StoreService.paymentOptions(await payShop())).toEqual([
		{
			key: "fake-hosted",
			label: "Credit card and other payment methods",
			manual: false,
			instructions: "",
		},
	]);
	expect(await StoreService.paymentLabel(await payShop())).toBe("Fake Hosted");
	resetPay();
	pay().id = "fk_pay_1";
	expect(
		(
			await StoreService.checkout(
				await payShop(),
				cart,
				"http://x/store/svc-pay",
			)
		).url,
	).toBe("https://gw.test/pay");
	expect(pay().checkout!.config).toEqual({ secret_key: "sk_live_1" });

	// switching it off stops the checkout but keeps the keys, and another shop is untouched
	expect(
		await ExtensionService.save(P, "fake-hosted", { enabled: false }),
	).toEqual({});
	expect(
		(
			await StoreService.checkout(
				await payShop(),
				cart,
				"http://x/store/svc-pay",
			)
		).errors?.cart,
	).toMatch(/online payments/);
	expect(
		await ExtensionService.save(P, "fake-hosted", { enabled: true }),
	).toEqual({});
	expect((await ExtensionService.running(P, "order.created")).length).toBe(0); // a gateway listens for nothing
	expect(await ExtensionService.payments(S)).toEqual([]); // payments are per shop
});

/** What the checkout page sends along with the cart. */
const buyer = {
	name: "Buyer",
	phone: "555-0100",
	email: "buyer@x.io",
	address_1: "1 Main St",
	address_2: "Apt 4",
	city: "Springfield",
	state: "IL",
	country: "United States",
	postal_code: "62701",
};

/**
 * Point the fake hosted gateway at a fresh checkout id and forget the last call.
 * @param id The checkout id the gateway hands out next.
 */
function hosted(id: string) {
	resetPay();
	pay().id = id;
}
/** What the gateway was last asked to charge. */
const charge = () => pay().checkout!.args as any;
/** What the gateway answers next time the payment is looked up. */
const paidBy = (buyer: any = null) => (pay().status = { paid: true, buyer });

test("checkout: DB-priced hosted checkout + cart snapshot; stock and payments-off guards", async () => {
	// a shop with no gateway switched on → refused
	const [bare] =
		await sql`insert into shops (name, currency, slug, online_enabled) values ('Bare', 'USD', 'svc-bare', ${true}) returning id`;
	const bareShop = (await ShopRepository.find(bare.id))!;
	expect(
		(
			await StoreService.checkout(
				bareShop,
				{
					customer: buyer,
					items: [{ product_id: mug.id, variant_id: null, qty: 1 }],
				},
				"http://x/store/svc-store",
			)
		).errors?.cart,
	).toMatch(/online payments/);
	await gateway(S);

	hosted("cs_test_1");
	// over the stock → friendly error, nothing sent to the gateway
	const over = await StoreService.checkout(
		await shop(),
		{
			customer: buyer,
			items: [{ product_id: mug.id, variant_id: null, qty: 9 }],
		},
		"http://x/store/svc-store",
	);
	expect(over.errors?.cart).toMatch(/Only 3/);
	expect(pay().checkout).toBeUndefined();

	const ok = await StoreService.checkout(
		await shop(),
		{
			customer: buyer,
			items: [
				{ product_id: mug.id, variant_id: null, qty: 2 },
				{ product_id: tee.id, variant_id: teeS.id, qty: 1 },
			],
		},
		"http://x/store/svc-store",
	);
	expect(ok.url).toBe("https://gw.test/pay");
	expect(charge().successUrl).toBe("http://x/store/svc-store/done");
	expect(charge().cancelUrl).toBe("http://x/store/svc-store");
	expect(charge().lines.map((l: any) => [l.name, l.price, l.qty])).toEqual([
		["Svc Mug", 1000, 2],
		["Svc Tee — S", 2000, 1],
	]);
	const [cart] =
		await sql`select * from store_carts where stripe_session_id = 'cs_test_1'`;
	expect(JSON.parse(cart.payload).total).toBe(4000);
	expect(JSON.parse(cart.payload).customer).toEqual(buyer); // the buyer rides in the snapshot
	expect(charge().email).toBe("buyer@x.io"); // prefilled on the gateway's page
	expect(charge().reference).toBe(String(cart.id));
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(3); // nothing taken until the payment lands
});

test("fulfill: paid session → order once (idempotent), stock through the ledger, customer attached", async () => {
	paidBy({ email: "buyer@x.io", name: "Buyer" });
	const r = await StoreService.fulfill(await shop(), "cs_test_1");
	const order = r.order!;
	expect(order.total).toBe(4000);
	expect(order.payment_method).toBe("Fake Hosted"); // the extension's name, so history survives a rename
	expect(order.items.map((i) => [i.name, i.qty, i.cost])).toEqual([
		["Svc Mug", 2, 400],
		["Svc Tee — S", 1, 800],
	]);
	expect(await StockRepository.level(sql, S, mug.id, null)).toBe(1);
	expect(await StockRepository.level(sql, S, tee.id, teeS.id)).toBe(1);
	const cust = await CustomerRepository.byEmail(S, "buyer@x.io");
	expect([cust?.name, cust?.phone]).toEqual(["Buyer", "555-0100"]); // created from the checkout form
	expect(order.customer_id).toBe(cust!.id);
	expect(order.note).toBe(
		"Deliver to: Buyer · 555-0100\n1 Main St\nApt 4\nSpringfield, IL 62701\nUnited States",
	);
	// the online cashier is a deactivated system user
	const [sys] = await sql`select * from users where id = ${order.user_id}`;
	expect([sys.name, !!sys.active]).toEqual(["Online Store", false]);
	// a second return visit shows the same order instead of creating another
	const again = await StoreService.fulfill(await shop(), "cs_test_1");
	expect(again.order!.id).toBe(order.id);
	expect(
		Number(
			(await sql`select count(*) as n from orders where shop_id = ${S}`)[0].n,
		),
	).toBe(1);
});

test("fulfill: a paid order emails the buyer when email is set up", async () => {
	const sent: any[] = [];
	const realSend = MAILERS.resend!.send; // shared process: put the real one back for the other files
	afterAll(() => {
		MAILERS.resend!.send = realSend;
	});
	MAILERS.resend!.send = async (_creds, msg) => void sent.push(msg);
	// its own untracked product, so the other tests' stock arithmetic is untouched
	const gift = await ProductRepository.create(S, {
		...base,
		name: "Svc Gift",
		price: 1500,
		purchase_price: null,
		track_stock: false,
		stock: 0,
	} as any);
	await MailService.update({
		driver: "resend",
		from_email: "noreply@svc.io",
		credentials: { resend: { api_key: "re_test" } },
	});

	hosted("cs_mail_1");
	await StoreService.checkout(
		await shop(),
		{
			customer: buyer,
			items: [{ product_id: gift.id, variant_id: null, qty: 1 }],
		},
		"http://x/store/svc-store",
	);
	paidBy({ email: "buyer@x.io", name: "Buyer" });
	const order = (await StoreService.fulfill(await shop(), "cs_mail_1")).order!;
	await Bun.sleep(20); // the confirmation is not awaited — a slow mail server must not hold up the page

	expect(sent).toHaveLength(1);
	expect(sent[0].to).toBe("buyer@x.io");
	expect(sent[0].from).toBe("Svc Store <noreply@svc.io>"); // the shop's name, the platform's one address
	expect(sent[0].subject).toBe(`Order ${order.reference} — Svc Store`); // the public code, never the id
	expect(sent[0].text).toContain("Thanks for your order, Buyer!");
	expect(sent[0].text).toContain("1 × Svc Gift");
	expect(sent[0].text).toContain("Total: $15");
	expect(sent[0].text).toContain("Paid with Fake Hosted");
	expect(sent[0].text).toContain("1 Main St"); // the delivery address rides along
	expect(sent[0].html).toContain("1 × Svc Gift");
	expect(sent[0].html).toContain(`Order ${order.reference}`); // rendered from resources/views/emails/order.edge

	// returning to /done again shows the order but doesn't email a second time
	await StoreService.fulfill(await shop(), "cs_mail_1");
	await Bun.sleep(20);
	expect(sent).toHaveLength(1);

	// with email switched off nothing is sent and the order still goes through
	await MailService.update({
		driver: "",
		from_email: "",
		credentials: {},
	});
	hosted("cs_mail_2");
	await StoreService.checkout(
		await shop(),
		{
			customer: buyer,
			items: [{ product_id: gift.id, variant_id: null, qty: 1 }],
		},
		"http://x/store/svc-store",
	);
	paidBy();
	expect(
		(await StoreService.fulfill(await shop(), "cs_mail_2")).order,
	).toBeDefined();
	await Bun.sleep(20);
	expect(sent).toHaveLength(1);
});

test("fulfill: unpaid stays pending; a stock race still records the paid order (without taking stock)", async () => {
	hosted("cs_test_2");
	expect(
		(
			await StoreService.checkout(
				await shop(),
				{
					customer: buyer,
					items: [{ product_id: mug.id, variant_id: null, qty: 1 }],
				},
				"http://x/store/svc-store",
			)
		).url,
	).toBeDefined();
	expect((await StoreService.fulfill(await shop(), "cs_test_2")).pending).toBe(
		true,
	);
	// meanwhile the last mug sells at the counter
	await sql`update products set stock = 0 where id = ${mug.id}`;
	paidBy();
	const r = await StoreService.fulfill(await shop(), "cs_test_2");
	expect(r.order).toBeDefined();
	expect(r.order!.customer_id).not.toBeNull(); // the checkout form's buyer is attached even when the gateway has no record
	expect(
		Number(
			(await sql`select stock from products where id = ${mug.id}`)[0].stock,
		),
	).toBe(0); // never negative
	expect(
		(await StoreService.fulfill(await shop(), "cs_missing")).error,
	).toBeDefined();
});

test("fulfill: the order gets its own shrunk copy of the picture; a cart that is only priced leaves no file", async () => {
	const { UPLOAD_DIR } = await import("@constants/Storage.Constant");
	const dot = Uint8Array.fromBase64(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	);
	const picture = `/uploads/${Bun.randomUUIDv7()}.png`;
	await Bun.write(
		`${UPLOAD_DIR}${picture}`,
		await new Bun.Image(dot).resize(600, 300, { fit: "fill" }).png().bytes(),
	);
	const framed = await ProductRepository.create(S, {
		...base,
		name: "Svc Framed",
		price: 1200,
		purchase_price: null,
		track_stock: false,
		stock: 0,
		images: [picture],
	} as any);
	/**
	 * How many order pictures sit in the upload folder.
	 * @returns The count.
	 */
	async function orderFiles() {
		return (
			await Array.fromAsync(new Bun.Glob("uploads/*/orders/*").scan(UPLOAD_DIR))
		).length;
	}
	const before = await orderFiles();
	hosted("cs_img_1");
	await StoreService.checkout(
		await shop(),
		{
			customer: buyer,
			items: [{ product_id: framed.id, variant_id: null, qty: 1 }],
		},
		"http://x/store/svc-store",
	);
	expect(await orderFiles()).toBe(before); // priced but not paid: no copy yet
	paidBy({ email: "buyer@x.io", name: "Buyer" });
	const order = (await StoreService.fulfill(await shop(), "cs_img_1")).order!;
	const image = order.items[0]!.image!;
	expect(image).toMatch(/^\/uploads\/\d+\/orders\/.+\.png$/);
	expect(image).not.toBe(picture);
	expect(await orderFiles()).toBe(before + 1);
	const { width, height } = await new Bun.Image(
		await Bun.file(`${UPLOAD_DIR}${image}`).bytes(),
	).metadata();
	expect([width, height]).toEqual([224, 112]);
});

test("store pages: sanitised on save, slug unique per shop, update + delete", async () => {
	const r = await StoreService.savePage(S, null, {
		title: "About us",
		slug: "about",
		body: `<h2 onclick="x()">Hi</h2><script>evil()</` + `script><p>Welcome</p>`,
		css: "h2{color:red}",
	});
	expect(r.errors).toBeUndefined();
	const page = (await StorePageRepository.findBySlug(S, "about"))!;
	expect(page.body).toBe("<h2>Hi</h2><p>Welcome</p>");
	expect(page.css).toBe("h2{color:red}");
	expect(await StorePageRepository.links(S)).toEqual([
		{ slug: "about", title: "About us" },
	]);
	// duplicate slug refused for this shop; a different shop can use it
	expect(
		(
			await StoreService.savePage(S, null, {
				title: "Dup",
				slug: "about",
				body: "",
				css: "",
			})
		).errors?.slug,
	).toMatch(/already used/);
	const [ps] =
		await sql`insert into shops (name, currency, slug) values ('Pages Other', 'USD', 'svc-pages-other') returning id`;
	expect(
		(
			await StoreService.savePage(ps.id, null, {
				title: "About",
				slug: "about",
				body: "",
				css: "",
			})
		).errors,
	).toBeUndefined();
	// update keeps its own slug; unknown/foreign ids are refused
	expect(
		(
			await StoreService.savePage(S, page.id, {
				title: "Our story",
				slug: "about",
				body: "<p>New</p>",
				css: "",
			})
		).errors,
	).toBeUndefined();
	expect((await StorePageRepository.findBySlug(S, "about"))!.title).toBe(
		"Our story",
	);
	expect(
		(
			await StoreService.savePage(S, 999999, {
				title: "X",
				slug: "x-p",
				body: "",
				css: "",
			})
		).errors?.title,
	).toMatch(/not found/);
	await StorePageRepository.delete(page.id, S);
	expect(await StorePageRepository.findBySlug(S, "about")).toBeNull();
});

test("packages: the storefront sees the slots, checkout resolves the pick and the paid order takes component stock", async () => {
	const pen = await ProductRepository.create(S, {
		...base,
		name: "Svc Pen",
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
				stock: 24,
			},
			{
				name: "Blue",
				price: 250,
				purchase_price: null,
				attributes: null,
				barcode: null,
				images: [],
				stock: 0,
			},
		],
	} as any);
	const [red, blue] = (await ProductRepository.find(pen.id, S))!.variants;
	const pack = await ProductRepository.create(S, {
		...base,
		name: "Svc Dozen",
		price: 2800,
		purchase_price: null,
		track_stock: false,
		stock: 0,
		kind: "bundle",
		bundle_items: [
			{ product_id: pen.id, variant_ids: [red!.id, blue!.id], qty: 12 },
		],
	} as any);
	const sold = await ProductRepository.create(S, {
		...base,
		name: "Svc Blue Dozen",
		price: 2800,
		purchase_price: null,
		track_stock: false,
		stock: 0,
		kind: "bundle",
		bundle_items: [{ product_id: pen.id, variant_ids: [blue!.id], qty: 12 }],
	} as any);

	const cat = await StoreService.catalog(S);
	const p = cat.find((x) => x.id === pack.id)!;
	expect([p.kind, p.stock, p.sold_out, p.variants.length]).toEqual([
		"bundle",
		2,
		false,
		0,
	]); // 24 Red / 12
	expect(
		p.bundle_items.map((b) => [
			b.name,
			b.qty,
			b.options.map((o) => [o.name, o.stock]),
		]),
	).toEqual([
		[
			"Svc Pen",
			12,
			[
				["Red", 24],
				["Blue", 0],
			],
		],
	]);
	expect(cat.find((x) => x.id === sold.id)!.sold_out).toBe(true); // nothing can fill the slot
	expect(cat.find((x) => x.id === pen.id)!.kind).toBe("item");
	expect(JSON.stringify(cat)).not.toContain("purchase_price"); // component costs stay server-side

	hosted("cs_pack_1");
	const slot = p.bundle_items[0]!;
	const line = (choices?: Record<string, number>) =>
		({
			customer: buyer,
			items: [{ product_id: pack.id, variant_id: null, qty: 1, choices }],
		}) as any;
	expect(
		(
			await StoreService.checkout(
				await shop(),
				line(),
				"http://x/store/svc-store",
			)
		).errors?.cart,
	).toMatch(/Choose an option/);
	expect(
		(
			await StoreService.checkout(
				await shop(),
				line({ [slot.id]: red!.id }),
				"http://x/store/svc-store",
			)
		).url,
	).toBe("https://gw.test/pay");

	// a switched-off component takes the package off the store, the POS and both checkouts
	await ProductRepository.setActive(pen.id, S, false);
	expect((await StoreService.catalog(S)).some((x) => x.id === pack.id)).toBe(
		false,
	);
	const pos = await ProductRepository.pageForShop(S, "Svc", 1, 50, {
		active: true,
	});
	expect(pos.data.some((x) => x.id === pack.id)).toBe(false);
	expect(
		await ProductRepository.priceLine(pack.id, null, S, {
			[slot.id]: red!.id,
		}),
	).toEqual({ error: expect.stringMatching(/no longer available/) });
	await ProductRepository.setActive(pen.id, S, true);
	expect((await StoreService.catalog(S)).some((x) => x.id === pack.id)).toBe(
		true,
	);
	expect(charge().lines.map((l: any) => [l.name, l.price])).toEqual([
		["Svc Dozen (12 × Red)", 2800],
	]);

	// the cart snapshot keeps the resolved components, so fulfilling takes them off the shelf
	paidBy();
	const order = (await StoreService.fulfill(await shop(), "cs_pack_1")).order!;
	expect(order.items[0]!.components).toEqual([
		{ product_id: pen.id, variant_id: red!.id, qty: 12 },
	]);
	expect(order.items[0]!.cost).toBe(120 * 12);
	expect(await StockRepository.level(sql, S, pen.id, red!.id)).toBe(12);
});

test("delivery: the zones decide the fee, undeliverable addresses are refused, and the order carries it", async () => {
	const US = {
		name: "Domestic",
		countries: ["United States"],
		states: [],
		cities: [],
		fee: 200,
		free_delivery_min: null,
	};
	const setZones = (id: number, zones: object[]) =>
		sql`update shops set delivery_zones = ${JSON.stringify(zones)} where id = ${id}`;
	const [d] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, country, delivery_zones)
    values ('Del Store', 'USD', 'UTC', 'svc-del', ${true}, 'United States', ${JSON.stringify([US])}) returning id`;
	const D = d.id as number;
	const delShop = () => ShopRepository.find(D).then((x) => x!);
	await StoreService.updateSettings(D, {
		enabled: true,
		slug: "svc-del",
		domain: null,
		google_site_verification: null,
		template: "classic",
		credentials: {},
	});
	await gateway(D);
	const pen = await ProductRepository.create(D, {
		...base,
		name: "Del Pen",
		price: 1000,
		purchase_price: 300,
		track_stock: false,
		stock: 0,
	} as any);
	const cart = { items: [{ product_id: pen.id, variant_id: null, qty: 2 }] }; // subtotal 2000

	hosted("cs_del_1");
	expect(
		(
			await StoreService.checkout(
				await delShop(),
				{ ...cart, customer: buyer },
				"http://x/store/svc-del",
			)
		).url,
	).toBeDefined();
	expect(charge().lines.map((l: any) => [l.name, l.price, l.qty])).toEqual([
		["Del Pen", 1000, 2],
		["Delivery", 200, 1],
	]);
	const snap = JSON.parse(
		(
			await sql`select * from store_carts where stripe_session_id = 'cs_del_1'`
		)[0].payload,
	);
	expect([snap.subtotal, snap.delivery_fee, snap.total]).toEqual([
		2000, 200, 2200,
	]);

	// abroad, with no zone for it → refused as a field error on the country box, nothing sent to the gateway
	hosted("cs_del_x");
	const abroad = { ...buyer, country: "Japan" };
	const no = await StoreService.checkout(
		await delShop(),
		{ ...cart, customer: abroad },
		"http://x/store/svc-del",
	);
	expect(no.errors).toEqual({
		"customer.country": "We don't deliver to Japan",
	});
	expect(pay().checkout).toBeUndefined();

	// …once a rest-of-world zone exists that same address is charged its price
	await setZones(D, [
		US,
		{
			name: "Rest of world",
			countries: [],
			states: [],
			cities: [],
			fee: 500,
			free_delivery_min: null,
		},
	]);
	hosted("cs_del_2");
	expect(
		(
			await StoreService.checkout(
				await delShop(),
				{ ...cart, customer: abroad },
				"http://x/store/svc-del",
			)
		).url,
	).toBeDefined();
	expect(charge().lines.at(-1).price).toBe(500);

	// the paid order keeps the fee: total = subtotal + fee
	paidBy();
	const order = (await StoreService.fulfill(await delShop(), "cs_del_2"))
		.order!;
	expect([order.subtotal, order.delivery_fee, order.total, order.paid]).toEqual(
		[2000, 500, 2500, 2500],
	);

	// a lone rest-of-world zone charges its price everywhere, and a 0 fee adds no gateway line
	await setZones(D, [
		{
			name: "Everywhere",
			countries: [],
			states: [],
			cities: [],
			fee: 0,
			free_delivery_min: null,
		},
	]);
	hosted("cs_del_3");
	expect(
		(
			await StoreService.checkout(
				await delShop(),
				{ ...cart, customer: abroad },
				"http://x/store/svc-del",
			)
		).url,
	).toBeDefined();
	expect(charge().lines.length).toBe(1);
	await setZones(D, [
		{
			name: "Everywhere",
			countries: [],
			states: [],
			cities: [],
			fee: 150,
			free_delivery_min: null,
		},
	]);
	hosted("cs_del_4");
	await StoreService.checkout(
		await delShop(),
		{ ...cart, customer: abroad },
		"http://x/store/svc-del",
	);
	expect(charge().lines.at(-1).price).toBe(150);

	// a country covered only by a city zone: another city there is the city box's problem, not the country's
	await setZones(D, [
		{
			name: "Springfield",
			countries: ["United States"],
			states: [],
			cities: ["Springfield"],
			fee: 100,
			free_delivery_min: null,
		},
	]);
	expect(
		(
			await StoreService.checkout(
				await delShop(),
				{ ...cart, customer: { ...buyer, city: "Shelbyville" } },
				"http://x/store/svc-del",
			)
		).errors,
	).toEqual({ "customer.city": "We don't deliver to Shelbyville" });
	// …and a country covered only by a state zone: the state box's (the whole state ships at one price, whatever the city)
	await setZones(D, [
		{
			name: "Illinois",
			countries: ["United States"],
			states: ["Illinois"],
			cities: [],
			fee: 120,
			free_delivery_min: null,
		},
	]);
	expect(
		(
			await StoreService.checkout(
				await delShop(),
				{ ...cart, customer: { ...buyer, state: "Texas" } },
				"http://x/store/svc-del",
			)
		).errors,
	).toEqual({ "customer.state": "We don't deliver to Texas" });
	hosted("cs_del_5");
	await StoreService.checkout(
		await delShop(),
		{ ...cart, customer: { ...buyer, state: "illinois", city: "Anywhere" } },
		"http://x/store/svc-del",
	);
	expect(charge().lines.at(-1).price).toBe(120);
	await setZones(D, []); // no zones at all = nothing is delivered
	expect(
		(
			await StoreService.checkout(
				await delShop(),
				{ ...cart, customer: buyer },
				"http://x/store/svc-del",
			)
		).errors,
	).toEqual({ "customer.country": "We don't deliver to United States" });
});

test("delivery zones: the most specific zone wins, free from its threshold; pick up in store; city zones match on the postal code", async () => {
	const { deliveryFee, deliveryZone, deliveryCountries, undeliverable } =
		await import("@validators/StoreCustomer.Validator");
	// the rule itself: a zone naming the city beats one naming the country beats the rest of the world; free from the
	// zone's own threshold, else its fee (city any case, spaces trimmed); no zone for the address = not delivered
	const zones = [
		{
			name: "Rest of world",
			countries: [],
			states: [],
			cities: [],
			fee: 900,
			free_delivery_min: null,
		},
		{
			name: "Domestic",
			countries: ["United States"],
			states: [],
			cities: [],
			fee: 200,
			free_delivery_min: 5000,
		},
		{
			name: "Springfield",
			countries: ["United States"],
			states: [],
			cities: ["Springfield", "Ogdenville"],
			fee: 100,
			free_delivery_min: 5000,
		},
		{
			name: "Illinois",
			countries: ["United States"],
			states: ["Illinois"],
			cities: [],
			fee: 150,
			free_delivery_min: null,
		},
	];
	const rules = { delivery_zones: zones };
	const at = (city: string, state = "Texas", country = "United States") => ({
		country,
		state,
		city,
	});
	expect(deliveryFee(rules, at("Shelbyville"), 1000)).toBe(200);
	expect(deliveryFee(rules, at(" springfield "), 1000)).toBe(100);
	expect(deliveryFee(rules, at("ogdenville"), 1000)).toBe(100); // any city of the zone
	expect(deliveryFee(rules, at("Shelbyville"), 5000)).toBe(0);
	expect(deliveryFee(rules, at("Chicago", " illinois "), 1000)).toBe(150); // the state zone, any city of it, any case
	expect(deliveryFee(rules, at("Springfield", "Illinois"), 1000)).toBe(100); // …but a city zone beats it
	expect(deliveryFee(rules, at("Chicago", "Illinois"), 99999)).toBe(150); // the state zone has no threshold of its own
	expect(deliveryFee(rules, at("Springfield", "", "Japan"), 9000)).toBe(900); // the city zone is inside the US only; the rest of the world has no threshold
	expect(
		deliveryFee({ delivery_zones: zones.slice(1) }, at("", "", "Japan"), 9000),
	).toBeNull();
	expect(deliveryFee({ delivery_zones: [] }, at(""), 1)).toBeNull();
	expect(deliveryZone(zones, at("", "", "Japan"))?.name).toBe("Rest of world");
	// what the checkout's country box offers, and what it says when an address is out of reach
	expect(deliveryCountries(zones)).toBeNull();
	expect(deliveryCountries(zones.slice(1))).toEqual(["United States"]);
	expect(
		deliveryCountries([
			{ ...zones[1]!, countries: ["Japan", "Canada"] },
			zones[2]!,
		]),
	).toEqual(["Canada", "Japan", "United States"]);
	expect(undeliverable(zones, at("", "", "Japan"))).toBeNull();
	expect(undeliverable(zones.slice(1), at("Tokyo", "", "Japan"))).toEqual({
		field: "country",
		key: "store.validation_no_delivery",
		params: { place: "Japan" },
	});
	expect(
		undeliverable(zones.slice(2), at("Shelbyville", "Illinois")),
	).toBeNull(); // the Illinois zone takes any city of it
	expect(
		undeliverable(zones.slice(2, 3), at("Shelbyville", "Illinois")),
	).toEqual({
		field: "city",
		key: "store.validation_no_delivery",
		params: { place: "Shelbyville" },
	}); // only a city zone names the US
	expect(undeliverable(zones.slice(3), at("Shelbyville"))).toEqual({
		field: "state",
		key: "store.validation_no_delivery",
		params: { place: "Texas" },
	}); // only the Illinois zone names the US
	expect(undeliverable([], { country: "", state: "", city: "" })).toEqual({
		field: "country",
		key: "store.validation_no_delivery_country",
	});

	const [o] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, country, delivery_zones)
    values ('Opt Store', 'USD', 'UTC', 'svc-delopt', ${true}, 'United States', ${JSON.stringify(zones.slice(1, 3))}) returning id`;
	const O = o.id as number;
	const oShop = () => ShopRepository.find(O).then((x) => x!);
	await StoreService.updateSettings(O, {
		enabled: true,
		slug: "svc-delopt",
		domain: null,
		google_site_verification: null,
		template: "classic",
		manual_gateways: ["cod"],
		credentials: {},
	});
	const mug = await ProductRepository.create(O, {
		...base,
		name: "Opt Mug",
		price: 1000,
		purchase_price: 300,
		track_stock: false,
		stock: 0,
	} as any);
	const items = (qty: number) => [
		{ product_id: mug.id, variant_id: null, qty },
	];
	const url = "http://x/store/svc-delopt";
	const placed = async (input: Parameters<typeof StoreService.checkout>[1]) => {
		const r = await StoreService.checkout(await oShop(), input, url);
		expect(r.errors).toBeUndefined();
		return (
			await StoreService.fulfill(
				await oShop(),
				new URL(r.url!).searchParams.get("sid")!,
			)
		).order!;
	};

	// the buyer's city (Springfield) has its own zone; another city takes the country's; $50 of goods ships free
	expect(
		(await placed({ items: items(2), customer: buyer, payment: "cod" }))
			.delivery_fee,
	).toBe(100);
	expect(
		(
			await placed({
				items: items(2),
				customer: { ...buyer, city: "Shelbyville" },
				payment: "cod",
			})
		).delivery_fee,
	).toBe(200);
	const free = await placed({
		items: items(5),
		customer: { ...buyer, city: "Shelbyville" },
		payment: "cod",
	});
	expect([free.delivery_fee, free.total]).toEqual([0, 5000]);
	// …and a free-delivery code has nothing left to waive then
	await sql`insert into coupons (shop_id, code, description, type, value, min_subtotal, max_discount, starts_at, ends_at, usage_limit, per_customer_limit, product_ids, category_ids, emails, active)
    values (${O}, 'SHIPFREE', '', 'free_delivery', 0, 0, null, null, null, null, null, '[]', '[]', '[]', ${true})`;
	expect(
		(
			await StoreService.quote(await oShop(), {
				items: items(5),
				coupon: "SHIPFREE",
				email: "",
				country: "United States",
				state: "IL",
				city: "Shelbyville",
				postal_code: "",
				pickup: false,
			})
		).errors?.coupon,
	).toMatch(/already free/);
	expect(
		(
			await StoreService.quote(await oShop(), {
				items: items(2),
				coupon: "SHIPFREE",
				email: "",
				country: "United States",
				state: "IL",
				city: "Shelbyville",
				postal_code: "",
				pickup: false,
			})
		).quote?.delivery_fee,
	).toBe(0);

	// pick up in store: ignored while the shop doesn't offer it (the address still prices the order)…
	const noPickup = await placed({
		items: items(2),
		customer: { ...buyer, city: "Shelbyville" },
		payment: "cod",
		pickup: true,
	});
	expect([
		noPickup.delivery_fee,
		noPickup.note.startsWith("Deliver to:"),
	]).toEqual([200, true]);
	// …and once it does (the Delivery section's own save), the fee is 0 with no address needed and the note says who collects
	await StoreService.updateDelivery(O, {
		country: "United States",
		pickup: true,
		guided_address: false,
		delivery_zones: zones.slice(1, 3),
	});
	expect(await StoreService.settings(O)).toMatchObject({
		country: "United States",
		pickup: true,
		guided_address: false,
		delivery_zones: zones.slice(1, 3),
	});
	const collect = await placed({
		items: items(2),
		customer: {
			...buyer,
			address_1: "",
			city: "",
			state: "",
			country: "",
			postal_code: "",
		},
		payment: "cod",
		pickup: true,
	});
	expect([collect.delivery_fee, collect.total, collect.note]).toEqual([
		0,
		2000,
		"Pick up in store: Buyer · 555-0100",
	]);
	// with its address set, the note also says where to collect it
	await sql`update shops set address = ${"12 Market St, Springfield"} where id = ${O}`;
	const atShop = await placed({
		items: items(1),
		customer: {
			...buyer,
			address_1: "",
			city: "",
			state: "",
			country: "",
			postal_code: "",
		},
		payment: "cod",
		pickup: true,
	});
	expect(atShop.note).toBe(
		"Pick up in store: Buyer · 555-0100\nPick up at: 12 Market St, Springfield",
	);
	await sql`update shops set address = null where id = ${O}`;
	// cash on delivery with nothing delivered is paid at pick-up
	expect([noPickup.payment_method, collect.payment_method]).toEqual([
		"Cash on delivery",
		"Pay at pick-up",
	]);
	expect(
		(
			await StoreService.quote(await oShop(), {
				items: items(2),
				coupon: "SHIPFREE",
				email: "",
				country: "",
				state: "",
				city: "",
				postal_code: "",
				pickup: true,
			})
		).errors?.coupon,
	).toMatch(/already free/);

	// with the country's postal codes downloaded, a city zone matches on the buyer's postal code — however the city is spelled
	await sql`insert into postal_codes (country, postal_code, place, admin1) values ('US', '62701', 'Springfield', 'Illinois'), ('US', '62701', 'Downtown Springfield', 'Illinois'), ('US', '60601', 'Chicago', 'Illinois')`;
	await sql`update shops set pickup = ${false} where id = ${O}`;
	expect(
		(
			await placed({
				items: items(2),
				customer: { ...buyer, city: "springfeld (typo)", postal_code: "62701" },
				payment: "cod",
			})
		).delivery_fee,
	).toBe(100); // 62701 → Springfield → its zone
	expect(
		(
			await placed({
				items: items(2),
				customer: { ...buyer, city: "Springfield", postal_code: "60601" },
				payment: "cod",
			})
		).delivery_fee,
	).toBe(200); // the code says Chicago, whatever the city box says
	expect(
		(
			await placed({
				items: items(2),
				customer: { ...buyer, city: "Springfield", postal_code: "00000" },
				payment: "cod",
			})
		).delivery_fee,
	).toBe(100); // an unknown code → the typed city
	expect(
		(
			await placed({
				items: items(2),
				customer: { ...buyer, city: "springfield ", postal_code: "" },
				payment: "cod",
			})
		).delivery_fee,
	).toBe(100); // no postal code at all (Myanmar…) → the typed city name
	expect(
		(
			await placed({
				items: items(2),
				customer: { ...buyer, city: "Shelbyville", postal_code: "" },
				payment: "cod",
			})
		).delivery_fee,
	).toBe(200);
	expect(
		(
			await StoreService.quote(await oShop(), {
				items: items(2),
				coupon: "SHIPFREE",
				email: "",
				country: "United States",
				state: "IL",
				city: "Anywhere",
				postal_code: "62701",
				pickup: false,
			})
		).quote?.delivery_fee,
	).toBe(0);
	await sql`delete from postal_codes where country = 'US'`;
});

test("tokenize gateway: the browser gets the payload and the script, the nonce is charged server-side, and /done writes the order once", async () => {
	const [o] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Tok Store', 'THB', 'UTC', 'svc-tok', ${true}) returning id`;
	const O = o.id as number;
	const tokShop = () => ShopRepository.find(O).then((x) => x!);
	await gateway(O, "tokenize", {
		public_key: "pkey_test_1",
		secret_key: "skey_test_secret",
	});

	resetPay();
	pay().methods = ["promptpay", "rabbit_linepay"]; // every method the account switched on, not just card
	const tea = await ProductRepository.create(O, {
		...base,
		name: "Tok Tea",
		price: 12000,
		purchase_price: 5000,
		track_stock: true,
		stock: 2,
	} as any);
	const items = [{ product_id: tea.id, variant_id: null, qty: 2 }]; // 2 × ฿120.00 = 24000 satang
	const r = await StoreService.checkout(
		await tokShop(),
		{ customer: buyer, items } as any,
		"http://x/store/svc-tok",
	);
	expect(r.url).toBeUndefined(); // no hosted page — the gateway's own form opens in the browser
	const t = r.tokenize!;
	expect([t.gateway, t.public_key, t.amount, t.currency]).toEqual([
		"fake-tokenize",
		"pkey_test_1",
		24000,
		"THB",
	]);
	expect(t.ref).toMatch(/^fake-tokenize_[0-9a-f]{32}$/); // our own session key: the provider has no id yet
	expect(t.methods).toEqual(["promptpay", "rabbit_linepay"]);
	expect(t.script).toBe(
		"/store/svc-tok/ext/fake-tokenize/assets/checkout.js?v=1.0.0",
	); // always the slug path
	expect((t as any).secret_key).toBeUndefined(); // only the public field reaches the browser
	// a methods lookup that fails must never stop someone paying by card
	pay().methodsFail = true;
	expect(
		(
			await StoreService.checkout(
				await tokShop(),
				{ customer: buyer, items } as any,
				"http://x/store/svc-tok",
			)
		).tokenize!.methods,
	).toEqual([]);
	pay().methodsFail = false;

	const snap = async () =>
		JSON.parse(
			(
				await sql`select * from store_carts where stripe_session_id = ${t.ref}`
			)[0].payload,
		);
	expect([(await snap()).total, (await snap()).charge_id]).toEqual([
		24000,
		undefined,
	]);
	expect(await StockRepository.level(sql, O, tea.id, null)).toBe(2); // nothing taken until the charge lands
	// back on /done before anything was submitted → nothing to verify yet
	expect(await StoreService.fulfill(await tokShop(), t.ref)).toEqual({
		pending: true,
	});

	// pay: the amount comes from the snapshot, never the client; 3-D Secure routes through the gateway's URL
	pay().chargeId = "chrg_test_1";
	pay().chargeUrl = "https://gw.test/3ds";
	const paid = await StoreService.pay(
		await tokShop(),
		t.ref,
		"tokn_test_abc123456",
		"http://x/store/svc-tok",
	);
	expect([paid.url, paid.qr]).toEqual(["https://gw.test/3ds", undefined]);
	expect(pay().charged!.config).toEqual({
		public_key: "pkey_test_1",
		secret_key: "skey_test_secret",
	}); // decrypted for the gateway
	expect(pay().charged!.args).toMatchObject({
		token: "tokn_test_abc123456",
		amount: 24000,
		currency: "THB",
		reference: t.ref,
		returnUri: `http://x/store/svc-tok/done?sid=${t.ref}`,
	});
	expect((await snap()).charge_id).toBe("chrg_test_1");

	// a charge that hasn't answered yet keeps the page waiting — no order, no stock movement
	pay().status = { paid: false, buyer: null };
	expect((await StoreService.fulfill(await tokShop(), t.ref)).pending).toBe(
		true,
	);
	expect(pay().looked!.id).toBe("chrg_test_1"); // looked up by the charge, not by our ref
	// one that is done for says so instead, with the provider's reason — a waiting page would never resolve
	pay().status = {
		paid: false,
		buyer: null,
		failed: true,
		reason: "Insufficient funds",
	};
	expect(await StoreService.fulfill(await tokShop(), t.ref)).toEqual({
		failed: true,
		reason: "Insufficient funds",
	});
	pay().status = { paid: false, buyer: null, failed: true };
	expect(await StoreService.fulfill(await tokShop(), t.ref)).toEqual({
		failed: true,
		reason: null,
	});
	// nothing at all is recorded for a payment that failed: no order row, no stock moved, cart still unclaimed
	expect(
		Number(
			(await sql`select count(*) as n from orders where shop_id = ${O}`)[0].n,
		),
	).toBe(0);
	expect(await StockRepository.level(sql, O, tea.id, null)).toBe(2);
	expect(
		(
			await sql`select order_id from store_carts where stripe_session_id = ${t.ref}`
		)[0].order_id,
	).toBeNull();

	// paid → the order is written exactly once, and the buyer we asked on our own page beats the card's name
	pay().status = { paid: true, buyer: { name: "TOK CARDHOLDER" } };
	const order = (await StoreService.fulfill(await tokShop(), t.ref)).order!;
	expect([order.total, order.payment_method]).toEqual([24000, "Fake Tokenize"]);
	expect(order.items.map((i) => [i.name, i.qty, i.cost])).toEqual([
		["Tok Tea", 2, 5000],
	]);
	expect(await StockRepository.level(sql, O, tea.id, null)).toBe(0);
	expect((await CustomerRepository.byEmail(O, "buyer@x.io"))!.name).toBe(
		"Buyer",
	);
	expect((await StoreService.fulfill(await tokShop(), t.ref)).order!.id).toBe(
		order.id,
	);
	expect(
		Number(
			(await sql`select count(*) as n from orders where shop_id = ${O}`)[0].n,
		),
	).toBe(1);
	// …and that session can't be charged again
	expect(
		(
			await StoreService.pay(
				await tokShop(),
				t.ref,
				"tokn_test_abc123456",
				"http://x/store/svc-tok",
			)
		).errors?.cart,
	).toMatch(/Unknown checkout session/);
	expect(
		(
			await StoreService.pay(
				await tokShop(),
				"fake-tokenize_nope",
				"tokn_test_abc123456",
				"http://x/store/svc-tok",
			)
		).errors?.cart,
	).toMatch(/Unknown checkout session/);

	// a QR method redirects nowhere: the charge carries a code, so `pay` keeps it on the snapshot and /done shows it
	const pot = await ProductRepository.create(O, {
		...base,
		name: "Tok Pot",
		price: 30000,
		purchase_price: null,
		track_stock: false,
		stock: 0,
	} as any);
	const t2 = (
		await StoreService.checkout(
			await tokShop(),
			{
				customer: buyer,
				items: [{ product_id: pot.id, variant_id: null, qty: 1 }],
			} as any,
			"http://x/store/svc-tok",
		)
	).tokenize!;
	pay().chargeId = "chrg_test_2";
	pay().chargeUrl = null;
	pay().qr = "https://gw.test/qr.svg";
	const qrPay = await StoreService.pay(
		await tokShop(),
		t2.ref,
		"src_test_xyz987654",
		"http://x/store/svc-tok",
	);
	expect([qrPay.qr, qrPay.url]).toEqual([
		"https://gw.test/qr.svg",
		`http://x/store/svc-tok/done?sid=${t2.ref}`,
	]);
	pay().status = { paid: false, buyer: null };
	expect(await StoreService.fulfill(await tokShop(), t2.ref)).toEqual({
		pending: true,
		qr: "https://gw.test/qr.svg",
	});
	// scanned → the order lands, and the QR is gone from the answer
	pay().status = { paid: true, buyer: null };
	const qrOrder = await StoreService.fulfill(await tokShop(), t2.ref);
	expect([qrOrder.qr, qrOrder.order!.total]).toEqual([undefined, 30000]);

	// …and a charge with no code at all just sends the buyer straight to /done
	const t3 = (
		await StoreService.checkout(
			await tokShop(),
			{
				customer: buyer,
				items: [{ product_id: pot.id, variant_id: null, qty: 1 }],
			} as any,
			"http://x/store/svc-tok",
		)
	).tokenize!;
	pay().chargeId = "chrg_test_3";
	delete pay().qr;
	const plain = await StoreService.pay(
		await tokShop(),
		t3.ref,
		"src_test_xyz987654",
		"http://x/store/svc-tok",
	);
	expect([plain.qr, plain.url]).toEqual([
		undefined,
		`http://x/store/svc-tok/done?sid=${t3.ref}`,
	]);
	// a buyer-facing failure from the gateway ("GatewayError") is shown as it is, not a 500
	pay().fail = "Your card was declined";
	expect(
		(
			await StoreService.pay(
				await tokShop(),
				t3.ref,
				"tokn_test_abc123456",
				"http://x/store/svc-tok",
			)
		).errors?.cart,
	).toBe("Your card was declined");
	delete pay().fail;
});

test("manual payments: built in, switched on next to the gateway extension, the buyer picks one, the order is written unpaid and can be tracked", async () => {
	const [m] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Manual Store', 'USD', 'UTC', 'svc-manual', ${true}) returning id`;
	const M = m.id as number;
	const mShop = () => ShopRepository.find(M).then((x) => x!);
	const settings = (over: any = {}) =>
		StoreService.updateSettings(M, {
			enabled: true,
			slug: "svc-manual",
			domain: null,
			google_site_verification: null,
			template: "classic",
			manual_gateways: [],
			credentials: {},
			...over,
		});
	const pen = await ProductRepository.create(M, {
		...base,
		name: "Manual Pen",
		price: 300,
		purchase_price: 100,
		track_stock: true,
		stock: 5,
	} as any);
	const items = [{ product_id: pen.id, variant_id: null, qty: 2 }];

	// settings: unknown keys are refused, bank transfer needs its details before it can be switched on
	expect(
		(await settings({ manual_gateways: ["nope"] })).errors?.gateway,
	).toMatch(/Unknown payment option/);
	expect(
		(await settings({ manual_gateways: ["bank_transfer"] })).errors?.[
			"credentials.bank_transfer.instructions"
		],
	).toMatch(/required/);
	// COD needs nothing; the buyer's choice is refused until it's switched on
	expect(
		(
			await StoreService.checkout(
				await mShop(),
				{ customer: buyer, items, payment: "cod" },
				"http://x/store/svc-manual",
			)
		).errors?.cart,
	).toMatch(/isn't available/);
	expect(
		(
			await settings({
				manual_gateways: ["cod", "bank_transfer", "cod"],
				credentials: { bank_transfer: { instructions: "KBank 123-4" } },
			})
		).errors,
	).toBeUndefined();
	expect((await mShop()).manual_gateways).toEqual(["cod", "bank_transfer"]); // de-duplicated, in the order given
	expect((await StoreService.settings(M)).manual_gateways).toEqual([
		"cod",
		"bank_transfer",
	]);
	expect(await StoreService.paymentOptions(await mShop())).toEqual([
		{ key: "cod", label: "Cash on delivery", manual: true, instructions: "" },
		{
			key: "bank_transfer",
			label: "Bank transfer",
			manual: true,
			instructions: "KBank 123-4",
		},
	]);
	// the gateway extension (when on) comes first, and names the "Secure payment by …" line
	await gateway(M);
	expect(
		(await StoreService.paymentOptions(await mShop())).map((o) => o.key),
	).toEqual(["fake-hosted", "cod", "bank_transfer"]);
	expect(await StoreService.paymentLabel(await mShop())).toBe("Fake Hosted");
	// no payment picked → the online gateway, as before
	hosted("cs_manual_1");
	expect(
		(
			await StoreService.checkout(
				await mShop(),
				{ customer: buyer, items },
				"http://x/store/svc-manual",
			)
		).url,
	).toBe("https://gw.test/pay");

	// bank transfer: the order exists right away — unpaid, stock taken, buyer attached, email with the bank details
	const sent: any[] = [];
	const realSend = MAILERS.resend!.send;
	afterAll(() => {
		MAILERS.resend!.send = realSend;
	});
	MAILERS.resend!.send = async (_creds, msg) => void sent.push(msg);
	await MailService.update({
		driver: "resend",
		from_email: "noreply@manual.io",
		credentials: { resend: { api_key: "re_test" } },
	});
	const r = await StoreService.checkout(
		await mShop(),
		{ customer: buyer, items, payment: "bank_transfer" },
		"http://x/store/svc-manual",
	);
	expect(r.url).toMatch(
		/^http:\/\/x\/store\/svc-manual\/done\?sid=bank_transfer_[0-9a-f]{32}$/,
	);
	const sid = new URL(r.url!).searchParams.get("sid")!;
	const done = await StoreService.fulfill(await mShop(), sid);
	const order = done.order!;
	expect([
		order.payment_method,
		order.payment_status,
		order.paid,
		order.total,
		order.fulfillment,
	]).toEqual(["Bank transfer", "unpaid", 0, 600, "new"]);
	expect(await StockRepository.level(sql, M, pen.id, null)).toBe(3);
	expect(order.customer_id).not.toBeNull();
	expect((await StoreService.fulfill(await mShop(), sid)).order!.id).toBe(
		order.id,
	); // idempotent, like a gateway return
	await Bun.sleep(20);
	expect(sent).toHaveLength(1);
	expect(sent[0].text).toContain("To pay by Bank transfer");
	expect(sent[0].text).toContain("KBank 123-4");
	expect(await StoreService.paymentInstructions(await mShop(), order)).toBe(
		"KBank 123-4",
	);
	await MailService.update({
		driver: "",
		from_email: "",
		credentials: {},
	});

	// track: the public code (random, never the id) + the buyer's email or phone (digits compared); anything else is a miss
	expect(order.reference).toMatch(
		/^(?:[A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/,
	);
	expect(
		(await StoreService.track(await mShop(), order.reference!, "BUYER@x.io"))
			?.id,
	).toBe(order.id);
	expect(
		(await StoreService.track(await mShop(), order.reference!, "(555) 0100"))
			?.id,
	).toBe(order.id);
	expect(
		await StoreService.track(
			await mShop(),
			order.reference!,
			"someone@else.io",
		),
	).toBeNull();
	expect(
		await StoreService.track(await mShop(), order.reference!, "0100"),
	).toBeNull(); // too short to be a phone
	expect(
		await StoreService.track(
			await mShop(),
			"AAAA-AAAA-AAAA-AAAA",
			"buyer@x.io",
		),
	).toBeNull(); // no such code
	expect(
		await StoreService.track(await shop(), order.reference!, "buyer@x.io"),
	).toBeNull(); // another shop's store
	// switching the manual options off keeps the online gateway
	await settings({ manual_gateways: [] });
	expect(
		(await StoreService.paymentOptions(await mShop())).map((o) => o.key),
	).toEqual(["fake-hosted"]);
	// …and with the extension off too, the label falls back to the first manual option
	await ExtensionService.save(M, "fake-hosted", { enabled: false });
	await settings({ manual_gateways: ["cod"] });
	expect(await StoreService.paymentLabel(await mShop())).toBe(
		"Cash on delivery",
	);
});

test("coupons: applied at the checkout, frozen on the snapshot, written on the order, counted once — and passed to the gateway", async () => {
	const { CouponService: _CouponService } = await import("../Coupon.Service");
	const CouponService = Container.get(_CouponService);
	const { CouponInput } = await import("@validators/Coupon.Validator");
	const [c] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, country, delivery_zones) values ('Coupon Store', 'USD', 'UTC', 'svc-coupon', ${true}, 'United States', ${JSON.stringify([{ name: "Domestic", countries: ["United States"], states: [], cities: [], fee: 300, free_delivery_min: null }])}) returning id`;
	const C = c.id as number;
	const cShop = () => ShopRepository.find(C).then((x) => x!);
	await StoreService.updateSettings(C, {
		enabled: true,
		slug: "svc-coupon",
		domain: null,
		google_site_verification: null,
		template: "classic",
		manual_gateways: ["cod"],
		credentials: {},
	});
	const lamp = await ProductRepository.create(C, {
		...base,
		name: "Coupon Lamp",
		price: 2000,
		purchase_price: 800,
		track_stock: true,
		stock: 9,
	} as any);
	const items = [{ product_id: lamp.id, variant_id: null, qty: 2 }]; // $40 of goods + $3 delivery
	const coupon = (over: Record<string, unknown>) =>
		CouponService.create(
			C,
			CouponInput.parse({ code: "X10", type: "percent", value: 10, ...over }),
		);
	await coupon({ code: "TEN", per_customer_limit: 1, usage_limit: 5 });
	await coupon({ code: "SHIP", type: "free_delivery" });
	const url = "http://x/store/svc-coupon";

	// quote: what the checkout page shows after "Apply" — the same rules, so the same numbers
	expect(
		(
			await StoreService.quote(await cShop(), {
				items,
				coupon: "nope",
				email: "",
				country: "",
				state: "",
				city: "",
				postal_code: "",
				pickup: false,
			})
		).errors?.coupon,
	).toMatch(/isn't valid/);
	expect(
		(
			await StoreService.quote(await cShop(), {
				items,
				coupon: " ten ",
				email: "buyer@x.io",
				country: "United States",
				state: "",
				city: "",
				postal_code: "",
				pickup: false,
			})
		).quote,
	).toMatchObject({
		code: "TEN",
		type: "percent",
		value: 10,
		discount: 400,
		delivery_fee: 300,
	});
	expect(
		(
			await StoreService.quote(await cShop(), {
				items,
				coupon: "ship",
				email: "buyer@x.io",
				country: "United States",
				state: "",
				city: "",
				postal_code: "",
				pickup: false,
			})
		).quote,
	).toMatchObject({ code: "SHIP", discount: 0, delivery_fee: 0 });

	// a bad code stops the checkout with a message for the code box; nothing is snapshotted
	expect(
		(
			await StoreService.checkout(
				await cShop(),
				{ customer: buyer, items, payment: "cod", coupon: "NOPE" },
				url,
			)
		).errors,
	).toEqual({ coupon: "That code isn't valid" });
	// cash on delivery with TEN: the order carries the discount and the code, stock is taken, the use is counted
	const r = await StoreService.checkout(
		await cShop(),
		{ customer: buyer, items, payment: "cod", coupon: "ten" },
		url,
	);
	const order = (
		await StoreService.fulfill(
			await cShop(),
			new URL(r.url!).searchParams.get("sid")!,
		)
	).order!;
	expect([
		order.subtotal,
		order.discount_type,
		order.discount_value,
		order.discount,
		order.delivery_fee,
		order.total,
		order.coupon_code,
	]).toEqual([4000, "percent", 10, 400, 300, 3900, "TEN"]);
	expect((await CouponService.page(C, "TEN", "", 1, 10)).data[0]).toMatchObject(
		{
			used_count: 1,
			saved_total: 400,
		},
	);
	// …and the same buyer can't use it again (per-customer limit), while a free-delivery code zeroes the fee
	expect(
		(
			await StoreService.checkout(
				await cShop(),
				{ customer: buyer, items, payment: "cod", coupon: "TEN" },
				url,
			)
		).errors?.coupon,
	).toMatch(/isn't valid/);
	const r2 = await StoreService.checkout(
		await cShop(),
		{ customer: buyer, items, payment: "cod", coupon: "SHIP" },
		url,
	);
	const order2 = (
		await StoreService.fulfill(
			await cShop(),
			new URL(r2.url!).searchParams.get("sid")!,
		)
	).order!;
	expect([
		order2.discount_type,
		order2.discount,
		order2.delivery_fee,
		order2.total,
		order2.coupon_code,
	]).toEqual([null, 0, 0, 4000, "SHIP"]);
	expect(
		(await CouponService.page(C, "SHIP", "", 1, 10)).data[0],
	).toMatchObject({
		used_count: 1,
		saved_total: 300,
	}); // what it saved = the waived fee

	// the hosted gateway is told the discount on its own, so the lines stay itemised
	await gateway(C);
	hosted("cs_coupon_1");
	const other = { ...buyer, email: "other@x.io" };
	expect(
		(
			await StoreService.checkout(
				await cShop(),
				{ customer: other, items, coupon: "TEN" },
				url,
			)
		).url,
	).toBe("https://gw.test/pay");
	expect(charge().discount).toEqual({ label: "Coupon TEN", amount: 400 });
	expect(charge().lines.map((l: any) => l.price)).toEqual([2000, 300]);
	// the void of an order gives its use back
	const { OrderService: _OrderService } = await import("../Order.Service");
	const OrderService = Container.get(_OrderService);
	expect(
		await OrderService.void(order.id, C, order.user_id, {
			reason: "test",
		} as any),
	).toBeNull();
	expect((await CouponService.page(C, "TEN", "", 1, 10)).data[0]).toMatchObject(
		{
			used_count: 0,
		},
	);
});

test("tax: an added-on-top tax is a gateway line and lands on the order; an included one changes nothing but the order's tax fields", async () => {
	const [t] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, country, delivery_zones, tax_rate, tax_label, tax_included)
    values ('Tax Store', 'USD', 'UTC', 'svc-tax', ${true}, 'United States', ${JSON.stringify([{ name: "Domestic", countries: ["United States"], states: [], cities: [], fee: 200, free_delivery_min: null }])}, 750, 'Sales tax', ${false}) returning id`;
	const T = t.id as number;
	const taxShop = () => ShopRepository.find(T).then((x) => x!);
	await StoreService.updateSettings(T, {
		enabled: true,
		slug: "svc-tax",
		domain: null,
		google_site_verification: null,
		template: "classic",
		credentials: {},
	});
	await gateway(T);
	const pen = await ProductRepository.create(T, {
		...base,
		name: "Tax Pen",
		price: 1000,
		purchase_price: 300,
		track_stock: false,
		stock: 0,
	} as any);
	const cart = { items: [{ product_id: pen.id, variant_id: null, qty: 2 }] }; // subtotal 2000 → 7.5% = 150

	hosted("cs_tax_1");
	expect(
		(
			await StoreService.checkout(
				await taxShop(),
				{ ...cart, customer: buyer },
				"http://x/store/svc-tax",
			)
		).url,
	).toBeDefined();
	expect(charge().lines.map((l: any) => [l.name, l.price, l.qty])).toEqual([
		["Tax Pen", 1000, 2],
		["Sales tax 7.5%", 150, 1],
		["Delivery", 200, 1],
	]);
	paidBy();
	const order = (await StoreService.fulfill(await taxShop(), "cs_tax_1"))
		.order!;
	expect([
		order.subtotal,
		order.tax,
		order.tax_rate,
		order.tax_label,
		order.tax_included,
		order.delivery_fee,
		order.total,
		order.paid,
	]).toEqual([2000, 150, 750, "Sales tax", false, 200, 2350, 2350]);

	// prices that already include the tax: no extra line, same total, the share is still recorded (2000 − 2000/1.075 = 140)
	await sql`update shops set tax_included = ${true} where id = ${T}`;
	hosted("cs_tax_2");
	await StoreService.checkout(
		await taxShop(),
		{ ...cart, customer: buyer },
		"http://x/store/svc-tax",
	);
	expect(charge().lines.map((l: any) => l.name)).toEqual([
		"Tax Pen",
		"Delivery",
	]);
	paidBy();
	const incl = (await StoreService.fulfill(await taxShop(), "cs_tax_2")).order!;
	expect([incl.tax, incl.tax_included, incl.total]).toEqual([140, true, 2200]);
});

test("languages: the save is checked against the app's languages, stored default first", async () => {
	const { StoreLanguagesInput } = await import("@validators/Store.Validator");
	const { validate } = await import("@validators/validate");
	expect(validate(StoreLanguagesInput, { languages: [] }).errors).toEqual({
		languages: "Pick at least one language",
	});
	expect(
		validate(StoreLanguagesInput, { languages: ["de", "xx"] }).errors,
	).toBeDefined(); // never a language the app does not speak
	expect(
		validate(StoreLanguagesInput, { languages: ["de", "de"] }).data,
	).toEqual({ languages: ["de"] }); // a repeat is dropped
	const v = validate(StoreLanguagesInput, { languages: ["de", "en"] });

	const [l] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Lang Store', 'EUR', 'UTC', 'svc-lang', ${true}) returning id`;
	const L = l.id as number;
	expect((await ShopRepository.find(L))!.languages).toEqual(["en", "de"]); // the column's default: every language, English first
	await StoreService.updateLanguages(L, v.data!);
	expect((await StoreService.settings(L)).languages).toEqual(["de", "en"]);
	expect((await ShopRepository.find(L))!.languages).toEqual(["de", "en"]);
});

test("coupon holds: parallel checkouts can't all use a one-time code; a pending checkout holds it; a late card charge is refused", async () => {
	const { CouponService: _CouponService } = await import("../Coupon.Service");
	const CouponService = Container.get(_CouponService);
	const { CouponInput } = await import("@validators/Coupon.Validator");
	const [h] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, country, delivery_zones) values ('Hold Store', 'USD', 'UTC', 'svc-hold', ${true}, 'United States', ${JSON.stringify([{ name: "All", countries: [], states: [], cities: [], fee: 0, free_delivery_min: null }])}) returning id`;
	const H = h.id as number;
	const hShop = () => ShopRepository.find(H).then((x) => x!);
	await StoreService.updateSettings(H, {
		enabled: true,
		slug: "svc-hold",
		domain: null,
		google_site_verification: null,
		template: "classic",
		manual_gateways: ["cod"],
		credentials: {},
	});
	await gateway(H, "tokenize", { public_key: "pk", secret_key: "sk" });
	const cup = await ProductRepository.create(H, {
		...base,
		name: "Hold Cup",
		price: 1000,
		purchase_price: 100,
		track_stock: false,
	} as any);
	const items = [{ product_id: cup.id, variant_id: null, qty: 1 }];
	const url = "http://x/store/svc-hold";
	for (const code of ["ONCE", "HOLD"])
		await CouponService.create(
			H,
			CouponInput.parse({ code, type: "fixed", value: 100, usage_limit: 1 }),
		);
	const as = (email: string) => ({ ...buyer, email, phone: "" });

	// five cash-on-delivery checkouts at once with a one-time code: exactly one gets it
	const all = await Promise.all(
		[1, 2, 3, 4, 5].map(async (n) =>
			StoreService.checkout(
				await hShop(),
				{ customer: as(`p${n}@x.io`), items, payment: "cod", coupon: "ONCE" },
				url,
			),
		),
	);
	expect(all.filter((r) => r.url).length).toBe(1);
	expect(all.filter((r) => r.errors?.coupon).length).toBe(4);

	// a card checkout that isn't paid yet holds the code: the next buyer is refused…
	resetPay();
	const first = await StoreService.checkout(
		await hShop(),
		{ customer: as("a@x.io"), items, coupon: "HOLD" },
		url,
	);
	const ref = first.tokenize!.ref;
	const next = async () =>
		StoreService.checkout(
			await hShop(),
			{ customer: as("b@x.io"), items, payment: "cod", coupon: "HOLD" },
			url,
		);
	expect((await next()).errors?.coupon).toBe("That code isn't valid");
	// …until the hold runs out; then the late card charge is refused, so the code is never used twice
	const old = new Date(Date.now() - 2 * 60 * 60_000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
	await sql`update store_carts set created_at = ${old} where stripe_session_id = ${ref}`;
	expect((await next()).url).toBeDefined();
	expect(
		(await StoreService.pay(await hShop(), ref, "tokn_x", url)).errors?.cart,
	).toMatch(/expired/);
});

test("a guest checkout never lands in a store account's history", async () => {
	const [g] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, country, delivery_zones) values ('Guest Store', 'USD', 'UTC', 'svc-guest', ${true}, 'United States', ${JSON.stringify([{ name: "All", countries: [], states: [], cities: [], fee: 0, free_delivery_min: null }])}) returning id`;
	const G = g.id as number;
	const gShop = () => ShopRepository.find(G).then((x) => x!);
	await StoreService.updateSettings(G, {
		enabled: true,
		slug: "svc-guest",
		domain: null,
		google_site_verification: null,
		template: "classic",
		manual_gateways: ["cod"],
		credentials: {},
	});
	const mug = await ProductRepository.create(G, {
		...base,
		name: "Guest Mug",
		price: 500,
		purchase_price: 100,
		track_stock: false,
	} as any);
	const items = [{ product_id: mug.id, variant_id: null, qty: 1 }];
	// the victim has a store account (a Firebase sign-in); a stranger types their email as a guest
	const [victim] =
		await sql`insert into customers (shop_id, name, email, phone, firebase_uid) values (${G}, 'Victim', 'victim@x.io', '555-0199', 'uid-victim') returning id`;
	const r = await StoreService.checkout(
		await gShop(),
		{ customer: { ...buyer, email: "victim@x.io" }, items, payment: "cod" },
		"http://x/store/svc-guest",
	);
	const order = (
		await StoreService.fulfill(
			await gShop(),
			new URL(r.url!).searchParams.get("sid")!,
		)
	).order!;
	expect(order.customer_id).toBeNull();
	expect(
		(
			await sql`select count(*) as n from orders where customer_id = ${victim.id}`
		)[0].n,
	).toBe(0);
});

test("a guest who types another person's phone gets a record of their own", async () => {
	const [g] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, country, delivery_zones) values ('Phone Store', 'USD', 'UTC', 'svc-phone', ${true}, 'United States', ${JSON.stringify([{ name: "All", countries: [], states: [], cities: [], fee: 0, free_delivery_min: null }])}) returning id`;
	const G = g.id as number;
	const gShop = () => ShopRepository.find(G).then((x) => x!);
	await StoreService.updateSettings(G, {
		enabled: true,
		slug: "svc-phone",
		domain: null,
		google_site_verification: null,
		template: "classic",
		manual_gateways: ["cod"],
		credentials: {},
	});
	const mug = await ProductRepository.create(G, {
		...base,
		name: "Phone Mug",
		price: 500,
		purchase_price: 100,
		track_stock: false,
	} as any);
	const items = [{ product_id: mug.id, variant_id: null, qty: 1 }];
	/**
	 * A guest order with the same phone number.
	 * @param email The email the guest types.
	 * @returns The customer the order was written to.
	 */
	async function orderAs(email: string) {
		const r = await StoreService.checkout(
			await gShop(),
			{ customer: { ...buyer, email }, items, payment: "cod" },
			"http://x/store/svc-phone",
		);
		const { order } = await StoreService.fulfill(
			await gShop(),
			new URL(r.url!).searchParams.get("sid")!,
		);
		return order!.customer_id as number;
	}
	const first = await orderAs("first@x.io");
	const second = await orderAs("second@x.io");
	expect(second).not.toBe(first);
	const rows =
		await sql`select id, email, phone from customers where shop_id = ${G} order by id`;
	expect(rows.map((c: any) => [c.id, c.email, c.phone])).toEqual([
		[first, "first@x.io", buyer.phone],
		[second, "second@x.io", null],
	]);
	// the same person again: still their own record
	expect(await orderAs("first@x.io")).toBe(first);

	// one unit left: two lines of it with different notes are still two units
	const last = await ProductRepository.create(G, {
		...base,
		name: "Last Mug",
		price: 500,
		purchase_price: 100,
		track_stock: true,
		stock: 1,
	} as any);
	const two = await StoreService.checkout(
		await gShop(),
		{
			customer: buyer,
			items: [
				{ product_id: last.id, variant_id: null, qty: 1, note: "a" },
				{ product_id: last.id, variant_id: null, qty: 1, note: "b" },
			],
			payment: "cod",
		},
		"http://x/store/svc-phone",
	);
	expect(two.errors?.cart).toMatch(/Last Mug/);
});

test("custom request: a product that asks for one needs the note, lines with different notes stay apart, and the order keeps them", async () => {
	const [c] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Engrave Store', 'USD', 'UTC', 'svc-engrave', ${true}) returning id`;
	const C = c.id as number;
	const cShop = () => ShopRepository.find(C).then((x) => x!);
	await StoreService.updateSettings(C, {
		enabled: true,
		slug: "svc-engrave",
		domain: null,
		google_site_verification: null,
		template: "classic",
		manual_gateways: ["cod"],
		credentials: {},
	});
	const tumbler = await ProductRepository.create(C, {
		...base,
		name: "Tumbler",
		price: 1500,
		purchase_price: null,
		track_stock: false,
		custom_request: true,
		custom_request_label: "Name to engrave",
	} as any);
	const cap = await ProductRepository.create(C, {
		...base,
		name: "Cap",
		price: 800,
		purchase_price: null,
		track_stock: false,
	} as any);
	// the storefront sees the question; a product that asks for none sends null
	const catalog = await StoreService.catalog(C);
	expect(catalog.map((p) => [p.name, p.custom_request]).sort()).toEqual([
		["Cap", null],
		["Tumbler", "Name to engrave"],
	]);
	// a CSV-style update that leaves the fields out keeps them
	await ProductRepository.update(tumbler.id, C, {
		...base,
		name: "Tumbler",
		price: 1500,
		purchase_price: null,
		track_stock: false,
	} as any);
	expect((await ProductRepository.find(tumbler.id, C))!.custom_request).toBe(
		true,
	);

	// no note (or only spaces) → refused, with the product's name
	const missing = await StoreService.checkout(
		await cShop(),
		{
			customer: buyer,
			items: [{ product_id: tumbler.id, variant_id: null, qty: 1 }],
			payment: "cod",
		},
		"http://x",
	);
	expect(missing.errors?.cart).toMatch(/Tumbler/);

	const r = await StoreService.checkout(
		await cShop(),
		{
			customer: buyer,
			items: [
				{ product_id: tumbler.id, variant_id: null, qty: 1, note: "Anna" },
				{ product_id: tumbler.id, variant_id: null, qty: 2, note: "Ben" },
				// a note on a product that asks for none is dropped
				{ product_id: cap.id, variant_id: null, qty: 1, note: "ignored" },
			],
			payment: "cod",
		},
		"http://x",
	);
	const order = (
		await StoreService.fulfill(
			await cShop(),
			new URL(r.url!).searchParams.get("sid")!,
		)
	).order!;
	expect(order.items.map((i) => [i.name, i.qty, i.note])).toEqual([
		["Tumbler", 1, "Anna"],
		["Tumbler", 2, "Ben"],
		["Cap", 1, ""],
	]);
});

test("send order: a store with no payment option writes the cart as an unpaid order at once; a store that takes payments refuses it", async () => {
	const [d] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, tax_rate, tax_label) values ('Direct Store', 'USD', 'UTC', 'svc-direct', ${true}, 1000, 'VAT') returning id`;
	const D = d.id as number;
	const dShop = () => ShopRepository.find(D).then((x) => x!);
	const dish = await ProductRepository.create(D, {
		...base,
		name: "Direct Dish",
		price: 800,
		purchase_price: 200,
		track_stock: true,
		stock: 2,
	} as any);
	const items = [{ product_id: dish.id, variant_id: null, qty: 2 }];
	expect(await StoreService.paymentOptions(await dShop())).toEqual([]);

	// nothing is asked: no buyer, no address, no fee — only the cart
	const r = await StoreService.send(
		await dShop(),
		{ items },
		"http://x/store/svc-direct",
	);
	const sid = new URL(r.url!).searchParams.get("sid")!;
	expect(sid).toStartWith("direct_");
	const order = (await StoreService.fulfill(await dShop(), sid)).order!;
	expect(order).toMatchObject({
		payment_status: "unpaid",
		payment_method: "Pay later",
		fulfillment: "new",
		customer_id: null,
		subtotal: 1600,
		tax: 160,
		delivery_fee: 0,
		total: 1760,
		paid: 0,
		note: "",
	});
	// written once, and the stock left the shelf
	expect(
		(await sql`select count(*) as n from orders where shop_id = ${D}`)[0].n,
	).toBe(1);
	expect((await ProductRepository.find(dish.id, D))!.stock).toBe(0);
	// sold out now: refused with the reason
	expect(
		(await StoreService.send(await dShop(), { items }, "http://x")).errors
			?.cart,
	).toContain("Direct Dish");

	// a payment option is on: the checkout page is the only way in
	await StoreService.updateSettings(D, {
		enabled: true,
		slug: "svc-direct",
		domain: null,
		google_site_verification: null,
		template: "classic",
		manual_gateways: ["cod"],
		credentials: {},
	});
	expect(
		(await StoreService.send(await dShop(), { items }, "http://x")).errors
			?.cart,
	).toBeTruthy();
});

test("an account may change a store address only a few times a week", async () => {
	const { SLUG_CHANGES_PER_WEEK } = await import("@constants/Store.Constant");
	const owner = 990_002;
	const [row] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled, owner_id) values ('Rename Store', 'USD', 'UTC', 'svc-rename-0', ${true}, ${owner}) returning id`;
	const id = row.id as number;
	/**
	 * Save the store settings with another address.
	 * @param n The number in the new address.
	 * @returns The errors, if any.
	 */
	async function rename(n: number) {
		const r = await StoreService.updateSettings(id, {
			enabled: true,
			slug: `svc-rename-${n}`,
			domain: null,
			google_site_verification: null,
			template: "classic",
			manual_gateways: ["cod"],
			credentials: {},
		});
		return r.errors;
	}
	expect(await rename(0)).toBeUndefined(); // the same address: not a rename
	for (let n = 1; n <= SLUG_CHANGES_PER_WEEK; n++)
		expect(await rename(n)).toBeUndefined();
	expect((await rename(99))?.slug).toMatch(/too often/);
	expect((await ShopRepository.find(id))!.slug).toBe(
		`svc-rename-${SLUG_CHANGES_PER_WEEK}`,
	);
});

test("theme look: only #rrggbb colours and known fonts are saved, per template; an empty look is removed", async () => {
	const { StoreThemeInput } = await import("@validators/Store.Validator");
	const { validate } = await import("@validators/validate");
	// anything that is not a plain hex colour never reaches the page's <style>
	expect(
		validate(StoreThemeInput, {
			template: "noir",
			primary: "red;}body{display:none",
		}).errors,
	).toEqual({ primary: "Pick a valid color" });
	expect(
		validate(StoreThemeInput, { template: "noir", font: "comic" }).errors,
	).toBeDefined();
	expect(
		validate(StoreThemeInput, { template: "ext:aurora" }).errors,
	).toBeDefined(); // built-in templates only
	const v = validate(StoreThemeInput, {
		template: "noir",
		primary: "#FF0000",
		font: "archivo",
	});
	expect(v.data).toEqual({
		template: "noir",
		primary: "#ff0000",
		secondary: "",
		background: "",
		footer: "",
		text: "",
		muted: "",
		footer_text: "",
		surface: "",
		surface_text: "",
		font: "archivo",
	});

	const [row] =
		await sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Look Store', 'EUR', 'UTC', 'svc-look', ${true}) returning id`;
	const id = row.id as number;
	expect((await ShopRepository.find(id))!.theme_config).toEqual({});
	await StoreService.updateTheme(id, v.data!);
	expect((await StoreService.settings(id)).theme_config).toEqual({
		noir: {
			primary: "#ff0000",
			secondary: "",
			background: "",
			footer: "",
			text: "",
			muted: "",
			footer_text: "",
			surface: "",
			surface_text: "",
			font: "archivo",
		},
	});
	// another template keeps its own entry; emptying one takes it out
	await StoreService.updateTheme(id, {
		template: "classic",
		primary: "",
		secondary: "#00ff00",
		background: "",
		footer: "#112233",
		text: "",
		muted: "",
		footer_text: "",
		surface: "",
		surface_text: "",
		font: "",
	});
	await StoreService.updateTheme(id, {
		template: "noir",
		primary: "",
		secondary: "",
		background: "",
		footer: "",
		text: "",
		muted: "",
		footer_text: "",
		surface: "",
		surface_text: "",
		font: "",
	});
	expect((await ShopRepository.find(id))!.theme_config).toEqual({
		classic: {
			primary: "",
			secondary: "#00ff00",
			background: "",
			footer: "#112233",
			text: "",
			muted: "",
			footer_text: "",
			surface: "",
			surface_text: "",
			font: "",
		},
	});
});
