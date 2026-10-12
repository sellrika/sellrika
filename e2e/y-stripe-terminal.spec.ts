import { expect, test, type Locator, type Page } from "@playwright/test";
import { enableGlobally, login, submitProduct } from "./helpers";
import { BASE_PORT } from "./tmp";

// The Stripe Terminal extension: a card payment at the till with a card reader, against the Stripe
// stand-in of e2e/fixtures/serve.ts (STRIPE_TERMINAL_API_URL). It approves a charge the moment it
// reaches the reader and declines an amount that ends in 01.
// It also covers the app's own rule for such a method: the pay dialog's confirm button stays off
// until the extension approves, and the sale then completes by itself.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const GOOD = `Reader Tea ${run}`; // $12.50
const BAD = `Reader Cake ${run}`; // $10.01: the stand-in declines it
const NAME = "Stripe Terminal";
const FIXTURES = `http://localhost:${BASE_PORT - 1}`;

/** A card payment as the Stripe stand-in keeps it. */
type Intent = { id: string; status: string; amount: number; refunded: number };

/**
 * The card payments the stand-in holds for one amount.
 * Other runs may have left their own, so they are picked by amount.
 * @param page Any page, for its request context.
 * @param amount The cents.
 * @returns The payments, oldest first.
 */
async function intentsOf(page: Page, amount: number) {
	const all: Intent[] = await (
		await page.request.get(`${FIXTURES}/terminal/last`)
	).json();
	return all.filter((i) => i.amount === amount);
}

/**
 * The id of the order a receipt dialog shows.
 * @param dlg The dialog after a sale.
 * @returns The order id.
 */
async function orderIdOf(dlg: Locator) {
	const text = await dlg
		.getByText(/Order #\d+/)
		.first()
		.innerText();
	return Number(text.match(/#(\d+)/)![1]);
}

let page: Page;
let order = 0;
test.beforeAll(async ({ browser }) => {
	// a context of its own: the customer's screen is a second page of it, with the same localStorage
	const context = await browser.newContext();
	page = await context.newPage();
	await login(page);
});
test.afterAll(async () => page.context().close());

test("setup: two products, and the extension adds the Card reader method", async () => {
	for (const [name, price] of [
		[GOOD, "1250.00"],
		[BAD, "1000.01"],
	] as const) {
		await page.goto("/products/create");
		await page.getByLabel("Name", { exact: true }).fill(name);
		await page.getByLabel("Base price").fill(price);
		await submitProduct(page);
	}
	await enableGlobally(page, NAME);
	await page.goto("/extensions");
	await page.getByLabel(`${NAME} enabled`).click();
	const settings = page.getByRole("dialog");
	await settings.getByLabel("Secret key").fill("sk_test_e2e");
	await settings.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Extension saved").last()).toBeVisible();
	await page.goto("/payment-methods");
	await expect(page.getByText("Card reader", { exact: true })).toBeVisible();
});

test("a declined card shows the reason and keeps the confirm button off", async () => {
	await page.goto("/pos");
	await page.getByPlaceholder(/Search or scan/).fill(BAD);
	await page.getByText(BAD).first().click();
	await page.getByRole("button", { name: /^Charge/ }).click();
	const pay = page.getByRole("dialog");
	const confirm = pay.getByRole("button", { name: /^Confirm/ });
	await expect(confirm).toBeEnabled(); // Cash is picked first
	await pay.getByRole("button", { name: "Card reader" }).click();
	// the method must be approved by its extension first
	await expect(confirm).toBeDisabled();
	const box = pay.locator("[data-terminal]");
	// the readers come from Stripe: the one that is online is picked, the other can't be
	await expect(box.getByLabel("Reader", { exact: true })).toHaveValue(
		"tmr_e2e_front",
	);
	await expect(
		box.getByRole("option", { name: "Back room (offline)" }),
	).toBeDisabled();
	await box.getByRole("button", { name: "Send to reader" }).click();
	await expect(box.locator("[data-terminal-status]").first()).toHaveText(
		"Card declined: Your card was declined.",
	);
	await expect(confirm).toBeDisabled();
	await expect(box.getByRole("button", { name: "Try again" })).toBeVisible();
	// nothing stays open at Stripe
	await expect
		.poll(async () => (await intentsOf(page, 100001)).map((i) => i.status))
		.toEqual(["canceled"]);
	// another method frees the button again
	await pay.getByRole("button", { name: "Cash", exact: true }).click();
	await expect(confirm).toBeEnabled();
	await page.keyboard.press("Escape");
	await expect(pay).toBeHidden();
	// start the next sale with an empty cart
	await page.evaluate(() => localStorage.clear());
});

test("an approved card completes the sale by itself and the money is taken with the order", async () => {
	await page.goto("/pos");
	await page.getByPlaceholder(/Search or scan/).fill(GOOD);
	await page.getByText(GOOD).first().click();
	await page.getByRole("button", { name: /^Charge/ }).click();
	const pay = page.getByRole("dialog");
	await pay.getByRole("button", { name: "Card reader" }).click();
	await expect(pay.getByRole("button", { name: /^Confirm/ })).toBeDisabled();
	// the customer's screen runs the same script, but only says what to do: it never drives the reader
	const screen = await page.context().newPage();
	await screen.goto("/pos/display");
	await expect(screen.locator("[data-terminal-screen]")).toContainText(
		"Tap your card on the reader",
	);
	await expect(screen.locator("[data-terminal]")).toHaveCount(0);
	await pay.getByRole("button", { name: "Send to reader" }).click();
	// the cashier does not tap again: the dialog goes on to the receipt
	await expect(pay.getByRole("heading", { name: "Sale complete" })).toBeVisible(
		{ timeout: 15_000 },
	);
	await expect(pay.getByText("Card reader")).toBeVisible();
	order = await orderIdOf(pay);
	// the hold is captured once the order is saved, and the closing dialog does not cancel it
	await expect
		.poll(async () => (await intentsOf(page, 125000)).map((i) => i.status))
		.toEqual(["succeeded"]);
	await pay.getByRole("button", { name: "Done" }).click();
	await screen.close();
	// the dialog's own cancel waits 5 seconds for the order before it acts: the money must still be there after it
	await page.waitForTimeout(6000);
	// one charge only, although the script ran in two places
	expect((await intentsOf(page, 125000)).map((i) => i.status)).toEqual([
		"succeeded",
	]);
});

test("the order page shows the card payment, and a refund goes back to the card", async () => {
	await page.goto(`/orders/${order}`);
	const button = page.locator("[data-terminal-order]");
	await expect(button).toHaveText("Card payment");
	await page.getByRole("button", { name: "Refund", exact: true }).click();
	const dlg = page.getByRole("dialog");
	await dlg.getByLabel("Amount to refund").fill("250.00");
	await dlg.getByRole("button", { name: "Refund $250", exact: true }).click();
	await expect
		.poll(async () => (await intentsOf(page, 125000)).map((i) => i.refunded))
		.toEqual([25000]);
	// the button's dialog lists what went back
	await button.click();
	await expect(
		page.locator("[data-terminal-charge]").getByText("Card refund done: $250"),
	).toBeVisible({ timeout: 15_000 });
});
