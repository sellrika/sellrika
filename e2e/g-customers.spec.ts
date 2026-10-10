import { expect, test, type Page } from "@playwright/test";
import { amount, login, search as searchBox, submitProduct } from "./helpers";

// Customers end to end: list (add / validate / search / page), detail (+ edit, purchase history),
// attaching one to a sale at the till (search + quick-add), and deleting one without losing the order.
// Serial: every step builds on the previous one. Sorts after flow.spec.ts on purpose — it adds orders.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36); // unique names per run
const ANN = `Ann${run}`;
const ANNIE = `Annie${run}`; // ANN after the edit
const BOB = `Bob${run}`;
const QUICK = `Quick${run}`;
const PHONE = `0911${run}`;
const EMAIL = `ann.${run}@shop.test`;
const NOTE = `Likes oat milk ${run}`;
const NOTE2 = `Allergic to nuts ${run}`;
const PRODUCT = `Bean ${run}`; // 3.00, no variants

let page: Page;
let orderUrl = "";
test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});
test.afterAll(() => page.close());

const dlg = () => page.getByRole("dialog");
const crow = (name: string) =>
	page.getByRole("button", { name: `Open ${name}`, exact: true }); // list rows are role=button
const card = (name: string) =>
	page.getByRole("button", { name: new RegExp(`${name} \\$`) }); // POS product card: "B Name $3"
const search = (q: string) => searchBox(page, "Search customers", q);

async function fillCustomer(v: {
	name?: string;
	phone?: string;
	email?: string;
	note?: string;
}) {
	if (v.name !== undefined)
		await dlg().getByLabel("Name", { exact: true }).fill(v.name);
	if (v.phone !== undefined)
		await dlg().getByLabel("Phone", { exact: true }).fill(v.phone);
	if (v.email !== undefined)
		await dlg().getByLabel("Email", { exact: true }).fill(v.email);
	if (v.note !== undefined)
		await dlg().getByLabel("Note", { exact: true }).fill(v.note);
}

/** Put PRODUCT in the cart on a clean /pos. */
async function startSale() {
	await page.goto("/pos");
	await page.getByPlaceholder(/Search or scan barcode/).fill(PRODUCT);
	await card(PRODUCT).click();
	await expect(
		page.getByRole("button", { name: "Charge $3", exact: true }),
	).toBeEnabled();
}
async function checkout() {
	await page.getByRole("button", { name: "Charge $3", exact: true }).click();
	await dlg().getByRole("button", { name: "Cash", exact: true }).click();
	await dlg().getByRole("button", { name: "Confirm $3", exact: true }).click();
	await expect(
		dlg().getByRole("heading", { name: "Sale complete" }),
	).toBeVisible();
}

test("add a customer with every field", async () => {
	await page.goto("/customers");
	await page.getByRole("button", { name: "Add customer" }).first().click();
	await expect(
		dlg().getByRole("heading", { name: "Add customer" }),
	).toBeVisible();
	await fillCustomer({ name: ANN, phone: PHONE, email: EMAIL, note: NOTE });
	await dlg().getByRole("button", { name: "Add customer" }).click();
	await expect(page.getByText("Customer added")).toBeVisible();
	await expect(crow(ANN)).toContainText(PHONE);
	await expect(crow(ANN)).toContainText(EMAIL);
	await expect(crow(ANN)).toContainText(amount("$0")); // nothing bought yet
});

test("the add form validates name, email and a duplicate phone", async () => {
	await page.goto("/customers"); // reload: the "Customer added" toast sits on top of the header button for 4s
	await page.getByRole("button", { name: "Add customer" }).first().click();

	await dlg().getByRole("button", { name: "Add customer" }).click(); // empty
	await expect(
		dlg().getByText("Name is required", { exact: true }),
	).toBeVisible(); // "Only the name is required." is in the dialog too

	await fillCustomer({ name: BOB, email: "a@b" }); // passes the browser's type=email check, not zod's
	await dlg().getByRole("button", { name: "Add customer" }).click();
	await expect(dlg().getByText("Enter a valid email")).toBeVisible();

	await fillCustomer({ email: "", phone: PHONE }); // phone already belongs to ANN
	await dlg().getByRole("button", { name: "Add customer" }).click();
	await expect(
		dlg().getByText(new RegExp(`Phone already used by .${ANN}.`)),
	).toBeVisible();

	await fillCustomer({ phone: `${PHONE}9` });
	await dlg().getByRole("button", { name: "Add customer" }).click();
	await expect(page.getByText("Customer added")).toBeVisible();
	await expect(crow(BOB)).toBeVisible();
});

test("search filters the list and the pager shows the range", async () => {
	await search(run);
	await expect(page.getByText("2 matching customers")).toBeVisible();
	await expect(page.getByText("1–2 of 2")).toBeVisible();
	await expect(page.getByText("1 / 1")).toBeVisible();

	await search(ANN);
	await expect(
		page.getByText("1 matching customer", { exact: true }),
	).toBeVisible();
	await expect(crow(ANN)).toBeVisible();
	await expect(crow(BOB)).toHaveCount(0);

	await search(`nobody${run}`);
	await expect(page.getByText("No matching customers")).toBeVisible();

	await search("");
	await expect(crow(ANN)).toBeVisible();
});

test("customer detail shows the fields and an empty purchase history", async () => {
	await crow(ANN).click();
	await page.waitForURL(/\/customers\/\d+$/);
	await expect(page.getByRole("heading", { name: ANN })).toBeVisible();
	await expect(page.getByText(PHONE)).toBeVisible();
	await expect(page.getByText(EMAIL)).toBeVisible();
	await expect(page.getByText(NOTE)).toBeVisible();
	await expect(page.getByText("No purchases yet")).toBeVisible();
	await expect(page.getByText(amount("$0"))).toBeVisible(); // total spent
});

test("a customer keeps several addresses: add two, change one, remove one", async () => {
	const list = page.locator("[data-customer-addresses]");
	await expect(list).toContainText("No addresses yet.");

	// only the first line is needed
	await list.getByRole("button", { name: "Add address" }).click();
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(dlg().getByText("Address is required")).toBeVisible();
	await dlg().getByLabel("Label").fill("Home");
	await dlg().getByLabel("Address", { exact: true }).fill("9 Rama IV Rd");
	await dlg().getByLabel("City").fill("Bangkok");
	await dlg().getByLabel("Tax ID").fill("GB123456789"); // optional, for invoices
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Address saved")).toBeVisible();
	await expect(list.locator("[data-address-tax-id]")).toHaveText(
		"Tax ID: GB123456789",
	);
	await expect(list.locator("[data-address]")).toHaveCount(1);

	await list.getByRole("button", { name: "Add address" }).click();
	await dlg().getByLabel("Label").fill("Office");
	await dlg().getByLabel("Address", { exact: true }).fill("1 Work St");
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(list.locator("[data-address]")).toHaveCount(2);

	await list.getByRole("button", { name: "Edit address Home" }).click();
	await expect(dlg().getByLabel("City")).toHaveValue("Bangkok");
	await dlg().getByLabel("City").fill("Nonthaburi");
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(list).toContainText("9 Rama IV Rd, Nonthaburi");

	await list.getByRole("button", { name: "Delete address Office" }).click();
	await expect(list.locator("[data-address]")).toHaveCount(1);
});

test("edit a customer", async () => {
	await page.reload(); // the "Customer added" toast from two tests ago still covers the Edit button
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(dlg().getByLabel("Name", { exact: true })).toHaveValue(ANN);
	await fillCustomer({ name: ANNIE, note: NOTE2 });
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Customer updated")).toBeVisible();
	await expect(page.getByRole("heading", { name: ANNIE })).toBeVisible();
	await expect(page.getByText(NOTE2)).toBeVisible();

	await page.getByRole("link", { name: "Back to customers" }).click();
	await page.waitForURL("**/customers");
	await expect(crow(ANNIE)).toBeVisible();
});

test("sell to a customer picked at the till", async () => {
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(PRODUCT);
	await page.getByLabel("Base price").fill("3.00");
	await submitProduct(page);

	await startSale();
	await page.getByRole("button", { name: "Add customer" }).click();
	await expect(dlg().getByRole("heading", { name: "Customer" })).toBeVisible();
	await dlg().getByPlaceholder("Search name or phone").fill(ANNIE);
	await dlg()
		.getByRole("button", { name: `${ANNIE} ${PHONE}`, exact: true })
		.click(); // the result row, not "New customer …"
	await expect(
		page.getByRole("button", { name: "Remove customer" }),
	).toBeVisible();
	await expect(page.getByText(`${ANNIE} · ${PHONE}`)).toBeVisible(); // cart header

	await page.getByRole("button", { name: "Charge $3", exact: true }).click();
	await expect(
		dlg().getByText(`1 line in this sale for ${ANNIE}.`),
	).toBeVisible();
	await dlg().getByRole("button", { name: "Cash", exact: true }).click();
	await dlg().getByRole("button", { name: "Confirm $3", exact: true }).click();
	await expect(
		dlg().getByRole("heading", { name: "Sale complete" }),
	).toBeVisible();
	await expect(
		dlg().getByText(new RegExp(`Order #\\d+ · Cash · ${ANNIE}`)),
	).toBeVisible();
	await dlg().getByRole("button", { name: "Done" }).click();
	await expect(
		page.getByRole("button", { name: "Add customer" }),
	).toBeVisible(); // customer cleared with the cart
});

test("quick-add a customer from the picker", async () => {
	await startSale();
	await page.getByRole("button", { name: "Add customer" }).click();
	await dlg().getByPlaceholder("Search name or phone").fill(QUICK);
	await expect(dlg().getByText("No customer matches")).toBeVisible();
	await dlg()
		.getByRole("button", { name: /New customer/ })
		.click();
	await expect(dlg().getByLabel("Name", { exact: true })).toHaveValue(QUICK); // the typed text seeds the form
	await dlg().getByLabel(/Phone/).fill(`0977${run}`);
	await dlg().getByRole("button", { name: "Add & attach" }).click();
	await expect(page.getByText(`Added ${QUICK}`)).toBeVisible();
	await expect(page.getByText(`${QUICK} · 0977${run}`)).toBeVisible();

	await checkout();
	await page.getByRole("button", { name: "Done" }).click();

	await page.goto("/customers");
	await search(QUICK);
	await expect(crow(QUICK)).toContainText(`0977${run}`);
	await expect(crow(QUICK)).toContainText(amount("$3")); // total spent
});

test("purchase history links to the order, which shows the customer", async () => {
	await search(ANNIE);
	await crow(ANNIE).click();
	await page.waitForURL(/\/customers\/\d+$/);
	const customerUrl = page.url();
	await expect(page.getByText("No purchases yet")).toHaveCount(0);
	const orderRow = page.getByRole("button", { name: /^Open order \d+$/ });
	await expect(orderRow).toContainText(PRODUCT);
	await expect(orderRow).toContainText(amount("$3"));

	await page.getByRole("link", { name: "View in Orders" }).click();
	await page.waitForURL(/\/orders\?customer=\d+$/);
	await expect(page.getByText(ANNIE).first()).toBeVisible(); // filter chip

	await page.goto(customerUrl);
	await page.getByRole("button", { name: /^Open order \d+$/ }).click();
	await page.waitForURL(/\/orders\/\d+$/);
	orderUrl = page.url();
	await expect(
		page.getByRole("link", { name: new RegExp(ANNIE) }),
	).toBeVisible();
});

test("delete a customer — the order keeps its history", async () => {
	await page.goto("/customers");
	await search(ANNIE);
	await crow(ANNIE).click();
	await page.waitForURL(/\/customers\/\d+$/);
	await page.getByRole("button", { name: `Delete ${ANNIE}` }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await page.waitForURL("**/customers");
	await expect(page.getByText(`Deleted “${ANNIE}”`)).toBeVisible();

	await search(ANNIE);
	await expect(page.getByText("No matching customers")).toBeVisible();

	await page.goto(orderUrl);
	await expect(page.getByText("Walk-in (no customer attached)")).toBeVisible();
	await expect(page.getByText(PRODUCT).first()).toBeVisible();
});
