import { readFileSync } from "node:fs"; // Playwright runs specs under Node, not Bun
import { expect, test, type Page } from "@playwright/test";
import { login, search, submitProduct } from "./helpers";

// Products page CSV import/export (Universal POS Product CSV v1).
// Own throwaway DB per spec file, so nothing here needs cleaning up.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const TEA = `Csv Tea ${run}`;
const KAF = `Csv Kaf ${run}`; // two variants via a shared variant_group
const BC = `00${run}9`; // leading zeros must survive the round trip

let page: Page;
test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});
test.afterAll(() => page.close());

test("importing a v1 CSV creates simple and variant products; bad rows are reported", async () => {
	await page.goto("/products");
	const csv = [
		"name,sku,price,barcode,currency,cost,category,unit,track_stock,stock_quantity,variant_group,variant_name",
		`${TEA},T1,4.50,${BC},USD,2.00,Csv Drinks ${run},pack,true,7,,`,
		`${KAF},K1,3.00,,USD,,,,,,g-${run},Small`,
		`${KAF},K2,5.00,,USD,,,,,,g-${run},Large`,
		`,X1,1.00,,USD,,,,,,,`, // no name → reported, everything else still imports
	].join("\n");
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Import" }).click();
	await (await chooser).setFiles({
		name: "products.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(csv),
	});

	await expect(page.getByText("Imported 2 products")).toBeVisible();
	await expect(page.getByRole("alert")).toContainText(
		"Row 5: Name is required",
	);
	await search(page, "Search products", TEA);
	const tea = page.getByRole("row").filter({ hasText: TEA });
	await expect(tea).toContainText(BC);
	await expect(tea).toContainText("T1"); // imported SKU shows in the list
	await search(page, "Search products", KAF);
	const kaf = page.getByRole("row").filter({ hasText: KAF });
	await expect(kaf).toContainText("2 variants");
	await expect(kaf).toContainText("from");
});

test("sku round-trips through the product form and is searchable", async () => {
	await search(page, "Search products", TEA);
	await page.getByRole("link", { name: TEA, exact: true }).click();
	const sku = page.getByLabel("SKU", { exact: true });
	await expect(sku).toHaveValue("T1");
	await sku.fill(`T-${run}`);
	await submitProduct(page);
	await page.goto("/products");
	await search(page, "Search products", `T-${run}`);
	await expect(page.getByRole("row").filter({ hasText: TEA })).toBeVisible();

	// variant SKUs live per row in the variants editor
	await search(page, "Search products", KAF);
	await page.getByRole("link", { name: KAF, exact: true }).click();
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await expect(page.getByLabel("Variant SKU").nth(0)).toHaveValue("K1");
	await expect(page.getByLabel("Variant SKU").nth(1)).toHaveValue("K2");
});

test("export downloads a CSV holding the imported products", async () => {
	await page.goto("/products");
	const dl = page.waitForEvent("download");
	await page.getByRole("link", { name: "Export" }).click();
	const file = readFileSync((await (await dl).path())!, "utf8");
	expect(file.split(/\r?\n/)[0]).toBe(
		"name,sku,price,barcode,currency,cost,category,brand,unit,tax_rate,price_includes_tax,track_stock,stock_quantity,low_stock_threshold,variant_group,variant_name,additional_barcodes,supplier,supplier_sku,description,active",
	);
	expect(file).toContain(TEA);
	expect(file).toContain(BC);
	expect(file).toContain(`T-${run}`); // the edited SKU is exported
	expect(file).toContain("Small");
	expect(file).toContain("Large");
});
