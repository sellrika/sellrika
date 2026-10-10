import { expect, test, type Page } from "@playwright/test";
import { amount, login, submitProduct } from "./helpers";

// One cashier's day, in order: set up catalogue → sell → check orders + stats → clean up.
// Serial on purpose: later steps rely on what earlier ones created, and the stats assert on exact totals
// (the DB is fresh for every run, so this file is the only source of orders).
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36); // unique names per run
const CAT = `Drinks ${run}`;
const PAY = `QR ${run}`;
const SIMPLE = `Latte ${run}`; // no variants, 4.50
const VARIANT = `Tee ${run}`; // Size S/M, 3.00 each
const PHOTO = `Muffin ${run}`; // image on product, 2.25
const VPHOTO = `Cap ${run}`; // image on variant "Red", 7.00
const LINK = "https://cdn.example.com/bowl.jpg";

// 1×1 transparent PNG — enough for the magic-byte sniff in app/xcore/storage/Storage.ts
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

async function newProduct(name: string, price: string) {
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(name);
	await page.getByLabel("Base price").fill(price);
}
async function saveProduct(name: string) {
	await submitProduct(page);
	// a new product lands on its edit page, and the form knows it
	await expect(page).toHaveURL(/\/products\/\d+\/edit$/);
	await expect(
		page.getByRole("heading", { name: "Edit product" }),
	).toBeVisible();
	await page.goto("/products");
	await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
}
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
const vrow = () =>
	page.getByRole("row").filter({ has: page.getByLabel("Variant name") }); // variant rows (input values are not row text)
const orow = (n: number) =>
	page.getByRole("button", { name: `Open order ${n}` }); // order rows are role=button → /orders/:id
// POS helpers
const card = (name: string) =>
	page.locator("section button", { hasText: name }).first();
async function checkout(method: string, total: string, tendered?: string) {
	await page
		.getByRole("button", { name: `Charge ${total}`, exact: true })
		.click();
	const dlg = page.getByRole("dialog");
	await dlg.getByRole("button", { name: method, exact: true }).click();
	if (tendered) await dlg.getByLabel("Amount tendered").fill(tendered);
	await dlg
		.getByRole("button", { name: `Confirm ${total}`, exact: true })
		.click();
	await expect(
		dlg.getByRole("heading", { name: "Sale complete" }),
	).toBeVisible();
	return dlg;
}

test("add a category", async () => {
	await page.goto("/categories");
	await page.getByRole("button", { name: "Add category" }).click();
	await page.getByLabel("New category name").fill(CAT);
	await page.getByRole("dialog").locator('button[type="submit"]').click();
	await expect(row(CAT)).toBeVisible();
	await expect(row(CAT).getByText("0", { exact: true })).toBeVisible(); // product count badge
});

test("add a payment method", async () => {
	await page.goto("/payment-methods");
	await page.getByRole("button", { name: "Add payment method" }).click();
	await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(PAY);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Add", exact: true })
		.click();
	await expect(row(PAY)).toBeVisible();
	await expect(row(PAY).getByText("Pays the exact amount")).toBeVisible();
	await expect(row(PAY).getByLabel(`${PAY} enabled`)).toBeChecked();
});

test("add a product without variants, in the category", async () => {
	await newProduct(SIMPLE, "4.50");
	await page.getByRole("button", { name: CAT }).click(); // CategoryPicker pill
	await saveProduct(SIMPLE);
	await expect(row(SIMPLE)).toContainText("$4.50");
	await expect(row(SIMPLE)).toContainText(CAT);
	await page.goto("/categories");
	await expect(row(CAT).getByText("1", { exact: true })).toBeVisible();
});

test("add a product with generated variants", async () => {
	await newProduct(VARIANT, "5.00");
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await page.getByRole("button", { name: "Quick generate" }).click();
	await page.getByLabel("Option group name").fill("Size");
	await page.getByLabel("Option values").fill("S, M");
	await page.getByRole("button", { name: "Generate 2 variants" }).click();
	await expect(page.getByLabel("Variant name")).toHaveCount(2);
	await expect(page.getByLabel("Variant name").nth(1)).toHaveValue("M");
	await page.getByLabel("Bulk set price").fill("3.00");
	await page.getByRole("button", { name: "Apply to all" }).click();
	await saveProduct(VARIANT);
	await expect(row(VARIANT)).toContainText(/from \$3\s*2 variants/); // price cell: "from $3" then the variant count
	await expect(row(VARIANT)).toContainText("2 variants");
});

test("add a product with an image", async () => {
	await newProduct(PHOTO, "2.25");
	// a picked photo opens the square editor first: Discard drops it, Save uploads it
	await page.locator('input[type="file"]').first().setInputFiles(PNG);
	const editor = page.getByRole("dialog", { name: "Edit image" });
	await editor.getByRole("button", { name: "Discard" }).click();
	await expect(editor).toBeHidden();
	await expect(page.getByAltText("Cover image")).toHaveCount(0);
	// the corner × closes it the same way
	await page.locator('input[type="file"]').first().setInputFiles(PNG);
	await editor.getByRole("button", { name: "Close" }).click();
	await expect(editor).toBeHidden();
	await expect(page.getByAltText("Cover image")).toHaveCount(0);
	await page.locator('input[type="file"]').first().setInputFiles(PNG);
	const undo = editor.getByRole("button", { name: "Undo" });
	const redo = editor.getByRole("button", { name: "Redo" });
	await expect(
		editor.getByRole("img", { name: "Image preview" }),
	).toBeVisible();
	await expect(undo).toBeDisabled();
	await editor.getByRole("button", { name: "Flip horizontally" }).click();
	await editor.getByRole("button", { name: "Flip vertically" }).click();
	await editor.getByRole("button", { name: "Rotate left" }).click();
	await editor.getByRole("button", { name: "Rotate right" }).click();
	// a background colour and padding around the photo (a transparent png keeps "No background")
	await editor.getByRole("button", { name: "Light gray" }).click();
	await expect(
		editor.getByRole("button", { name: "Light gray" }),
	).toHaveAttribute("aria-pressed", "true");
	await editor.getByLabel("Padding").fill("0.1");
	await undo.click();
	await expect(redo).toBeEnabled();
	await redo.click();
	await expect(redo).toBeDisabled();
	// "Remove background" runs a model in the browser; with the model out of reach it says so and keeps the photo
	await page.route("**/huggingface.co/**", (r) => r.abort());
	const removeBg = editor.getByRole("button", { name: "Remove background" });
	await removeBg.click();
	await expect(
		page.getByText(
			/^Couldn't remove the background\. Your photo is unchanged\./,
		),
	).toBeVisible();
	await expect(removeBg).toBeEnabled();
	await expect(redo).toBeDisabled(); // no undo step was added
	// the shadow is drawn under a cut-out only, so it stays off while the photo is whole
	await expect(editor.getByLabel("Shadow")).toBeDisabled();
	await page.unroute("**/huggingface.co/**");
	await editor.getByRole("button", { name: "Save" }).click();
	await expect(editor).toBeHidden();
	await expect(page.getByAltText("Cover image")).toBeVisible();
	// an https link opens in the editor, like a file: the server fetches it and Save stores a copy of our own.
	// One that can't be reached says so, and nothing is added — a product never keeps another site's link.
	await page.getByRole("button", { name: "Add image link" }).first().click();
	await page.getByLabel("Image link", { exact: true }).fill("not a link");
	await page.getByRole("button", { name: "Add link" }).click();
	await expect(page.getByText("Use a full https:// link")).toBeVisible();
	await page.getByLabel("Image link", { exact: true }).fill(LINK);
	await page.getByLabel("Image link", { exact: true }).press("Enter");
	await expect(
		editor.getByText("Could not load the image from that link"),
	).toBeVisible();
	await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
	await editor.getByRole("button", { name: "Discard" }).click();
	await expect(page.getByAltText("Image 2")).toHaveCount(0);
	await saveProduct(PHOTO);
	await expect(row(PHOTO).getByRole("img", { name: PHOTO })).toBeVisible();
	await expect(row(PHOTO).locator("img")).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/products\/.+\.webp$/, // the editor saves every photo as a square webp
	);
	await page.getByRole("link", { name: PHOTO, exact: true }).click();
	// an image the product has opens in the same editor; Save swaps in the new square
	const cover = page.getByAltText("Cover image");
	const before = await cover.getAttribute("src");
	await page.getByRole("button", { name: "Edit image 1" }).click();
	await expect(undo).toBeDisabled(); // a fresh history per image
	await editor.getByRole("button", { name: "Rotate right" }).click();
	await editor.getByRole("button", { name: "Save" }).click();
	await expect(editor).toBeHidden();
	await expect(cover).not.toHaveAttribute("src", before ?? "");
	await expect(cover).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/products\/.+\.webp$/,
	);
});

test("add a product with an image on a variant", async () => {
	await newProduct(VPHOTO, "7.00");
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await page.getByRole("button", { name: "Add variant" }).click();
	await page.getByLabel("Variant name").fill("Red");
	await page.locator('input[type="file"]').nth(1).setInputFiles(PNG); // 0 = product images, 1 = first variant row
	await page
		.getByRole("dialog", { name: "Edit image" })
		.getByRole("button", { name: "Save" })
		.click();
	await expect(vrow().locator("img")).toBeVisible();
	await saveProduct(VPHOTO);
	// reopen: the variant still has its image, the product itself has none
	await page.getByRole("link", { name: VPHOTO, exact: true }).click();
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await expect(page.getByLabel("Variant name")).toHaveValue("Red");
	await expect(vrow().locator("img")).toHaveAttribute("src", /^\/uploads\//);
	await expect(page.getByAltText("Cover image")).toHaveCount(1); // only the variant's
});

test("sell: a few orders with different payment methods", async () => {
	await page.goto("/pos");
	// filter by the new category: only the simple product is in it
	await page.getByRole("button", { name: CAT, exact: true }).click();
	await expect(card(SIMPLE)).toBeVisible();
	await expect(
		page.locator("section button", { hasText: VARIANT }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "All", exact: true }).click();

	// #1 — 2× Latte, cash with change
	await card(SIMPLE).click();
	await card(SIMPLE).click();
	// a plain line reopens as a quantity-only sheet; "Update line" keeps the one line
	await page.getByRole("button", { name: `Edit ${SIMPLE}` }).click();
	const plain = page.getByRole("dialog");
	await expect(plain.getByText("No options for this product")).toBeVisible();
	await expect(plain.getByText("2", { exact: true })).toBeVisible(); // the line's quantity
	await plain.getByRole("button", { name: "OK" }).click();
	await expect(
		page.getByRole("button", { name: "Charge $9", exact: true }),
	).toBeVisible();
	const r1 = await checkout("Cash", "$9", "10.00");
	await expect(r1.getByText("Change")).toBeVisible();
	await expect(r1.locator("dd").last()).toHaveText("$1");
	await r1.getByRole("button", { name: "Done" }).click();

	// #2 — Tee / M through the variant picker, paid with the new method
	await card(VARIANT).click();
	const pick = page.getByRole("dialog");
	await pick.getByRole("button", { name: "M", exact: true }).click();
	await pick.getByRole("button", { name: "Increase quantity" }).click();
	await pick.getByRole("button", { name: /Add to cart/ }).click();
	// reopening a variant line starts from that variant
	await page.getByRole("button", { name: `Edit ${VARIANT}` }).click();
	await expect(
		pick.getByRole("button", { name: "M", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("Escape"); // closed without changes
	const r2 = await checkout(PAY, "$6");
	await expect(r2.getByText(`2 × ${VARIANT}`)).toBeVisible();
	await r2.getByRole("button", { name: "Done" }).click();

	// #3 — Muffin + Cap/Red (only option, picked from the list), card
	await card(PHOTO).click();
	await card(VPHOTO).click();
	await page.getByRole("dialog").getByRole("button", { name: "Red" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /Add to cart/ })
		.click();
	const r3 = await checkout("Card", "$9.25");
	await r3.getByRole("button", { name: "Done" }).click();
	await expect(page.getByRole("button", { name: /^Charge/ })).toBeDisabled(); // cart cleared
});

test("orders list, receipt and stats", async () => {
	await page.goto("/orders");
	await expect(page.getByText("3 sales for")).toBeVisible();
	await expect(orow(1)).toContainText(amount("$9"));
	await expect(orow(1)).toContainText("Cash");
	await expect(orow(2)).toContainText(amount("$6"));
	await expect(orow(2)).toContainText(PAY);
	await expect(orow(3)).toContainText("$9.25");
	await expect(orow(3)).toContainText("Card");

	// stats: 9.00 + 6.00 + 9.25 = 24.25 over 3 orders
	const stat = (label: string) =>
		page.getByText(label).locator("xpath=../following-sibling::div");
	await expect(stat("Today's revenue")).toHaveText("$24.25");
	await expect(stat("Today's orders")).toHaveText("3");
	await expect(stat("Avg. order")).toHaveText("$8.08");

	// payment filter
	await page.getByRole("combobox", { name: "Payment method" }).click();
	await page.getByRole("option", { name: PAY }).click();
	await expect(page.getByText("1 matching sale")).toBeVisible();
	await expect(orow(1)).toHaveCount(0);
	await page.getByRole("combobox", { name: "Payment method" }).click();
	await page.getByRole("option", { name: "Any payment" }).click();

	// order detail page
	await orow(2).click();
	await page.waitForURL("**/orders/2");
	await expect(page.getByRole("heading", { name: /^Order #/ })).toBeVisible();
	await expect(page.getByText(`${VARIANT}`).first()).toBeVisible();
	await expect(page.getByText("Completed")).toBeVisible();
});

test("delete: category, payment method, product — orders keep their history", async () => {
	await page.goto("/categories");
	await confirmDelete(CAT);
	await expect(row(CAT)).toHaveCount(0);
	await page.goto("/products");
	await expect(row(SIMPLE)).toContainText("—"); // uncategorised now, still there

	await page.goto("/payment-methods");
	await confirmDelete(PAY);
	await expect(row(PAY)).toHaveCount(0);

	await page.goto("/products");
	await confirmDelete(SIMPLE);
	await expect(row(SIMPLE)).toHaveCount(0);
	await page.goto("/pos");
	await expect(page.locator("section button", { hasText: SIMPLE })).toHaveCount(
		0,
	);

	await page.goto("/orders");
	await expect(orow(1)).toContainText(`2× ${SIMPLE}`); // sold product still on the order
	await expect(orow(2)).toContainText(PAY); // deleted method name kept
});
