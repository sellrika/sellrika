import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, login, submitProduct } from "./helpers";
import { BASE_PORT, portOf, tmpOf, storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("marketing");

/**
 * Marketing (/marketing): the abandoned-cart switch, a campaign from draft to
 * scheduled and back, "Send test to me", the unsubscribe page, and the
 * "Complete your order" link that refills the store cart.
 * Email goes through Resend, which the fixture server stands in for.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const CUSTOMER = `Mkt Buyer ${run}`;
const SUBJECT = `Spring news ${run}`;
const MUG = `Share Mug ${run}`;
const FIXTURES = `http://localhost:${BASE_PORT - 1}`;

let admin: Page;
let visitor: Page;

test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	await login(admin);
	visitor = await (await browser.newContext()).newPage(); // no cookies
});
test.afterAll(async () => {
	await visitor.context().close();
	await admin.close();
});

test("share: no Share button while the online store is off", async () => {
	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(MUG);
	await admin.getByLabel("Base price").fill("9");
	await submitProduct(admin);
	await expect(admin.getByRole("button", { name: "Share" })).toHaveCount(0);
	await admin.goto(`/products?q=${encodeURIComponent(MUG)}`);
	await expect(admin.getByRole("button", { name: `Share ${MUG}` })).toHaveCount(
		0,
	);
});

test("setup: online store on, email on, a customer with an email", async () => {
	await admin.goto("/online-store");
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Online store settings saved")).toBeVisible();
	const mail = await admin.request.put("/email", {
		data: {
			driver: "resend",
			from_email: "noreply@pos.local",
			credentials: { resend: { api_key: "re_e2e" } },
		},
		maxRedirects: 0,
	});
	expect(mail.status()).toBe(303);
	await admin.goto("/customers");
	await admin.getByRole("button", { name: "Add customer" }).first().click();
	const dlg = admin.getByRole("dialog");
	await dlg.getByLabel("Name").fill(CUSTOMER);
	await dlg.getByLabel("Email").fill(`buyer-${run}@pos.local`);
	await dlg.getByRole("button", { name: "Add customer" }).click();
	await expect(admin.getByText("Customer added")).toBeVisible();
});

test("share: the dialog gives the product's store link and share links", async () => {
	await admin.goto(`/products?q=${encodeURIComponent(MUG)}`);
	await admin.getByRole("button", { name: `Share ${MUG}` }).click();
	const dlg = admin.getByRole("dialog");
	const link = await dlg.getByLabel("Product link").inputValue();
	expect(link).toMatch(/\/\/[^/]+\.localhost:\d+\/p\/share-mug-/);
	const fb = await dlg
		.getByRole("link", { name: "Facebook" })
		.getAttribute("href");
	expect(decodeURIComponent(fb ?? "")).toContain(`${link}?utm_source=facebook`);
	await admin.keyboard.press("Escape");

	// the product form has the same button
	await admin.getByRole("link", { name: "Edit" }).first().click();
	await admin.getByRole("button", { name: "Share", exact: true }).click();
	await expect(
		admin.getByRole("dialog").getByLabel("Product link"),
	).toHaveValue(link);

	// the link opens the product page for anyone
	await visitor.goto(link);
	await expect(visitor.getByRole("heading", { name: MUG })).toBeVisible();
});

test("a guest can't open /marketing", async () => {
	await visitor.goto("/marketing");
	await expect(visitor).toHaveURL(/\/login$/);
});

test("abandoned cart: switch on, pick 12 hours, kept after reload", async () => {
	await admin.goto("/marketing");
	await expect(
		admin.getByRole("heading", { name: "Marketing", exact: true }),
	).toBeVisible();
	// the abandoned-cart email sits in the Settings dialog
	const settings = admin.getByRole("button", { name: "Settings" });
	await settings.click();
	const toggle = admin.getByRole("switch", {
		name: "Send abandoned cart emails",
	});
	await toggle.click();
	await admin.getByLabel("12 hours").check();
	await admin.getByRole("button", { name: "Save", exact: true }).click();
	await expect(admin.getByText("Abandoned cart email saved")).toBeVisible();
	await admin.reload();
	await settings.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(admin.getByLabel("12 hours")).toBeChecked();
});

test("campaign: write, pick a customer, save, schedule, cancel", async () => {
	await admin.goto("/marketing");
	await admin.getByRole("link", { name: "New campaign" }).click();
	await admin.getByLabel("Subject").fill(SUBJECT);
	await admin.getByRole("textbox", { name: "Message" }).click();
	await admin.keyboard.type("Fresh beans are in.");
	await admin.getByPlaceholder("Search customers by name or email").fill(run);
	await admin.getByRole("checkbox", { name: CUSTOMER }).check();
	await expect(admin.getByText("1 selected")).toBeVisible();
	await admin.getByRole("button", { name: "Save campaign" }).click();
	await expect(admin.getByText("Campaign saved")).toBeVisible();
	await expect(admin).toHaveURL(/\/marketing\/campaigns\/\d+$/);
	await expect(admin.getByText("Draft")).toBeVisible();

	// tomorrow at 09:00 on the shop's clock
	const d = new Date(Date.now() + 86_400_000);
	const day = d.toISOString().slice(0, 10);
	await admin.getByLabel("Date").fill(day);
	await admin.getByLabel("Time").fill("09:00");
	await admin.getByRole("button", { name: "Schedule", exact: true }).click();
	await expect(admin.getByText("Campaign scheduled")).toBeVisible();
	await expect(admin.getByText(/^Scheduled for /)).toBeVisible();

	await admin.getByRole("button", { name: "Cancel schedule" }).click();
	await expect(admin.getByText("Schedule cancelled")).toBeVisible();
	await expect(admin.getByText("Draft")).toBeVisible();

	// the list shows it as a draft with one recipient
	await admin.goto("/marketing");
	await expect(
		admin.getByRole("button", { name: `Open campaign ${SUBJECT}` }),
	).toContainText("Draft");
});

test("send test to me → the unsubscribe link → button → done", async () => {
	await admin.goto("/marketing");
	await admin.getByRole("button", { name: `Open campaign ${SUBJECT}` }).click();
	await admin.getByRole("button", { name: "Send test to me" }).click();
	await expect(admin.getByText("Test email sent to you")).toBeVisible();
	const mail = await (
		await admin.request.get(
			`${FIXTURES}/resend/last?to=${encodeURIComponent(ADMIN.email)}`,
		)
	).json();
	expect(mail.subject).toBe(SUBJECT);
	expect(mail.html).toContain("Fresh beans are in.");
	expect(mail.headers["List-Unsubscribe"]).toMatch(/\/unsubscribe\//);
	const path = (mail.text as string).match(
		/http:\/\/main-shop\.localhost:\d+\/unsubscribe\/[\w.-]+/,
	)![0];

	await visitor.goto(path);
	await expect(
		visitor.getByRole("heading", {
			name: "Unsubscribe from Main Shop emails?",
		}),
	).toBeVisible();
	await visitor.getByRole("button", { name: "Unsubscribe" }).click();
	await expect(
		visitor.getByRole("heading", { name: "You are unsubscribed" }),
	).toBeVisible();
	// a forged link does nothing
	await visitor.goto(`${STORE}/unsubscribe/abc.def`);
	await expect(
		visitor.getByRole("heading", {
			name: "This unsubscribe link does not work.",
		}),
	).toBeVisible();
});

test("the Complete your order link refills the store cart", async () => {
	test.skip(!!process.env.E2E_MYSQL_URL, "writes the SQLite file directly");
	// the reminder email is sent hours later by the sweep; its cart row is written here directly
	const db = new DatabaseSync(`${tmpOf(portOf("marketing"))}/pos.db`, {
		timeout: 5000,
	});
	const shop = db
		.prepare("select id from shops where slug = 'main-shop'")
		.get() as { id: number };
	const token = `e2e${run}`;
	const payload = {
		items: [
			{
				product_id: 999999,
				variant_id: null,
				name: `Restored Mug ${run}`,
				price: 1200,
				cost: null,
				qty: 2,
				track_stock: false,
			},
		],
		subtotal: 2400,
		total: 2400,
	};
	db.prepare(
		"insert into store_carts (shop_id, payload, restore_token) values (?, ?, ?)",
	).run(shop.id, JSON.stringify(payload), token);
	db.close();

	await visitor.goto(`${STORE}/cart/${token}`);
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/checkout$/);
	await expect(visitor.getByText(`Restored Mug ${run}`).first()).toBeVisible();
	// an unknown link lands on the store
	await visitor.goto(`${STORE}/cart/nope`);
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/$/);
});
