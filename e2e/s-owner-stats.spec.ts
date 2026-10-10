import { expect, test, type Page } from "@playwright/test";
import { login, submitProduct } from "./helpers";

// The platform admin's Users pages (Admin section): the list, one owner with their shops,
// and one shop with its totals and sales. A plain owner can't open them.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const OWNER = `stats-${run}@pos.local`;
const SHOP = `Stats Shop ${run}`;

let admin: Page;
let invitePath = "";

test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	await login(admin);
});
test.afterAll(async () => {
	await admin.close();
});

test("the platform admin sees every shop owner and can search them", async () => {
	// a second owner, invited with their own shop
	await admin.goto("/shops/create");
	await admin.getByLabel("Name", { exact: true }).fill(SHOP);
	await admin.getByLabel("Owner email").fill(OWNER);
	await admin.getByRole("button", { name: "Create shop" }).click();
	invitePath = new URL(await admin.getByLabel("Invitation link").inputValue())
		.pathname;

	await admin.getByRole("link", { name: "Users", exact: true }).click();
	await admin.waitForURL("**/owners");
	const table = admin.getByRole("table");
	await expect(table.getByText("admin@sellrika.local")).toBeVisible();
	const row = table.getByRole("row").filter({ hasText: OWNER });
	await expect(row.getByText("Invited")).toBeVisible();

	await admin.getByLabel("Search by name or email").fill(OWNER);
	await admin.waitForURL((u) => u.searchParams.get("q") === OWNER);
	await expect(table.getByText("admin@sellrika.local")).toHaveCount(0);
	await expect(row).toBeVisible();
});

test("an owner's page lists their shops; a shop's page shows its totals and sales", async () => {
	await admin.getByRole("table").getByRole("link").first().click();
	await admin.waitForURL(/\/owners\/\d+$/);
	await expect(admin.getByRole("heading", { level: 1 })).toContainText(
		"Invited",
	);
	// the campaign email limit: the default, then one set on this owner, then back
	const campaign = admin.getByRole("region", { name: "Campaign emails" });
	await expect(
		campaign.getByText("0 of 1000 sent this month through our email."),
	).toBeVisible();
	await campaign.getByLabel("Limit per month").fill("250");
	await campaign.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Limit saved")).toBeVisible();
	await admin.reload();
	await expect(campaign.getByLabel("Limit per month")).toHaveValue("250");
	await expect(
		campaign.getByText("0 of 250 sent this month through our email."),
	).toBeVisible();
	await campaign.getByLabel("Limit per month").fill("");
	await campaign.getByRole("button", { name: "Save" }).click();
	await expect(
		campaign.getByText("0 of 1000 sent this month through our email."),
	).toBeVisible();

	await admin.getByRole("link", { name: SHOP }).click();
	await admin.waitForURL(/\/owners\/\d+\/shops\/\d+$/);
	await expect(admin.getByRole("heading", { name: SHOP })).toBeVisible();
	const allTime = admin.getByRole("region", { name: "All time" });
	await expect(allTime.getByText("Products", { exact: true })).toBeVisible();
	await expect(allTime.getByText("0 switched on")).toBeVisible();
	await expect(admin.getByText("Online store off")).toBeVisible();

	// another period: the URL carries it, like /reports
	await admin.getByRole("tab", { name: "This year" }).click();
	await admin.waitForURL((u) => u.searchParams.get("preset") === "this_year");
	await expect(admin.getByRole("tab", { name: "This year" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(admin.getByText("Nothing sold in this range.")).toBeVisible();
});

test("the admin sees every product of an owner's shop, and can search them", async () => {
	// one product in the admin's own shop (Main Shop)
	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(`Tea ${run}`);
	await admin.getByLabel("Base price").fill("4.50");
	await submitProduct(admin);

	await admin.goto(`/owners?q=${encodeURIComponent("admin@sellrika.local")}`);
	await admin.getByRole("table").getByRole("link").first().click();
	await admin.getByRole("link", { name: "Main Shop" }).click();
	await admin.getByRole("link", { name: "View all products" }).click();
	await admin.waitForURL(/\/owners\/\d+\/shops\/\d+\/products$/);
	await expect(
		admin.getByRole("heading", { name: "Products of Main Shop" }),
	).toBeVisible();
	const row = admin.getByRole("row").filter({ hasText: `Tea ${run}` });
	await expect(row.getByText("$4.50")).toBeVisible();

	await admin
		.getByLabel("Search by name, SKU or barcode")
		.fill("no-such-thing");
	await admin.waitForURL((u) => u.searchParams.get("q") === "no-such-thing");
	await expect(admin.getByText("No products found.")).toBeVisible();
});

test("the sign-up switch on the Users page turns /register on and off", async () => {
	await admin.goto("/owners");
	const settings = admin.getByRole("button", { name: "Settings" });
	await settings.click();
	const toggle = admin.getByRole("switch", { name: "Allow people to sign up" });
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	expect((await admin.request.get("/register")).status()).toBe(404);
	await toggle.click();
	await expect(admin.getByText("Sign-up is now on")).toBeVisible();
	expect(
		(await admin.request.get("/register", { maxRedirects: 0 })).status(),
	).toBe(303); // signed in → /pos
	await admin.reload();
	await settings.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await toggle.click();
	await expect(admin.getByText("Sign-up is now off")).toBeVisible();
	expect((await admin.request.get("/register")).status()).toBe(404);
});

test("a plain shop owner can't open the Users pages", async ({ browser }) => {
	const owner = await (await browser.newContext()).newPage();
	await owner.goto(invitePath);
	await owner.getByLabel("Name", { exact: true }).fill("Stats Owner");
	await owner.getByLabel("New password", { exact: true }).fill("owner1234");
	await owner.getByLabel("Confirm new password").fill("owner1234");
	await owner.getByRole("button", { name: "Save and sign in" }).click();
	await owner.waitForURL("**/pos");
	await expect(
		owner.getByRole("link", { name: "Users", exact: true }),
	).toHaveCount(0);
	expect((await owner.request.get("/owners")).status()).toBe(403);
	expect((await owner.request.get("/owners/1")).status()).toBe(403);
	expect(
		(
			await owner.request.put("/owners/1/campaign-limit", {
				data: { limit: 99999 },
			})
		).status(),
	).toBe(403);
	expect((await owner.request.get("/owners/1/shops/1/products")).status()).toBe(
		403,
	);
	await owner.context().close();
});
