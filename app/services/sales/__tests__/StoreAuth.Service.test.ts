import { ACCOUNT_ADDRESSES_MAX } from "@constants/Store.Constant";
import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import type { FirebaseUser } from "@gateways/firebase/Firebase.Api";
// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
process.env.APP_KEY = process.env.APP_KEY || "store-auth-test-key";
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { StoreAuthService: _StoreAuthService } = await import(
	"../StoreAuth.Service"
);
const StoreAuthService = Container.get(_StoreAuthService);
const { StoreService: _StoreService } = await import("../Store.Service");
const StoreService = Container.get(_StoreService);
const { FirebaseApi } = await import("@gateways/firebase/Firebase.Api");
const firebase = Container.get(FirebaseApi);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { CustomerRepository: _CustomerRepository } = await import(
	"@repositories/Customer.Repository"
);
const CustomerRepository = Container.get(_CustomerRepository);
const { CustomerSessionRepository: _CustomerSessionRepository } = await import(
	"@repositories/CustomerSession.Repository"
);
const CustomerSessionRepository = Container.get(_CustomerSessionRepository);
const { ProductRepository: _ProductRepository } = await import(
	"@repositories/Product.Repository"
);
const ProductRepository = Container.get(_ProductRepository);

await migrate(true);

const [s] = await Db.insert(
	sql,
	"shops",
	sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Auth Store', 'USD', 'UTC', 'svc-auth', ${true})`,
	sql`id`,
);
const S = s.id as number;
const shop = () => ShopRepository.find(S).then((x) => x!);
const config = {
	api_key: "AIzaTestKey",
	auth_domain: "auth-store.firebaseapp.com",
	project_id: "auth-store",
	app_id: "1:1:web:abc",
};
const settings = (over: Record<string, unknown> = {}) =>
	StoreService.updateSettings(S, {
		enabled: true,
		slug: "svc-auth",
		domain: null,
		google_site_verification: null,
		template: "classic",
		credentials: {},
		manual_gateways: ["cod"],
		...over,
	});
/** What Firebase answers for the next token: keyed by the token so a test can hold several users at once. */
const users: Record<string, FirebaseUser | null> = {};
firebase.lookup = async (_key, token) =>
	token in users ? users[token]! : null;

test("settings: a provider switched on needs the whole Firebase config; the storefront only offers sign-in once it is complete", async () => {
	expect(StoreAuthService.logins(await shop())).toBeNull();
	expect(
		(await settings({ customer_logins: ["email", "google"] })).errors,
	).toEqual({ "firebase.api_key": "Web API key is required" });
	expect(
		(
			await settings({
				customer_logins: ["google"],
				firebase: { ...config, app_id: "" },
			})
		).errors,
	).toEqual({ "firebase.app_id": "App ID is required" });
	// a half-filled config is kept while every provider is off (the admin may fill it in over two visits)
	expect(
		(await settings({ firebase: { ...config, app_id: "" } })).errors,
	).toBeUndefined();
	expect((await shop()).firebase_config).toEqual({ ...config, app_id: "" });
	expect(StoreAuthService.logins(await shop())).toBeNull();
	expect(
		(
			await settings({
				customer_logins: ["google", "email", "google"],
				firebase: config,
			})
		).errors,
	).toBeUndefined();
	expect((await shop()).customer_logins).toEqual(["google", "email"]); // de-duplicated, in the order given
	expect(StoreAuthService.logins(await shop())).toEqual({
		providers: ["google", "email"],
		firebase: config,
	});
	expect(await StoreService.settings(S)).toMatchObject({
		customer_logins: ["google", "email"],
		firebase: config,
	});
});

test("login: a verified token finds or creates the customer, claims the record with that email once, and never an unverified one", async () => {
	users.good = {
		uid: "uid-ann",
		email: "ann@x.io",
		email_verified: true,
		name: "Ann Lee",
	};
	users.unverified = {
		uid: "uid-bob",
		email: "bob@x.io",
		email_verified: false,
		name: null,
	};
	users.noemail = {
		uid: "uid-anon",
		email: null,
		email_verified: true,
		name: "Anon",
	};
	// earlier guest orders left a customer record with Ann's email → the sign-in claims it (verified email) instead of making a second one
	const guest = await CustomerRepository.create(S, {
		name: "A. Lee",
		phone: "555-0100",
		email: "ANN@x.io",
		note: "",
	});
	const r = await StoreAuthService.login(await shop(), "good");
	expect(r.customer!.id).toBe(guest.id);
	expect((await CustomerRepository.find(guest.id, S))!.firebase_uid).toBe(
		"uid-ann",
	);
	expect(
		(await StoreAuthService.login(await shop(), "good")).customer!.id,
	).toBe(guest.id); // by uid from now on
	// a new person → a new record, named after the account
	users.new = {
		uid: "uid-new",
		email: "new@x.io",
		email_verified: true,
		name: "New Person",
	};
	const fresh = await StoreAuthService.login(await shop(), "new");
	expect(fresh.customer).toMatchObject({
		name: "New Person",
		email: "new@x.io",
		firebase_uid: "uid-new",
		phone: null,
	});
	users.named = {
		uid: "uid-n2",
		email: "n2@x.io",
		email_verified: true,
		name: null,
	};
	expect(
		(await StoreAuthService.login(await shop(), "named")).customer!.name,
	).toBe("n2@x.io"); // no display name → the email
	// refused: an unverified email (says so, so the page can offer to resend the link), no email, a token Firebase doesn't know, accounts off
	expect(
		await StoreAuthService.login(await shop(), "unverified"),
	).toMatchObject({
		errors: { token: expect.stringMatching(/Verify your email/) },
		unverified: true,
	});
	expect(
		(await StoreAuthService.login(await shop(), "noemail")).errors!.token,
	).toMatch(/email address/);
	expect(
		(await StoreAuthService.login(await shop(), "forged")).errors!.token,
	).toMatch(/not valid/);
	expect(await CustomerRepository.byEmail(S, "bob@x.io")).toBeNull(); // nothing was created for the refused ones
	firebase.lookup = async () => {
		throw new Error("offline");
	};
	expect(
		(await StoreAuthService.login(await shop(), "good")).errors!.token,
	).toMatch(/Could not verify/);
	firebase.lookup = async (_key, token) =>
		token in users ? users[token]! : null;
	await settings({ customer_logins: [], firebase: config });
	expect(
		(await StoreAuthService.login(await shop(), "good")).errors!.token,
	).toMatch(/doesn't offer/);
	await settings({ customer_logins: ["email"], firebase: config });
});

test("account: name / phone (unique per shop) and the address are the customer's to change; orders are theirs alone", async () => {
	const ann = (await StoreAuthService.login(await shop(), "good")).customer!;
	const other = (await StoreAuthService.login(await shop(), "new")).customer!;
	expect(
		(
			await StoreAuthService.updateProfile(other, {
				name: "New",
				phone: "555-0100",
			})
		).errors,
	).toEqual({ phone: "That phone number is used by another account" });
	expect(
		(
			await StoreAuthService.updateProfile(ann, {
				name: "Ann Lee-Smith",
				phone: "555-0100",
			})
		).errors,
	).toBeUndefined(); // her own number is fine
	expect((await CustomerRepository.find(ann.id, S))!.name).toBe(
		"Ann Lee-Smith",
	);
	// addresses: several per account, each with a label + phone; edit / remove only reach their own; the list is capped
	const address = {
		label: "Home",
		phone: "555-0100",
		address_1: "1 Main St",
		address_2: "",
		city: "Springfield",
		state: "IL",
		country: "United States",
		postal_code: "62701",
	};
	expect(
		(await StoreAuthService.addAddress(ann, address)).errors,
	).toBeUndefined();
	const [home] = await StoreAuthService.addresses(ann);
	expect(home).toMatchObject(address);
	expect(
		await StoreAuthService.updateAddress(other, home!.id, address),
	).toBeNull(); // not theirs
	expect(
		(await StoreAuthService.updateAddress(ann, home!.id, {
			...address,
			label: "Work",
		}))!.label,
	).toBe("Work");
	await StoreAuthService.removeAddress(other, home!.id); // someone else's is left alone
	expect((await StoreAuthService.addresses(ann)).map((a) => a.label)).toEqual([
		"Work",
	]);
	for (let i = 1; i < ACCOUNT_ADDRESSES_MAX; i++)
		expect(
			(
				await StoreAuthService.addAddress(ann, {
					...address,
					address_1: `${i} Extra St`,
				})
			).errors,
		).toBeUndefined();
	expect(
		(
			await StoreAuthService.addAddress(ann, {
				...address,
				address_1: "One too many",
			})
		).errors?.address_1,
	).toMatch(/up to/);
	expect((await StoreAuthService.addresses(ann)).length).toBe(
		ACCOUNT_ADDRESSES_MAX,
	);

	// an order placed while signed in belongs to the account whatever email was typed at the checkout; a guest's is matched by email
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
	const pen = await ProductRepository.create(S, {
		...base,
		name: "Auth Pen",
		price: 300,
		purchase_price: 100,
		track_stock: false,
		stock: 0,
	} as any);
	const buyer = {
		name: "Typed Name",
		phone: "555-0999",
		email: "typo@x.io",
		address_1: "9 Side St",
		address_2: "",
		city: "Chicago",
		state: "IL",
		country: "United States",
		postal_code: "60601",
	};
	const co = await StoreService.checkout(
		await shop(),
		{
			customer: buyer,
			items: [{ product_id: pen.id, variant_id: null, qty: 1 }],
			payment: "cod",
		},
		"http://x/store/svc-auth",
		other.id,
	);
	const order = (
		await StoreService.fulfill(
			await shop(),
			new URL(co.url!).searchParams.get("sid")!,
		)
	).order!;
	expect(order.customer_id).toBe(other.id);
	const landed = await StoreAuthService.addresses(other); // the delivery address lands on the account, with the phone
	expect(landed).toHaveLength(1);
	expect(landed[0]).toMatchObject({
		address_1: "9 Side St",
		city: "Chicago",
		phone: "555-0999",
		label: "",
	});
	expect(
		(await StoreAuthService.orders(other, 1)).data.map((o) => o.id),
	).toEqual([order.id]);
	expect((await StoreAuthService.orders(ann, 1)).data).toEqual([]);
	expect(
		(await StoreAuthService.order(other, order.reference!))!.items.map(
			(i) => i.name,
		),
	).toEqual(["Auth Pen"]);
	expect(await StoreAuthService.order(ann, order.reference!)).toBeNull(); // not hers
	expect(await StoreAuthService.order(other, "AAAA-AAAA-AAAA")).toBeNull();
	// a delivery to a new place adds it to the account; the same place again (however it's typed) doesn't
	for (const address_1 of ["Elsewhere", "9 side st "]) {
		const co2 = await StoreService.checkout(
			await shop(),
			{
				customer: { ...buyer, address_1 },
				items: [{ product_id: pen.id, variant_id: null, qty: 1 }],
				payment: "cod",
			},
			"http://x/store/svc-auth",
			other.id,
		);
		await StoreService.fulfill(
			await shop(),
			new URL(co2.url!).searchParams.get("sid")!,
		);
	}
	expect(
		(await StoreAuthService.addresses(other)).map((a) => a.address_1),
	).toEqual(["9 Side St", "Elsewhere"]);
	// "Save address for next order" unticked: a new place is delivered to but not kept
	const co3 = await StoreService.checkout(
		await shop(),
		{
			customer: { ...buyer, address_1: "Not kept" },
			items: [{ product_id: pen.id, variant_id: null, qty: 1 }],
			payment: "cod",
			save_address: false,
		},
		"http://x/store/svc-auth",
		other.id,
	);
	await StoreService.fulfill(
		await shop(),
		new URL(co3.url!).searchParams.get("sid")!,
	);
	expect((await StoreAuthService.addresses(other)).length).toBe(2);

	// sessions: one row per sign-in, gone on delete, and a deleted customer takes theirs along
	const session = await CustomerSessionRepository.create(other.id, S, 30);
	expect(
		(await CustomerSessionRepository.findValid(session.id))!.customer_id,
	).toBe(other.id);
	await CustomerSessionRepository.delete(session.id);
	expect(await CustomerSessionRepository.findValid(session.id)).toBeNull();
	const again = await CustomerSessionRepository.create(other.id, S, 30);
	await CustomerRepository.delete(other.id, S);
	expect(await CustomerSessionRepository.findValid(again.id)).toBeNull();
});
