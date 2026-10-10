import { expect, test } from "@playwright/test";
import { enableGlobally, login, submitProduct } from "./helpers";

// The Loyalty Points extension: the admin sets the rule, a customer earns points on paid sales,
// the goal gives a discount code, and the Loyalty page shows the points and the history to every role.
const run = Date.now().toString(36);
const P = `Loyal Mug ${run}`;
const NAME = "Loyalty Points";
const BUYER = `Loyal Ann ${run}`;

test("loyalty: paid sales to a customer earn points, the goal gives a discount code", async ({
	page,
	request,
}) => {
	await login(page);
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(P);
	await page.getByLabel("Base price").fill("25.00");
	await submitProduct(page);

	// switching it on before it is set up opens the settings
	await enableGlobally(page, NAME);
	await page.goto("/extensions");
	const ext = page.getByRole("row").filter({ hasText: NAME });
	await ext.getByLabel(`${NAME} enabled`).click();
	const settings = page.getByRole("dialog");
	// its own settings form: three questions, and an example that follows the answers
	await expect(settings.getByText("Loyalty points is on")).toBeVisible();
	await settings
		.getByLabel("How much must a customer pay to get 1 point?")
		.fill("1");
	await settings
		.getByLabel("How many points does a customer need for a reward?")
		.fill("30");
	await settings.getByRole("button", { name: "Money off" }).click();
	await settings.getByLabel("Reward size").fill("5");
	await expect(settings.locator("[data-loyalty-summary]")).toHaveText(
		"About every $30 paid gives one $5 off code.",
	);
	await expect(
		settings.getByText("Customer gets a code for $5 off"),
	).toBeVisible();
	if (process.env.LOYALTY_SHOT)
		await page.screenshot({ path: `${process.env.LOYALTY_SHOT}/config.png` });
	await settings.getByRole("button", { name: "Save" }).click();
	await expect(ext.getByLabel(`${NAME} enabled`)).toBeChecked();

	await page.goto("/customers");
	await page.getByRole("button", { name: "Add customer" }).first().click();
	const add = page.getByRole("dialog");
	await add.getByLabel("Name", { exact: true }).fill(BUYER);
	await add.getByRole("button", { name: "Add customer" }).click();
	await expect(add).toBeHidden();

	// two cash sales of 25.00 to that customer: 25 points, then 50 = one reward and 20 left
	for (const _ of [1, 2]) {
		await page.goto("/pos");
		await page.locator("section button", { hasText: P }).first().click();
		await page.getByRole("button", { name: "Add customer" }).click();
		await add.getByPlaceholder("Search name or phone").fill(BUYER);
		await add.getByRole("button", { name: BUYER, exact: true }).click();
		await page.getByRole("button", { name: "Charge $25", exact: true }).click();
		const sale = page.getByRole("dialog");
		await sale.getByRole("button", { name: "Cash", exact: true }).click();
		await sale.getByLabel("Amount tendered").fill("25.00");
		await sale
			.getByRole("button", { name: "Confirm $25", exact: true })
			.click();
		await expect(sale.getByText(/Order #\d+/).first()).toBeVisible();
	}
	// the second sale reached the goal: its receipt prints the points and the reward's code
	const slip = page.locator("#receipt");
	await expect(slip).toContainText("Points earned+25");
	await expect(slip).toContainText("Your points20 of 30");
	await expect(slip).toContainText("Your reward: $5 off");
	await expect(slip).toContainText(/Code: LOYAL-[A-Z0-9]{8}/);

	// the Sell screen tells the cashier: the customer's points and one button that puts the reward on the sale
	await page.goto("/pos");
	await page.locator("section button", { hasText: P }).first().click();
	await page.getByRole("button", { name: "Add customer" }).click();
	await add.getByPlaceholder("Search name or phone").fill(BUYER);
	await add.getByRole("button", { name: BUYER, exact: true }).click();
	const strip = page.locator("[data-loyalty]").first();
	await expect(strip).toContainText("20 of 30 points");
	if (process.env.LOYALTY_SHOT)
		await page.screenshot({ path: `${process.env.LOYALTY_SHOT}/till.png` });
	await strip.getByRole("button", { name: "Use reward: $5 off" }).click();
	await expect(
		strip.getByRole("button", { name: "Reward applied: $5 off" }),
	).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Charge $20", exact: true }),
	).toBeVisible();
	// the sale is not finished: the reward stays unused
	await page.getByRole("button", { name: "Clear", exact: true }).click();
	await page.getByRole("button", { name: "Clear cart" }).click();

	// the page sits in the sidebar; the points are booked just after the sale, so look until they are there
	await page.goto("/pos");
	await page.getByRole("link", { name: "Loyalty", exact: true }).click();
	await expect(page).toHaveURL(/\/extensions\/loyalty\/members$/);
	const row = page.locator("[data-member]").filter({ hasText: BUYER });
	await expect(async () => {
		await page.reload();
		await expect(row).toContainText("20 of 30 points", { timeout: 2000 });
	}).toPass();
	await expect(page.getByText("1 members")).toBeVisible();

	// the search finds the member by name
	await page.getByPlaceholder("Search by name or phone").fill("no-such-person");
	await expect(page.getByText("No member found.")).toBeVisible();
	await page.getByPlaceholder("Search by name or phone").fill(BUYER);
	await expect(row).toBeVisible();

	// the history: two orders and the reward with its code
	await row.getByRole("button").click();
	const history = page.getByRole("dialog", { name: `Points of ${BUYER}` });
	await expect(history).toContainText("50 earned in all");
	await expect(history.getByText("+25")).toHaveCount(2);
	const reward = await history.getByText(/Reward: code LOYAL-/).innerText();
	const code = reward.match(/LOYAL-[A-Z0-9]{8}/)![0];

	// the reward is a normal discount code of the shop
	await page.goto(`/coupons?q=${code}`);
	await expect(page.getByText(code).first()).toBeVisible();

	// nobody reads the members without signing in
	const guest = await request.get("/ext/loyalty/members", { maxRedirects: 0 });
	expect(guest.status()).not.toBe(200);
});
