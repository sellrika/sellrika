import { expect, test, type Page } from "@playwright/test";
import { amount, login, submitProduct } from "./helpers";
import { storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("x-send-order");

// A store with no payment option switched on takes orders straight from the cart:
// the button says "Send order", nothing is asked, and the order is written unpaid.
// Staff then see it on /orders and record the money there.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const P = `Send Soup ${run}`;

let admin: Page;
let visitor: Page; // separate context → no session cookie
test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	await login(admin);
	visitor = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
	await admin.close();
	await visitor.context().close();
});

test("owner: a product and the store on, with no payment option", async () => {
	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(P);
	await admin.getByLabel("Base price").fill("6.00");
	await submitProduct(admin);

	await admin.goto("/online-store");
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Online store settings saved")).toBeVisible();
});

test("visitor: Send order writes the order at once and shows it; an empty or wrong cart is refused", async () => {
	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	const cart = visitor.getByRole("dialog", { name: "Your cart" });
	await visitor.getByRole("button", { name: `Increase ${P}` }).click();
	await expect(cart).toContainText(amount("$12"));
	// no "Checkout" and no "Secure payment by …" line: there is nothing to pay with
	await expect(cart.getByRole("button", { name: "Checkout" })).toHaveCount(0);
	await expect(cart.getByText(/Secure payment by/)).toHaveCount(0);
	await cart.getByRole("button", { name: "Send order" }).click();
	// straight to the thank-you page: no name, no address, no payment
	await expect(visitor).toHaveURL(
		/main-shop\.localhost:\d+\/done\?sid=direct_/,
	);
	await expect(
		visitor.getByRole("heading", { name: "Order received!" }),
	).toBeVisible();
	await expect(visitor.locator("[data-order-code]")).toHaveText(
		/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
	);
	await expect(visitor.locator("#store-done")).toContainText(P);
	await expect(visitor.locator("#store-done")).toContainText(amount("$12"));
	// the cart is empty again
	await visitor.goto(STORE);
	await expect(
		visitor.getByRole("button", { name: "Open cart" }),
	).not.toContainText("2");

	// the route checks its input like any other
	const empty = await visitor.request.post(`${STORE}/checkout/send`, {
		data: { items: [] },
	});
	expect(empty.status()).toBe(422);
	const gone = await visitor.request.post(`${STORE}/checkout/send`, {
		data: { items: [{ product_id: 999999, variant_id: null, qty: 1 }] },
	});
	expect(gone.status()).toBe(422);
});

test("staff: the unpaid order takes more items from the Sell screen, gives items back, keeps its history, then the money is recorded", async () => {
	await admin.goto("/orders?status=unpaid");
	const row = admin.getByRole("button", { name: /^Open order \d+$/ }).first(); // rows are buttons
	await expect(row).toContainText("Unpaid");
	await expect(row).toContainText("Pay later");
	await row.click();
	await admin.waitForURL(/\/orders\/\d+$/);
	const orderUrl = admin.url();
	const id = orderUrl.match(/\d+$/)![0];
	await expect(admin.getByText(P).first()).toBeVisible();
	await expect(admin.getByText("Still due")).toBeVisible();
	await expect(admin.locator("[data-order-history]")).toHaveCount(0); // nothing was added or removed yet

	// Add items → the Sell screen, opened for this order: no customer, no discount, no payment
	await admin.getByRole("link", { name: "Add items" }).click();
	await admin.waitForURL(`**/pos?order=${id}`);
	await expect(admin.locator("[data-adding-to-order]")).toContainText(
		"Adding items to order #",
	);
	await expect(admin.getByRole("button", { name: "Add customer" })).toHaveCount(
		0,
	);
	await admin.locator("section button", { hasText: P }).click();
	await admin.getByRole("button", { name: /^Add to order/ }).click();
	await admin.waitForURL(orderUrl);
	// a new line, the total grew, and the history says what the order was and what it is now
	await expect(
		admin
			.locator("[data-order-items]")
			.getByRole("row", { name: new RegExp(P) }),
	).toHaveCount(2);
	const history = admin.locator("[data-order-history]");
	await expect(history).toContainText("Items added");
	// one table row per change: when, what, the items that changed, the order before, the order after, who
	const added = history.getByRole("row", { name: /Items added/ });
	await expect(added.locator("[data-history-changed]")).toHaveText(`+ 1× ${P}`);
	await expect(added.getByRole("cell").nth(3)).toHaveText(`2× ${P}$12`);
	await expect(added.getByRole("cell").nth(4)).toHaveText(
		`2× ${P}, 1× ${P}$18`,
	);
	await expect(added.getByRole("cell").nth(5)).toHaveText("Admin");

	// the delete button of a line takes one off on screen only: the order changes when it is saved
	const rows = admin
		.locator("[data-order-items]")
		.getByRole("row", { name: new RegExp(P) });
	const removeOne = admin.getByRole("button", { name: `Remove one ${P}` });
	const draft = admin.locator("[data-remove-draft]");
	await expect(draft).toHaveCount(0);
	await removeOne.first().click();
	await expect(rows.first().getByRole("cell").nth(1)).toHaveText("1"); // 2 → 1
	await expect(draft).toContainText("1 item will be removed");
	await expect(history).not.toContainText("Items removed"); // nothing saved yet
	await admin.getByRole("button", { name: "Undo" }).click();
	await expect(rows.first().getByRole("cell").nth(1)).toHaveText("2");
	await expect(draft).toHaveCount(0);
	// again, and saved this time
	await removeOne.first().click();
	await admin.getByRole("button", { name: "Save changes" }).click();
	await expect(admin.getByText("Items removed").first()).toBeVisible();
	const removed = history.getByRole("row", { name: /Items removed/ });
	await expect(removed.locator("[data-history-changed]")).toHaveText(
		`− 1× ${P}`,
	);
	await expect(removed.getByRole("cell").nth(4)).toHaveText(
		`1× ${P}, 1× ${P}$12`,
	);
	await expect(draft).toHaveCount(0);
	// a line with one unit left goes away from the list; the very last unit can't go (that is a void)
	await removeOne.first().click();
	await expect(rows).toHaveCount(1);
	await expect(removeOne).toBeDisabled();
	await admin.getByRole("button", { name: "Undo" }).click();
	await expect(rows).toHaveCount(2);
	// the server says the same when asked for every line at once
	const all = await admin.request.post(`/orders/${id}/items/remove`, {
		data: {
			items: [
				{ order_item_id: 1, qty: 1 },
				{ order_item_id: 2, qty: 1 },
			],
		},
	});
	expect(all.status()).toBe(422);

	// a guest reaches neither route
	const guest = await visitor.request.post(
		`${new URL(orderUrl).origin}/orders/${id}/items`,
		{ data: { items: [] }, maxRedirects: 0 },
	);
	expect(guest.status()).not.toBe(201);

	// the money comes in: the order is closed, nothing can be added or removed any more
	await admin.getByRole("button", { name: "Record payment" }).click();
	await expect(admin.getByLabel("Amount received")).toHaveValue("12.00");
	await admin.getByRole("button", { name: /^Record \$12$/ }).click();
	await expect(admin.getByText("Still due")).toHaveCount(0);
	await expect(admin.getByRole("link", { name: "Add items" })).toHaveCount(0);
	await expect(removeOne).toHaveCount(0);
	await admin.goto(`/pos?order=${id}`);
	await expect(admin.locator("[data-adding-to-order]")).toHaveCount(0); // the plain Sell screen
	const closed = await admin.request.post(`/orders/${id}/items/remove`, {
		data: { items: [{ order_item_id: 1, qty: 1 }] },
	});
	expect(closed.status()).toBe(422);
});

test("staff: Pay later on the Sell screen saves the cart as an unpaid order that can still change", async () => {
	await admin.goto("/pos");
	await admin.locator("section button", { hasText: P }).click();
	await admin.getByRole("button", { name: "Charge $6", exact: true }).click();
	const dlg = admin.getByRole("dialog");
	await dlg.getByRole("button", { name: "Pay later" }).click();
	// the receipt says what is still to pay, not the change
	await expect(
		dlg.getByRole("heading", { name: "Order saved, not paid yet" }),
	).toBeVisible();
	await expect(dlg).toContainText("Pay later");
	await expect(dlg).toContainText("Still due");
	await dlg.getByRole("button", { name: "Done" }).click();
	await expect(
		admin.getByRole("button", { name: "Charge $6", exact: true }),
	).toHaveCount(0); // the cart is empty again

	// the order is unpaid, so it takes more items
	await admin.goto("/orders?status=unpaid");
	const row = admin.getByRole("button", { name: /^Open order \d+$/ }).first();
	await expect(row).toContainText("Pay later");
	await row.click();
	await expect(admin.getByText("Still due")).toBeVisible();
	await expect(admin.getByRole("link", { name: "Add items" })).toBeVisible();

	// a discount is refused, and a guest can't use the route
	const item = { product_id: 1, variant_id: null, qty: 1 };
	const off = await admin.request.post("/pos/open", {
		data: { items: [item], discount_type: "percent", discount_value: 10 },
	});
	expect(off.status()).toBe(422);
	const guest = await visitor.request.post(
		`${new URL(admin.url()).origin}/pos/open`,
		{ data: { items: [item] }, maxRedirects: 0 },
	);
	expect(guest.status()).not.toBe(201);
});

test("a payment option switched on: the cart's button is Checkout again and Send order is refused", async () => {
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Cash on delivery payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();

	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(visitor.getByRole("button", { name: "Send order" })).toHaveCount(
		0,
	);
	const refused = await visitor.request.post(`${STORE}/checkout/send`, {
		data: { items: [{ product_id: 1, variant_id: null, qty: 1 }] },
	});
	expect(refused.status()).toBe(422);
	await visitor.getByRole("button", { name: "Checkout" }).click();
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/checkout$/);
});
