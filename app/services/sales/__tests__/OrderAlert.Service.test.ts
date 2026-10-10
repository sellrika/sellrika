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
const { OrderAlertService: _OrderAlertService } = await import(
	"../OrderAlert.Service"
);
const { OrderAlertEmail } = await import("@emails/OrderAlert.Email");
const OrderAlertService = Container.get(_OrderAlertService);
const { OnlineStoreInput } = await import("@validators/Store.Validator");
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { decrypt } = await import("@helpers/crypto");

const migrated = await sql`select 1 from users`.then(
	() => true,
	() => false,
);
if (!migrated)
	for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		await up(sql);

const [s] =
	await sql`insert into shops (name, currency, timezone, slug, online_enabled) values ('Alert Store', 'USD', 'UTC', 'alert-store', ${true}) returning id`;
const S = s.id as number;
const store = (
	over: Partial<Parameters<typeof StoreService.updateSettings>[1]> = {},
) =>
	({
		enabled: true,
		slug: "alert-store",
		domain: null,
		google_site_verification: null,
		template: "classic",
		gateway: "",
		credentials: {},
		...over,
	}) as Parameters<typeof StoreService.updateSettings>[1];
const TOKEN = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";

// a paid online order as fulfil() hands it over — only the fields the alert reads
const order = {
	id: 77,
	reference: "P8J4-MJSQ-4Z8T",
	total: 1450,
	payment_status: "paid",
	payment_method: "Stripe",
	note: "Deliver to: Ann · 0912\n1 Main St",
	items: [
		{ name: "Mug", qty: 2 },
		{ name: "Tee", qty: 1 },
	],
} as any;

const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

test("alerts: the bot token is stored encrypted and never echoed; blank keeps it; a chat id needs a token", async () => {
	// validator: junk ids are refused, the GA id is upper-cased (the form always sends strings — null is what the service stores)
	const raw = { ...store(), domain: "", google_site_verification: "" };
	expect(
		OnlineStoreInput.safeParse({ ...raw, telegram_chat_id: "abc" }).success,
	).toBe(false);
	expect(
		OnlineStoreInput.safeParse({ ...raw, telegram_bot_token: "nope" }).success,
	).toBe(false);
	expect(OnlineStoreInput.safeParse({ ...raw, ga_id: "UA-1234" }).success).toBe(
		false,
	);
	expect(
		OnlineStoreInput.safeParse({ ...raw, meta_pixel_id: "12ab" }).success,
	).toBe(false);
	const ok = OnlineStoreInput.safeParse({
		...raw,
		ga_id: "g-abc123",
		meta_pixel_id: "123456789012345",
		alert_email: " Boss@Example.com ",
	});
	expect(ok.success && ok.data).toMatchObject({
		ga_id: "G-ABC123",
		meta_pixel_id: "123456789012345",
		alert_email: "boss@example.com",
	});

	expect(
		(await StoreService.updateSettings(S, store({ telegram_chat_id: "42" })))
			.errors?.telegram_bot_token,
	).toBe("Bot token is required");
	expect(
		(
			await StoreService.updateSettings(
				S,
				store({
					telegram_bot_token: TOKEN,
					telegram_chat_id: "42",
					alert_email: "boss@example.com",
					ga_id: "G-ABC123",
					meta_pixel_id: "123456789012345",
				}),
			)
		).errors,
	).toBeUndefined();
	const settings = await StoreService.settings(S);
	expect(settings).toMatchObject({
		telegram_chat_id: "42",
		telegram_token_set: true,
		alert_email: "boss@example.com",
		ga_id: "G-ABC123",
		meta_pixel_id: "123456789012345",
	});
	expect(JSON.stringify(settings)).not.toContain(TOKEN);
	const box = (await ShopRepository.alertToken(S))!;
	expect(box).not.toBe(TOKEN);
	expect(decrypt(box)).toBe(TOKEN);
	// a blank token on the next save keeps the stored one; the shop row itself never carries it
	await StoreService.updateSettings(
		S,
		store({ telegram_bot_token: "", telegram_chat_id: "42" }),
	);
	expect(decrypt((await ShopRepository.alertToken(S))!)).toBe(TOKEN);
	expect(JSON.stringify(await ShopRepository.find(S))).not.toContain(
		"telegram_bot_token",
	);
});

test("alerts: notify() posts the order summary to Telegram with the decrypted token, and never throws", async () => {
	const calls: { url: string; body: any }[] = [];
	globalThis.fetch = (async (url: any, init: any) => {
		calls.push({ url: String(url), body: JSON.parse(init.body) });
		return new Response("{}", { status: 200 });
	}) as any;
	const shop = (await ShopRepository.find(S))!;
	await OrderAlertService.notify(shop, order); // alert_email is set too, but email is off → silently skipped
	expect(calls.length).toBe(1);
	expect(calls[0]!.url).toBe(
		`https://api.telegram.org/bot${TOKEN}/sendMessage`,
	);
	expect(calls[0]!.body.chat_id).toBe("42");
	expect(calls[0]!.body.text).toBe(
		"New order P8J4-MJSQ-4Z8T — Alert Store\n$14.50 · Paid with Stripe\n\n2 × Mug\n1 × Tee\n\nDeliver to: Ann · 0912\n1 Main St",
	);
	// an unpaid (cash on delivery) order says so up front
	expect(
		new OrderAlertEmail("", shop, {
			...order,
			payment_status: "unpaid",
			payment_method: "Cash on delivery",
		}).text(),
	).toContain("$14.50 · UNPAID — Cash on delivery");
	// Telegram down: logged, not thrown
	globalThis.fetch = (async () => {
		throw new Error("offline");
	}) as any;
	await expect(OrderAlertService.notify(shop, order)).resolves.toBeUndefined();
	// nothing switched on → nothing called
	globalThis.fetch = (async () => {
		throw new Error("must not be called");
	}) as any;
	await StoreService.updateSettings(S, store());
	await expect(
		OrderAlertService.notify((await ShopRepository.find(S))!, order),
	).resolves.toBeUndefined();
});

test("alerts: the email renders html with the order code, the lines and the note; subject and text stay the Telegram text", async () => {
	const shop = (await ShopRepository.find(S))!;
	const mail = await new OrderAlertEmail(
		"boss@example.com",
		shop,
		order,
	).build();
	expect(mail.subject).toBe("New order P8J4-MJSQ-4Z8T — Alert Store");
	expect(mail.text).toBe(new OrderAlertEmail("", shop, order).text());
	expect(mail.html).toContain("New order P8J4-MJSQ-4Z8T — Alert Store");
	expect(mail.html).toContain("2 × Mug");
	expect(mail.html).toContain("white-space:pre-line");
});
