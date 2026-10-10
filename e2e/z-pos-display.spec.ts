import { expect, test, type Page } from "@playwright/test";
import {
	enableGlobally,
	login,
	submitProduct,
	TINY_PNG,
	uploadExtension,
} from "./helpers";
import { zip } from "../app/helpers/zip";

// The customer's screen (/pos/display): a second window of the same browser that follows the Sell screen's cart
// through localStorage, plus the `pos.display` slot an extension fills (a QR code to pay, advertisements).
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const P = `Display Tea ${run}`;
/** An extension whose slot script prints the sale it is handed, and follows it. */
const EXT = Buffer.from(
	zip({
		"extension.json": JSON.stringify({
			key: "second-screen",
			name: "Second Screen",
			version: "1.0.0",
			description: "Shows the sale",
			slots: [{ name: "pos.display", script: "assets/display.js" }],
		}),
		"index.js": "export default {}",
		"assets/display.js": `export default (el, api) => {
			const show = (s) => { el.textContent = "ext " + s.lines.length + " lines " + s.total + " " + s.currency; };
			show(api.context.sale());
			return api.context.onChange(show);
		};`,
	}),
);

let sell: Page;
let display: Page; // same browser context → the same localStorage, like a second window
test.beforeAll(async ({ browser }) => {
	const context = await browser.newContext();
	sell = await context.newPage();
	await login(sell);
	display = await context.newPage();
});
test.afterAll(async () => sell.context().close());

test("the customer screen follows the Sell screen's cart and shows No items when it is empty", async () => {
	await sell.goto("/products/create");
	await sell.getByLabel("Name", { exact: true }).fill(P);
	await sell.getByLabel("Base price").fill("4.50");
	await submitProduct(sell);

	await sell.goto("/pos");
	// the button opens it in a window of its own (one monitor here: a plain window, no permission asked)
	const [opened] = await Promise.all([
		sell.waitForEvent("popup"),
		sell.getByRole("button", { name: "Customer screen" }).click(),
	]);
	await expect(opened).toHaveURL(/\/pos\/display$/);
	await expect(opened.locator("[data-fullscreen-hint]")).toHaveText(
		"Click anywhere for full screen",
	);
	// the cashier's next click on the Sell screen is passed on: the customer screen goes full screen
	await sell.getByPlaceholder(/Search or scan/).click();
	await expect(opened.locator("[data-fullscreen-hint]")).toHaveCount(0);
	expect(await opened.evaluate(() => !!document.fullscreenElement)).toBe(true);
	await opened.close();
	// always light, even when the cashier's computer is set to dark
	await display.emulateMedia({ colorScheme: "dark" });
	await display.goto("/pos/display");
	await expect(display.locator("html")).not.toHaveClass(/dark/);
	await expect(display.getByText("No items")).toBeVisible();
	// no extension yet: the big column shows the shop instead
	await expect(display.locator("[data-slot='pos.display']")).toHaveCount(0);
	await expect(display.locator("[data-display-space]")).toContainText(
		"Main Shop",
	);

	await sell.getByPlaceholder(/Search or scan/).fill(P);
	await sell.getByText(P).first().click();
	await sell.getByText(P).first().click();
	await expect(display.getByText(P)).toBeVisible();
	await expect(display.getByText("2 × $4.50")).toBeVisible();
	await expect(display.locator("[data-count]")).toHaveText("2 items");
	await expect(display.locator("li[data-added]")).toHaveCount(1); // the line that grew is marked
	await expect(display.locator("[data-total]")).toHaveText("$9");

	// a note typed on the line shows under it
	await sell.getByRole("button", { name: /note/i }).first().click();
	await sell
		.getByPlaceholder("Note for the kitchen or the order")
		.fill("No sugar");
	await expect(display.locator("[data-note]")).toHaveText("No sugar");

	await display.reload(); // a fresh window reads the saved cart
	await expect(display.locator("[data-total]")).toHaveText("$9");
});

test("an extension fills the pos.display slot with the live sale", async () => {
	await sell.goto("/admin/extensions");
	await uploadExtension(sell, EXT);
	await expect(sell.getByText("Extension added").last()).toBeVisible();
	await enableGlobally(sell, "Second Screen");
	await sell.goto("/extensions");
	await sell.getByLabel("Second Screen enabled").click();
	await expect(
		sell
			.getByRole("row")
			.filter({ hasText: "Second Screen" })
			.getByText("Ready"),
	).toBeVisible();

	await display.reload();
	const slot = display.locator("[data-extension='second-screen']");
	await expect(slot).toHaveText("ext 1 lines 900 USD"); // cents

	await sell.goto("/pos");
	await sell.getByRole("button", { name: "Clear", exact: true }).click();
	await sell.getByRole("button", { name: "Clear cart" }).click();
	await expect(slot).toHaveText("ext 0 lines 0 USD");
	await expect(display.getByText("No items")).toBeVisible();
});

test("a payment method's picture shows on the customer screen while that method is picked", async () => {
	// Catalog › Payments: give Card a picture (a QR code to pay)
	await sell.goto("/payment-methods");
	await sell.getByRole("button", { name: "Edit Card" }).click();
	const form = sell.getByRole("dialog");
	await form
		.getByLabel("Picture file for the customer screen")
		.setInputFiles(TINY_PNG);
	await expect(form.locator("[data-image-preview]")).toBeVisible();
	await form.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sell.getByText("Payment method updated")).toBeVisible();
	await expect(sell.locator("[data-method-image]")).toHaveText(
		"On customer screen",
	);

	await sell.goto("/pos");
	await sell.getByPlaceholder(/Search or scan/).fill(P);
	await sell.getByText(P).first().click();
	const payment = display.locator("[data-payment]");
	await sell.getByRole("button", { name: /^Charge/ }).click();
	await expect(payment).toHaveCount(0); // Cash is picked first and has no picture
	await sell.getByRole("dialog").getByRole("button", { name: "Card" }).click();
	await expect(payment.locator("img")).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/payments\//,
	);
	await expect(payment).toContainText("Card · $4.50");
	// the pay dialog shows the same picture, for a shop with no second monitor
	const shown = sell.getByRole("dialog").locator("[data-pay-show]");
	await expect(shown.locator("img")).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/payments\//,
	);
	await expect(shown).toContainText("Card · $4.50");
	// the extension's slot is hidden under it, not gone
	await expect(
		display.locator("[data-extension='second-screen']"),
	).toBeHidden();

	await sell.getByRole("dialog").getByRole("button", { name: "Cash" }).click();
	await expect(payment).toHaveCount(0);
	await sell.getByRole("dialog").getByRole("button", { name: "Card" }).click();
	await expect(payment).toHaveCount(1);
	await sell.keyboard.press("Escape"); // the dialog closed: the picture goes
	await expect(payment).toHaveCount(0);
	await expect(
		display.locator("[data-extension='second-screen']"),
	).toBeVisible();
});

test("the PromptPay extension adds a payment method and shows a QR code for the amount", async () => {
	// PromptPay moves Thai baht only
	await sell.goto("/shops");
	await sell.getByRole("link", { name: "Edit Main Shop" }).click();
	await sell.getByRole("combobox", { name: "Currency" }).click();
	await sell.getByPlaceholder("Search currency…").fill("THB");
	await sell.getByRole("option", { name: /THB/ }).first().click();
	await sell.getByRole("button", { name: "Save" }).first().click();
	await expect(sell.getByText("Shop updated")).toBeVisible();

	// Enable asks for the PromptPay ID first
	await enableGlobally(sell, "PromptPay QR");
	await sell.goto("/extensions");
	await sell.getByLabel("PromptPay QR enabled").click();
	await sell
		.getByRole("dialog")
		.getByLabel("PromptPay ID")
		.fill("080-123-4567");
	await sell
		.getByRole("dialog")
		.getByLabel("Name under the QR code")
		.fill("Plot Thailand");
	await sell
		.getByRole("dialog")
		.getByLabel("Account name")
		.fill("Main Shop Co.");
	await sell.getByRole("dialog").getByRole("button", { name: "Save" }).click();
	await expect(sell.getByText("Extension saved").last()).toBeVisible();

	// its method is a row of Catalog › Payments like any other
	await sell.goto("/payment-methods");
	await expect(sell.locator("[data-method-extension]")).toHaveText(
		"Added by an extension",
	);

	await display.reload();
	const code = display.locator("[data-promptpay]");
	await expect(code).toHaveCount(0); // nothing to pay yet
	await sell.goto("/pos");
	await sell.getByRole("button", { name: /^Charge/ }).click();
	await expect(code).toHaveCount(0); // Cash is picked first
	await sell
		.getByRole("dialog")
		.getByRole("button", { name: "PromptPay" })
		.click();
	await expect(code.locator("[data-promptpay-code] svg")).toBeVisible();
	// the Thai QR Payment card: the amount under the code, then the name and the account's name from the settings
	await expect(code.locator("[data-promptpay-name]")).toHaveText(
		"Plot Thailand",
	);
	await expect(code.locator("[data-promptpay-account]")).toHaveText(
		"Account: Main Shop Co.",
	);
	await expect(code.locator("[data-promptpay-amount]")).toContainText("4.50");
	// the pay dialog draws the same code
	await expect(
		sell
			.getByRole("dialog")
			.locator("[data-pay-show] [data-promptpay-code] svg"),
	).toBeVisible();
	await sell.keyboard.press("Escape"); // the dialog closed: the code goes
	await expect(code).toHaveCount(0);
});
