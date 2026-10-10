import { expect, test, type Page } from "@playwright/test";
import { amount, addProductImage, login, submitProduct } from "./helpers";
import { storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("l-store");

// Online store: admin enables the public storefront and picks a template; a logged-out visitor
// browses the store at <slug>.localhost, fills the cart (persisted across reloads) and hits the no-gateway guard.
// The real Stripe redirect/return is deliberately not e2e-tested (no network); that path is covered
// by app/services/StoreService.test.ts with a stubbed Stripe client.
test.describe.configure({ mode: "serial" });

let classicBorder = ""; // captured on the default template, compared after switching to Sunday

const run = Date.now().toString(36);
const P = `Web Mug ${run}`;

/** The "Delivery" line of the checkout's order summary (label + amount in one row). */
const deliveryRow = (p: Page) =>
	p.locator("aside div").filter({ hasText: /^Delivery/ });

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

test("admin: create a product and switch the online store on", async () => {
	// delivery (/online-store › Delivery): Main Shop sits in the United States; the default "Everywhere" zone becomes a US-only zone at $2 — no other zone yet
	await admin.goto("/online-store?section=delivery");
	await admin.getByRole("combobox", { name: "Country" }).click();
	await admin.getByPlaceholder("Search country…").fill("united sta");
	await admin
		.getByRole("option", { name: /United States/ })
		.first()
		.click();
	await admin.getByRole("button", { name: "Save delivery" }).click();
	await expect(admin.getByText("Delivery settings saved")).toBeVisible();
	await admin.getByRole("button", { name: "Edit zone 1" }).click(); // the table's one row → the dialog
	const dialog = admin.getByRole("dialog");
	await dialog.getByLabel("Zone name").fill("Domestic");
	await dialog.getByRole("combobox", { name: "Countries" }).click();
	await admin.getByPlaceholder("Search country…").fill("united states");
	await admin
		.getByRole("option", { name: "United States", exact: true })
		.click();
	await admin.keyboard.press("Escape");
	await expect(
		dialog.getByRole("combobox", { name: "Countries" }),
	).toContainText("United States");
	await dialog.getByLabel("Delivery price").fill("2.00");
	await dialog.getByRole("button", { name: "Save zone" }).click();
	await expect(admin.getByText("Zone saved")).toBeVisible();
	await expect(admin.getByRole("row", { name: /Domestic/ })).toContainText(
		"United States",
	);
	await expect(admin.getByRole("row", { name: /Domestic/ })).toContainText(
		amount("$2"),
	);
	// the GeoNames cities have their own page (Settings › Addresses) under Settings, offering the active shop's country first (downloaded for real at the end of this file)
	await admin.goto("/postal-codes");
	await expect(admin.locator("[data-postal-status]")).toHaveText(
		"No countries downloaded yet.",
	);
	await admin.getByRole("button", { name: "Add cities" }).click();
	await expect(
		admin.getByRole("combobox", { name: "Cities for" }),
	).toContainText("United States");
	await expect(
		admin.getByRole("button", { name: "Download", exact: true }),
	).toBeEnabled();
	await expect(
		admin.getByRole("button", { name: /All countries/ }),
	).toBeEnabled();
	// tax: 7% VAT already inside the prices — a line on the checkout / thank-you page / order, totals unchanged
	await admin.goto("/shops");
	await admin.getByRole("link", { name: "Edit Main Shop" }).click();
	const shopDlg = admin.locator("form"); // the edit page
	await shopDlg.getByLabel("Tax rate", { exact: true }).fill("7");
	await shopDlg.getByLabel("Tax label", { exact: true }).fill("VAT");
	await shopDlg.getByLabel("Prices include tax").click();
	await shopDlg.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Shop updated")).toBeVisible();

	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(P);
	await admin.getByLabel("Base price").fill("4.00");
	await admin.getByLabel("Original price").fill("5.00"); // "was" price → 20% off in the storefront
	await admin.getByRole("textbox", { name: "Description" }).click();
	await admin.getByRole("button", { name: "Bullet list" }).click();
	await admin.keyboard.type("hand roasted");
	await admin.getByRole("button", { name: "Insert table" }).click();
	await admin.keyboard.type("Origin");
	await addProductImage(admin); // order lines keep a copy of it (checked on /done, track and the account)
	await submitProduct(admin);

	await admin.goto("/online-store");
	// seeded slug is there already; a bad one is refused
	await expect(admin.getByLabel("Store URL")).toHaveValue("main-shop");
	await admin.getByLabel("Store URL").fill("ab");
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("At least 3 characters")).toBeVisible();
	// every slug is a subdomain, so a name like a mail server's is kept for the system
	await admin.getByLabel("Store URL").fill("mail");
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("This name is kept for the system. Pick another one."),
	).toBeVisible();
	await admin.getByLabel("Store URL").fill("main-shop");
	// custom domain: junk is refused, a pasted URL is trimmed to the bare hostname
	await admin.getByLabel("Custom domain (optional)").fill("not a domain");
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Enter a domain like shop.example.com"),
	).toBeVisible();
	await admin
		.getByLabel("Custom domain (optional)")
		.fill("https://www.main-shop.test/");
	// Google Search Console: the pasted HTML tag is kept as its content (junk is refused — unit-tested)
	await admin
		.getByLabel("Verification (optional)")
		.fill('<meta name="google-site-verification" content="e2e_Token-1234" />');
	// analytics ids: the GA4 id is upper-cased on save; both loaders show up in the store's raw HTML (checked below)
	await admin.getByLabel("Google Analytics").fill("g-e2e12345");
	await admin.getByLabel("Meta Pixel").fill("123456789012345");
	// new-order alerts: a Telegram chat without a bot token is refused
	await admin.getByRole("button", { name: "Alerts", exact: true }).click();
	await admin.getByLabel("Telegram chat ID").fill("42");
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Bot token is required")).toBeVisible();
	await admin.getByLabel("Telegram chat ID").fill("");
	await admin.getByLabel("Alert email").fill("owner@e2e.test");
	await admin.getByRole("button", { name: "General", exact: true }).click();
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Online store settings saved")).toBeVisible();
	// the saved domain waits for its DNS: the records to add point at DOMAIN_CNAME (localhost here) and its IPv4
	const setup = admin.getByTestId("domain-setup");
	await expect(setup.getByText("Waiting for DNS")).toBeVisible();
	await expect(setup.getByRole("cell", { name: "CNAME" })).toBeVisible();
	await expect(
		setup.getByRole("button", { name: "Copy localhost" }),
	).toBeVisible();
	await expect(
		setup.getByRole("button", { name: "Copy 127.0.0.1" }),
	).toBeVisible();
	// the TXT record that proves the domain is this shop's
	await expect(
		setup.getByRole("cell", { name: "TXT", exact: true }),
	).toBeVisible();
	await expect(setup.getByText(/^sellrika-verify=/)).toBeVisible();
	await expect(admin.getByTestId("domain-found")).toHaveText(
		"Your domain does not point anywhere yet.",
	);
	await setup.getByRole("button", { name: "Check now" }).click();
	await expect(
		admin.getByText("The DNS does not point here yet"),
	).toBeVisible();
	// the sitemap link to submit in Search Console follows the (normalised) custom domain, else this host
	await expect(
		admin.getByRole("link", { name: "https://main-shop.test/sitemap.xml" }),
	).toBeVisible();
	await admin.getByLabel("Custom domain (optional)").fill("");
	await expect(
		admin.getByRole("link", { name: /\/sitemap\.xml$/ }),
	).toHaveAttribute(
		"href",
		/^http:\/\/main-shop\.localhost:\d+\/sitemap\.xml$/,
	);
	await admin.reload();
	await expect(admin.getByLabel("Custom domain (optional)")).toHaveValue(
		"main-shop.test",
	);
	await expect(admin.getByLabel("Verification (optional)")).toHaveValue(
		"e2e_Token-1234",
	);
	await expect(admin.getByLabel("Google Analytics")).toHaveValue("G-E2E12345");
	await admin.getByRole("button", { name: "Alerts", exact: true }).click();
	await expect(admin.getByLabel("Alert email")).toHaveValue("owner@e2e.test");

	// build a "Terms of Use" page in the visual editor (slug follows the title)
	await admin.getByRole("button", { name: "Pages", exact: true }).click();
	await admin.getByRole("link", { name: "New page" }).click();
	await admin.waitForURL("**/online-store/pages/create");
	await admin.getByLabel("Title").fill("Terms of Use");
	await expect(admin.getByLabel("Address", { exact: true })).toHaveValue(
		"terms-of-use",
	);
	await expect(
		admin
			.frameLocator("iframe.gjs-frame")
			.getByText("Write your content here…"),
	).toBeVisible();
	await admin.getByRole("button", { name: "Save page" }).click();
	await expect(admin.getByText("/pages/terms-of-use")).toBeVisible(); // back on /online-store#pages
});

test("visitor: browse the public store, no login required", async () => {
	await visitor.goto(STORE);
	await expect(visitor.getByText("Main Shop").first()).toBeVisible();
	await expect(visitor).toHaveTitle("Main Shop"); // the shop's own site — never branded "· Sellrika"
	await expect(
		visitor.getByRole("link", { name: P, exact: true }),
	).toBeVisible(); // the card links to the product's own page
	await expect(
		visitor
			.locator("s")
			.filter({ hasText: amount("$5") })
			.first(),
	).toBeVisible(); // the original price, struck through (<s>)
	// "/" on the main host is the app, not a store: a signed-out visitor gets the app's own page
	await visitor.goto("/");
	await expect(visitor).not.toHaveTitle("Main Shop");
	await visitor.goto(STORE);
	// the footer links to the page the admin built
	await visitor.getByRole("link", { name: "Terms of Use" }).click();
	await expect(
		visitor.getByRole("heading", { name: "Terms of Use" }),
	).toBeVisible();
	await expect(visitor.getByText("Write your content here…")).toBeVisible();
	await expect(visitor).toHaveTitle("Terms of Use · Main Shop");

	// server-rendered (Edge themes, resources/views/themes): the raw HTML a crawler downloads already holds the shop
	const html = await (await visitor.request.get(STORE)).text();
	expect(html).toMatch(
		new RegExp(`href="/p/web-mug-[a-z0-9]+" aria-label="${P}"`),
	); // slug from the name // the card's own markup — not just the page JSON
	expect(html).toContain('rel="canonical"');
	expect(html).toContain(
		'<meta name="google-site-verification" content="e2e_Token-1234">',
	); // Search Console reads this on the store's home page
	expect(html).toContain("gtag/js?id=G-E2E12345"); // the analytics loaders the admin switched on
	expect(html).toContain('fbq("init","123456789012345")');
	expect(html.match(/<title/g)!.length).toBe(1); // one <title> (store/partials/head.edge), never doubled
	const page = await (
		await visitor.request.get(`${STORE}/pages/terms-of-use`)
	).text();
	expect(page).toContain("Write your content here…");
	expect(page).toContain('rel="canonical"');

	await visitor.goto(STORE);
});

test("visitor: cart adds, steps quantity, survives a reload, and blocks payment until a gateway is set up", async () => {
	// every product opens the sheet first (name, description, quantity) — options only when it has variants
	await visitor.getByRole("link", { name: P, exact: true }).click(); // the card is a link, but a plain click opens the sheet in place
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/$/);
	await expect(visitor.getByRole("dialog", { name: P })).toBeVisible(); // the product sheet is a <dialog> named after the product
	await expect(visitor.getByText("Option", { exact: true })).toHaveCount(0);
	await expect(visitor.getByRole("dialog").getByText("−20%")).toBeVisible(); // discount badge on the product sheet
	await expect(
		visitor.locator("li", { hasText: "hand roasted" }),
	).toBeVisible(); // rich-text description renders as markup
	// table borders take the theme's own line colour (--store-line), so they show on every
	// template and change with it (compared after the switch to Sunday)
	classicBorder = await visitor
		.getByRole("dialog")
		.locator(".rich-html th")
		.first()
		.evaluate((e) => getComputedStyle(e as Element).borderTopColor);
	expect(classicBorder).not.toBe("rgba(0, 0, 0, 0)");
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	// adding closes the sheet and pops the badge — the drawer only opens from the cart button
	await expect(visitor.getByRole("dialog")).toHaveCount(0);
	await expect(
		visitor.getByRole("button", { name: "Open cart" }),
	).toContainText("1");
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(
		visitor.getByRole("dialog", { name: "Your cart" }),
	).toBeVisible();
	await visitor.getByRole("button", { name: `Increase ${P}` }).click();
	await expect(visitor.getByRole("dialog")).toContainText(amount("$8"));
	// persisted per store in localStorage
	await visitor.reload();
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(visitor.getByRole("dialog")).toContainText(amount("$8"));
	// no payment option is on yet, so the cart's button would send the order itself (e2e/x-send-order.spec.ts);
	// the checkout page is still there: it asks who is buying and where it goes
	await expect(
		visitor.getByRole("button", { name: "Send order" }),
	).toBeVisible();
	await visitor.goto(`${STORE}/checkout`);
	await expect(
		visitor.getByRole("heading", { name: "Checkout" }),
	).toBeVisible();
	// $8 of mugs + the shop's $2 delivery — the country is locked to the only one it ships to
	await expect(deliveryRow(visitor)).toContainText(amount("$2"));
	await expect(visitor.getByText("Incl. VAT 7%")).toBeVisible(); // $8 holds $0.52 of VAT; nothing is added to the total
	await expect(visitor.locator("[data-tax]")).toContainText("$0.52");
	await expect(visitor.getByLabel("Country")).toContainText("United States");
	await expect(visitor.getByLabel("Country")).toBeDisabled();
	await expect(
		visitor.getByText("We deliver within United States only."),
	).toBeVisible();
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$10"),
	);
	// validation runs in the page (the server's own schema) — inline messages, no browser bubbles, nothing posted
	await visitor.getByRole("button", { name: /^Pay/ }).click();
	await expect(visitor.getByText("Name is required")).toBeVisible();
	await expect(visitor.getByLabel("Name", { exact: true })).toBeFocused();
	await expect(visitor.getByLabel("Name", { exact: true })).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await visitor.getByLabel("Name", { exact: true }).fill("Ann Shopper");
	await expect(visitor.getByText("Name is required")).toHaveCount(0); // fixed → the message goes away live
	await visitor.getByLabel("Phone number").fill("abc");
	await expect(visitor.getByText("Enter a valid contact number")).toBeVisible();
	await visitor.getByLabel("Phone number").fill("555-0100");
	await visitor.getByLabel("Email").fill("ann@example.com");
	await visitor.getByLabel("Address line 1").fill("1 Main St");
	await visitor.getByLabel("City").fill("Springfield");
	await visitor.getByLabel("State / Province").fill("IL");
	await visitor.getByLabel("Postal code").fill("62701");
	// no gateway switched on in /settings › Payments → friendly error instead of a redirect
	await visitor.getByRole("button", { name: /^Pay/ }).click();
	await expect(
		visitor.getByText(/doesn't accept online payments/),
	).toBeVisible();
	// the details are remembered on this device
	await visitor.reload();
	await expect(visitor.getByLabel("Name", { exact: true })).toHaveValue(
		"Ann Shopper",
	);
	await expect(visitor.getByLabel("Address line 1")).toHaveValue("1 Main St");
	await expect(visitor.getByLabel("Postal code")).toHaveValue("62701");
	await expect(visitor.getByLabel("Country")).toContainText("United States");
});

test("visitor: a rest-of-world zone unlocks the country box and re-prices the order", async () => {
	await admin.goto("/online-store?section=delivery");
	await expect(admin.getByRole("combobox", { name: "Country" })).toContainText(
		"United States",
	); // saved earlier
	await expect(admin.getByRole("row", { name: /Domestic/ })).toContainText(
		amount("$2"),
	);
	await admin.getByRole("button", { name: "Add zone" }).click();
	const dialog = admin.getByRole("dialog"); // no countries picked = every other country
	await dialog.getByLabel("Zone name").fill("Rest of world");
	await dialog.getByLabel("Delivery price").fill("5.00");
	await dialog.getByRole("button", { name: "Save zone" }).click();
	await expect(admin.getByText("Zone saved").last()).toBeVisible();
	await expect(admin.getByRole("row", { name: /Rest of world/ })).toContainText(
		"Every other country",
	);

	await visitor.goto(`${STORE}/checkout`); // the cart ($8) and the saved details are still there
	await expect(visitor.getByLabel("Country")).toBeEnabled();
	await expect(visitor.getByLabel("Country")).toContainText("United States");
	await expect(deliveryRow(visitor)).toContainText(amount("$2"));
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$10"),
	);
	// abroad → the international price
	await visitor.getByLabel("Country").click();
	await visitor.getByPlaceholder("Search country…").fill("thailand");
	await visitor.getByRole("option", { name: /Thailand/ }).click();
	await expect(deliveryRow(visitor)).toContainText(amount("$5"));
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$13"),
	);
	// and back home
	await visitor.getByLabel("Country").click();
	await visitor.getByPlaceholder("Search country…").fill("united sta");
	await visitor.getByRole("option", { name: /United States/ }).click();
	await expect(deliveryRow(visitor)).toContainText(amount("$2"));
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$10"),
	);

	await visitor.goto(STORE);
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await visitor.getByRole("button", { name: `Remove ${P}` }).click();
	await expect(visitor.getByText("Your cart is empty")).toBeVisible();
});

test("visitor: delivery options — a city zone, free delivery from an amount, and pick up in store", async () => {
	// admin (/online-store › Delivery): US goods ship free from $10, a Springfield zone costs $1 (free from $10 too), and the buyer may collect in store
	await admin.goto("/online-store?section=delivery");
	const dialog = admin.getByRole("dialog");
	await admin.getByRole("button", { name: "Edit zone 1" }).click();
	await dialog.getByLabel("Free delivery from").fill("10.00");
	await dialog.getByRole("button", { name: "Save zone" }).click();
	await expect(admin.getByText("Zone saved").last()).toBeVisible();
	await admin.getByRole("button", { name: "Add zone" }).click();
	await dialog.getByLabel("Zone name").fill("Springfield");
	await dialog.getByRole("combobox", { name: "Countries" }).click();
	await admin.getByPlaceholder("Search country…").fill("united states");
	await admin
		.getByRole("option", { name: "United States", exact: true })
		.click();
	await admin.keyboard.press("Escape");
	await dialog.getByRole("combobox", { name: "Cities" }).click();
	await admin.getByPlaceholder("Search city…").fill("Springfield");
	await admin.getByRole("option", { name: "Add “Springfield”" }).click(); // no US list downloaded → the typed name is added as is
	await admin.keyboard.press("Escape");
	await expect(dialog.getByRole("combobox", { name: "Cities" })).toContainText(
		"Springfield",
	);
	await dialog.getByLabel("Delivery price").fill("1.00");
	await dialog.getByLabel("Free delivery from").fill("10.00");
	await dialog.getByRole("button", { name: "Save zone" }).click();
	await expect(admin.getByText("Zone saved").last()).toBeVisible();
	await expect(admin.getByRole("row", { name: /^Springfield/ })).toContainText(
		amount("$1"),
	);
	await admin.getByLabel("Pick up in store").click();
	await admin.getByRole("button", { name: "Save delivery" }).click();
	await expect(admin.getByText("Delivery settings saved").last()).toBeVisible();

	// visitor: one $4 mug to Springfield (remembered from the earlier checkout) → the city's own price
	await visitor.goto(`${STORE}?q=${encodeURIComponent(P)}`);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await visitor.goto(`${STORE}/checkout`); // still no payment option: the cart's button would send the order
	await expect(visitor.getByLabel("City")).toHaveValue("Springfield");
	await expect(deliveryRow(visitor)).toContainText(amount("$1"));
	await expect(visitor.locator("[data-free-delivery]")).toHaveText(
		"Add $6 more for free delivery.",
	);
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$5"),
	);
	// another city → the shop's price
	await visitor.getByLabel("City").fill("Shelbyville");
	await expect(deliveryRow(visitor)).toContainText(amount("$2"));
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$6"),
	);
	// three mugs = $12 of goods → free delivery
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await visitor.getByRole("button", { name: `Increase ${P}` }).click();
	await visitor.getByRole("button", { name: `Increase ${P}` }).click();
	await visitor.keyboard.press("Escape");
	await expect(deliveryRow(visitor)).toContainText("Free");
	await expect(visitor.locator("[data-free-delivery]")).toHaveCount(0);
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$12"),
	);
	// pick up in store: the address goes away, nothing is charged for delivery
	await visitor.getByRole("radio", { name: /^Pick up in store/ }).check();
	await expect(visitor.getByLabel("Address line 1")).toHaveCount(0);
	await expect(
		visitor.locator("aside div").filter({ hasText: /^Pick up in store/ }),
	).toContainText("Free");
	await expect(visitor.getByRole("button", { name: /^Pay/ })).toContainText(
		amount("$12"),
	);
	await visitor.getByRole("radio", { name: "Delivery", exact: true }).check();
	await expect(visitor.getByLabel("Address line 1")).toBeVisible();

	// admin: back to the flat price (the later checkouts count on $2 delivery); the pick-up choice disappears
	await admin.goto("/online-store?section=delivery");
	await expect(admin.getByRole("row", { name: /Domestic/ })).toContainText(
		amount("$10"),
	); // saved: the threshold in the table
	await expect(admin.getByRole("row", { name: /^Springfield/ })).toContainText(
		amount("$1"),
	);
	await expect(admin.getByLabel("Pick up in store")).toBeChecked();
	await admin.getByRole("button", { name: "Edit zone 1" }).click();
	await expect(
		admin.getByRole("dialog").getByLabel("Free delivery from"),
	).toHaveValue("10.00");
	await admin.getByRole("dialog").getByLabel("Free delivery from").fill("");
	await admin
		.getByRole("dialog")
		.getByRole("button", { name: "Save zone" })
		.click();
	await expect(admin.getByText("Zone saved").last()).toBeVisible();
	await admin.getByRole("button", { name: "Remove zone 3" }).click();
	await expect(admin.getByText("Zone removed")).toBeVisible();
	await expect(admin.getByRole("row", { name: /^Springfield/ })).toHaveCount(0);
	await admin.getByLabel("Pick up in store").click();
	await admin.getByRole("button", { name: "Save delivery" }).click();
	await expect(admin.getByText("Delivery settings saved").last()).toBeVisible();
	await visitor.reload();
	await expect(
		visitor.getByRole("radio", { name: /^Pick up in store/ }),
	).toHaveCount(0);
	await expect(deliveryRow(visitor)).toContainText(amount("$2"));
	await visitor.getByLabel("City").fill("Springfield"); // leave the remembered address as it was
	await visitor.goto(STORE);
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await visitor.getByRole("button", { name: `Remove ${P}` }).click();
	await expect(visitor.getByText("Your cart is empty")).toBeVisible();
});

test("visitor: every product has its own page — shareable, with product meta, listed in the sitemap", async () => {
	await visitor.goto(STORE);
	const href = (await visitor
		.getByRole("link", { name: P, exact: true })
		.getAttribute("href"))!;
	expect(href).toMatch(/^\/p\/web-mug-[a-z0-9]+$/);
	await visitor.goto(`${STORE}${href}`); // links on the store are relative to its own host
	await expect(
		visitor.getByRole("heading", { level: 1, name: P }),
	).toBeVisible();
	await expect(visitor).toHaveTitle(`${P} · Main Shop`);
	await expect(visitor.getByText("−20%")).toBeVisible();
	await expect(
		visitor.locator("li", { hasText: "hand roasted" }),
	).toBeVisible(); // the description, as markup
	// the options, description and Add to cart sit inline — adding goes straight to the cart, no sheet
	await visitor.getByRole("button", { name: /^Add to cart/ }).click();
	await expect(visitor.getByRole("dialog")).toHaveCount(0);
	await expect(
		visitor.getByRole("button", { name: "Open cart" }),
	).toContainText("1");
	await visitor.getByRole("button", { name: "Open cart" }).click();
	await expect(
		visitor.getByRole("dialog", { name: "Your cart" }),
	).toBeVisible();
	await expect(visitor.getByRole("dialog")).toContainText(amount("$4"));
	await visitor.getByRole("button", { name: `Remove ${P}` }).click();
	await expect(visitor.getByText("Your cart is empty")).toBeVisible();
	// the sheet on the catalog links to the page
	await visitor.goto(STORE);
	await visitor.getByRole("link", { name: P, exact: true }).click();
	// Share: no navigator.share in headless Chromium → the link is copied instead
	await visitor.getByRole("button", { name: "Share" }).click();
	await expect(visitor.getByRole("status")).toHaveText("Link copied");
	expect(await visitor.evaluate(() => navigator.clipboard.readText())).toMatch(
		new RegExp(`^http://[^/]+${href}$`),
	);
	await visitor.getByRole("link", { name: "Product page" }).click();
	await expect(visitor).toHaveURL(new RegExp(`${href}$`));
	// what a crawler / link preview downloads: product Open Graph + JSON-LD, and the sitemap knows the page
	const html = await (await visitor.request.get(`${STORE}${href}`)).text();
	expect(html).toContain('<meta property="og:type" content="product">');
	expect(html).toContain(
		'<meta property="product:price:amount" content="4.00">',
	);
	expect(html).toContain('"@type":"Product"');
	expect(html).toContain('"@type":"OfferShippingDetails"'); // from the Domestic zone
	expect(html).toMatch(
		new RegExp(`<link rel="canonical" href="http://[^"]+${href}">`),
	);
	expect(
		await (await visitor.request.get(`${STORE}/sitemap.xml`)).text(),
	).toContain(`${href}</loc>`); // the shop's own sitemap
	// the main host: a sitemap of the app's own public pages only, no shops
	const site = await (await visitor.request.get("/sitemap.xml")).text();
	expect(site).toContain("<urlset");
	expect(site).not.toContain(href);
	expect(await (await visitor.request.get("/robots.txt")).text()).toContain(
		"Sitemap: http://",
	);
});

test("admin: switching the template changes the public page; disabled store 404s", async () => {
	await admin.goto("/online-store");
	await admin.getByRole("button", { name: "Template", exact: true }).click();
	await admin.getByRole("button", { name: /^Sunday/ }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Online store settings saved")).toBeVisible();
	await visitor.goto(STORE);
	await expect(
		visitor.getByPlaceholder("Search for something nice"),
	).toBeVisible(); // Sunday's search box
	await expect(visitor.locator("html")).not.toHaveClass(/dark/); // Sunday is always light — no device dark mode leaking into popovers
	await visitor.getByRole("link", { name: P, exact: true }).click();
	const sundayBorder = await visitor
		.locator(".rich-html th")
		.first()
		.evaluate((e) => getComputedStyle(e as Element).borderTopColor);
	expect(sundayBorder).not.toBe(classicBorder); // Sunday's own palette, so the table stays visible on its cream
	await visitor.getByRole("link", { name: "Product page" }).click(); // the product page renders inside Sunday's own shell (header + footer)
	await expect(
		visitor.getByRole("heading", { level: 1, name: P }),
	).toBeVisible();
	await expect(visitor.locator("body")).toHaveCSS(
		"background-color",
		"rgb(255, 250, 244)",
	); // Sunday's cream (--store-bg #fffaf4)
	await expect(
		visitor.getByPlaceholder("Search for something nice"),
	).toBeVisible(); // Sunday's own header
	await expect(
		visitor.getByRole("button", { name: "Open cart" }),
	).toBeVisible(); // the header cart button
	await visitor.goto(`${STORE}/pages/terms-of-use`); // custom pages wear the template's look too
	await expect(visitor.locator("body")).toHaveCSS(
		"background-color",
		"rgb(255, 250, 244)",
	); // Sunday's page shell
	await expect(
		visitor.getByPlaceholder("Search for something nice"),
	).toBeVisible();

	// the shop's own look for Sunday: the gear on its card opens Customize
	await admin.getByRole("button", { name: "Customize Sunday" }).click();
	const look = admin.getByRole("dialog", { name: "Customize Sunday" });
	await look.getByLabel("Primary color").fill("#ff0000");
	await look.getByLabel("Secondary color").fill("#00ff00");
	await look.getByLabel("Background color").fill("#eef6ff");
	await look.getByLabel("Text color", { exact: true }).fill("#112233");
	await look.getByLabel("Small text color").fill("#778899");
	await look.getByLabel("Card background").fill("#223344");
	await look.getByLabel("Footer background").fill("#002244");
	await look.getByLabel("Footer text").fill("#ffcc00");
	await look.getByRole("combobox", { name: "Font" }).click();
	await admin.getByRole("option", { name: "Archivo" }).click();
	await look.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Template look saved")).toBeVisible();
	await expect(admin.getByText("Customized", { exact: true })).toBeVisible(); // Sunday's card says so
	await visitor.goto(STORE);
	await expect(visitor.locator("html")).toHaveClass(/theme-primary/);
	await expect(visitor.locator("html")).toHaveClass(/theme-secondary/);
	await expect(visitor.locator("body")).toHaveCSS("font-family", /^Archivo/);
	await expect(visitor.locator('link[href*="archivo"]')).toHaveCount(1); // only the picked font's file
	await expect(visitor.getByRole("button", { name: "Open cart" })).toHaveCSS(
		"background-color",
		"rgb(255, 0, 0)",
	); // a main button takes the primary colour
	await expect(visitor.locator("body")).toHaveCSS(
		"background-color",
		"rgb(238, 246, 255)",
	); // the page's own background
	await expect(visitor.locator("footer")).toHaveCSS(
		"background-color",
		"rgb(0, 34, 68)",
	);
	await expect(visitor.locator("footer strong").first()).toHaveCSS(
		"color",
		"rgb(255, 204, 0)",
	); // the footer's own text colour
	await expect(visitor.locator("footer")).toHaveCSS(
		"color",
		"rgb(255, 204, 0)",
	); // exactly it, never a softer shade
	await expect(visitor.locator("body")).toHaveCSS("color", "rgb(17, 34, 51)"); // the page's own text colour
	const card = visitor.locator(".card").first();
	await expect(card).toHaveCSS("background-color", "rgb(34, 51, 68)"); // the cards' own colour
	await expect(card).toHaveCSS("color", "rgb(255, 255, 255)"); // white text on the dark card, picked by itself
	// Reset = the template's own look again
	await admin.getByRole("button", { name: "Customize Sunday" }).click();
	await look.getByRole("button", { name: "Reset" }).click();
	await look.getByRole("button", { name: "Save" }).click();
	await expect(admin.getByText("Customized", { exact: true })).toHaveCount(0);
	await visitor.goto(STORE);
	await expect(visitor.locator("html")).not.toHaveClass(/theme-primary/);

	await admin.getByRole("button", { name: "General", exact: true }).click();
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible(); // an earlier toast may still be on screen
	await visitor.goto(STORE);
	await expect(visitor.getByText("Page not found")).toBeVisible();
});

test("admin: edit and delete a store page from the settings list", async () => {
	await admin.goto("/online-store?section=pages"); // the section rail is deep-linkable
	await admin.getByRole("link", { name: "Edit Terms of Use" }).click();
	await admin.waitForURL("**/online-store/pages/*/edit");
	await expect(admin.getByLabel("Title")).toHaveValue("Terms of Use");
	await admin.goto("/online-store?section=pages");
	await admin.getByRole("button", { name: "Delete Terms of Use" }).click();
	await admin.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(admin.getByText("No pages yet")).toBeVisible();
});

test("visitor: the catalog is paged on the server — page and search live in the URL", async () => {
	// the previous test switched the store off → back on (Sunday template stays)
	await admin.goto("/online-store");
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
	// 12 more products through the product endpoint (cookie of the admin page) → 13 in total, 12 per page
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
	for (let i = 1; i <= 12; i++)
		expect(
			await postProduct({ ...input, name: `Filler ${run} ${i}` }),
		).toBeTruthy();
	await visitor.goto(STORE);
	await expect(visitor.getByText("1 / 2")).toBeVisible();
	await expect(visitor.locator("main a[href*='/p/']")).toHaveCount(12);
	await expect(
		visitor.getByRole("link", { name: "Next page" }),
	).toHaveAttribute("href", "/?page=2");
	await visitor.getByRole("link", { name: "Next page" }).click();
	await expect(visitor).toHaveURL(/\?page=2$/);
	await expect(visitor.getByText("2 / 2")).toBeVisible();
	await expect(
		visitor.getByRole("link", { name: P, exact: true }),
	).toBeVisible(); // the oldest product ends up on page 2
	await visitor.reload(); // the URL is the state
	await expect(visitor.getByText("2 / 2")).toBeVisible();
	// search (a plain GET form, Enter submits) → ?q=, back to page 1, no pager
	const search = visitor
		.getByPlaceholder(/Search products|something nice/)
		.first();
	await search.fill("Web Mug");
	await search.press("Enter");
	await expect(visitor).toHaveURL(/\?q=Web(\+|%20)Mug$/);
	await expect(visitor.locator("main a[href*='/p/']")).toHaveCount(1);
	await expect(visitor.getByText("/ 2")).toHaveCount(0);
	await expect(search).toHaveValue("Web Mug"); // the box follows the URL
	// one history entry per search → Back lands on page 2 again
	await visitor.goBack();
	await expect(visitor).toHaveURL(/main-shop\.localhost:\d+\/\?page=2$/);
	await expect(visitor.getByText("2 / 2")).toBeVisible();
	// the product page suggests up to 4 other products (newest first here — no categories); a tap opens their sheet like a catalog card
	await visitor.goto(`${STORE}/?page=2`);
	await visitor.goto(
		STORE +
			(await visitor
				.getByRole("link", { name: P, exact: true })
				.getAttribute("href"))!,
	);
	await expect(
		visitor.getByRole("heading", { level: 1, name: P }),
	).toBeVisible();
	const related = visitor.getByRole("region", { name: "Related products" });
	await expect(related.getByRole("link")).toHaveCount(4);
	await related.getByRole("link", { name: `Filler ${run} 12` }).click();
	await expect(visitor.getByRole("dialog")).toContainText(`Filler ${run} 12`);
	await visitor.keyboard.press("Escape");
});

test("no JavaScript: the catalog search and pager still work (a plain GET form and links)", async ({
	browser,
}) => {
	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const page = await ctx.newPage();
	await page.goto(STORE);
	await expect(page.getByText("1 / 2")).toBeVisible();
	await page.getByRole("link", { name: "Next page" }).click();
	await expect(page).toHaveURL(/\?page=2$/);
	await expect(page.getByText("2 / 2")).toBeVisible();
	await expect(page.getByRole("link", { name: P, exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Previous page" }).click();
	await expect(page.getByText("1 / 2")).toBeVisible();
	const search = page.getByRole("searchbox", { name: "Search products" });
	await search.fill("Web Mug");
	await search.press("Enter"); // the browser submits the GET form itself
	await expect(page).toHaveURL(/\?q=Web(\+|%20)Mug$/);
	await expect(page.locator("main a[href*='/p/']")).toHaveCount(1);
	await expect(page.getByRole("link", { name: P, exact: true })).toBeVisible();
	await expect(page.getByText("/ 2")).toHaveCount(0);
	await ctx.close();
});

test("admin: the banner and contact block show on the storefront; visitor: sort and the in-stock filter live in the URL", async () => {
	await admin.goto("/online-store?section=content");
	await admin.getByLabel("Banner text").fill(`Free delivery this week ${run}`);
	await admin.getByLabel("Banner type").click();
	await admin.getByRole("option", { name: "Warning" }).click();
	await admin.getByLabel("Phone", { exact: true }).fill("+95 9 123 456 789");
	await admin.getByLabel("Opening hours").fill("Mon–Sat 9:00–18:00");
	await admin.getByLabel("Support email").fill("help@mainshop.test"); // printed on order emails
	await admin.getByLabel("Facebook").fill("facebook.com/mainshop"); // not a full link → refused
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Paste the full link, starting with https://"),
	).toBeVisible();
	await admin.getByLabel("Facebook").fill("https://facebook.com/mainshop");
	await admin.getByLabel("WhatsApp").fill("+95 9 123 456 789");
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(
		admin.getByText("Online store settings saved").last(),
	).toBeVisible();
	await admin.goto("/online-store?section=content");
	await expect(admin.getByLabel("Support email")).toHaveValue(
		"help@mainshop.test",
	);

	await visitor.goto(STORE);
	await expect(
		visitor.getByText(`Free delivery this week ${run}`),
	).toBeVisible(); // the strip above the header
	await expect(
		visitor
			.locator("[data-tone]")
			.filter({ hasText: `Free delivery this week ${run}` }),
	).toHaveAttribute("data-tone", "warning"); // …in the warning colours
	const footer = visitor.locator("footer");
	await expect(
		footer.getByRole("link", { name: "+95 9 123 456 789" }),
	).toHaveAttribute("href", "tel:+959123456789");
	await expect(footer.getByText("Mon–Sat 9:00–18:00")).toBeVisible();
	await expect(footer.getByRole("link", { name: "Facebook" })).toHaveAttribute(
		"href",
		"https://facebook.com/mainshop",
	);
	await expect(footer.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
		"href",
		"https://wa.me/959123456789",
	); // digits only, country code kept
	await expect(footer.getByRole("link", { name: "Viber" })).toHaveCount(0); // left blank

	// sort: P ($4) is the dearest of the 13 → first with "Price: high to low"; the choice is in the URL and survives a reload
	await visitor.getByLabel("Sort products").selectOption("price_desc");
	await expect(visitor).toHaveURL(/\?sort=price_desc$/);
	await expect(visitor.locator("main a[href*='/p/']").first()).toHaveAttribute(
		"aria-label",
		P,
	);
	await visitor.getByLabel("In stock").check();
	await expect(visitor).toHaveURL(/\?sort=price_desc&stock=1$/);
	await visitor.reload();
	await expect(visitor.getByLabel("Sort products")).toHaveValue("price_desc");
	await expect(visitor.getByLabel("In stock")).toBeChecked();
	await expect(visitor.locator("main a[href*='/p/']").first()).toHaveAttribute(
		"aria-label",
		P,
	);
});
