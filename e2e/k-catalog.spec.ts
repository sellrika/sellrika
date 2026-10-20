import { expect, test, type Page } from "@playwright/test";
import { amount, login, search, submitProduct, TINY_PNG } from "./helpers";

// Catalogue admin: categories, products (edit/search/pagination/barcodes), POS search + scanning,
// payment-method editing, and a second shop (isolation, currency, delete rules).
// Serial: every test builds on the previous one. Everything it creates is deleted at the end and the
// seeded "Main Shop" is the active shop again, so the specs that run after this one are unaffected.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36); // unique names per run
const CAT = `Snacks ${run}`;
const CAT2 = `Sweets ${run}`; // CAT renamed
const P1 = `Bar ${run}`; // simple, 3.00 → 3.50, barcode BC1
const P2 = `Cone ${run}`; // Size S/L, 5.00 each, barcode BC2 on L
const BULK = `Bulk${run}`; // 6 products, for the pager
const BC1 = `7${run}01`;
const BC2 = `7${run}02`;
const PAY = `Wave ${run}`;
const PAY2 = `Wave Money ${run}`; // PAY renamed
const SHOP = `Zed Shop ${run}`;
const SHOP2 = `Zed Bazaar ${run}`; // SHOP renamed
const TEA = `Tea ${run}`; // lives in the second shop only

// 1×1 transparent PNG — enough for the magic-byte sniff in app/xcore/storage/Storage.ts (copied from flow.spec.ts)
const PNG = {
	name: "tiny.png",
	mimeType: "image/png",
	buffer: Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
		"base64",
	),
};

let page: Page;
test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});
test.afterAll(() => page.close());

const row = (name: string) => page.getByRole("row").filter({ hasText: name });
async function confirmDelete(name: string) {
	await page
		.getByRole("button", { name: `Delete ${name}`, exact: true })
		.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
}
async function newProduct(name: string, price: string) {
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(name);
	await page.getByLabel("Base price").fill(price);
}
async function saveProduct(name: string) {
	await submitProduct(page);
	await page.goto(`/products?q=${encodeURIComponent(name)}`); // page 1 may be full of other specs' products
	await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
}
// POS
const card = (name: string) =>
	page.locator("section button", { hasText: name }).first();
const scanBox = () => page.getByPlaceholder(/Search or scan barcode/);
async function scan(code: string) {
	await scanBox().fill(code);
	await scanBox().press("Enter");
	await expect(scanBox()).toHaveValue(""); // a hit clears the box
}
const chargeButton = () => page.getByRole("button", { name: /^Charge/ });
/** Pick a shop from the sidebar switcher. */
async function switchShop(from: string, to: string) {
	await page.getByRole("button", { name: `Shop: ${from}` }).click();
	await page.getByRole("menuitem").filter({ hasText: to }).click();
	await page.waitForURL("**/pos");
	await expect(page.getByRole("button", { name: `Shop: ${to}` })).toBeVisible();
}

test("rename a category, give it a colour and a picture", async () => {
	await page.goto("/categories");
	await page.getByRole("button", { name: "Add category" }).click();
	await page.getByLabel("New category name").fill(CAT);
	await page.getByRole("dialog").locator('button[type="submit"]').click();
	await expect(row(CAT)).toBeVisible();

	await row(CAT)
		.getByRole("button", { name: `Edit ${CAT}` })
		.click();
	const dlg = page.getByRole("dialog", { name: "Edit category" });
	await dlg.getByLabel("Category name").fill(CAT2);
	await dlg.getByRole("button", { name: "Category color" }).click();
	await page.getByRole("button", { name: "Teal", exact: true }).click();
	// a picked picture opens the image editor over the dialog; Save uploads it
	await dlg.locator('input[type="file"]').setInputFiles(PNG);
	await page
		.getByRole("dialog", { name: "Edit image" })
		.getByRole("button", { name: "Save" })
		.click();
	await expect(dlg.getByAltText("Cover image")).toBeVisible();
	await dlg.getByRole("button", { name: "Save", exact: true }).click();

	await expect(page.getByText("Category saved")).toBeVisible();
	await expect(row(CAT2)).toBeVisible();
	await expect(row(CAT)).toHaveCount(0);
	await expect(row(CAT2).locator("[data-category-image]")).toBeVisible();
	// colour and picture stuck: the dialog reopens with both
	await row(CAT2)
		.getByRole("button", { name: `Edit ${CAT2}` })
		.click();
	await expect(
		dlg.getByRole("button", { name: "Category color" }),
	).toContainText("Teal");
	await expect(dlg.getByAltText("Cover image")).toBeVisible();
	await dlg.getByRole("button", { name: "Cancel" }).click();
});

test("edit a product: price, cost, category, barcode and unit", async () => {
	await newProduct(P1, "3.00");
	await saveProduct(P1);

	await page.getByRole("link", { name: P1, exact: true }).click();
	await page.waitForURL("**/edit");
	await page.getByLabel("Base price").fill("3.50");
	await page.getByLabel("Purchase price", { exact: true }).fill("1.00");
	await page.getByRole("button", { name: CAT2, exact: true }).click(); // CategoryPicker pill
	await page.getByLabel("Barcode", { exact: true }).fill(BC1);
	// unit: pick a predefined one, then replace it with a custom one typed into the dropdown
	await page.getByLabel("Unit", { exact: true }).click();
	await page.getByRole("option", { name: "kg", exact: true }).click();
	await expect(page.getByLabel("Unit", { exact: true })).toContainText("kg");
	await page.getByLabel("Unit", { exact: true }).click();
	await page.getByPlaceholder("Search or add…").fill("bundle");
	await page.getByRole("option", { name: "Use “bundle”" }).click();
	await expect(page.getByLabel("Unit", { exact: true })).toContainText(
		"bundle",
	);
	// Additional data tab: two rows, one left untitled (dropped on save)
	await page.getByRole("tab", { name: /^Additional data/ }).click();
	await page.getByRole("button", { name: "Add row" }).click();
	await page.getByLabel("Title", { exact: true }).nth(0).fill("Hersteller");
	await page.getByLabel("Value", { exact: true }).nth(0).fill("Bayer");
	await page.getByRole("button", { name: "Add row" }).click();
	await page.getByLabel("Value", { exact: true }).nth(1).fill("orphan");
	await saveProduct(P1);

	await expect(row(P1)).toContainText("$3.50");
	await expect(row(P1)).toContainText(CAT2);
	await expect(row(P1)).toContainText(BC1);
	// reopen: the cost is stored too (it is never shown in the list)
	await page.getByRole("link", { name: P1, exact: true }).click();
	await expect(page.getByLabel("Purchase price", { exact: true })).toHaveValue(
		"1.00",
	);
	await expect(page.getByLabel("Unit", { exact: true })).toContainText(
		"bundle",
	);
	// the titled row came back, the untitled one was dropped
	await page.getByRole("tab", { name: /^Additional data/ }).click();
	await expect(page.getByLabel("Title", { exact: true })).toHaveCount(1);
	await expect(page.getByLabel("Title", { exact: true }).nth(0)).toHaveValue(
		"Hersteller",
	);
	await expect(page.getByLabel("Value", { exact: true }).nth(0)).toHaveValue(
		"Bayer",
	);
});

test("a barcode can only be used once per shop", async () => {
	await newProduct(P2, "5.00");
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await page.getByRole("button", { name: "Quick generate" }).click();
	await page.getByLabel("Option group name").fill("Size");
	await page.getByLabel("Option values").fill("S, L");
	await page.getByRole("button", { name: "Generate 2 variants" }).click();
	await expect(page.getByLabel("Variant name")).toHaveCount(2);
	// duplicate a row: a copy lands right under it with the same price, "(copy)" name and no barcode
	await page.getByLabel("Variant barcode").nth(1).fill("777");
	await page.getByRole("button", { name: "Duplicate variant" }).nth(1).click();
	await expect(page.getByLabel("Variant name")).toHaveCount(3);
	await expect(page.getByLabel("Variant name").nth(2)).toHaveValue("L (copy)");
	await expect(page.getByLabel("Variant name").nth(2)).toBeFocused();
	await expect(page.getByLabel("Variant barcode").nth(2)).toHaveValue("");
	await page.getByRole("button", { name: "Remove variant" }).nth(2).click();
	await expect(page.getByLabel("Variant name")).toHaveCount(2);

	await page.getByLabel("Variant barcode").nth(1).fill(BC1); // already on P1
	await page.getByRole("button", { name: "Save product" }).click();
	await expect(
		page.getByText(`Barcode already used by “${P1}”`).first(),
	).toBeVisible();
	await expect(page).not.toHaveURL(/\/products$/);

	await page.getByLabel("Variant barcode").nth(1).fill(BC2);
	// option groups panel: the generated Size group is there, a Color group + value is added by hand and rows pick it
	await expect(page.getByLabel("Variant Size").nth(1)).toHaveValue("L");
	await page.getByRole("button", { name: "Add group" }).click();
	await page.getByLabel("New group name").fill("Color");
	await page.keyboard.press("Enter");
	await page.getByLabel("New Color value").fill("Red");
	await page.keyboard.press("Enter");
	await page.getByLabel("Variant Color").nth(0).selectOption("Red");
	// a new row names itself from its tags
	await page.getByRole("button", { name: "Add variant" }).click();
	await page.getByLabel("Variant Color").nth(2).selectOption("Red");
	await page.getByLabel("Variant Size").nth(2).selectOption("L");
	await expect(page.getByLabel("Variant name").nth(2)).toHaveValue("Red / L");
	await page.getByRole("button", { name: "Remove variant" }).nth(2).click();
	await saveProduct(P2);
	await expect(row(P2)).toContainText("2 variants");
	await expect(row(P2)).toContainText(/from \$5\s*2 variants/); // price cell: "from $5" then the variant count
	// the tags round-trip; removing a group clears it on every row
	await page.getByRole("link", { name: P2, exact: true }).click();
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await expect(page.getByLabel("Variant Color").nth(0)).toHaveValue("Red");
	await page.getByRole("button", { name: "Remove group Color" }).click();
	await expect(page.getByLabel("Variant Color")).toHaveCount(0);
	// an Additional data row — the POS sheet test below expects it above the description
	await page.getByRole("tab", { name: /^Additional data/ }).click();
	await page.getByRole("button", { name: "Add row" }).click();
	await page
		.getByLabel("Title", { exact: true })
		.nth(0)
		.fill("Darreichungsform");
	await page
		.getByLabel("Value", { exact: true })
		.nth(0)
		.fill("Brausetabletten");
	await saveProduct(P2); // back to Size only (the POS test below picks "L")
});

test("the description editor stores rich text, and every product view renders it", async () => {
	await page.goto("/products");
	await search(page, "Search products", P2);
	await page.getByRole("link", { name: P2, exact: true }).click();
	await page.waitForURL("**/edit");

	const editor = page.getByRole("textbox", { name: "Description" });
	await editor.click();
	await page.getByLabel("Text style").selectOption("h2");
	await page.keyboard.type("About");
	await page.keyboard.press("Enter");
	await page.getByLabel("Text style").selectOption("p");
	await page.getByRole("button", { name: "Bold", exact: true }).click();
	await page.keyboard.type("Crunchy");
	await page.getByRole("button", { name: "Bold", exact: true }).click();
	await page.keyboard.press("Enter");
	await page.getByRole("button", { name: "Bullet list" }).click();
	await page.keyboard.type("gluten free");
	await expect(editor.locator("h2")).toHaveText("About");
	await expect(editor.locator("b, strong")).toHaveText("Crunchy");

	// a table: 2×2 on insert (header row + body row), then reshaped with the row/column tools
	await page.getByRole("button", { name: "Insert table" }).click();
	await expect(editor.locator("tr")).toHaveCount(2);
	await expect(editor.locator("th")).toHaveCount(2);
	await editor.locator("th").first().click();
	await page.getByRole("button", { name: "Column +" }).click();
	await expect(editor.locator("th")).toHaveCount(3);
	await page.getByRole("button", { name: "Column −" }).click(); // drops the column the caret is in
	await expect(editor.locator("th")).toHaveCount(2);
	await page.getByRole("button", { name: "Row +" }).click(); // the tools stay up: the caret moved to a surviving cell
	await expect(editor.locator("tr")).toHaveCount(3);
	// fill one header and one body cell — new rows are body cells even under a header row
	await editor.locator("th").first().click();
	await page.keyboard.type("Size");
	await editor.locator("td").first().click();
	await page.keyboard.type("Small");
	// a collapsible section: the title is selected on insert, so typing names it; the strip toggles "open"
	await page.getByRole("button", { name: "Insert section" }).click();
	await page.keyboard.type("Storage");
	await expect(editor.locator("details summary")).toHaveText("Storage");
	await expect(editor.locator("details")).toHaveAttribute("open", "");
	await page.getByRole("button", { name: "Open by default ✓" }).click();
	await expect(editor.locator("details")).not.toHaveAttribute("open", "");
	await page
		.getByRole("button", { name: "Open by default", exact: true })
		.click();
	await editor.locator("details p").click();
	await page.keyboard.type("Keep cool");
	await page.getByRole("button", { name: "Section +" }).click();
	await expect(editor.locator("details")).toHaveCount(2);
	await page.getByRole("button", { name: "Delete section" }).click();
	await expect(editor.locator("details")).toHaveCount(1);
	await saveProduct(P2);

	// the list shows the text without its markup
	await expect(row(P2)).toContainText(
		"About Crunchy gluten free Size Small Storage Keep cool",
	);

	// reopening rebuilds the editor from the stored HTML (not from escaped tag soup)
	await page.getByRole("link", { name: P2, exact: true }).click();
	await page.waitForURL("**/edit");
	await expect(
		page.getByRole("textbox", { name: "Description" }).locator("li"),
	).toHaveText("gluten free");
	await expect(
		page.getByRole("textbox", { name: "Description" }).locator("th").first(),
	).toHaveText("Size");
	await expect(
		page
			.getByRole("textbox", { name: "Description" })
			.locator("details[open] summary"),
	).toHaveText("Storage"); // the section, still open by default

	// the picture tool: the file is uploaded and the text keeps its path, never the picture's data
	const stored = page.getByRole("textbox", { name: "Description" });
	await stored.click();
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Insert picture" }).click();
	await (await chooser).setFiles(TINY_PNG);
	const picture = stored.locator("figure img");
	await expect(picture).toHaveAttribute("src", /^\/uploads\/\d+\/products\//);
	await picture.click();
	await page.getByLabel("Describe the picture (alt text)").fill("A cracker");
	await page.getByRole("button", { name: "Add caption" }).click();
	await expect(stored.locator("figcaption")).toHaveText("Caption");
	await page.getByRole("button", { name: "Remove caption" }).click();
	await expect(stored.locator("figcaption")).toHaveCount(0);
	// a picture pasted as data is taken out again
	await stored.evaluate((el) => {
		el.insertAdjacentHTML(
			"beforeend",
			'<p><img src="data:image/png;base64,iVBORw0KGgo="></p>',
		);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await expect(stored.locator("img")).toHaveCount(1);
	await submitProduct(page);
	await page.reload();
	await expect(
		page.getByRole("textbox", { name: "Description" }).locator("img"),
	).toHaveAttribute("alt", "A cracker");

	// the POS product sheet renders it as real markup
	await page.goto("/pos");
	await card(P2).click();
	// the Additional data rows come first, then the description
	const sheetExtra = page.getByRole("dialog").getByLabel("Additional data");
	await expect(sheetExtra).toContainText("Darreichungsform");
	await expect(sheetExtra).toContainText("Brausetabletten");
	await expect(
		page.getByRole("dialog").locator("dl + .rich-html"),
	).toBeVisible();
	await expect(page.getByRole("dialog").locator("li")).toHaveText(
		"gluten free",
	);
	await expect(page.getByRole("dialog").locator("table th").first()).toHaveText(
		"Size",
	);
	await expect(page.getByRole("dialog").locator("table tr")).toHaveCount(3);
	await page.keyboard.press("Escape");
});

test("search filters the product list", async () => {
	await page.goto("/products");
	await search(page, "Search products", P1);
	await expect(page.getByText("1 matching product")).toBeVisible();
	await expect(row(P1)).toBeVisible();
	await expect(row(P2)).toHaveCount(0);

	await search(page, "Search products", BC2); // barcodes are searchable too
	await expect(row(P2)).toBeVisible();

	await search(page, "Search products", `nothing-${run}`);
	await expect(
		page.getByText(`No products match “nothing-${run}”`),
	).toBeVisible();

	// the category select box: only P1 is in CAT2
	await search(page, "Search products", "");
	await page.getByRole("combobox", { name: "Category" }).click();
	await page.getByRole("option", { name: CAT2 }).click();
	await expect(page).toHaveURL(/[?&]category=\d+/);
	await expect(row(P1)).toBeVisible();
	await expect(row(P2)).toHaveCount(0);
	await expect(page.getByText("1 matching product")).toBeVisible();
	await page.getByRole("combobox", { name: "Category" }).click();
	await page.getByRole("option", { name: "All categories" }).click();
	await expect(page).not.toHaveURL(/category=/);
	await expect(row(P2)).toBeVisible();
});

test("an icon button shows its tooltip on hover", async () => {
	await page.goto(`/products?q=${encodeURIComponent(P1)}`);
	const del = row(P1).getByRole("button", { name: `Delete ${P1}` });
	await expect(del).not.toHaveAttribute("title");
	await del.hover();
	await expect(page.getByRole("tooltip")).toHaveText(`Delete ${P1}`);
	await page.mouse.move(0, 0);
	await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("featuring a product pins it to the top of the list", async () => {
	await page.goto(`/products?q=${run}`);
	const toggle = (name: string) =>
		row(name).getByRole("button", { name: `Feature ${name}` });
	const firstRowLink = (name: string) =>
		page.getByRole("row").nth(1).getByRole("link", { name, exact: true });

	await toggle(P1).click();
	await expect(firstRowLink(P1)).toBeVisible(); // jumps ahead of the products edited more recently
	await page.reload();
	await expect(toggle(P1)).toHaveAttribute("aria-pressed", "true");
	await expect(firstRowLink(P1)).toBeVisible();

	await toggle(P1).click(); // back to plain "most recently edited first"
	// wait for the save before the reload: a reload right after the click can cut the request off
	await expect(toggle(P1)).toHaveAttribute("aria-pressed", "false");
	await page.reload();
	await expect(toggle(P1)).toHaveAttribute("aria-pressed", "false");
});

test("switching a product off hides it from the POS", async () => {
	await page.goto(`/products?q=${run}`);
	const active = row(P2).getByRole("switch", { name: `${P2} active` });
	await active.click();
	await expect(active).not.toBeChecked();

	await page.goto("/pos");
	await scanBox().fill(P2);
	await expect(page.locator("section button", { hasText: P2 })).toHaveCount(0);

	await page.goto(`/products?q=${run}`);
	await active.click(); // back on for the tests below
	await expect(active).toBeChecked();
});

test("the pager walks a long list", async () => {
	for (let i = 1; i <= 6; i++) {
		await newProduct(`${BULK} ${i}`, "1.00");
		await saveProduct(`${BULK} ${i}`);
	}
	// a short viewport keeps lib/fitPage.ts on 5 rows, so ?per_page=5 survives the mount
	await page.setViewportSize({ width: 1280, height: 500 });
	await page.goto(`/products?q=${BULK}&per_page=5`);
	await expect(page.getByText("6 matching products")).toBeVisible();
	await expect(page.getByText("1–5 of 6")).toBeVisible();
	await expect(page.getByText("1 / 2")).toBeVisible();
	await expect(row(`${BULK} 6`)).toBeVisible(); // newest first: 6…2 here, 1 on the next page
	await expect(row(`${BULK} 1`)).toHaveCount(0);

	await page.getByRole("link", { name: "Next" }).click();
	await expect(page.getByText("6–6 of 6")).toBeVisible();
	await expect(page.getByText("2 / 2")).toBeVisible();
	await expect(row(`${BULK} 1`)).toBeVisible();
	await expect(row(`${BULK} 6`)).toHaveCount(0);
	await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled(); // last page → real disabled button
});

test("POS: search, category pills, scanning and the cart", async () => {
	await page.goto("/pos");
	await page.setViewportSize({ width: 1280, height: 720 }); // away from /products first: fitPage would refetch

	// search by name
	await scanBox().fill(P1);
	await expect(card(P1)).toBeVisible();
	await expect(page.locator("section button", { hasText: P2 })).toHaveCount(0);
	await scanBox().fill("");

	// category pill: only P1 is in CAT2
	await page.getByRole("button", { name: CAT2, exact: true }).click();
	await expect(card(P1)).toBeVisible();
	await expect(page.locator("section button", { hasText: P2 })).toHaveCount(0);
	await page.getByRole("button", { name: "All", exact: true }).click();
	await expect(card(P2)).toBeVisible();

	// scan a plain product's barcode → straight into the cart
	await scan(BC1);
	await expect(
		page.getByRole("button", { name: `Remove ${P1}` }),
	).toBeVisible();
	await expect(chargeButton()).toHaveText("Charge $3.50");

	// scan a variant's barcode → that variant, no picker
	await scan(BC2);
	await expect(
		page.getByRole("button", { name: `Remove ${P2}` }),
	).toBeVisible();
	await expect(chargeButton()).toHaveText("Charge $8.50");

	// variant picker: choose L, quantity 2
	await card(P2).click();
	const pick = page.getByRole("dialog");
	await pick.getByRole("button", { name: "L", exact: true }).click();
	await pick.getByRole("button", { name: "Increase quantity" }).click();
	await expect(pick.getByRole("button", { name: /Add to cart/ })).toContainText(
		amount("$10"),
	);
	await pick.getByRole("button", { name: /Add to cart/ }).click();
	await expect(chargeButton()).toHaveText("Charge $18.50");

	// cart line stepper + remove
	await page.getByRole("button", { name: `Increase ${P1}` }).click();
	await expect(chargeButton()).toHaveText("Charge $22");
	await page.getByRole("button", { name: `Decrease ${P1}` }).click();
	await expect(chargeButton()).toHaveText("Charge $18.50");
	await page.getByRole("button", { name: `Remove ${P2}` }).click();
	await expect(chargeButton()).toHaveText("Charge $3.50");

	// clear
	await page.getByRole("button", { name: "Clear" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Clear cart" })
		.click();
	await expect(page.getByText("Cart is empty")).toBeVisible();
	await expect(chargeButton()).toBeDisabled();
});

test("edit a payment method: name, icon, colour and 'amount tendered'", async () => {
	await page.goto("/payment-methods");
	await page.getByRole("button", { name: "Add payment method" }).click();
	await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(PAY);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Add", exact: true })
		.click();
	await expect(row(PAY).getByText("Pays the exact amount")).toBeVisible();

	await row(PAY)
		.getByRole("button", { name: `Edit ${PAY}` })
		.click();
	const er = page.getByRole("dialog");
	await er.getByLabel("Name", { exact: true }).fill(PAY2);
	await er.getByRole("button", { name: "Icon" }).click();
	await page.getByRole("button", { name: "Banknote", exact: true }).click();
	await er.getByRole("button", { name: "Color", exact: true }).click();
	await page.getByRole("button", { name: "Sky", exact: true }).click();
	await er.getByRole("switch", { name: "Ask for the amount given" }).click();
	await er.getByRole("button", { name: "Save" }).click();

	await expect(page.getByText("Payment method updated")).toBeVisible();
	await expect(
		row(PAY2).getByText("Asks the amount given, shows the change"),
	).toBeVisible();
	await expect(row(PAY)).toHaveCount(0);
	// icon + colour stuck
	await row(PAY2)
		.getByRole("button", { name: `Edit ${PAY2}` })
		.click();
	await expect(er.getByRole("button", { name: "Icon" })).toContainText(
		"Banknote",
	);
	await expect(
		er.getByRole("button", { name: "Color", exact: true }),
	).toContainText("Sky");
	await er.getByRole("button", { name: "Cancel" }).click();
});

test("a disabled payment method is not offered at checkout", async () => {
	await page.goto("/payment-methods");
	await row(PAY2).getByLabel(`${PAY2} enabled`).click();
	await expect(page.getByText(`${PAY2} disabled`)).toBeVisible();
	await expect(row(PAY2).getByLabel(`${PAY2} enabled`)).not.toBeChecked();

	await page.goto("/pos");
	await card(P1).click();
	await card(P1).click();
	await chargeButton().click();
	let dlg = page.getByRole("dialog");
	await expect(
		dlg.getByRole("button", { name: "Cash", exact: true }),
	).toBeVisible();
	await expect(
		dlg.getByRole("button", { name: PAY2, exact: true }),
	).toHaveCount(0);
	await page.keyboard.press("Escape"); // no sale — just checking the options

	// back on: it shows up and asks for the amount tendered
	await page.goto("/payment-methods");
	await row(PAY2).getByLabel(`${PAY2} enabled`).click();
	await expect(row(PAY2).getByLabel(`${PAY2} enabled`)).toBeChecked();

	await page.goto("/pos");
	// the 2 × P1 cart survived the page switch (localStorage, 1 day)
	await expect(chargeButton()).toHaveText("Charge $7");
	await chargeButton().click();
	dlg = page.getByRole("dialog");
	await expect(
		dlg.getByRole("heading", { name: "Charge $7", exact: true }),
	).toBeVisible();
	await dlg.getByRole("button", { name: "Card", exact: true }).click();
	await expect(dlg.getByLabel("Amount tendered")).toHaveCount(0);
	await dlg.getByRole("button", { name: PAY2, exact: true }).click();
	await dlg.getByLabel("Amount tendered").fill("10.00");
	await expect(dlg.locator("dd").last()).toHaveText("$3"); // change
	await page.keyboard.press("Escape");
	// leave the cart empty for the tests that follow
	await page.getByRole("button", { name: "Clear" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Clear cart" })
		.click();
	await expect(page.getByText("Cart is empty")).toBeVisible();
});

test("delete a product that has variants", async () => {
	await page.goto("/products");
	await search(page, "Search products", P2);
	await expect(row(P2)).toBeVisible();
	await confirmDelete(P2);
	await expect(page.getByText(`Deleted “${P2}”`)).toBeVisible();
	await expect(row(P2)).toHaveCount(0);
	await page.goto("/pos");
	await expect(page.locator("section button", { hasText: P2 })).toHaveCount(0);
});

test("create a second shop with its own currency, time zone and logo", async () => {
	await page.goto("/shops");
	await page.getByRole("link", { name: "New shop" }).click();
	await expect(page).toHaveURL(/\/shops\/create$/);
	const dlg = page.locator("form"); // the whole page is the form now
	await dlg.getByLabel("Name").fill(SHOP);
	await dlg.getByRole("combobox", { name: "Currency" }).click();
	await page.getByPlaceholder("Search currency…").fill("GBP");
	await page.getByRole("option", { name: /GBP/ }).first().click();
	await dlg.getByRole("combobox", { name: "Time zone" }).click();
	await page.getByPlaceholder("Search time zone…").fill("Bangkok");
	await page
		.getByRole("option", { name: /Asia\/Bangkok/ })
		.first()
		.click();
	await dlg.getByLabel("Tax rate", { exact: true }).fill("7"); // VAT sits inside the prices → "Incl. VAT 7%" on receipts, totals unchanged
	await dlg.getByLabel("Tax label", { exact: true }).fill("VAT");
	await dlg.getByLabel("Prices include tax").click();
	await dlg.locator('input[type="file"]').setInputFiles(PNG);
	await expect(dlg.getByAltText("Logo preview")).toBeVisible();
	await dlg.getByRole("button", { name: "Create shop" }).click();

	await expect(page).toHaveURL(/\/shops$/);
	await expect(page.getByText("Shop created")).toBeVisible();
	await expect(page.getByRole("img", { name: SHOP })).toBeVisible(); // the logo on the card
	await expect(page.getByText("GBP")).toBeVisible();
	await expect(page.getByText("Asia/Bangkok").first()).toBeVisible();

	// reopened, the edit page shows what was saved (cents → the decimal the admin typed)
	await page.getByRole("link", { name: `Edit ${SHOP}` }).click();
	await expect(page).toHaveURL(/\/shops\/\d+\/edit$/);
	await expect(dlg.getByLabel("Tax rate", { exact: true })).toHaveValue("7");
	await expect(dlg.getByLabel("Tax label", { exact: true })).toHaveValue("VAT");
	await expect(dlg.getByLabel("Prices include tax")).toBeChecked();
	await page.getByRole("link", { name: "Cancel" }).click();
	await expect(page).toHaveURL(/\/shops$/);
});

test("switching shops swaps the whole catalogue", async () => {
	await page.getByRole("button", { name: "Switch", exact: true }).click(); // the only non-current shop
	await page.waitForURL("**/pos");
	await expect(
		page.getByRole("button", { name: `Shop: ${SHOP}` }),
	).toBeVisible();
	await expect(page.getByText("No products yet")).toBeVisible();

	await page.goto("/products");
	await expect(page.getByText("No products yet")).toBeVisible();

	await page.goto("/payment-methods");
	for (const m of ["Cash", "Card", "Other"]) await expect(row(m)).toBeVisible();
	await expect(row(PAY2)).toHaveCount(0); // the other shop's method

	await newProduct(TEA, "4.00");
	await saveProduct(TEA);
	await page.goto("/pos");
	await expect(card(TEA)).toContainText(amount("£4")); // the shop's currency
});

test("changing the shop's currency changes the money on the POS", async () => {
	await page.goto("/shops");
	await page.getByRole("link", { name: `Edit ${SHOP}` }).click();
	const dlg = page.locator("form");
	await dlg.getByLabel("Name").fill(SHOP2);
	await dlg.getByRole("combobox", { name: "Currency" }).click();
	await page.getByPlaceholder("Search currency…").fill("EUR");
	await page.getByRole("option", { name: /EUR/ }).first().click();
	await dlg.getByRole("button", { name: "Save" }).click();

	await expect(page.getByText("Shop updated")).toBeVisible();
	await expect(
		page.getByRole("button", { name: `Shop: ${SHOP2}` }),
	).toBeVisible();
	await page.goto("/pos");
	await expect(card(TEA)).toContainText(amount("€4"));
	// the cart shows the shop's tax line: €4 already holds 7% VAT → €0.26, and the total stays €4
	await card(TEA).click();
	await expect(page.getByText("Incl. VAT 7%").first()).toBeVisible();
	await expect(page.locator("[data-tax]").first()).toContainText("€0.26");
	await expect(
		page.getByRole("button", { name: "Charge €4", exact: true }),
	).toBeVisible();
	await page.evaluate(() => {
		for (const k of Object.keys(localStorage))
			if (k.startsWith("cart:")) localStorage.removeItem(k);
	}); // leave no unfinished sale behind
});

test("back in the first shop the other shop's product is gone", async () => {
	await switchShop(SHOP2, "Main Shop");
	await scanBox().fill(TEA);
	await expect(page.getByText("No products match")).toBeVisible();
	await expect(card(P1)).toHaveCount(0); // filtered out, but still in this shop

	await page.goto(`/products?q=${TEA.replace(" ", "+")}`);
	await expect(page.getByText(`No products match “${TEA}”`)).toBeVisible();
});

test("a shop with products can't be deleted, an empty one can", async () => {
	await page.goto("/shops");
	await confirmDelete(SHOP2);
	await expect(
		page.getByText("Delete or move this shop's products first"),
	).toBeVisible();
	await expect(page.getByRole("img", { name: SHOP2 })).toBeVisible();

	await switchShop("Main Shop", SHOP2);
	await page.goto("/products");
	await confirmDelete(TEA);
	await expect(row(TEA)).toHaveCount(0);

	await switchShop(SHOP2, "Main Shop");
	await page.goto("/shops");
	await confirmDelete(SHOP2);
	await expect(page.getByText(`Deleted “${SHOP2}”`)).toBeVisible();
	await expect(page.getByRole("img", { name: SHOP2 })).toHaveCount(0);
	await expect(page.getByText("Current")).toBeVisible(); // Main Shop, the only one left
});

test("POS: the grid loads the next page when you scroll to the bottom; scanning finds products beyond the loaded page", async () => {
	await page.goto("/pos");
	const input = {
		description: "",
		price: 100,
		purchase_price: null,
		images: [],
		sku: null,
		barcode: null,
		unit: null,
		track_stock: false,
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		kind: "item",
		bundle_items: [],
		category_ids: [],
		variants: [],
	};
	const grid = () => page.locator("section .grid > button"); // the product cards only (not the pills / cart buttons)
	const already = await grid().count();
	const need = Math.max(0, 17 - already);
	for (let i = 1; i <= need; i++)
		expect(
			(
				await page.request.post("/products", {
					data: {
						...input,
						name: `Scroll Filler ${run} ${i}`,
						barcode: i === need ? `SCROLL${run}` : null,
					},
				})
			).ok(),
		).toBeTruthy();
	await page.goto("/pos");
	const cards = grid();
	await expect(cards).toHaveCount(16); // first page only
	await page.locator("[data-sentinel]").scrollIntoViewIfNeeded();
	await expect(cards).toHaveCount(17); // the rest arrived
	// the last filler (oldest → last page) is scannable without being on screen
	await page.goto("/pos");
	await expect(cards).toHaveCount(16);
	await scan(`SCROLL${run}`);
	await expect(
		page.getByRole("button", { name: `Remove Scroll Filler ${run} ${need}` }),
	).toBeVisible();
	await page
		.getByRole("button", { name: `Remove Scroll Filler ${run} ${need}` })
		.click();
});

test("global search: ⌘K (or the sidebar box) opens the palette; it finds products, settings sections and recent picks", async () => {
	const input = {
		description: "",
		price: 1250,
		purchase_price: null,
		images: [],
		sku: `FIND-${run}`,
		barcode: null,
		unit: null,
		track_stock: false,
		low_stock_at: 0,
		featured: false,
		active: true,
		original_price: null,
		kind: "item",
		bundle_items: [],
		category_ids: [],
		variants: [],
	};
	expect(
		(
			await page.request.post("/products", {
				data: { ...input, name: `Find Me ${run}` },
			})
		).ok(),
	).toBeTruthy();
	await page.goto("/pos");
	const palette = page.locator("#search-js");
	const box = () => palette.locator(".search-input");
	const item = (text: string | RegExp) =>
		palette.locator(".item", { hasText: text });
	await expect(palette).toBeHidden();
	await page.keyboard.press("ControlOrMeta+k");
	await expect(palette).toBeVisible();
	await expect(box()).toBeFocused();
	// a product by its SKU → its edit page; the row says what it is and what it costs
	await box().pressSequentially(`find-${run}`);
	await expect(item(`Find Me ${run}`)).toContainText(
		`Product · FIND-${run} · $12.50`,
	);
	await item(`Find Me ${run}`).click();
	await expect(page).toHaveURL(/\/products\/\d+\/edit$/);
	await expect(palette).toBeHidden();
	// a settings section, from the sidebar box; words match in any order
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(palette).toBeVisible();
	await box().pressSequentially("delivery setting");
	await expect(item("Delivery settings")).toContainText(
		"Online store › Delivery",
	);
	await item("Delivery settings").click();
	await expect(page).toHaveURL(/\/online-store\?section=delivery$/);
	await expect(page.getByRole("button", { name: "Add zone" })).toBeVisible(); // the Delivery section (shipping zones)
	// "Tax settings" lands on the active shop's edit page, at the tax card — picked with the keyboard: ↓ points at a row, Enter opens it
	await page.keyboard.press("ControlOrMeta+k");
	await box().pressSequentially("tax");
	await expect(item("Tax settings")).toBeVisible();
	await page.keyboard.press("ArrowDown");
	await expect(item("Tax settings")).toHaveClass(/is-active/);
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/shops\/\d+\/edit#tax$/);
	await expect(page.getByLabel("Tax rate", { exact: true })).toBeVisible();
	// an empty box lists what was picked before (kept in the browser), and Esc closes
	await page.keyboard.press("ControlOrMeta+k");
	await expect(
		palette.locator("#search-js-histories .item", {
			hasText: `Find Me ${run}`,
		}),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(palette).toBeHidden();
});
