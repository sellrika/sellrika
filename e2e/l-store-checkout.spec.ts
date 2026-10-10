import { expect, test, type Page } from "@playwright/test";
import {
	amount,
	addProductImage,
	enableGlobally,
	login,
	submitProduct,
} from "./helpers";
import { storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("l-store-checkout");

// Online store, second half: payments, checkout, coupons, guided addresses, customer accounts and themes.
// The storefront itself (catalog, cart, delivery zones, templates) is in l-store.spec.ts. The two files were one;
// they are split so CI runs them in two shards at the same time. This file has its own server, so its first
// test builds the shop the other tests count on.
// The real Stripe redirect/return is deliberately not e2e-tested (no network); that path is covered
// by app/services/StoreService.test.ts with a stubbed Stripe client.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const P = `Web Mug ${run}`;

/** A row of /extensions (payment gateways are extensions). */
const extRow = (name: string) =>
	admin.getByRole("row").filter({ hasText: name });

let admin: Page;
let visitor: Page; // separate context → no session cookie
test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	await login(admin);
	visitor = await (
		await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		})
	).newPage(); // the Share button copies the link here (no system share sheet in headless Chromium)
});
test.afterAll(async () => {
	await admin.close();
	await visitor.context().close();
});

/**
 * Create a product through the product endpoint, with the admin page's cookie.
 * A CI runner sometimes drops the connection before the answer ("socket hang up").
 * Then the product may or may not exist, so look for it before trying once more.
 * @param data The product, as the form sends it.
 * @returns True when the product exists afterwards.
 */
async function postProduct(data: { name: string } & Record<string, unknown>) {
	try {
		return (await admin.request.post("/products", { data })).ok();
	} catch {
		const found = await admin.request.get(
			`/pos/products?q=${encodeURIComponent(data.name)}`,
		);
		if ((await found.json()).total > 0) return true;
		return (await admin.request.post("/products", { data })).ok();
	}
}

/**
 * Open the Delivery address tab of the store account page.
 * The tabs are plain links (`?tab=address`), so this is a page load.
 * @param p The buyer's page, on the store's /account.
 */
async function openAddresses(p: Page) {
	await p.getByRole("link", { name: "Delivery address" }).click();
	await expect(p).toHaveURL(/\/account\?tab=address$/);
}

/**
 * The "Add address" form of the account page: a <details> disclosure
 * around a plain form (the address boxes are the checkout's own island).
 * @param p The buyer's page, on the Delivery address tab.
 * @returns The disclosure, opened.
 */
async function addAddressForm(p: Page) {
	await p.getByText("Add address", { exact: true }).click();
	return p.locator("details").filter({ hasText: "Add address" });
}

test("setup: the shop the checkout tests count on — delivery zones, tax, a product, the store on, a remembered address", async () => {
	// delivery: the shop sits in the United States; a US zone at $2 and a rest-of-world zone at $5
	await admin.goto("/online-store?section=delivery");
	await admin.getByRole("combobox", { name: "Country" }).click();
	await admin.getByPlaceholder("Search country…").fill("united sta");
	await admin
		.getByRole("option", { name: /United States/ })
		.first()
		.click();
	await admin.getByRole("button", { name: "Save delivery" }).click();
	await expect(admin.getByText("Delivery settings saved")).toBeVisible();
	await admin.getByRole("button", { name: "Edit zone 1" }).click();
	const dialog = admin.getByRole("dialog");
	await dialog.getByLabel("Zone name").fill("Domestic");
	await dialog.getByRole("combobox", { name: "Countries" }).click();
	await admin.getByPlaceholder("Search country…").fill("united states");
	await admin
		.getByRole("option", { name: "United States", exact: true })
		.click();
	await admin.keyboard.press("Escape");
	await dialog.getByLabel("Delivery price").fill("2.00");
	await dialog.getByRole("button", { name: "Save zone" }).click();
	await expect(admin.getByText("Zone saved")).toBeVisible();
	await admin.getByRole("button", { name: "Add zone" }).click();
	await dialog.getByLabel("Zone name").fill("Rest of world");
	await dialog.getByLabel("Delivery price").fill("5.00");
	await dialog.getByRole("button", { name: "Save zone" }).click();
	await expect(admin.getByRole("row", { name: /Rest of world/ })).toContainText(
		"Every other country",
	);
	// tax: 7% VAT already inside the prices
	await admin.goto("/shops");
	await admin.getByRole("link", { name: "Edit Main Shop" }).click();
	const shopForm = admin.locator("form");
	await shopForm.getByLabel("Tax rate", { exact: true }).fill("7");
	await shopForm.getByLabel("Tax label", { exact: true }).fill("VAT");
	await shopForm.getByLabel("Prices include tax").click();
	await shopForm.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Shop updated")).toBeVisible();
	// the product: $4, with a picture (order lines keep a copy of it)
	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(P);
	await admin.getByLabel("Base price").fill("4.00");
	await admin.getByLabel("Original price").fill("5.00");
	await addProductImage(admin);
	await submitProduct(admin);
	// the store on, wearing the Sunday template
	await admin.goto("/online-store");
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Template", exact: true }).click();
	await admin.getByRole("button", { name: /^Sunday/ }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Online store settings saved")).toBeVisible();

	// visitor: an earlier try at the checkout — no payment option yet, but the details are remembered on this device
	await visitor.goto(STORE);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.goto(`${STORE}/checkout`);
	await visitor.getByLabel("Country").click();
	await visitor.getByPlaceholder("Search country…").fill("united sta");
	await visitor.getByRole("option", { name: /United States/ }).click();
	await visitor.getByLabel("Name", { exact: true }).fill("Ann Shopper");
	await visitor.getByLabel("Phone number").fill("555-0100");
	await visitor.getByLabel("Email").fill("ann@example.com");
	await visitor.getByLabel("Address line 1").fill("1 Main St");
	await visitor.getByLabel("City").fill("Springfield");
	await visitor.getByLabel("State / Province").fill("IL");
	await visitor.getByLabel("Postal code").fill("62701");
	await visitor.getByRole("button", { name: /^Pay/ }).click();
	await expect(
		visitor.getByText(/doesn't accept online payments/),
	).toBeVisible();
	await visitor.goto(STORE);
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await visitor.getByRole("button", { name: `Remove ${P}` }).click();
	await expect(visitor.getByText("Your cart is empty")).toBeVisible();
});

test("admin: payment gateways are extensions — built in, switched on for all shops, enabled on /extensions, one online provider on at a time, and that one names the storefront's payment line", async () => {
	// /online-store › Payments only points at /extensions until a gateway is on for all shops
	await admin.goto("/online-store?section=payments");
	await expect(admin.getByText("No payment extension yet")).toBeVisible();
	await enableGlobally(admin, "Stripe");
	await admin.goto("/extensions");
	await expect(extRow("Stripe").getByText("Needs setup")).toBeVisible();
	await expect(
		extRow("Stripe").getByText("Payments", { exact: true }),
	).toBeVisible(); // marked as a gateway
	await expect(extRow("Stripe").getByLabel("Stripe enabled")).not.toBeChecked(); // the platform switch alone never turns a gateway on in a shop
	// switching on before it is set up opens the settings; a key with the wrong prefix is refused
	await extRow("Stripe").getByLabel("Stripe enabled").click();
	const dlg = admin.getByRole("dialog");
	await expect(dlg.getByRole("link", { name: /Read more/ })).toHaveAttribute(
		"href",
		"https://dashboard.stripe.com/apikeys",
	);
	await dlg.getByLabel("Publishable key").fill("nope");
	await dlg.getByLabel("Secret key").fill("sk_test_e2e");
	await dlg.getByRole("button", { name: "Save" }).click();
	await expect(dlg.getByText("Publishable keys start with pk_")).toBeVisible();
	await dlg.getByLabel("Publishable key").fill("pk_test_e2e");
	await dlg.getByLabel("Secret key").fill("sk_test_e2e");
	await dlg.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Extension saved").last()).toBeVisible();
	await expect(extRow("Stripe").getByText("Ready")).toBeVisible();
	await expect(extRow("Stripe").getByLabel("Stripe enabled")).toBeChecked();
	// a second online provider: switching it on switches Stripe off — one takes the money
	await enableGlobally(admin, "Omise");
	await admin.goto("/extensions");
	await extRow("Omise").getByLabel("Omise enabled").click();
	await dlg.getByLabel("Public key").fill("pkey_test_e2e");
	await dlg.getByLabel("Secret key").fill("skey_test_e2e");
	await dlg.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Extension saved").last()).toBeVisible();
	await expect(extRow("Omise").getByLabel("Omise enabled")).toBeChecked();
	await expect(extRow("Stripe").getByLabel("Stripe enabled")).not.toBeChecked();
	// only the secret is write-only
	await extRow("Omise")
		.getByRole("button", { name: "Configure Omise" })
		.click();
	await expect(dlg.getByLabel("Public key")).toHaveValue("pkey_test_e2e");
	await expect(dlg.getByLabel("Secret key")).toHaveValue("");
	await admin.keyboard.press("Escape");
	// /online-store › Payments lists the shop's gateways with their own switch and Configure dialog
	await admin.goto("/online-store?section=payments");
	await expect(admin.getByText("No payment extension yet")).toHaveCount(0);
	const omiseCard = admin
		.locator("div")
		.filter({
			has: admin.getByRole("button", { name: "Configure Omise" }),
		})
		.last();
	await expect(omiseCard).toContainText("Ready");
	await expect(omiseCard.getByLabel("Omise enabled")).toBeChecked();
	await omiseCard.getByRole("button", { name: "Configure Omise" }).click();
	await expect(dlg.getByLabel("Public key")).toHaveValue("pkey_test_e2e");
	await admin.keyboard.press("Escape");
	await expect(admin.getByLabel("Cash on delivery payments")).not.toBeChecked(); // the built-in manual options sit in the same section

	// the storefront now names Omise under the cart's Checkout button (the pre-built form itself is Omise's
	// own CDN modal — never opened here, e2e must not talk to Omise)
	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(visitor.getByText("Secure payment by Omise")).toBeVisible();
	await visitor.getByRole("button", { name: `Remove ${P}` }).click();
	await expect(visitor.getByText("Your cart is empty")).toBeVisible();
});

test("manual payments: bank transfer at the checkout → unpaid order → staff record the money and ship it → the buyer tracks it", async () => {
	// admin: cash on delivery needs nothing; bank transfer needs the details the buyer is shown; both are built in and sit next to the Omise extension
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Cash on delivery payments").click();
	await admin.getByRole("button", { name: "Configure Bank transfer" }).click();
	await admin
		.getByLabel("Bank transfer Bank details")
		.fill("KBank 123-4-56789-0\nRattan & Co");
	await admin.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
	await admin.getByLabel("Bank transfer payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
	await admin.goto("/online-store?section=payments");
	await expect(admin.getByLabel("Cash on delivery payments")).toBeChecked();
	await expect(admin.getByLabel("Bank transfer payments")).toBeChecked();
	await expect(
		admin.getByRole("button", { name: "Configure Omise" }),
	).toBeVisible(); // the online provider (an extension) is listed next to them

	// visitor: the checkout offers the three ways to pay; bank transfer shows the details and places the order unpaid
	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await visitor.getByRole("button", { name: "Checkout" }).click();
	await expect(visitor.getByLabel("Name", { exact: true })).toHaveValue(
		"Ann Shopper",
	); // remembered from the earlier checkout
	await expect(
		visitor.getByRole("radio", {
			name: "Credit card and other payment methods",
		}),
	).toBeChecked();
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toBeVisible();
	await visitor.getByRole("radio", { name: /Bank transfer/ }).check();
	await expect(visitor.getByText("KBank 123-4-56789-0")).toBeVisible();
	await expect(
		visitor.getByRole("button", { name: /^Place order/ }),
	).toContainText(amount("$6")); // $4 mug + $2 delivery
	await visitor.getByRole("button", { name: /^Place order/ }).click();
	await visitor.waitForURL(
		/main-shop\.localhost:\d+\/done\?sid=bank_transfer_/,
	);
	await expect(
		visitor.getByRole("heading", { name: "Order received!" }),
	).toBeVisible();
	await expect(visitor.getByText("You'll pay by bank transfer.")).toBeVisible();
	await expect(visitor.locator("[data-payment-instructions]")).toContainText(
		"KBank 123-4-56789-0",
	);
	const code = (await visitor.locator("[data-order-code]").innerText()).trim(); // the public code, e.g. P8J4-MJSQ-4Z8T — never the id
	expect(code).toMatch(/^(?:[A-Z2-9]{4}-){2}[A-Z2-9]{4}$/);
	await expect(visitor.locator("[data-tax]")).toContainText("$0.26"); // the $4 mug's included VAT, frozen on the order
	await expect(visitor.locator("img[data-line-image]")).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/orders\//,
	); // the line shows the mug's picture, a copy the order owns
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(visitor.getByText("Your cart is empty")).toBeVisible(); // the sale went through — the cart is gone
	await visitor.keyboard.press("Escape");

	// admin: staff find it by the code the buyer quotes; it shows under Online, unpaid and new; the money is
	// recorded, then it ships with a tracking number
	await admin.goto(`/orders?q=${code.toLowerCase()}`);
	await expect(admin.getByText("1 matching sale")).toBeVisible();
	const orderId = Number(
		(await admin
			.getByRole("button", { name: /^Open order \d+$/ })
			.first()
			.getAttribute("aria-label"))!.match(/\d+/)![0],
	); // rows are buttons
	await admin.goto("/orders");
	await admin.getByRole("tab", { name: "Online" }).click();
	const row = admin.getByRole("button", {
		name: `Open order ${orderId}`,
		exact: true,
	});
	await expect(row).toContainText("Unpaid");
	await expect(row).toContainText("New");
	await expect(row).toContainText("Bank transfer");
	await admin.getByRole("combobox", { name: "Order status" }).click();
	await admin.getByRole("option", { name: "Unpaid" }).click();
	await expect(row).toBeVisible();
	await row.click();
	await admin.waitForURL(`**/orders/${orderId}`);
	await expect(admin.locator("[data-tax]")).toContainText("$0.26"); // the same line on the staff side
	await expect(admin.getByText("Still due")).toBeVisible();
	await admin.getByRole("button", { name: "Record payment" }).click();
	await expect(admin.getByLabel("Amount received")).toHaveValue("6.00");
	await admin.getByRole("button", { name: /^Record \$6$/ }).click();
	await expect(admin.getByText(amount("Recorded $6")).last()).toBeVisible();
	await expect(
		admin.getByRole("button", { name: "Record payment" }),
	).toHaveCount(0);
	await expect(admin.getByText("Still due")).toHaveCount(0);
	await admin.getByRole("combobox", { name: "Delivery status" }).click();
	await admin.getByRole("option", { name: "Shipped" }).click();
	await admin.getByLabel(/Tracking number/).fill("TH-E2E-1");
	await admin.getByRole("button", { name: "Save delivery status" }).click();
	await expect(
		admin.getByText("Marked as shipped — the customer has been emailed").last(),
	).toBeVisible();
	await expect(
		admin.getByRole("heading", { name: /^Order #/ }).locator(".."),
	).toContainText("Shipped");

	// visitor: the footer's Track order page — the number plus the email is the proof; anything else is one vague miss
	await visitor.goto(STORE);
	await visitor.getByRole("link", { name: "Track order" }).click();
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/track$/);
	await visitor.getByLabel("Order code").fill(code.toLowerCase());
	await visitor.getByLabel("Email or phone number").fill("someone@else.com");
	await visitor.getByRole("button", { name: "Find my order" }).click();
	await expect(visitor.getByRole("alert")).toContainText("couldn't find");
	await visitor.getByLabel("Email or phone number").fill("ann@example.com");
	await visitor.getByRole("button", { name: "Find my order" }).click();
	await expect(
		visitor.getByRole("heading", { name: `Order ${code}` }),
	).toBeVisible();
	await expect(visitor.getByText("Paid with Bank transfer")).toBeVisible();
	await expect(visitor.locator("[aria-current='step']")).toContainText(
		"Shipped",
	);
	await expect(visitor.locator("[data-tracking]")).toHaveText("TH-E2E-1");
	await expect(visitor.getByText(`1 × ${P}`)).toBeVisible();
	await expect(visitor.locator("img[data-line-image]")).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/orders\//,
	);

	// the shop adds its own delivery status between Packing and Shipped, and the order moves to it
	await admin.goto("/orders");
	await admin.getByRole("button", { name: "Delivery status settings" }).click();
	const steps = admin.getByRole("dialog");
	await steps.getByRole("button", { name: "Add status" }).click();
	await steps.getByLabel("Status name").last().fill("Waiting for courier");
	await steps
		.getByRole("button", { name: "Color of Waiting for courier" })
		.click();
	await admin.getByRole("button", { name: "Pink", exact: true }).click();
	// drag it by its grip onto Shipped's row: it takes Shipped's place
	await steps
		.getByRole("button", { name: /^Move Waiting for courier:/ })
		.dragTo(steps.getByRole("button", { name: /^Move Shipped:/ }));
	await expect(steps.getByLabel("Status name").nth(2)).toHaveValue(
		"Waiting for courier",
	);
	// the arrow keys move a row too: Packing down one place, then back up
	await steps
		.getByRole("button", { name: /^Move Packing:/ })
		.press("ArrowDown");
	await expect(steps.getByLabel("Status name").nth(1)).toHaveValue(
		"Waiting for courier",
	);
	await steps.getByRole("button", { name: /^Move Packing:/ }).press("ArrowUp");
	await expect(steps.getByLabel("Status name").nth(2)).toHaveValue(
		"Waiting for courier",
	);
	// New, Shipped and Delivered have no remove button
	await expect(
		steps.getByRole("button", { name: "Remove Shipped" }),
	).toHaveCount(0);
	await steps.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Delivery statuses saved").last()).toBeVisible();
	// its tab sits in the shop's order under Any source and Online, not under POS
	const tabs = admin.getByRole("tab", {
		name: /^(Any stage|New|Packing|Waiting for courier|Shipped|Delivered)$/,
	});
	await expect(tabs).toHaveText([
		"Any stage",
		"New",
		"Packing",
		"Waiting for courier",
		"Shipped",
		"Delivered",
	]);
	await admin.getByRole("tab", { name: "POS" }).click();
	await expect(tabs).toHaveCount(0);
	await admin.getByRole("tab", { name: "Online" }).click();
	await admin.getByRole("tab", { name: "Waiting for courier" }).click();
	await expect(row).toHaveCount(0);
	await admin.goto(`/orders/${orderId}`);
	await admin.getByRole("combobox", { name: "Delivery status" }).click();
	await admin.getByRole("option", { name: "Waiting for courier" }).click();
	await admin.getByRole("button", { name: "Save delivery status" }).click();
	await expect(
		admin.getByRole("heading", { name: /^Order #/ }).locator(".."),
	).toContainText("Waiting for courier");
	await admin.goto("/orders");
	await admin.getByRole("tab", { name: "Waiting for courier" }).click();
	await expect(row).toContainText("Waiting for courier");
	await expect(row.getByText("Waiting for courier")).toHaveCSS(
		"color",
		"rgb(236, 72, 153)",
	);
	// the buyer sees it on their order's progress
	await visitor.goto(`${STORE}/track`);
	await visitor.getByLabel("Order code").fill(code);
	await visitor.getByLabel("Email or phone number").fill("ann@example.com");
	await visitor.getByRole("button", { name: "Find my order" }).click();
	await expect(visitor.locator("[aria-current='step']")).toContainText(
		"Waiting for courier",
	);
	// a status an order still sits on can't be removed
	await admin.getByRole("button", { name: "Delivery status settings" }).click();
	await steps
		.getByRole("button", { name: "Remove Waiting for courier" })
		.click();
	await steps.getByRole("button", { name: "Save" }).click();
	await expect(steps.getByRole("alert")).toContainText(
		'Some orders are still at "Waiting for courier"',
	);
	await steps.getByRole("button", { name: "Cancel" }).click();
	// back to Shipped, as the rest of this file expects
	await admin.goto(`/orders/${orderId}`);
	await admin.getByRole("combobox", { name: "Delivery status" }).click();
	await admin.getByRole("option", { name: "Shipped" }).click();
	await admin.getByRole("button", { name: "Save delivery status" }).click();
	await expect(
		admin.getByRole("heading", { name: /^Order #/ }).locator(".."),
	).toContainText("Shipped");
	// Reset to default brings the built-in list back
	await admin.goto("/orders");
	await admin.getByRole("button", { name: "Delivery status settings" }).click();
	await steps.getByRole("button", { name: "Reset to default" }).click();
	await expect(steps.getByLabel("Status name")).toHaveCount(4);
	await expect(
		steps.getByRole("button", { name: "Reset to default" }),
	).toBeDisabled();
	await steps.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Delivery statuses saved").last()).toBeVisible();
	await expect(tabs).toHaveText([
		"Any stage",
		"New",
		"Packing",
		"Shipped",
		"Delivered",
	]);

	// back to how the next spec files expect the shop: manual options off
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Cash on delivery payments").click();
	await admin.getByLabel("Bank transfer payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
});

test("custom request: the product asks the buyer for a note; it rides the cart, the checkout, the order and the staff page", async () => {
	const E = `Engraved Tumbler ${run}`;
	// admin: a product with the Custom request switch on and its own question
	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(E);
	await admin.getByLabel("Base price").fill("12.00");
	await admin.getByRole("switch", { name: "Custom request" }).click();
	await admin.getByLabel("Question to the buyer").fill("Name to engrave");
	await submitProduct(admin);
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Cash on delivery payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();

	// visitor: the product page asks the question; Add does nothing until it is answered
	await visitor.goto(`${STORE}?q=${encodeURIComponent(E)}`);
	await visitor.getByRole("link", { name: E, exact: true }).click();
	const box = visitor.getByLabel("Name to engrave");
	await expect(box).toHaveAttribute("maxlength", "1000");
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	expect(
		await box.evaluate((el: HTMLTextAreaElement) => el.validity.valid),
	).toBe(false);
	await box.fill("Anna & Ben\n2026");
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await expect(box).toHaveValue(""); // a fresh box for the next one
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(visitor.getByRole("dialog")).toContainText("Anna & Ben");
	await visitor.getByRole("button", { name: "Checkout" }).click();
	await expect(visitor.locator("[data-line-note]")).toContainText(
		"Your request: Anna & Ben",
	);
	await visitor.getByRole("radio", { name: /Cash on delivery/ }).check();
	await visitor.getByRole("button", { name: /^Place order/ }).click();
	await visitor.waitForURL(/\/done\?sid=cod_/);
	await expect(visitor.locator("[data-line-note]")).toContainText(
		"Your request: Anna & Ben",
	);
	const code = (await visitor.locator("[data-order-code]").innerText()).trim();

	// admin: the order line shows what the buyer wrote
	await admin.goto(`/orders?q=${code.toLowerCase()}`);
	await admin
		.getByRole("button", { name: /^Open order \d+$/ })
		.first()
		.click();
	await expect(admin.locator("[data-line-note]")).toContainText(
		"Note: Anna & Ben",
	);

	// back to how the next tests expect the shop: cash on delivery off, the tumbler off the store
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Cash on delivery payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
	await admin.goto(`/products?q=${encodeURIComponent(E)}`);
	await admin.getByRole("link", { name: "Edit" }).first().click();
	await admin.getByRole("switch", { name: "Active" }).click();
	await submitProduct(admin);
});

test("coupons: admin makes a code on /coupons; the buyer applies it at the checkout, pays less; the order and the list show it; one use per customer", async () => {
	// admin: bank transfer back on so the visitor can place an order without a gateway
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Bank transfer payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();

	// admin: a 10% code, one use per customer; a bad code is refused inline
	await admin.goto("/coupons");
	await expect(admin.getByText("No coupons yet")).toBeVisible();
	await admin.getByRole("button", { name: "Add coupon" }).first().click();
	const dlg = admin.getByRole("dialog");
	await dlg.getByLabel("Code", { exact: true }).fill("e2e 10");
	await dlg.getByLabel("Percentage", { exact: true }).fill("10");
	await dlg.getByRole("button", { name: "Add coupon" }).click();
	await expect(
		dlg.getByText("Letters, numbers, dashes and underscores only"),
	).toBeVisible();
	await dlg.getByLabel("Code", { exact: true }).fill("e2e10");
	await dlg.getByLabel("Description").fill("10% off for testers");
	await dlg.getByLabel("Uses per customer").fill("1");
	await dlg.getByRole("button", { name: "Add coupon" }).click();
	await expect(admin.getByText("Coupon added").last()).toBeVisible();
	const row = admin.getByRole("button", { name: "Edit E2E10" });
	await expect(row).toContainText("10% off");
	await expect(row).toContainText("1× per customer");
	await expect(row).toContainText("Active");
	// a second code (free delivery); the dialog's own close button is reachable (it used to be clipped by the scroll box)
	await admin.getByRole("button", { name: "Add coupon" }).first().click();
	await dlg.getByLabel("Code", { exact: true }).fill("e2eship");
	await dlg.getByRole("radio", { name: /Free delivery/ }).check();
	await dlg.getByRole("button", { name: "Add coupon" }).click();
	await expect(admin.getByText("Coupon added").last()).toBeVisible();
	await expect(
		admin.getByRole("button", { name: "Edit E2ESHIP" }),
	).toContainText("Free delivery");
	await admin.getByRole("button", { name: "Edit E2ESHIP" }).click();
	await expect(dlg.getByRole("button", { name: "Close" })).toBeInViewport();
	await dlg.getByRole("button", { name: "Close" }).click();
	await expect(dlg).toHaveCount(0);

	// visitor: the code box on the checkout — a wrong code says so, the right one takes 10% off the items
	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await visitor.getByRole("button", { name: "Checkout" }).click();
	await visitor.getByRole("radio", { name: /Bank transfer/ }).check();
	await expect(
		visitor.getByRole("button", { name: /^Place order/ }),
	).toContainText(amount("$6"));
	await visitor.getByLabel("Discount code", { exact: true }).fill("nope");
	await visitor.getByRole("button", { name: "Apply" }).click();
	await expect(visitor.getByText("That code isn't valid")).toBeVisible();
	await visitor.getByLabel("Discount code", { exact: true }).fill("e2e10");
	await visitor.getByRole("button", { name: "Apply" }).click();
	await expect(visitor.locator("[data-coupon-applied]")).toContainText("E2E10");
	await expect(visitor.locator("[data-coupon-applied]")).toContainText(
		"10% off for testers",
	);
	await expect(visitor.locator("[data-discount]")).toHaveText("−$0.40");
	await expect(
		visitor.getByRole("button", { name: /^Place order/ }),
	).toContainText("5.60"); // $4 − $0.40 + $2 delivery
	await visitor.getByRole("button", { name: /^Place order/ }).click();
	await visitor.waitForURL(
		/main-shop\.localhost:\d+\/done\?sid=bank_transfer_/,
	);
	await expect(
		visitor.getByRole("heading", { name: "Order received!" }),
	).toBeVisible();
	await expect(visitor.locator("[data-coupon-code]")).toHaveText("E2E10");
	await expect(visitor.getByText("$5.60")).toBeVisible();
	const code = (await visitor.locator("[data-order-code]").innerText()).trim();

	// visitor: the same buyer can't use it twice (per-customer limit, counted by the checkout email)
	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.goto(`${STORE}/checkout`);
	await visitor.getByLabel("Discount code", { exact: true }).fill("E2E10");
	await visitor.getByRole("button", { name: "Apply" }).click();
	await expect(visitor.getByText("That code isn't valid")).toBeVisible();

	// admin: the order carries the code, the list counts the use (and the money it took off), then the code is deleted
	await admin.goto(`/orders?q=${code.toLowerCase()}`);
	await admin
		.getByRole("button", { name: /^Open order \d+$/ })
		.first()
		.click();
	await expect(admin.locator("[data-coupon-code]")).toHaveText("E2E10");
	await expect(admin.getByText("$5.60").first()).toBeVisible();
	await admin.goto("/coupons");
	await expect(row).toContainText("−$0.40");
	const stats = admin.locator("[data-coupon-stats]"); // totals over every code of the shop
	await expect(stats).toContainText("Times used1");
	await expect(stats).toContainText("Total discount given$0.40");
	await expect(stats).toContainText("Average discount$0.40");
	await admin.getByRole("button", { name: "History of E2E10" }).click();
	await admin.waitForURL(/\/coupons\/\d+$/);
	await expect(admin.locator("[data-used-count]")).toHaveText("1"); // no total limit on this code
	await expect(admin.locator("[data-saved-total]")).toHaveText("$0.40");
	const hist = admin.getByRole("button", { name: /^Open order \d+$/ });
	await expect(hist).toHaveCount(1);
	await expect(hist).toContainText(code);
	await expect(hist).toContainText("ann@example.com");
	await expect(hist).toContainText("−$0.40");
	await hist.click();
	await admin.waitForURL(/\/orders\/\d+$/);
	await expect(admin.locator("[data-coupon-code]")).toHaveText("E2E10");
	await admin.goto("/coupons");
	await row.click();
	await expect(
		admin.getByRole("dialog").getByLabel("Code", { exact: true }),
	).toHaveValue("E2E10");
	await admin
		.getByRole("dialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await admin
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await expect(admin.getByText("Deleted E2E10").last()).toBeVisible();
	await admin.getByRole("button", { name: "Edit E2ESHIP" }).click();
	await admin
		.getByRole("dialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await admin
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await expect(admin.getByText("Deleted E2ESHIP").last()).toBeVisible();
	await expect(admin.getByText("No coupons yet")).toBeVisible();

	// back to how the next spec files expect the shop: manual options off
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Bank transfer payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
});

test("guided address: with Thailand's postal codes downloaded, the checkout offers State → City and fills the postal code in", async () => {
	test.setTimeout(120_000); // a long flow: the download + import, the admin's zone dialog, the visitor's address, the switch
	// admin: the shop moves to Thailand and downloads its postal codes — the real GeoNames file (14 KB), served from e2e/fixtures/geonames by playwright.config.ts
	await admin.goto("/online-store?section=delivery");
	await admin.getByRole("combobox", { name: "Country" }).click();
	await admin.getByPlaceholder("Search country…").fill("thailand");
	await admin.getByRole("option", { name: /Thailand/ }).click();
	await admin.getByRole("button", { name: "Save delivery" }).click();
	await expect(admin.getByText("Delivery settings saved").last()).toBeVisible();
	await admin.goto("/postal-codes");
	await admin.getByRole("button", { name: "Add cities" }).click();
	await expect(
		admin.getByRole("combobox", { name: "Cities for" }),
	).toContainText("Thailand"); // the page follows the shop's country
	await admin.getByRole("button", { name: "Download", exact: true }).click();
	let status: any = null;
	for (let i = 0; i < 90; i++) {
		status = await (await admin.request.get("/postal-codes/status")).json();
		if (status.status === "ready" || status.status === "failed") break;
		await admin.waitForTimeout(1000);
	}
	expect(
		status,
		`GeoNames download did not finish: ${status?.error ?? status?.status}`,
	).toMatchObject({ status: "ready" });
	await expect(admin.locator("[data-postal-status]")).toContainText(
		/Last download: Thailand · \d+ places/,
	);
	await expect(admin.getByRole("row", { name: /Thailand/ })).toContainText(
		"TH",
	);
	await expect(
		admin.getByRole("button", { name: "Re-download Thailand" }),
	).toBeEnabled();
	// a zone's Cities picker lists the downloaded cities of the zone's countries as the admin types; a pick shows as a badge
	await admin.goto("/online-store?section=delivery");
	await admin.getByRole("button", { name: "Add zone" }).click();
	const dialog = admin.getByRole("dialog");
	await dialog.getByRole("combobox", { name: "Countries" }).click();
	await admin.getByPlaceholder("Search country…").fill("thailand");
	await admin.getByRole("option", { name: "Thailand", exact: true }).click();
	await admin.keyboard.press("Escape");
	await dialog.getByRole("combobox", { name: "States / provinces" }).click(); // a whole province at one price
	await admin.getByPlaceholder("Search state…").fill("nontha");
	await admin.getByRole("option", { name: "Nonthaburi" }).click();
	await admin.keyboard.press("Escape");
	await expect(
		dialog.getByRole("combobox", { name: "States / provinces" }),
	).toContainText("Nonthaburi");
	await dialog.getByRole("combobox", { name: "Cities" }).click();
	await admin.getByPlaceholder("Search city…").fill("nontha");
	await admin.getByRole("option", { name: "Muang Nonthaburi" }).click();
	await admin.keyboard.press("Escape");
	await expect(dialog.getByRole("combobox", { name: "Cities" })).toContainText(
		"Muang Nonthaburi",
	);
	await dialog.getByRole("button", { name: "Cancel" }).click(); // not kept

	// visitor: state first, then the city — the postal code follows (a product of this test's own, so it can run alone)
	const G = `Guided ${run}`;
	expect(
		await postProduct({
			name: G,
			description: "",
			price: 400,
			purchase_price: null,
			images: [],
			sku: null,
			barcode: null,
			unit: null,
			track_stock: false,
			stock: 0,
			low_stock_at: 0,
			featured: false,
			active: true,
			original_price: null,
			kind: "item",
			bundle_items: [],
			category_ids: [],
			variants: [],
		}),
	).toBeTruthy();
	await visitor.goto(`${STORE}?q=${encodeURIComponent(G)}`);
	await visitor.getByRole("link", { name: G, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.goto(`${STORE}/checkout`);
	// the remembered address is in the United States (no list for it → text boxes); moving to Thailand switches to the lists
	await expect(visitor.getByRole("textbox", { name: "City" })).toBeVisible();
	await visitor.getByLabel("Country").click();
	await visitor.getByPlaceholder("Search country…").fill("thailand");
	await visitor.getByRole("option", { name: /Thailand/ }).click();
	await expect(visitor.getByLabel("City")).toBeDisabled(); // a list now, and no state yet (the remembered "IL" isn't one of Thailand's)
	await visitor.getByLabel("State / Province").click();
	await visitor.getByPlaceholder("Search state…").fill("nontha");
	await visitor.getByRole("option", { name: "Nonthaburi" }).click();
	await visitor.getByLabel("City").click();
	await visitor.getByPlaceholder("Search city…").fill("muang");
	await visitor.getByRole("option", { name: "Muang Nonthaburi" }).click();
	await expect(visitor.getByLabel("Postal code")).toHaveValue("11000");
	await expect(visitor.getByLabel("Postal code")).toHaveAttribute(
		"readonly",
		"",
	); // the list decides it
	await expect(visitor.getByLabel("City")).toContainText("Muang Nonthaburi");
	// another city → its own code
	await visitor.getByLabel("City").click();
	await visitor.getByPlaceholder("Search city…").fill("pak kret");
	await visitor.getByRole("option", { name: "Pak Kret" }).click();
	await expect(visitor.getByLabel("Postal code")).toHaveValue("11120");

	// admin: "Address lists" off → plain text boxes even in Thailand, whose list is there (for countries whose records are poor); on again → the lists
	const toThailand = async () => {
		await visitor.reload(); // the remembered address (saved on Pay only) is still the US one
		await visitor.getByLabel("Country").click();
		await visitor.getByPlaceholder("Search country…").fill("thailand");
		await visitor.getByRole("option", { name: /Thailand/ }).click();
	};
	await admin.getByLabel("Address lists at the checkout").click();
	await admin.getByRole("button", { name: "Save delivery" }).click();
	await expect(admin.getByText("Delivery settings saved").last()).toBeVisible();
	await toThailand();
	await expect(visitor.getByRole("textbox", { name: "City" })).toBeVisible();
	await expect(
		visitor.getByRole("textbox", { name: "State / Province" }),
	).toBeVisible();
	await admin.getByLabel("Address lists at the checkout").click();
	await admin.getByRole("button", { name: "Save delivery" }).click();
	await expect(admin.getByText("Delivery settings saved").last()).toBeVisible();
	await toThailand();
	await expect(visitor.getByLabel("City")).toBeDisabled(); // a list again, waiting for a state

	// admin: Remove takes the country off the list — the checkout is back to plain text boxes, with the postal code optional
	await admin.goto("/postal-codes");
	await admin.getByRole("button", { name: "Remove Thailand" }).click();
	await expect(admin.locator("[data-postal-status]")).toHaveText(
		"No countries downloaded yet.",
	);
	await visitor.reload();
	await expect(visitor.getByRole("textbox", { name: "City" })).toBeVisible();
	await expect(visitor.getByLabel("Postal code")).toBeEditable(); // the remembered code stays, but it's a plain box again
});

// The browser side of Firebase is its CDN SDK; the visitor's page answers those script requests with this stand-in
// (the `firebase` compat global the storefront talks to). The token it hands out is the one e2e/fixtures/serve.ts accepts.
const FAKE_FIREBASE = `
window.firebase = window.firebase || (() => {
  const user = { emailVerified: true, getIdToken: async () => "e2e-token-0123456789abcdef", sendEmailVerification: async () => {} };
  const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
  const auth = {
    currentUser: null,
    signInWithPopup: async () => ({ user }),
    signInWithEmailAndPassword: async (email, password) => (password === "secret123" ? { user } : fail("auth/wrong-password")),
    createUserWithEmailAndPassword: async () => ({ user: { ...user, emailVerified: false } }),
    sendPasswordResetEmail: async () => {},
    signOut: async () => {},
  };
  const fb = { apps: [], initializeApp(c) { fb.apps.push(c); }, auth: Object.assign(() => auth, { GoogleAuthProvider: function () {}, OAuthProvider: function () {} }) };
  return fb;
})();`;

test("customer accounts: admin switches sign-in on with the Firebase config; the buyer signs in, sees the earlier order, keeps name + address, and the checkout is prefilled", async () => {
	test.slow(); // the longest flow in the suite: admin setup, sign-in, the account's three tabs, an address dialog, then a checkout
	// admin: a provider on needs the whole Firebase web config
	await admin.goto("/online-store?section=accounts");
	await admin.getByLabel("Sign in with Email & password").click();
	await admin.getByLabel("Sign in with Google").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Web API key is required")).toBeVisible();
	await admin.getByLabel("Web API key").fill("AIzaE2eKey");
	await admin.getByLabel("Auth domain").fill("main-shop.firebaseapp.com");
	await admin.getByLabel("Project ID").fill("main-shop");
	await admin.getByLabel("App ID").fill("1:1:web:e2e");
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
	await admin.reload();
	await expect(admin.getByLabel("Sign in with Email & password")).toBeChecked();
	await expect(admin.getByLabel("Sign in with Microsoft")).not.toBeChecked();
	await expect(admin.getByLabel("Project ID")).toHaveValue("main-shop");

	// visitor: the header offers Sign in; the dialog lists what the shop switched on; a wrong password is a plain message
	await visitor.route("https://www.gstatic.com/firebasejs/**", (route) =>
		route.fulfill({
			contentType: "application/javascript",
			body: FAKE_FIREBASE,
		}),
	);
	await visitor.goto(STORE);
	await visitor.getByRole("button", { name: "Sign in" }).click();
	const dialog = visitor.getByRole("dialog", { name: "Sign in" });
	await expect(
		dialog.getByRole("button", { name: "Continue with Google" }),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Continue with Microsoft" }),
	).toHaveCount(0);
	await dialog.getByLabel("Email").fill("ann@example.com");
	await dialog.getByLabel("Password", { exact: true }).fill("wrong");
	await dialog.getByRole("button", { name: "Sign in" }).click();
	await expect(dialog.getByRole("alert")).toContainText(
		"Wrong email or password",
	);
	await dialog.getByLabel("Password", { exact: true }).fill("secret123");
	await dialog.getByRole("button", { name: "Sign in" }).click();
	await expect(
		visitor.getByRole("link", { name: "My account" }).first(),
	).toContainText("Ann"); // the header knows them now

	// the account: the bank-transfer order placed earlier as a guest with this (verified) email is theirs
	await visitor.getByRole("link", { name: "My account" }).first().click();
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/account$/);
	await expect(visitor.getByText("Signed in as ann@example.com")).toBeVisible();
	// newest first — the bank-transfer one (shipped, tracked) sits below the coupon orders placed since
	const orderLink = visitor
		.getByRole("link", { name: /^Order [A-Z2-9-]+$/ })
		.filter({ hasText: "Shipped" });
	await expect(orderLink).toHaveCount(1);
	await expect(orderLink.locator("img[data-line-image]")).toHaveCount(0); // pictures only on the order page, not the list
	await orderLink.click();
	await expect(visitor).toHaveURL(
		/main-shop\.localhost:\d+\/account\/orders\/[A-Z2-9-]+$/,
	);
	await expect(visitor.locator("[aria-current='step']")).toContainText(
		"Shipped",
	);
	await expect(visitor.locator("[data-tracking]")).toHaveText("TH-E2E-1");
	await visitor.getByRole("link", { name: "My account" }).first().click();

	// name / phone and the delivery address are theirs to change (one tab each, plain form posts); the page remembers them
	await visitor.getByRole("link", { name: "Your details" }).click();
	await visitor.getByLabel("Name", { exact: true }).fill("Ann Lee");
	await visitor.getByLabel("Phone number").fill("555-0100");
	await visitor.getByRole("button", { name: "Save details" }).click();
	await expect(visitor).toHaveURL(/\/account\?tab=details&saved=1$/); // posted, back on the tab
	await expect(
		visitor.getByRole("status").filter({ hasText: "Saved" }),
	).toBeVisible();
	await expect(visitor.getByLabel("Name", { exact: true })).toHaveValue(
		"Ann Lee",
	);
	// addresses: several per account, each with a label + phone, added in its own form
	await openAddresses(visitor);
	const addr = await addAddressForm(visitor);
	await addr.getByLabel("Label").fill("Home");
	await addr.getByLabel("Phone number").fill("555-0100");
	await addr.getByLabel("Address line 1").fill("42 Account Ave");
	await addr.getByLabel("City").fill("Springfield");
	await addr.getByLabel("State / Province").fill("IL");
	await addr.getByLabel("Postal code").fill("62701");
	await addr.getByRole("button", { name: "Save address" }).click();
	await expect(visitor).toHaveURL(/\/account\?tab=address$/);
	await expect(
		visitor.getByRole("list", { name: "Saved addresses" }),
	).toContainText("42 Account Ave");
	await visitor.reload();
	await visitor.getByRole("link", { name: "Your details" }).click();
	await expect(visitor.getByLabel("Name", { exact: true })).toHaveValue(
		"Ann Lee",
	);
	await openAddresses(visitor);
	await expect(
		visitor.getByRole("list", { name: "Saved addresses" }),
	).toContainText("Home · 555-0100");

	// the checkout is prefilled from the account (beating what this device remembered) and says so
	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await visitor.getByRole("button", { name: "Checkout" }).click();
	await expect(visitor.getByLabel("Name", { exact: true })).toHaveValue(
		"Ann Lee",
	);
	await expect(visitor.getByLabel("Address line 1")).toHaveValue(
		"42 Account Ave",
	); // the first saved address, already picked
	await expect(
		visitor
			.getByRole("group", { name: "Saved addresses" })
			.getByRole("button", { name: /Home/ }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(visitor.getByText("Signed in as ann@example.com")).toBeVisible();
	// signed in: the email is the account's and can't be changed (the server uses the account's email too)
	await expect(visitor.getByRole("textbox", { name: "Email" })).toHaveValue(
		"ann@example.com",
	);
	await expect(visitor.getByRole("textbox", { name: "Email" })).toHaveAttribute(
		"readonly",
		"",
	);
	// signed in: the "save for next order" box (on) replaces the guest's "remembered on this device" note
	await expect(
		visitor.getByRole("checkbox", { name: "Save address for next order" }),
	).toBeChecked();
	await expect(visitor.getByText("Remembered on this device")).toHaveCount(0);

	// a second address on the account; Edit and Remove reach only the row they name
	await visitor.goto(`${STORE}/account`);
	await expect(
		visitor.getByRole("textbox", { name: "Search products" }),
	).toHaveCount(0); // the account page has no product search
	await openAddresses(visitor);
	const addr2 = await addAddressForm(visitor);
	await addr2.getByLabel("Label").fill("Office");
	await addr2.getByLabel("Phone number").fill("555-0200");
	await addr2.getByLabel("Address line 1").fill("7 Office Park");
	await addr2.getByLabel("City").fill("Springfield");
	await addr2.getByLabel("State / Province").fill("IL");
	await addr2.getByLabel("Postal code").fill("62702");
	await addr2.getByRole("button", { name: "Save address" }).click();
	await expect(visitor).toHaveURL(/\/account\?tab=address$/);
	const list = visitor.getByRole("list", { name: "Saved addresses" });
	await expect(list.getByRole("listitem")).toHaveCount(2);
	// each saved address has its own form behind its Edit disclosure
	await visitor.getByLabel("Edit Office").click();
	const editForm = visitor
		.locator("details")
		.filter({ has: visitor.getByLabel("Edit Office") });
	await expect(editForm.getByLabel("Address line 1")).toHaveValue(
		"7 Office Park",
	); // the row's values, not a blank form
	await editForm.getByLabel("Label").fill("Work");
	await editForm.getByRole("button", { name: "Save address" }).click();
	await expect(visitor).toHaveURL(/\/account\?tab=address$/);
	await expect(list).toContainText("Work · 555-0200");
	await expect(list).not.toContainText("Office ·"); // the label changed; the street "7 Office Park" stays

	// admin: bank transfer on again so the buyer can place an order without a gateway (off again at the end)
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Bank transfer payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();

	// the checkout: one tap on the other saved address swaps the boxes and the phone; a typed address is kept on the account after
	// the order (the box is on), and nothing about a signed-in customer lands in the device's localStorage
	const remembered = await visitor.evaluate(
		() => localStorage.getItem("store-customer:main-shop") ?? "",
	);
	await visitor.goto(`${STORE}/checkout`);
	const savedGroup = visitor.getByRole("group", { name: "Saved addresses" });
	await savedGroup.getByRole("button", { name: /Work/ }).click();
	await expect(visitor.getByLabel("Address line 1")).toHaveValue(
		"7 Office Park",
	);
	await expect(visitor.getByLabel("Phone number")).toHaveValue("555-0200");
	await expect(
		savedGroup.getByRole("button", { name: /Work/ }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		savedGroup.getByRole("button", { name: /Home/ }),
	).toHaveAttribute("aria-pressed", "false");
	await visitor.getByLabel("Address line 1").fill("99 Third Way"); // typed over → no saved address is picked any more
	await expect(
		savedGroup.getByRole("button", { name: /Work/ }),
	).toHaveAttribute("aria-pressed", "false");
	await visitor.getByRole("radio", { name: /Bank transfer/ }).check();
	await visitor.getByRole("button", { name: /^Place order/ }).click();
	await visitor.waitForURL(
		/main-shop\.localhost:\d+\/done\?sid=bank_transfer_/,
	);
	await expect(
		visitor.getByRole("heading", { name: "Order received!" }),
	).toBeVisible();
	expect(
		await visitor.evaluate(
			() => localStorage.getItem("store-customer:main-shop") ?? "",
		),
	).toBe(remembered); // untouched while signed in
	expect(remembered).not.toContain("99 Third Way");
	await visitor.goto(`${STORE}/account`);
	await openAddresses(visitor);
	await expect(list.getByRole("listitem")).toHaveCount(3);
	await expect(list).toContainText("99 Third Way");
	await visitor.getByRole("button", { name: "Remove Work" }).click();
	await expect(list.getByRole("listitem")).toHaveCount(2);
	await expect(list).not.toContainText("Work ·");
	await visitor.getByRole("link", { name: "Orders", exact: true }).click();
	await expect(
		visitor.getByRole("link", { name: /^Order [A-Z2-9-]+$/ }).first(),
	).toContainText("Unpaid"); // the bank-transfer one just placed, newest first

	// sign out: the header offers Sign in again
	await visitor.goto(`${STORE}/account`);
	await visitor.getByRole("button", { name: "Sign out" }).click();
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/$/);
	await expect(visitor.getByRole("button", { name: "Sign in" })).toBeVisible();
	await visitor.unroute("https://www.gstatic.com/firebasejs/**");

	// back to how the next spec files expect the shop: manual options off
	await admin.goto("/online-store?section=payments");
	await admin.getByLabel("Bank transfer payments").click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
});

test("customer accounts: a guest's account page asks to sign in; creating an email account needs the password twice, then the inbox; forgot password sends the link", async () => {
	await visitor.route("https://www.gstatic.com/firebasejs/**", (route) =>
		route.fulfill({
			contentType: "application/javascript",
			body: FAKE_FIREBASE,
		}),
	);
	await visitor.goto(`${STORE}/account`);
	await expect(visitor.getByText("Sign in to see your orders")).toBeVisible();
	await expect(visitor.getByRole("link", { name: "Your details" })).toHaveCount(
		0,
	); // nothing of an account for a guest (no tabs)
	await visitor
		.getByRole("main")
		.getByRole("button", { name: "Sign in" })
		.click(); // the prompt's own button opens the dialog
	const dialog = visitor.getByRole("dialog"); // its name follows the mode (Sign in → Create an account → Reset your password)

	// create an account: the password twice; a mismatch is refused in the page; a match ends at "check your inbox" (Firebase's link)
	await dialog.getByRole("button", { name: "Create an account" }).click();
	await dialog.getByLabel("Email").fill("new@example.com");
	await dialog.getByLabel("Password", { exact: true }).fill("secret123");
	await expect(
		dialog.getByRole("button", { name: "Create account" }),
	).toBeDisabled(); // the second box is still empty
	await dialog.getByLabel("Confirm password").fill("secret124");
	await dialog.getByRole("button", { name: "Create account" }).click();
	await expect(dialog.getByRole("alert")).toContainText(
		"The passwords don't match",
	);
	await dialog.getByLabel("Confirm password").fill("secret123");
	await dialog.getByRole("button", { name: "Create account" }).click();
	await expect(dialog.getByRole("status")).toContainText("Check your inbox");
	await expect(dialog.getByRole("button", { name: "Sign in" })).toBeVisible(); // back on the sign-in form for after the link

	// forgot password: the reset link goes out and the form returns to sign-in
	await dialog.getByRole("button", { name: "Forgot password?" }).click();
	await dialog.getByLabel("Email").fill("ann@example.com");
	await expect(dialog.getByLabel("Password", { exact: true })).toBeHidden(); // no password to reset one
	await dialog.getByRole("button", { name: "Send reset link" }).click();
	await expect(dialog.getByRole("status")).toContainText(
		"Check your inbox for the reset link",
	);
	await expect(dialog.getByRole("button", { name: "Sign in" })).toBeVisible();
	await visitor.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await visitor.unroute("https://www.gstatic.com/firebasejs/**");
});

test("themes: an extension brings its own storefront look — its own pages, its own words, its own hero", async () => {
	await enableGlobally(admin, "Aurora theme");
	await admin.goto("/extensions");
	await expect(extRow("Aurora theme").getByText("Ready")).toBeVisible(); // nothing it must have
	await extRow("Aurora theme").getByLabel("Aurora theme enabled").click();
	await expect(admin.getByText("Aurora theme enabled").last()).toBeVisible();

	// the theme joins the built-in templates in the picker, with its own name and description
	await admin.goto("/online-store?section=template");
	const aurora = admin.getByRole("button", { name: /^Aurora/ });
	await expect(aurora).toContainText("Photo cards, one accent colour");
	await aurora.click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();

	// the catalog is drawn by the theme's own template and painted by its own stylesheet
	await visitor.goto(STORE);
	await expect(visitor.locator(".aurora-shell")).toBeVisible();
	await expect(visitor.locator("html")).not.toHaveClass(/dark/); // the manifest pins `light`
	expect(
		await visitor
			.locator(".aurora-shell")
			.evaluate((e) => getComputedStyle(e as Element).backgroundColor),
	).toBe("rgb(246, 247, 251)");
	// its own face, served from the extension itself
	expect(
		await visitor
			.locator(".aurora-brand")
			.evaluate((e) => getComputedStyle(e as Element).fontFamily),
	).toContain("Aurora Display");
	// its dictionary rewords the app's own text — even in a shared component (the header cart button)
	await expect(visitor.getByRole("button", { name: "Open bag" })).toBeVisible();
	// its search box is a plain GET form, like a built-in theme's: Enter puts the query in the URL
	await visitor.locator(".aurora-search").fill(P);
	await visitor.locator(".aurora-search").press("Enter");
	await expect(visitor).toHaveURL(/[?&]q=/);
	await expect(visitor.locator(".aurora-card").first()).toContainText(P);

	// the theme draws the product page itself (views/product.edge), inside its own header and footer
	await visitor.locator(".aurora-card").first().click(); // the theme's own product sheet
	await expect(
		visitor.getByRole("dialog").locator(".aurora-surface"),
	).toBeVisible();
	await visitor.getByRole("link", { name: "Product page" }).click();
	await expect(visitor.locator(".aurora-detail-name")).toHaveText(P);
	await expect(visitor.locator(".aurora-bar")).toBeVisible();
	await expect(visitor.getByRole("button", { name: "Open bag" })).toBeVisible();
	// and the track page
	await visitor.goto(`${STORE}/track`);
	await expect(visitor.locator(".aurora-form")).toBeVisible();

	// out of the box the hero is the theme's own — its words, its picture — with the shop's featured
	// products in a "picked for you" rail beside it
	await visitor.goto(STORE);
	await expect(visitor.locator(".aurora-hero-title")).toHaveText(
		"Everything for a good morning",
	);
	await expect(visitor.locator(".aurora-hero-photo")).toHaveAttribute(
		"src",
		"/store/main-shop/ext/aurora/assets/hero.svg",
	);
	await expect(
		visitor.locator(".aurora-rail .aurora-card").first(),
	).toBeVisible();

	// and the shop makes it its own on /extensions — a colour swatch and its own hero words, no HTML
	await admin.goto("/extensions");
	await extRow("Aurora theme")
		.getByRole("button", { name: "Configure Aurora theme" })
		.click();
	const dlg = admin.getByRole("dialog");
	await dlg.getByLabel("Main colour").first().fill("#e07a20");
	await dlg.getByLabel("Hero headline").fill("Fresh every morning");
	await dlg.getByLabel("Hero button").fill("Browse the shop");
	await dlg.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Extension saved").last()).toBeVisible();
	await visitor.goto(STORE);
	await expect(visitor.locator(".aurora-hero-title")).toHaveText(
		"Fresh every morning",
	);
	await expect(visitor.locator(".aurora-hero .aurora-add")).toHaveText(
		"Browse the shop",
	);
	// the colour reaches the theme's own buttons
	expect(
		await visitor
			.locator(".aurora-hero .aurora-add")
			.evaluate((e) => getComputedStyle(e as Element).backgroundColor),
	).toBe("rgb(255, 255, 255)"); // the hero button stays white on the picture
	expect(
		await visitor
			.locator(".aurora-chip.is-on")
			.evaluate((e) => getComputedStyle(e as Element).backgroundColor),
	).toBe("rgb(224, 122, 32)"); // …while the category chip takes the shop's colour

	// switched off, the storefront falls back to a built-in template
	await admin.goto("/extensions");
	await extRow("Aurora theme").getByLabel("Aurora theme enabled").click();
	await expect(admin.getByText("Aurora theme disabled")).toBeVisible();
	await visitor.goto(STORE);
	await expect(visitor.locator(".aurora-shell")).toHaveCount(0);
});
