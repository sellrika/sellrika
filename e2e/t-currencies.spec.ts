import { expect, test, type Page } from "@playwright/test";
import { amount, login, submitProduct } from "./helpers";
import { storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("t-currencies");

// Multi-currency on the online store (display only). The platform admin sets how often the automatic
// exchange rates are fetched (/exchange-rates — the e2e fixture server answers USD 1 = EUR 0.5 = GBP 0.8);
// a shop owner turns currencies on at /online-store › Currencies (EUR automatic, GBP with a rate of its own);
// a visitor switches in the header dropdown and sees converted prices, while the checkout still charges USD.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const P = `FX Mug ${run}`;

let admin: Page;
let visitor: Page; // separate context → no session cookie
test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	await login(admin);
	visitor = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
	await admin.close();
	await visitor.context().close();
});

test("platform admin: the rates are fetched on boot; the schedule is saved; Refresh now fetches again", async () => {
	await admin.goto("/exchange-rates");
	await expect(admin).toHaveTitle(/Exchange rates/);
	const table = admin.getByRole("table");
	await expect(table.getByRole("row", { name: /EUR/ })).toContainText("0.5");
	await admin.getByLabel("Filter currencies").fill("gb");
	await expect(table.getByRole("row")).toHaveCount(2); // header + GBP
	// the schedule, Refresh now and the last fetch sit in the Settings dialog
	await admin.getByRole("button", { name: "Settings" }).click();
	await expect(admin.locator("[data-rates-status]")).toContainText(
		"Last updated",
	);
	// every hour instead of daily
	await expect(admin.getByRole("combobox", { name: "Update" })).toContainText(
		"Daily",
	);
	await admin.getByRole("combobox", { name: "Update" }).click();
	await admin.getByRole("option", { name: "Every hour" }).click();
	await admin.getByRole("button", { name: "Save", exact: true }).click();
	await expect(admin.getByText("Schedule saved")).toBeVisible();
	await admin.reload();
	await admin.getByRole("button", { name: "Settings" }).click();
	await expect(admin.getByRole("combobox", { name: "Update" })).toContainText(
		"Every hour",
	);
	const refreshed = admin.waitForResponse(
		(r) => new URL(r.url()).pathname === "/exchange-rates/refresh",
	);
	await admin.getByRole("button", { name: "Refresh now" }).click();
	expect((await refreshed).status()).toBe(303);
	await expect(admin.locator("[data-rates-status]")).toContainText(
		"Last updated",
	);
	await admin.keyboard.press("Escape"); // an open dialog hides the page behind it
	// it has its own place in the sidebar (Admin)
	await expect(
		admin.getByRole("link", { name: "Exchange rates" }),
	).toBeVisible();
});

test("owner: a product, the store on, and two extra currencies — EUR automatic, GBP at a rate of its own", async () => {
	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(P);
	await admin.getByLabel("Base price").fill("10.00");
	await submitProduct(admin);

	await admin.goto("/online-store");
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Online store settings saved")).toBeVisible();

	await admin.goto("/online-store?section=currencies");
	await expect(
		admin.getByText("Only your shop's own currency is shown."),
	).toBeVisible();
	for (const code of ["EUR", "GBP"]) {
		await admin.locator("#add-currency").click();
		await admin.getByPlaceholder("Search currency…").fill(code);
		await admin
			.getByRole("option", { name: new RegExp(`^${code}`) })
			.first()
			.click();
		await admin.getByRole("button", { name: "Add currency" }).click();
	}
	await expect(admin.locator("[data-currency]")).toHaveCount(2);
	await expect(admin.locator("[data-currency]").first()).toContainText(
		"Automatic: 1 USD = 0.5 EUR",
	);
	// a rate of zero is refused by the server
	await admin.getByLabel("Rate for GBP").fill("0");
	await admin.getByRole("button", { name: "Save currencies" }).click();
	await expect(
		admin.getByText("The rate must be more than zero"),
	).toBeVisible();
	await admin.getByLabel("Rate for GBP").fill("0.9");
	await admin.getByRole("button", { name: "Save currencies" }).click();
	await expect(admin.getByText("Currencies saved")).toBeVisible();
	await admin.reload();
	await expect(admin.getByLabel("Rate for GBP")).toHaveValue("0.9");
	await expect(admin.getByLabel("Rate for EUR")).toHaveValue("");
});

test("visitor: the header dropdown shows prices in EUR / GBP; the checkout still charges USD", async () => {
	await visitor.goto(STORE);
	const card = visitor.getByRole("link", { name: P, exact: true });
	await expect(card).toContainText(amount("$10"));
	const switcher = visitor.getByRole("combobox", { name: "Currency" });
	await expect(switcher.getByRole("option")).toHaveText(["USD", "EUR", "GBP"]);

	await switcher.selectOption("EUR");
	await expect(card).toContainText(amount("€5"));
	await expect(switcher).toHaveValue("EUR");
	// the choice is a cookie: the server renders the next page in EUR already
	const html = await (await visitor.request.get(STORE)).text();
	expect(html).toContain("€5");

	await switcher.selectOption("GBP");
	await expect(card).toContainText(amount("£9")); // the shop's own rate, not the automatic 0.8

	// the cart shows GBP; the checkout is in the shop's currency with a note
	await card.click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(visitor.getByRole("dialog")).toContainText(amount("£9"));
	await visitor.goto(`${STORE}/checkout`); // no payment option here: the cart's button would send the order
	await expect(visitor.locator("[data-currency-note]")).toHaveText(
		"About £9. You pay in USD.",
	);
	await expect(visitor.locator("aside")).toContainText(amount("$10"));

	// back to the shop's own currency: no note
	await visitor.getByRole("combobox", { name: "Currency" }).selectOption("USD");
	await expect(visitor.locator("[data-currency-note]")).toHaveCount(0);
});

test("owner: removing every extra currency hides the switcher", async () => {
	await admin.goto("/online-store?section=currencies");
	await admin.getByRole("button", { name: "Remove EUR" }).click();
	await admin.getByRole("button", { name: "Remove GBP" }).click();
	await admin.getByRole("button", { name: "Save currencies" }).click();
	await expect(admin.getByText("Currencies saved")).toBeVisible();
	await visitor.goto(STORE);
	await expect(
		visitor.getByRole("link", { name: P, exact: true }),
	).toContainText(amount("$10"));
	await expect(visitor.getByRole("combobox", { name: "Currency" })).toHaveCount(
		0,
	);
});
