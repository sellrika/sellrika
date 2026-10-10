import { expect, test, type Page } from "@playwright/test";
import { amount, login, submitProduct } from "./helpers";
import { storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("n-packages");

// Packages (bundles): build "12 × Pen, customer picks the colour", sell one on the POS and watch the
// stock come off the component variant, then the guards that keep the recipe intact (a product inside a
// package can't be deleted, neither can a variant it points at).
// Serial: every step builds on the previous one. Everything it creates is deleted at the end.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PEN = `Pen ${run}`; // Red / Blue / Black at $2.50, tracked — Red 30, Blue 5, Black 0
const PACK = `Pen — 1 dozen ${run}`; // package: 12 × PEN, allowed Red + Blue, $28

let page: Page;
let orderId = 0;
test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});
test.afterAll(() => page.close());

const row = (name: string) => page.getByRole("row").filter({ hasText: name });
/** A /stock row, narrowed by every given text (product name, then variant name). */
const srow = (...texts: string[]) =>
	texts.reduce((l, t) => l.filter({ hasText: t }), page.getByRole("row"));
/** Set one unit's on-hand count from the /stock Adjust dialog. */
async function setStock(variant: string, count: string) {
	await srow(PEN, variant).getByRole("button", { name: "Adjust" }).click();
	const dlg = page.getByRole("dialog");
	await dlg.getByRole("tab", { name: "Set count" }).click();
	await dlg.getByLabel("New count").fill(count);
	await dlg.getByRole("button", { name: "Save adjustment" }).click();
	await expect(
		srow(PEN, variant).getByText(count, { exact: true }),
	).toBeVisible();
}
// POS
const card = (name: string) =>
	page.locator("section button", { hasText: name }).first();

test("create the component product with three colours and stock them", async () => {
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(PEN);
	await page.getByLabel("Base price").fill("2.50");
	await page.getByRole("switch", { name: /Track stock/ }).click();
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await page.getByRole("button", { name: "Quick generate" }).click();
	await page.getByLabel("Option group name").fill("Color");
	await page.getByLabel("Option values").fill("Red, Blue, Black");
	await page.getByRole("button", { name: "Generate 3 variants" }).click();
	await expect(page.getByLabel("Variant name")).toHaveCount(3);
	await submitProduct(page);

	// variants start at 0 — their counts are set on /stock
	await page.goto(`/stock?q=${encodeURIComponent(run)}`);
	await setStock("Red", "30");
	await setStock("Blue", "5");
});

test("build a package of 12 pens the customer picks a colour for", async () => {
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(PACK);
	await page.getByRole("switch", { name: "Package" }).click();
	await expect(page.getByLabel("Purchase price", { exact: true })).toHaveCount(
		0,
	); // a package has no cost of its own
	await expect(page.getByLabel("In stock", { exact: true })).toHaveCount(0); // …and no stock of its own
	await page.getByLabel("Base price").fill("28.00");

	await page.getByRole("tab", { name: /^Contents/ }).click();
	await page.getByLabel("Search products to add").fill(PEN);
	await page.getByRole("button", { name: `Add ${PEN}` }).click();
	await page.getByLabel("Quantity").fill("12");
	// every colour is allowed on add; drop Black so the slot offers Red or Blue
	await page.getByRole("button", { name: "Black", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Red", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("button", { name: "Black", exact: true }),
	).toHaveAttribute("aria-pressed", "false");
	await expect(page.getByText("Customer picks one")).toBeVisible(); // 2 options → a question at the till

	const summary = page.getByText("Contents value");
	await expect(summary).toContainText(amount("$30")); // 12 × $2.50
	await expect(summary).toContainText(amount("$28"));
	await expect(summary).toContainText("Save");
	await expect(summary).toContainText("≈ $2.33 each");

	await submitProduct(page);
});

test("the product list marks the package and spells out its contents", async () => {
	await page.goto(`/products?q=${encodeURIComponent(PACK)}`);
	await expect(row(PACK).getByText("Package", { exact: true })).toBeVisible();
	await expect(row(PACK)).toContainText(`12 × ${PEN} (Red or Blue)`);
	await expect(row(PACK)).toContainText(amount("$28"));
	await expect(row(PACK)).toContainText("2"); // availability: 30 Red / 12, the 5 Blue can't fill a slot
});

test("POS: pick the colour and sell one package", async () => {
	await page.goto("/pos");
	await expect(card(PACK)).toContainText("Package");
	await card(PACK).click();

	const sheet = page.getByRole("dialog");
	await expect(
		sheet.getByRole("heading", { name: `12 × ${PEN}` }),
	).toBeVisible();
	await expect(
		sheet.getByText(`12 × ${PEN} (Red or Blue)`, { exact: true }),
	).toBeVisible(); // "In this package"
	await expect(
		sheet.getByRole("button", { name: "Blue", exact: true }),
	).toBeDisabled(); // 5 in stock < 12
	await expect(
		sheet.getByRole("button", { name: /Add to cart/ }),
	).toBeDisabled(); // nothing picked yet
	await sheet.getByRole("button", { name: "Red", exact: true }).click();
	await expect(sheet.getByText("2 can be built")).toBeVisible();
	await sheet.getByRole("button", { name: /Add to cart/ }).click();

	await expect(page.getByText(amount("12 × Red · $28"))).toBeVisible(); // the cart line carries the choice, with its quantity

	// tapping the line reopens the sheet with that answer; updating replaces the line instead of adding a second one
	await page.getByRole("button", { name: `Edit ${PACK}` }).click();
	await expect(
		sheet.getByRole("button", { name: "Red", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await sheet.getByRole("button", { name: /Update line/ }).click();
	await expect(page.getByText(amount("12 × Red · $28"))).toHaveCount(1);
	await page.getByRole("button", { name: "Charge $28", exact: true }).click();
	const dlg = page.getByRole("dialog");
	await dlg.getByRole("button", { name: "Cash", exact: true }).click();
	await dlg.getByRole("button", { name: "Confirm $28", exact: true }).click();
	await expect(
		dlg.getByRole("heading", { name: "Sale complete" }),
	).toBeVisible();
	orderId = Number(
		(
			await dlg
				.getByText(/Order #\d+/)
				.first()
				.innerText()
		).match(/#(\d+)/)![1],
	);
	await dlg.getByRole("button", { name: "Done" }).click();
});

test("the sale took twelve red pens off the shelf", async () => {
	await page.goto(`/stock?q=${encodeURIComponent(run)}`);
	await expect(srow(PACK)).toHaveCount(0); // a package is never listed — it owns no stock
	await expect(srow(PEN, "Red").getByText("18", { exact: true })).toBeVisible();
	await expect(srow(PEN, "Blue").getByText("5", { exact: true })).toBeVisible();

	await srow(PEN, "Red").getByRole("button", { name: "History" }).click();
	const sheet = page.getByRole("dialog");
	await expect(sheet.getByText("sale", { exact: true })).toBeVisible();
	await expect(sheet.getByText("-12", { exact: true })).toBeVisible();
	await expect(
		sheet.getByRole("link", { name: `Order #${orderId}` }),
	).toBeVisible();
	await page.keyboard.press("Escape");
});

test("the order line names the package and the colour that was picked", async () => {
	await page.goto(`/orders/${orderId}`);
	await expect(
		page.getByText(`${PACK} (12 × Red)`, { exact: true }),
	).toBeVisible();
	await expect(page.getByText(amount("$28")).first()).toBeVisible();
});

test("the storefront asks the same question", async () => {
	await page.goto("/online-store");
	await page.getByRole("switch", { name: "Enable online store" }).click();
	await page.getByRole("button", { name: "Save settings" }).click();
	await expect(page.getByText("Online store settings saved")).toBeVisible();

	await page.goto(STORE);
	await page.getByRole("link", { name: PACK, exact: true }).click();
	const sheet = page.getByRole("dialog", { name: PACK }); // the product sheet, a <dialog> named after the product
	await expect(
		sheet.getByRole("heading", { name: `12 × ${PEN}` }),
	).toBeVisible();
	await expect(
		sheet.getByText(`12 × ${PEN} (Red or Blue)`, { exact: true }),
	).toBeVisible();
	await expect(
		sheet.getByRole("button", { name: "Blue", exact: true }),
	).toBeDisabled();
	await expect(
		sheet.getByRole("button", { name: "Red", exact: true }),
	).toBeEnabled();
	await sheet.getByRole("button", { name: "Red", exact: true }).click();
	await sheet.getByRole("button", { name: /Add to cart/ }).click();
	// adding only pops the badge; the drawer opens from the cart button
	await page.getByRole("button", { name: "Open cart" }).click();
	// the cart line reopens the sheet with the answer; "Update line" replaces it (and returns to the drawer)
	await page.getByRole("button", { name: `Edit ${PACK}` }).click();
	await expect(
		sheet.getByRole("button", { name: "Red", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await sheet.getByRole("button", { name: /Update line/ }).click();
	await expect(page.getByText("12 × Red", { exact: true })).toHaveCount(1);
	await page.keyboard.press("Escape");
});

test("a product inside a package can't be deleted, nor can a variant it points at", async () => {
	await page.goto(`/products?q=${encodeURIComponent(PEN)}`);
	await page
		.getByRole("button", { name: `Delete ${PEN}`, exact: true })
		.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await expect(
		page
			.getByText(
				`“${PEN}” is used in package “${PACK}” — remove it there first`,
			)
			.first(),
	).toBeVisible();
	await page.goto(`/products?q=${encodeURIComponent(PEN)}`);
	await expect(row(PEN)).toBeVisible();

	// dropping the Red variant would leave the package's slot pointing at nothing
	await page.getByRole("link", { name: PEN, exact: true }).click();
	await page.waitForURL("**/products/*/edit");
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await page.getByRole("button", { name: "Remove variant" }).first().click();
	await page.getByRole("button", { name: "Save product" }).click();
	await expect(
		page
			.getByText(`“Red” is used in package “${PACK}” — remove it there first`)
			.first(),
	).toBeVisible();
	await expect(page).not.toHaveURL(/\/products$/);
});

test("switching off the product inside greys the package out and flags it on its Contents tab", async () => {
	await page.goto(`/products?q=${encodeURIComponent(run)}`);
	const active = row(PEN).getByRole("switch", { name: `${PEN} active` });
	await active.click();
	await expect(active).not.toBeChecked();
	await expect(
		row(PACK).getByText("Not sold: a product inside is switched off"),
	).toBeVisible();
	await expect(
		row(PACK).getByRole("switch", { name: `${PACK} active` }),
	).toBeChecked(); // the package's own switch is left alone

	await page.getByRole("link", { name: PACK, exact: true }).click();
	await page.waitForURL("**/products/*/edit");
	await page.getByRole("tab", { name: /^Contents/ }).click();
	await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: PEN })).toHaveAttribute(
		"target",
		"_blank",
	);

	await page.goto(`/products?q=${encodeURIComponent(run)}`);
	await active.click(); // back on
	await expect(
		row(PACK).getByText("Not sold: a product inside is switched off"),
	).toHaveCount(0);
});

test("cleanup: the package goes first, then the product it held", async () => {
	for (const name of [PACK, PEN]) {
		await page.goto(`/products?q=${encodeURIComponent(name)}`);
		await page
			.getByRole("button", { name: `Delete ${name}`, exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete" })
			.click();
		await expect(page.getByText(`Deleted “${name}”`)).toBeVisible();
		await expect(row(name)).toHaveCount(0);
	}
});
