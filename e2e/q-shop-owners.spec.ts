import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

// Shop owners: the platform admin (ADMIN_EMAIL) creates a shop for a new person by email. That person
// accepts the invitation link, and from then on sees only their own shop and staff.
// The platform settings (email, the address lists) stay with the platform admin.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const OWNER = { email: `owner-${run}@pos.local`, password: "owner1234" };
const SHOP = `Owner Shop ${run}`;

let admin: Page;
let owner: Page;
let invitePath = "";

test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	await login(admin);
	owner = await (await browser.newContext()).newPage(); // no cookies: a stranger opening the email
});
test.afterAll(async () => {
	await owner.context().close();
	await admin.close();
});

test("platform admin creates a shop for a new owner and gets the invitation link", async () => {
	await admin.goto("/shops/create");
	await admin.getByLabel("Name", { exact: true }).fill(SHOP);
	await admin.getByLabel("Owner email").fill(OWNER.email);
	await admin.getByRole("button", { name: "Create shop" }).click();
	// email is not set up in the e2e server: the admin is told so and gets the link to send by hand
	const notice = admin.locator("[data-invite]");
	await expect(notice).toContainText(OWNER.email);
	await expect(notice).toContainText("Email is not set up yet");
	const link = await admin.getByLabel("Invitation link").inputValue();
	invitePath = new URL(link).pathname;
	expect(invitePath).toMatch(/^\/invite\/[\w-]{30,}$/);
	// the new shop is the owner's, not the admin's
	await admin.goto("/shops");
	await expect(admin.getByText(SHOP)).toHaveCount(0);
	await expect(admin.getByText("Main Shop").first()).toBeVisible();
});

test("the new owner sets a name and password from the link and lands in their shop", async () => {
	await owner.goto(invitePath);
	await expect(owner.getByText(OWNER.email)).toBeVisible();
	await owner.getByLabel("Name", { exact: true }).fill("Nora Owner");
	await owner.getByLabel("New password", { exact: true }).fill(OWNER.password);
	await owner.getByLabel("Confirm new password").fill(OWNER.password);
	await owner.getByRole("button", { name: "Save and sign in" }).click();
	await owner.waitForURL("**/pos");
	await owner.goto("/shops");
	await expect(owner.getByText(SHOP).first()).toBeVisible();
	await expect(owner.getByText("Main Shop")).toHaveCount(0);
	// the link works once
	const again = await owner.context().browser()!.newPage();
	await again.goto(invitePath);
	await expect(
		again.getByText("This link does not work any more"),
	).toBeVisible();
	await again.close();
});

test("the owner can't reach other shops, other staff or the platform settings", async () => {
	// the admin's shop is id 1 (seeded): neither editable nor switchable
	expect((await owner.request.get("/shops/1/edit")).status()).toBe(404);
	expect((await owner.request.post("/shops/1/switch")).status()).toBe(404);
	await owner.goto("/users");
	await expect(owner.getByRole("row")).toHaveCount(2); // header + themselves
	await expect(owner.getByText("admin@sellrika.local")).toHaveCount(0);
	// platform settings: the Outgoing Email page and its endpoints refuse
	expect((await owner.request.get("/email")).status()).toBe(403);
	expect((await owner.request.put("/email", { data: {} })).status()).toBe(403);
	// …but their own shop's email is theirs to set up
	expect((await owner.request.get("/shop-email")).status()).toBe(200);
	expect(
		(
			await owner.request.post("/postal-codes", {
				data: { country: "Germany" },
			})
		).status(),
	).toBe(403);
	expect((await owner.request.get("/postal-codes")).status()).toBe(403);
	// the exchange rates are fetched for the whole platform: the page, the schedule and "Refresh now" refuse
	expect((await owner.request.get("/exchange-rates")).status()).toBe(403);
	expect(
		(
			await owner.request.put("/exchange-rates", { data: { schedule: "1h" } })
		).status(),
	).toBe(403);
	expect((await owner.request.post("/exchange-rates/refresh")).status()).toBe(
		403,
	);
	await owner.goto("/pos");
	await expect(owner.getByRole("link", { name: "Exchange rates" })).toHaveCount(
		0,
	);
	await expect(owner.getByRole("link", { name: "Addresses" })).toHaveCount(0);
	await expect(owner.getByRole("link", { name: "Outgoing Email" })).toHaveCount(
		0,
	);
	// a plain owner may not create shops for other people
	const form = await owner.request.post("/shops", {
		data: {
			name: "Sneaky",
			currency: "USD",
			timezone: "UTC",
			owner_email: `x-${run}@pos.local`,
		},
	});
	expect(form.status()).toBe(403);
});

test("the platform admin still has the platform settings", async () => {
	await admin.goto("/postal-codes");
	await expect(admin.getByRole("button", { name: "Add cities" })).toBeVisible();
	await admin.goto("/email");
	await expect(admin.getByLabel("From address")).toBeVisible();
});
