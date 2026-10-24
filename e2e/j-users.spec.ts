import { expect, test, type Page } from "@playwright/test";
import { ADMIN, login, submitProduct } from "./helpers";

// Staff (/users), the cashier role gates and /settings — one admin page plus a second page signed in as the cashier.
// Runs after flow.spec.ts (alphabetical) so the order it rings up can't disturb flow's exact totals.
// It restores the seeded admin's name and password at the end: later specs sign in as admin@sellrika.local / password
// and click the "Admin" user menu.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const CASHIER = { email: `cash-${run}@pos.local`, password: "cashier123" };
const RESET_PW = "cashier456";
const TEMP = `Temp ${run}`;
const PRODUCT = `Bun ${run}`;
const NEW_ADMIN_PW = "newpass123";

let cashierName = `Cash ${run}`; // renamed in the edit test
let orderPath = "";

let page: Page; // admin
let cash: Page; // cashier

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
	cash = await browser.newPage();
});
test.afterAll(async () => {
	await cash.close();
	await page.close();
});

async function loginAs(p: Page, email: string, password: string) {
	await p.goto("/login");
	await p.getByLabel("Email").fill(email);
	await p.getByLabel("Password").fill(password);
	await p.getByRole("button", { name: "Sign in" }).click();
}
const row = (name: string) => page.getByRole("row").filter({ hasText: name });
const dlg = () => page.getByRole("dialog");
async function fillStaff(name: string, email: string, password: string) {
	await dlg().getByLabel("Name", { exact: true }).fill(name);
	await dlg().getByLabel("Email", { exact: true }).fill(email);
	await dlg().getByLabel("Password", { exact: true }).fill(password);
}

test("admin adds a cashier", async () => {
	await page.goto("/users");
	await page.getByRole("button", { name: "Add staff" }).click();
	// the dialog comes with a random 8-character password, shown so it can be passed on
	const password = dlg().getByLabel("Password", { exact: true });
	await expect(password).toHaveValue(/^[a-km-zA-HJ-NP-Z2-9]{8}$/);
	const first = await password.inputValue();
	await dlg().getByRole("button", { name: "Generate a new password" }).click();
	await expect(password).not.toHaveValue(first);
	await fillStaff(cashierName, CASHIER.email, CASHIER.password);
	await dlg()
		.getByRole("button", { name: /^Cashier/ })
		.click();
	await dlg().getByRole("button", { name: "Add staff" }).click();
	await expect(page.getByText("Staff added")).toBeVisible();
	await expect(row(cashierName)).toContainText(CASHIER.email);
	await expect(
		row(cashierName).getByText("Cashier", { exact: true }),
	).toBeVisible();
	await expect(
		row(cashierName).getByLabel(`${cashierName} active`, { exact: true }),
	).toBeChecked();
});

test("new staff is validated: password length, then duplicate email", async () => {
	await page.goto("/users"); // reload: the "Staff added" toast sits on top of the header button for 4s
	await page.getByRole("button", { name: "Add staff" }).click();
	await fillStaff(`Short ${run}`, `short-${run}@pos.local`, "123");
	await dlg().getByRole("button", { name: "Add staff" }).click();
	await expect(dlg().getByText("Use at least 8 characters")).toBeVisible();

	await dlg().getByLabel("Email", { exact: true }).fill(CASHIER.email);
	await dlg().getByLabel("Password", { exact: true }).fill("longenough1");
	await dlg().getByRole("button", { name: "Add staff" }).click();
	await expect(dlg().getByText("That email is already in use")).toBeVisible();

	await dlg().getByRole("button", { name: "Cancel" }).click();
	await expect(row(`Short ${run}`)).toHaveCount(0);
});

test("edit staff: rename and flip the role", async () => {
	const renamed = `${cashierName} R`;
	await row(cashierName)
		.getByRole("button", { name: `Edit ${cashierName}` })
		.click();
	await dlg().getByLabel("Name", { exact: true }).fill(renamed);
	await dlg()
		.getByRole("button", { name: /^Admin/ })
		.click();
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Staff updated")).toBeVisible();
	cashierName = renamed;
	await expect(
		row(cashierName).getByText("Admin", { exact: true }),
	).toBeVisible();

	await row(cashierName)
		.getByRole("button", { name: `Edit ${cashierName}` })
		.click();
	await dlg()
		.getByRole("button", { name: /^Cashier/ })
		.click();
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(
		row(cashierName).getByText("Cashier", { exact: true }),
	).toBeVisible();
});

test("cashier signs in and sees only the pages they may use", async () => {
	await loginAs(cash, CASHIER.email, CASHIER.password);
	await cash.waitForURL("**/pos");
	for (const n of ["Sell", "Orders", "Customers"])
		await expect(
			cash.getByRole("link", { name: n, exact: true }),
		).toBeVisible();
	for (const n of [
		"Reports",
		"Products",
		"Stock",
		"Categories",
		"Payments",
		"Staff",
		"Shops",
	])
		await expect(cash.getByRole("link", { name: n, exact: true })).toHaveCount(
			0,
		);
	await cash.getByRole("button", { name: cashierName, exact: true }).click();
	await expect(cash.getByRole("menuitem", { name: "Settings" })).toBeVisible();
	await cash.keyboard.press("Escape");
});

test("cashier gets the 403 page on admin-only URLs", async () => {
	for (const path of ["/products", "/reports", "/users", "/stock"]) {
		await cash.goto(path);
		await expect(cash.getByText("Admins only")).toBeVisible();
	}
	await expect(cash.getByRole("link", { name: "Back to Sell" })).toBeVisible();
	// the image editor's link fetch is admin-only too
	const link = await cash.request.post("/uploads/link", {
		data: { url: "https://cdn.example.com/a.png" },
	});
	expect(link.status()).toBe(403);
	// the daily report's settings are for managers and admins
	const schedule = await cash.request.put("/reports/schedule", {
		data: { enabled: false, time: "22:00", channels: [] },
	});
	expect(schedule.status()).toBe(403);
	// the cities & postal codes list is shared by every shop — only an admin may download or remove a country
	const postal = await cash.request.post("/postal-codes", {
		data: { scope: "all" },
	});
	expect(postal.status()).toBe(403);
	// the store's currencies are an admin setting; the exchange rates a platform one
	const currencies = await cash.request.put("/online-store/currencies", {
		data: { currencies: [] },
	});
	expect(currencies.status()).toBe(403);
	// and a template's own colours and font
	const look = await cash.request.put("/online-store/theme", {
		data: { template: "classic", primary: "#ff0000" },
	});
	expect(look.status()).toBe(403);
	// so is the custom domain's DNS check
	expect((await cash.request.post("/online-store/domain/check")).status()).toBe(
		403,
	);
	expect((await cash.request.get("/exchange-rates")).status()).toBe(403);
	// the delivery statuses of the orders are the owner's setting: no button, and the route refuses
	await cash.goto("/orders");
	await expect(
		cash.getByRole("button", { name: "Delivery status settings" }),
	).toHaveCount(0);
	const steps = await cash.request.put("/orders/steps", {
		data: { steps: [] },
	});
	expect(steps.status()).toBe(403);
});

test("a manager runs the catalog and the cashiers, not the shop settings", async ({
	browser,
}) => {
	const MANAGER = { email: `mgr-${run}@pos.local`, password: "manager123" };
	const mgrName = `Mgr ${run}`;
	await page.goto("/users");
	await page.getByRole("button", { name: "Add staff" }).click();
	await fillStaff(mgrName, MANAGER.email, MANAGER.password);
	await dlg()
		.getByRole("button", { name: /^Manager/ })
		.click();
	await dlg().getByRole("button", { name: "Add staff" }).click();
	await expect(
		row(mgrName).getByText("Manager", { exact: true }),
	).toBeVisible();

	const mgr = await browser.newPage();
	await loginAs(mgr, MANAGER.email, MANAGER.password);
	await mgr.waitForURL("**/pos");
	for (const n of [
		"Reports",
		"Marketing",
		"Products",
		"Stock",
		"Categories",
		"Payments",
		"Staff",
	])
		await expect(mgr.getByRole("link", { name: n, exact: true })).toBeVisible();
	for (const n of ["Coupons", "Online Store", "Extensions"])
		await expect(mgr.getByRole("link", { name: n, exact: true })).toHaveCount(
			0,
		);
	for (const path of [
		"/products",
		"/stock",
		"/reports",
		"/marketing",
		"/payment-methods",
	]) {
		await mgr.goto(path);
		await expect(mgr.getByText("Admins only")).toHaveCount(0);
	}
	for (const path of ["/shops", "/online-store", "/coupons", "/extensions"]) {
		await mgr.goto(path);
		await expect(mgr.getByText("Admins only")).toBeVisible();
	}

	// staff: only cashier rows can be changed, and only the Cashier role is offered
	await mgr.goto("/users");
	const mrow = (text: string) => mgr.getByRole("row").filter({ hasText: text });
	await expect(
		mrow(ADMIN.email).getByRole("button", { name: /^Edit / }),
	).toBeDisabled();
	await expect(
		mrow(cashierName).getByRole("button", { name: `Edit ${cashierName}` }),
	).toBeEnabled();
	await mgr.getByRole("button", { name: "Add staff" }).click();
	const md = mgr.getByRole("dialog");
	await expect(md.getByRole("button", { name: /^Cashier/ })).toBeVisible();
	await expect(
		md.getByRole("button", { name: /^(Admin|Manager)/ }),
	).toHaveCount(0);
	await mgr.close();
});

test("cashier can switch shop when the account has more than one", async () => {
	await cash.goto("/pos");
	await cash.getByRole("button", { name: /^Shop: / }).click();
	const shops = cash.getByRole("menuitem");
	const names = await shops.allInnerTexts();
	if (names.length < 2) {
		await cash.keyboard.press("Escape");
		test.skip(true, "only one shop in this database");
	}
	const other = names.find((n) => !n.includes("Manage shops"))!;
	await shops.filter({ hasText: other }).first().click();
	await expect(
		cash.getByRole("button", { name: `Shop: ${other}` }),
	).toBeVisible();
});

test("cashier rings up a sale", async () => {
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(PRODUCT);
	await page.getByLabel("Base price").fill("5.00");
	await submitProduct(page);

	await cash.goto("/pos");
	await cash.getByPlaceholder(/Search or scan barcode/).fill(PRODUCT);
	await cash.locator("section button", { hasText: PRODUCT }).first().click();
	await cash.getByRole("button", { name: "Charge $5", exact: true }).click();
	const d = cash.getByRole("dialog");
	await d.getByRole("button", { name: "Cash", exact: true }).click();
	await d.getByRole("button", { name: "Confirm $5", exact: true }).click();
	await expect(d.getByRole("heading", { name: "Sale complete" })).toBeVisible();
	await d.getByRole("button", { name: "Done" }).click();
});

test("the cashier's order has no refund or void, the admin's does", async () => {
	await cash.goto("/orders");
	await cash
		.getByRole("button", { name: /^Open order / })
		.filter({ hasText: PRODUCT })
		.first()
		.click();
	await cash.waitForURL(/\/orders\/\d+$/);
	orderPath = new URL(cash.url()).pathname;
	await expect(cash.getByRole("button", { name: "Print" })).toBeVisible();
	await expect(cash.getByRole("button", { name: "Refund" })).toHaveCount(0);
	await expect(cash.getByRole("button", { name: "Void" })).toHaveCount(0);

	await page.goto(orderPath);
	await expect(page.getByText(`by ${cashierName}`).first()).toBeVisible(); // header + print receipt
	await expect(page.getByRole("button", { name: "Refund" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Void" })).toBeVisible();
});

test("sales staff: added with a commission, picked at checkout, their page adds up a period, and paying keeps a history", async () => {
	const SELLER = `Seller ${run}`;
	/**
	 * Open the Staff page on its Sales staff tab.
	 */
	async function openSalesTab() {
		await page.goto("/users");
		await page.getByRole("tab", { name: "Sales staff" }).click();
	}
	await openSalesTab();
	await page.getByRole("button", { name: "Add sales staff" }).click();
	await dlg().getByLabel("Name", { exact: true }).fill(SELLER);
	// more than 100% is refused
	await dlg().getByLabel("Commission").fill("150");
	await dlg().getByRole("button", { name: "Add sales staff" }).click();
	await expect(
		dlg().getByText("Commission must be between 0% and 100%"),
	).toBeVisible();
	await dlg().getByLabel("Commission").fill("10");
	await dlg().getByRole("button", { name: "Add sales staff" }).click();
	await expect(page.getByText("Sales staff added")).toBeVisible();
	await expect(row(SELLER)).toContainText("10%");

	// a cashier may not add or change sales staff
	const refused = await cash.request.post("/sales-staff", {
		data: { name: "Nope", commission: 0 },
	});
	expect(refused.status()).toBe(403);

	// the cashier names the sales person on a sale
	await cash.goto("/pos");
	await cash.getByPlaceholder(/Search or scan barcode/).fill(PRODUCT);
	await cash.locator("section button", { hasText: PRODUCT }).first().click();
	await cash.getByRole("button", { name: "Charge $5", exact: true }).click();
	const d = cash.getByRole("dialog");
	await d.getByRole("button", { name: "Cash", exact: true }).click();
	await d.getByRole("combobox", { name: "Sales staff (optional)" }).click();
	await cash.getByRole("option", { name: SELLER, exact: true }).click();
	await d.getByRole("button", { name: "Confirm $5", exact: true }).click();
	await expect(d.getByRole("heading", { name: "Sale complete" })).toBeVisible();
	await d.getByRole("button", { name: "Done" }).click();

	// their page: what they sold in a period, the commission, and what is not paid yet
	await openSalesTab();
	await page.getByRole("link", { name: `Open ${SELLER}` }).click();
	await page.waitForURL(/\/sales-staff\/\d+$/);
	const detail = new URL(page.url()).pathname;
	const totals = page.locator("[data-sales-totals]");
	await expect(totals).toContainText("$5");
	await expect(totals).toContainText("10% of the sales in this period");
	await expect(totals).toContainText("$0.50");
	await expect(totals).toContainText("Nothing paid yet");
	await expect(page.getByText("Nothing paid yet.")).toBeVisible(); // the empty history
	// another period: nothing sold yesterday, the commission due stays
	await page.getByRole("tab", { name: "Yesterday" }).click();
	await page.waitForURL(/preset=yesterday/);
	await expect(totals).not.toContainText("$5");
	await expect(totals).toContainText("$0.50");
	// a custom range, like on the reports page
	await page.getByRole("tab", { name: "Custom" }).click();
	const today = (await page
		.getByLabel("To", { exact: true })
		.getAttribute("max"))!;
	await page.getByLabel("From", { exact: true }).fill(today);
	await page.getByLabel("To", { exact: true }).fill(today);
	await page.getByRole("button", { name: "Apply" }).click();
	await page.waitForURL(/preset=custom/);
	await expect(totals).toContainText("$5");
	// a cashier may not open it
	expect((await cash.request.get(detail)).status()).toBe(403);

	// the orders page only filters by sales person: no totals there
	await page.getByRole("link", { name: "View orders" }).click();
	await page.waitForURL(/\/orders\?sales=\d+/);
	await expect(
		page.getByRole("combobox", { name: "Sales staff" }),
	).toContainText(SELLER);
	await expect(page.locator("[data-sales-totals]")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Open order / })).toHaveCount(
		1,
	);
	await page.getByRole("button", { name: /^Open order / }).click();
	await expect(page.getByText(`sold by ${SELLER}`)).toBeVisible();
	const sold = page.url();

	// paying: the amount goes to the history and the amount due starts again from zero
	const pay = await cash.request.post(`${detail}/pay`);
	expect(pay.status()).toBe(403); // a cashier may not
	await page.goto(detail);
	await page.getByRole("link", { name: "Back to sales staff" }).click();
	await expect(row(SELLER)).toContainText("$0.50"); // back on the Sales staff tab
	await expect(row(SELLER)).toContainText("Never");
	await row(SELLER)
		.getByRole("button", { name: `Pay ${SELLER}`, exact: true })
		.click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm).toContainText("Commission due: $0.50");
	await expect(confirm).toContainText("10% of $5, from 1 sales");
	await confirm.getByRole("button", { name: "Mark as paid" }).click();
	await expect(
		page.getByText(`Commission of ${SELLER} recorded as paid`),
	).toBeVisible();
	await expect(row(SELLER)).not.toContainText("Never");
	await expect(
		row(SELLER).getByRole("button", { name: `Pay ${SELLER}`, exact: true }),
	).toBeDisabled();
	await page.goto(detail);
	const paid = page
		.getByRole("region", { name: "Payment history" })
		.getByRole("row")
		.nth(1);
	for (const text of ["$0.50", "$5", "10%"])
		await expect(paid).toContainText(text);
	// nothing is due now, so the page's own Pay button is off
	await expect(
		page.getByRole("button", { name: `Pay ${SELLER}`, exact: true }),
	).toBeDisabled();
	await openSalesTab();

	// switched off: no longer offered at the POS
	await row(SELLER).getByLabel(`${SELLER} active`, { exact: true }).click();
	await expect(page.getByText(`${SELLER} deactivated`)).toBeVisible();
	await cash.goto("/pos");
	await cash.locator("section button", { hasText: PRODUCT }).first().click();
	await cash.getByRole("button", { name: "Charge $5", exact: true }).click();
	await expect(
		cash
			.getByRole("dialog")
			.getByRole("combobox", { name: "Sales staff (optional)" }),
	).toHaveCount(0);

	// deleted: the sale stays, with nobody named on it
	await row(SELLER)
		.getByRole("button", { name: `Delete ${SELLER}` })
		.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
	// the open dialog hides the rows, so wait for the server's answer first
	await expect(page.getByText(`Deleted “${SELLER}”`)).toBeVisible();
	await expect(row(SELLER)).toHaveCount(0);
	await page.goto(sold);
	await expect(page.getByText(`sold by ${SELLER}`)).toHaveCount(0);
});

test("an admin can't demote or delete themselves", async () => {
	await page.goto("/users");
	await expect(page.getByLabel("Admin active", { exact: true })).toBeDisabled();
	await expect(
		page.getByRole("button", { name: /^Delete Admin/ }),
	).toBeDisabled();

	await page.getByRole("button", { name: "Edit Admin", exact: true }).click();
	await dlg()
		.getByRole("button", { name: /^Cashier/ })
		.click();
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(
		page.getByText("You can't remove your own admin access").first(),
	).toBeVisible();
	await dlg().getByRole("button", { name: "Cancel" }).click();
	await expect(
		page.getByRole("link", { name: "Staff", exact: true }),
	).toBeVisible(); // still an admin
	// the signed-in admin is also the shop owner: "The shop owner always stays an active admin" is covered
	// for other admins in User.Service.test.ts; here demoting yourself hits the rule above first.
});

test("deactivating a cashier signs them out and refuses a fresh login", async () => {
	await page.getByLabel(`${cashierName} active`, { exact: true }).click();
	await expect(page.getByText(`${cashierName} deactivated`)).toBeVisible();

	await cash.goto("/pos");
	await expect(cash).toHaveURL(/\/login$/);
	await loginAs(cash, CASHIER.email, CASHIER.password);
	await expect(cash.getByText("This account has been disabled")).toBeVisible();

	await page.getByLabel(`${cashierName} active`, { exact: true }).click();
	await expect(page.getByText(`${cashierName} activated`)).toBeVisible();
	await loginAs(cash, CASHIER.email, CASHIER.password);
	await cash.waitForURL("**/pos");
});

test("resetting a password signs the cashier out; only the new one works", async () => {
	await page.getByRole("button", { name: `Edit ${cashierName}` }).click();
	await dlg().getByLabel("New password").fill(RESET_PW);
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Staff updated")).toBeVisible();

	await cash.goto("/pos");
	await expect(cash).toHaveURL(/\/login$/);
	await loginAs(cash, CASHIER.email, CASHIER.password);
	await expect(
		cash.getByText("These credentials do not match our records"),
	).toBeVisible();
	await loginAs(cash, CASHIER.email, RESET_PW);
	await cash.waitForURL("**/pos");
});

test("delete is blocked for staff with sales, allowed for a fresh account", async () => {
	await page.goto("/users");
	await expect(
		row(cashierName).getByRole("button", { name: /Has sales history/ }),
	).toBeDisabled();

	await page.getByRole("button", { name: "Add staff" }).click();
	await fillStaff(TEMP, `temp-${run}@pos.local`, "temp12345");
	await dlg().getByRole("button", { name: "Add staff" }).click();
	await expect(row(TEMP)).toBeVisible();

	await row(TEMP)
		.getByRole("button", { name: `Delete ${TEMP}`, exact: true })
		.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await expect(page.getByText("Deleted")).toBeVisible();
	await expect(row(TEMP)).toHaveCount(0);
});

test("settings: renaming yourself updates the sidebar", async () => {
	const boss = `Boss ${run}`;
	await page.goto("/settings");
	await page.getByLabel("Name", { exact: true }).fill(boss);
	await page.getByRole("button", { name: "Save name" }).click();
	await expect(page.getByText("Name updated")).toBeVisible();
	await expect(
		page.getByRole("button", { name: boss, exact: true }),
	).toBeVisible();

	// put it back: later specs click the "Admin" user menu
	await page.getByLabel("Name", { exact: true }).fill("Admin");
	await page.getByRole("button", { name: "Save name" }).click();
	await expect(
		page.getByRole("button", { name: "Admin", exact: true }),
	).toBeVisible();
});

test("settings: RawBT printing is off by default and remembered per device", async () => {
	await page.goto("/settings");
	await page.getByRole("button", { name: "Printing", exact: true }).click();
	await expect(page).toHaveURL(/\?section=printing$/); // the rail is deep-linkable
	const rawbt = page.getByRole("switch", { name: "Print through RawBT" });
	await expect(rawbt).toHaveAttribute("aria-checked", "false");
	await expect(page.getByLabel("Paper width")).toBeHidden(); // only shown once it is on

	await rawbt.click();
	await page.getByLabel("Paper width").click();
	await page.getByRole("option", { name: "80 mm (48 characters)" }).click();
	expect(
		await page.evaluate(() => [
			localStorage.getItem("rawbt"),
			localStorage.getItem("rawbt-cols"),
		]),
	).toEqual(["true", "48"]);

	// survives a reload (?section=printing brings the card straight back), then back off so the
	// Print buttons in later specs stay on window.print()
	await page.reload();
	await expect(rawbt).toHaveAttribute("aria-checked", "true");
	await rawbt.click();
	await expect(page.getByLabel("Paper width")).toBeHidden();
});

test("outgoing email is platform-admin-only; both providers save, one delivers", async () => {
	expect((await cash.request.get("/email")).status()).toBe(403); // platform-wide setting, the platform admin only
	await cash.goto("/pos");
	await expect(cash.getByRole("link", { name: "Outgoing Email" })).toHaveCount(
		0,
	);

	await page.goto("/pos");
	await page.getByRole("link", { name: "Outgoing Email" }).click();
	await expect(page).toHaveURL(/\/email$/);
	await expect(page.getByText("No shop")).toHaveCount(0); // the page's props don't hide the sidebar's shared active shop
	await expect(page.getByLabel("From name")).toHaveCount(0); // the name comes from who sends: the app or the shop
	await page.getByLabel("From address").fill("noreply@example.com");
	await expect(
		page.getByText("Every email goes out from noreply@example.com"),
	).toBeVisible(); // one address for every email
	// fill both providers, then switch SMTP on — nothing listens on port 1, so the test send fails without the network
	await page.getByLabel("Host", { exact: true }).fill("127.0.0.1");
	await page.getByLabel("Port", { exact: true }).fill("1");
	await page.getByLabel("Password", { exact: true }).fill("s3cret");
	await page.getByLabel("API key", { exact: true }).fill("re_e2e_key");
	await page.getByLabel("SMTP delivery").click();
	await page.getByRole("option", { name: "Enabled" }).click();
	await page.getByRole("button", { name: "Save email settings" }).click();
	await expect(page.getByText("Email settings saved")).toBeVisible();
	await expect(page.getByText("Saved", { exact: true })).toHaveCount(2); // both secrets stored, neither shown again
	await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");

	await page.getByRole("button", { name: "Send test" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByLabel("To")).toHaveValue(ADMIN.email); // prefilled with whoever is signed in
	await dialog.getByLabel("To").fill("someone@example.com");
	await dialog.getByRole("button", { name: "Send test" }).click();
	await expect(
		dialog.getByText(/Could not reach 127\.0\.0\.1:1/),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();

	// switching delivery to Resend keeps the SMTP host — both configs live side by side
	await page.getByLabel("Resend delivery").click();
	await page.getByRole("option", { name: "Enabled" }).click();
	await expect(page.getByLabel("SMTP delivery")).toContainText("Disabled"); // only one delivers
	await page.getByRole("button", { name: "Save email settings" }).click();
	await expect(page.getByText("Email settings saved").last()).toBeVisible();
	await page.reload();
	await expect(page.getByLabel("Host", { exact: true })).toHaveValue(
		"127.0.0.1",
	);
	await expect(page.getByLabel("Resend delivery")).toContainText("Enabled");
});

test("shop email: the shop's own setup, else the platform's one address", async () => {
	expect((await cash.request.get("/shop-email")).status()).toBe(403); // admins only
	await page.goto("/pos");
	await page.getByRole("link", { name: "Shop Email" }).click();
	await expect(page).toHaveURL(/\/shop-email$/);
	await expect(page.getByText("No shop")).toHaveCount(0); // the sidebar still shows the active shop
	// no own setup yet: the platform's Resend (switched on above) sends, from the platform's address
	await expect(
		page.getByText(/goes out through the platform, from noreply@example\.com/),
	).toBeVisible();
	await expect(page.getByLabel("API key", { exact: true })).toHaveValue(""); // the platform's keys are not shown here
	// switched on without an address: refused
	await page.getByLabel("API key", { exact: true }).fill("re_shop_key");
	await page.getByLabel("Resend delivery").click();
	await page.getByRole("option", { name: "Enabled" }).click();
	await page.getByRole("button", { name: "Save email settings" }).click();
	await expect(page.getByText("A sender address is required")).toBeVisible();
	await page.getByLabel("From address").fill("hello@myshop.com");
	await page.getByRole("button", { name: "Save email settings" }).click();
	await expect(page.getByText("Email settings saved")).toBeVisible();
	await page.reload();
	await expect(page.getByLabel("From address")).toHaveValue("hello@myshop.com");
	await expect(page.getByText(/goes out through the platform/)).toHaveCount(0);
	// switch it off again, so the other specs send the platform's way
	await page.getByLabel("Resend delivery").click();
	await page.getByRole("option", { name: "Disabled" }).click();
	await page.getByRole("button", { name: "Save email settings" }).click();
	await expect(page.getByText("Email settings saved").last()).toBeVisible();
});

test("settings: password is validated, changed, and put back", async ({
	browser,
}) => {
	await page.goto("/settings?section=password");
	const current = page.getByLabel("Current password", { exact: true });
	const next = page.getByLabel("New password", { exact: true });
	const confirm = page.getByLabel("Confirm new password");
	const submit = page.getByRole("button", { name: "Update password" });

	await current.fill("not-my-password");
	await next.fill(NEW_ADMIN_PW);
	await confirm.fill(NEW_ADMIN_PW);
	await submit.click();
	await expect(page.getByText("Current password is incorrect")).toBeVisible();

	await current.fill(ADMIN.password);
	await next.fill("short");
	await confirm.fill("short");
	await submit.click();
	await expect(page.getByText("Use at least 8 characters")).toBeVisible();

	await next.fill(NEW_ADMIN_PW);
	await confirm.fill("something-else");
	await submit.click();
	await expect(page.getByText("Passwords do not match")).toBeVisible();

	await confirm.fill(NEW_ADMIN_PW);
	await submit.click();
	await expect(page.getByText("Password changed")).toBeVisible();

	const fresh = await browser.newPage();
	await loginAs(fresh, ADMIN.email, NEW_ADMIN_PW);
	await fresh.waitForURL("**/pos");
	await fresh.close();

	// restore the seeded password — the specs that run after this one need it
	await page.goto("/settings?section=password");
	await page.getByLabel("Current password", { exact: true }).fill(NEW_ADMIN_PW);
	await page.getByLabel("New password", { exact: true }).fill(ADMIN.password);
	await page.getByLabel("Confirm new password").fill(ADMIN.password);
	await page.getByRole("button", { name: "Update password" }).click();
	await expect(page.getByText("Password changed")).toBeVisible();

	const back = await browser.newPage();
	await loginAs(back, ADMIN.email, ADMIN.password);
	await back.waitForURL("**/pos");
	await back.close();
});
