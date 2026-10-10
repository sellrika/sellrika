import { expect, test } from "@playwright/test";
import { enableGlobally, login, submitProduct } from "./helpers";

// The Labels extension: the admin switches it on, opens its page in the Catalog group, adds a product,
// sets the copies, sees the label with its barcode in the preview and prints from a hidden frame.
const run = Date.now().toString(36);
const P = `Label Mug ${run}`;
const CODE = "8850001112223";

test("labels: pick a product, set copies, preview the barcode, print one page per label", async ({
	page,
}) => {
	// count the prints instead of opening the print window (runs in the print frame too)
	await page.addInitScript(() => {
		window.print = () => {
			const w = window.top as unknown as { printed?: number };
			w.printed = (w.printed ?? 0) + 1;
		};
	});
	await login(page);
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(P);
	await page.getByLabel("Base price").fill("18.00");
	await page.getByLabel("Barcode").fill(CODE);
	await submitProduct(page);

	await enableGlobally(page, "Labels");
	await page.goto("/extensions");
	const ext = page.getByRole("row").filter({ hasText: "Labels" });
	await ext.getByLabel("Labels enabled").click();
	await expect(ext.getByLabel("Labels enabled")).toBeChecked();

	await page.getByRole("link", { name: "Labels", exact: true }).click();
	await expect(page).toHaveURL(/\/extensions\/labels\/print$/);
	const print = page.getByRole("button", { name: /^Print/ });
	await expect(print).toBeDisabled();

	await page.getByPlaceholder("Search by name, SKU or barcode").fill(P);
	const row = page.locator("[data-unit]").filter({ hasText: P });
	await row.getByRole("button", { name: "Add", exact: true }).click();
	await expect(print).toHaveText("Print 1 label");
	await expect(page.getByText(`${P} · 1 of 1`)).toBeVisible();
	// the stepper: one more, then a typed number
	await page.getByRole("button", { name: `One more of ${P}` }).click();
	await expect(print).toHaveText("Print 2 labels");
	await page.getByLabel(`Copies of ${P}`).fill("3");
	await page.getByLabel(`Copies of ${P}`).blur();
	await expect(print).toHaveText("Print 3 labels");
	// the list stays inside the screen and scrolls by itself
	const list = page.locator("[data-unit]").first().locator("xpath=../..");
	const box = (await list.boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await expect(list).toHaveCSS("overflow-y", "auto");
	// the Picked tab holds only that product
	await page.getByRole("button", { name: /^Picked/ }).click();
	await expect(page.locator("[data-unit]")).toHaveCount(1);

	// the preview: name, price with no ".00", the bars and the digits under them
	const preview = page.locator("[data-label]");
	await expect(preview).toContainText(P);
	await expect(preview).toContainText("$18");
	await expect(preview).toContainText(CODE);
	await expect(preview.locator("svg rect").first()).toBeAttached();

	// without the barcode the bars and digits go; a sheet makes the label 70 mm wide
	const chip = page.getByRole("button", { name: "Barcode", exact: true });
	await chip.click();
	await expect(chip).toHaveAttribute("aria-pressed", "false");
	await expect(preview.locator("svg")).toHaveCount(0);
	await chip.click();
	await page.getByLabel("Size", { exact: true }).selectOption("a4-24");
	await expect(preview).toHaveAttribute("style", /width:\s*70mm/);
	await expect(preview.locator("svg")).toBeAttached();
	await page.getByLabel("Size", { exact: true }).selectOption("50x30");

	await print.click();
	expect(
		await page.evaluate(
			() => (window as unknown as { printed?: number }).printed,
		),
	).toBe(1);
	// a roll: one page per label, three copies
	const frame = page.frameLocator("iframe").last();
	await expect(frame.locator(".page")).toHaveCount(3);
	await expect(frame.locator(".page svg")).toHaveCount(3);

	await page.getByRole("button", { name: "Clear all" }).click();
	await expect(print).toBeDisabled();
	await expect(print).toHaveText("Print");
});
