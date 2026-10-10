import { expect, test } from "@playwright/test";
import { enableGlobally, login, submitProduct } from "./helpers";

// The Tax Invoice extension and the `order.show` slot: the shop sets its VAT, the admin fills in the seller,
// a paid order gets the "Tax invoice" button, the buyer is typed once and the A4 page prints from a hidden frame.
const run = Date.now().toString(36);
const P = `Invoice Mug ${run}`;
const NAME = "Tax Invoice";
const BUYER = `Buyer Co ${run}`;

test("tax invoice: a paid order with VAT prints one with the buyer, and keeps its number", async ({
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
	await page.getByLabel("Base price").fill("107.00");
	await submitProduct(page);

	// the shop's VAT: 7%, inside the prices
	await page.goto("/shops/1/edit");
	await page.getByLabel("Tax rate", { exact: true }).fill("7");
	await page.getByLabel("Tax label", { exact: true }).fill("VAT");
	await page.getByLabel("Prices include tax").click();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page).toHaveURL(/\/shops$/);

	// switching it on before it is set up opens the settings
	await enableGlobally(page, NAME);
	await page.goto("/extensions");
	const ext = page.getByRole("row").filter({ hasText: NAME });
	await ext.getByLabel(`${NAME} enabled`).click();
	const settings = page.getByRole("dialog");
	await settings.getByLabel("Seller name").fill("Mug Co., Ltd.");
	await settings.getByLabel("Seller address").fill("1 Sukhumvit Rd, Bangkok");
	await settings.getByLabel("Seller tax ID").fill("DE 123 456 789");
	await settings.getByRole("button", { name: "Save" }).click();
	await expect(ext.getByLabel(`${NAME} enabled`)).toBeChecked();

	// a customer with two addresses, one with a tax ID
	await page.goto("/customers");
	await page.getByRole("button", { name: "Add customer" }).first().click();
	const add = page.getByRole("dialog");
	await add.getByLabel("Name", { exact: true }).fill(BUYER);
	await add.getByRole("button", { name: "Add customer" }).click();
	await page
		.getByRole("button", { name: `Open ${BUYER}`, exact: true })
		.click();
	for (const [label, line, tax] of [
		["Home", "9 Rama IV Rd", ""],
		["Office", "1 Work St", "GB123456789"],
	] as const) {
		await page.getByRole("button", { name: "Add address" }).click();
		await add.getByLabel("Label").fill(label);
		await add.getByLabel("Address", { exact: true }).fill(line);
		await add.getByLabel("City").fill("Bangkok");
		await add.getByLabel("Tax ID").fill(tax);
		await add.getByRole("button", { name: "Save" }).click();
		await expect(
			page.locator("[data-address]").filter({ hasText: line }),
		).toBeVisible();
	}

	// a cash sale to that customer
	await page.goto("/pos");
	await page.locator("section button", { hasText: P }).first().click();
	await page.getByRole("button", { name: "Add customer" }).click();
	await add.getByPlaceholder("Search name or phone").fill(BUYER);
	await add.getByRole("button", { name: BUYER, exact: true }).click();
	await page.getByRole("button", { name: "Charge $107", exact: true }).click();
	const sale = page.getByRole("dialog");
	await sale.getByRole("button", { name: "Cash", exact: true }).click();
	await sale.getByLabel("Amount tendered").fill("107.00");
	await sale.getByRole("button", { name: "Confirm $107", exact: true }).click();
	const text = await sale
		.getByText(/Order #\d+/)
		.first()
		.innerText();
	await page.goto(`/orders/${text.match(/#(\d+)/)![1]}`);
	// the invoice number is INV- and the order's public code
	const heading = await page.getByRole("heading", { level: 1 }).innerText();
	const number = `INV-${heading.match(/#\s*(\S+)/)![1]}`;

	// the slot's button sits in the header's button row
	const slot = page.locator("[data-slot='order.show']");
	await slot.getByRole("button", { name: "Tax invoice" }).click();
	const dlg = page.getByRole("dialog", { name: "Tax invoice" });
	// it starts with the customer: their name and their first address (it has no tax ID)
	await expect(dlg.getByLabel("Buyer name")).toHaveValue(BUYER);
	await expect(dlg.getByLabel("Buyer tax ID")).toHaveValue("");
	await expect(dlg.getByLabel("Buyer address")).toHaveValue(
		"9 Rama IV Rd\nBangkok",
	);
	// the address is required: the refusal shows in the dialog
	await dlg.getByLabel("Buyer address").fill("");
	await dlg.getByRole("button", { name: "Save and print" }).click();
	await expect(dlg).toContainText("Type the buyer's name and address.");
	// the other saved address is picked from the list: its tax ID comes with it
	await dlg.getByLabel("Saved address").selectOption({ label: "Office" });
	await expect(dlg.getByLabel("Buyer address")).toHaveValue(
		"1 Work St\nBangkok",
	);
	await expect(dlg.getByLabel("Buyer tax ID")).toHaveValue("GB123456789");
	await dlg.getByRole("button", { name: "Save and print" }).click();

	const printed = () =>
		page.evaluate(() => (window as unknown as { printed?: number }).printed);
	await expect.poll(printed).toBe(1);
	const invoice = page.frameLocator("iframe").last().locator("[data-invoice]");
	await expect(invoice).toContainText("Tax Invoice");
	await expect(invoice).toContainText(number);
	await expect(invoice).not.toContainText("Order"); // no separate order line
	await expect(invoice).toContainText("Mug Co., Ltd.");
	await expect(invoice).toContainText("To");
	await expect(invoice).toContainText(BUYER);
	await expect(invoice).toContainText("1 Work St");
	await expect(invoice).not.toContainText("Issued by"); // no signature lines
	await expect(invoice).toContainText("Tax ID: GB123456789");
	await expect(invoice).toContainText(P);
	// $107 with 7% VAT inside: $100 of goods, $7 under the shop's own tax label
	await expect(invoice).toContainText("VAT 7%");
	await expect(invoice).toContainText("$100.00");
	await expect(invoice).toContainText("$7.00");
	await expect(invoice).toContainText("$107.00");

	// opened again: the same number, the buyer already filled in
	await slot.getByRole("button", { name: "Tax invoice" }).click();
	await expect(dlg).toContainText(`Invoice ${number}`);
	await expect(dlg.getByLabel("Buyer name")).toHaveValue(BUYER);
	await expect(dlg.getByLabel("Buyer address")).toHaveValue(
		"1 Work St\nBangkok",
	);
});
