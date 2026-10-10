import { expect, test, type Locator, type Page } from "@playwright/test";
import {
	amount,
	addProductImage,
	login,
	search,
	submitProduct,
} from "./helpers";

// Order-level discount → checkout → receipt → refunds → void → orders list → reports.
// Serial: every step builds on the order(s) the previous one made. Runs after flow.spec.ts (alphabetical),
// so it never asserts on global counts — only on rows carrying its own `run` suffix.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const CAT = `Gear ${run}`;
const TRACKED = `Widget ${run}`; // $120, cost $40, tracks stock, 20 on hand, has a picture
const PLAIN = `Gadget ${run}`; // $60, cost $20, no stock tracking
const CODE = `TILL${run.toUpperCase()}`; // a 10% discount code, applied at the till

let page: Page;
let orderA = 0; // 2× TRACKED + 1× PLAIN, 10% off → $270, later refunded in full
let orderB = 0; // 3× TRACKED → $360, later voided

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});
test.afterAll(() => page.close());

// --- locators ---------------------------------------------------------------
const row = (name: string) => page.getByRole("row").filter({ hasText: name });
/** A line of a report breakdown (Top products, Sales by …). */
const item = (name: string) =>
	page.getByRole("listitem").filter({ hasText: name });
/** A report card, found by its title. */
const panel = (title: string) =>
	page.locator('[data-slot="card"]').filter({ hasText: title });
const cart = () => page.getByRole("complementary"); // the desktop cart <aside>
const card = (name: string) =>
	page.locator("section button", { hasText: name }).first();
const charge = (total: string) =>
	page.getByRole("button", { name: `Charge ${total}`, exact: true });
/** dd next to a <dt> with exactly this label (order detail / cart / receipt summaries). */
const dd = (scope: Locator, label: string) =>
	scope
		.getByText(label, { exact: true })
		.locator("xpath=following-sibling::dd");
const orderRow = (id: number) =>
	page.getByRole("button", { name: `Open order ${id}`, exact: true });
/** A stat/KPI label — they are plain <p>s, and the words repeat in the nav and table headers. */
const kpi = (label: string) =>
	page.getByRole("paragraph").filter({ hasText: new RegExp(`^${label}$`) });

async function orderIdOf(dlg: Locator) {
	const text = await dlg
		.getByText(/Order #\d+/)
		.first()
		.innerText();
	return Number(text.match(/#(\d+)/)![1]);
}

/** Open the cart's discount popover. */
async function discountPopover() {
	await cart()
		.getByRole("button", { name: new RegExp(`^(Discount|\\d+% off|${CODE})$`) })
		.click();
	const pop = page
		.getByRole("dialog")
		.filter({ hasText: "Discount on this sale" });
	await expect(pop).toBeVisible();
	return pop;
}

/** Read the on-hand count for a tracked unit off /stock. */
async function stockOf(name: string) {
	await page.goto("/stock");
	await search(page, "Search stock", name);
	await expect(row(name)).toBeVisible();
	return (await row(name).getByRole("cell").nth(2).innerText()).trim();
}

// --- catalogue --------------------------------------------------------------
test("set up a category and two products (one tracked, one not)", async () => {
	await page.goto("/categories");
	await page.getByRole("button", { name: "Add category" }).click();
	await page.getByLabel("New category name").fill(CAT);
	await page.getByRole("dialog").locator('button[type="submit"]').click();
	await expect(row(CAT)).toBeVisible();

	// tracked: 20 on hand, alert at 2
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(TRACKED);
	await page.getByLabel("Base price").fill("120.00");
	await page.getByLabel("Purchase price").fill("40.00");
	await page.getByRole("button", { name: CAT }).click();
	await page.getByRole("switch", { name: /Track stock/ }).click();
	await page.getByLabel("Low-stock alert at").fill("2");
	await addProductImage(page);
	await submitProduct(page);
	// counts are set on the Stock page, not in the form
	await page.goto(`/stock?q=${encodeURIComponent(TRACKED)}`);
	await row(TRACKED).getByRole("button", { name: "Adjust" }).click();
	const adj = page.getByRole("dialog");
	await adj.getByRole("tab", { name: "Set count" }).click();
	await adj.getByLabel("New count").fill("20");
	await adj.getByRole("button", { name: "Save adjustment" }).click();
	await expect(row(TRACKED).getByText("20", { exact: true })).toBeVisible();
	await page.goto(`/products?q=${TRACKED}`);
	await expect(row(TRACKED)).toContainText(amount("$120"));

	// untracked
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(PLAIN);
	await page.getByLabel("Base price").fill("60.00");
	await page.getByLabel("Purchase price").fill("20.00");
	await page.getByRole("button", { name: CAT }).click();
	await submitProduct(page);
	await page.goto(`/products?q=${PLAIN}`);
	await expect(row(PLAIN)).toContainText(amount("$60"));

	expect(await stockOf(TRACKED)).toBe("20");
});

// --- discount in the cart ---------------------------------------------------
test("cart discount: percent, then fixed, then removed", async () => {
	await page.goto("/pos");
	await card(TRACKED).click();
	await cart()
		.getByRole("button", { name: `Increase ${TRACKED}` })
		.click(); // 2× $120
	await card(PLAIN).click();
	await expect(dd(cart(), "Subtotal")).toHaveText("$300");
	await expect(dd(cart(), "Total")).toHaveText("$300");
	await expect(charge("$300")).toBeVisible();

	// 10% off → −$30
	let pop = await discountPopover();
	await pop.getByRole("button", { name: "10%", exact: true }).click();
	await expect(cart().getByRole("button", { name: "10% off" })).toBeVisible();
	await expect(cart().locator("dd").nth(2)).toHaveText("−$30");
	await expect(dd(cart(), "Subtotal")).toHaveText("$300");
	await expect(dd(cart(), "Total")).toHaveText("$270");
	await expect(charge("$270")).toBeVisible();

	// fixed $3 off
	pop = await discountPopover();
	await pop.getByRole("button", { name: "$", exact: true }).click();
	await pop.getByPlaceholder("0.00").fill("3.00");
	await pop.getByRole("button", { name: "Apply", exact: true }).click();
	await expect(
		cart().getByRole("button", { name: "Discount", exact: true }),
	).toBeVisible();
	await expect(cart().locator("dd").nth(2)).toHaveText("−$3");
	await expect(dd(cart(), "Total")).toHaveText("$297");
	await expect(charge("$297")).toBeVisible();

	// remove it again
	pop = await discountPopover();
	await pop.getByRole("button", { name: "Remove", exact: true }).click();
	await expect(cart().locator("dd").nth(2)).toHaveText("—");
	await expect(dd(cart(), "Total")).toHaveText("$300");
	await expect(charge("$300")).toBeVisible();
});

// --- discount code in the cart ----------------------------------------------
test("discount code: a coupon made on /coupons is applied at the till, re-quoted as the cart changes, then removed", async () => {
	// the unfinished sale survives the trip to /coupons (localStorage)
	await page.goto("/coupons");
	await page.getByRole("button", { name: "Add coupon" }).first().click();
	const dlg = page.getByRole("dialog");
	await dlg.getByLabel("Code", { exact: true }).fill(CODE.toLowerCase());
	await dlg.getByLabel("Percentage", { exact: true }).fill("10");
	await dlg.getByRole("button", { name: "Add coupon" }).click();
	await expect(page.getByText("Coupon added").last()).toBeVisible();

	await page.goto("/pos");
	await expect(dd(cart(), "Total")).toHaveText("$300");
	let pop = await discountPopover();
	await pop.getByLabel("Discount code").fill("nope");
	await pop.getByRole("button", { name: "Apply code" }).click();
	await expect(pop.getByText("That code isn't valid")).toBeVisible();
	await pop.getByLabel("Discount code").fill(CODE.toLowerCase());
	await pop.getByRole("button", { name: "Apply code" }).click();
	await expect(cart().getByRole("button", { name: CODE })).toBeVisible();
	await expect(cart().locator("dd").nth(2)).toHaveText("−$30");
	await expect(dd(cart(), "Total")).toHaveText("$270");

	// one unit more → the server re-quotes the code on the new lines
	await cart()
		.getByRole("button", { name: `Increase ${TRACKED}` })
		.click(); // 3× $120 + $60 = $420
	await expect(dd(cart(), "Total")).toHaveText("$378");
	await cart()
		.getByRole("button", { name: `Decrease ${TRACKED}` })
		.click();
	await expect(dd(cart(), "Total")).toHaveText("$270");

	// the popover shows the code; Remove clears it like any discount
	pop = await discountPopover();
	await expect(pop.locator("[data-coupon-applied]")).toContainText(CODE);
	await pop.getByRole("button", { name: "Remove", exact: true }).click();
	await expect(
		cart().getByRole("button", { name: "Discount", exact: true }),
	).toBeVisible();
	await expect(dd(cart(), "Total")).toHaveText("$300");
});

test("checkout with 10% off — the Sale complete receipt shows items and totals", async () => {
	const pop = await discountPopover();
	await pop.getByRole("button", { name: "10%", exact: true }).click();
	await charge("$270").click();

	const dlg = page.getByRole("dialog");
	await dlg.getByRole("button", { name: "Cash", exact: true }).click();
	await dlg.getByLabel("Amount tendered").fill("300.00");
	await dlg.getByRole("button", { name: "Confirm $270", exact: true }).click();
	await expect(
		dlg.getByRole("heading", { name: "Sale complete" }),
	).toBeVisible();

	await expect(dlg.getByText(`2 × ${TRACKED}`)).toBeVisible();
	await expect(dlg.getByText(`1 × ${PLAIN}`)).toBeVisible();
	await expect(dd(dlg, "Subtotal")).toHaveText("$300");
	await expect(dd(dlg, "Discount (10%)")).toHaveText("−$30");
	await expect(dd(dlg, "Total")).toHaveText("$270");
	await expect(dd(dlg, "Paid")).toHaveText("$300");
	await expect(dd(dlg, "Change")).toHaveText("$30");
	await expect(dlg.getByRole("button", { name: "Print" })).toBeVisible(); // printing itself is a browser dialog — not clicked

	orderA = await orderIdOf(dlg);
	await dlg.getByRole("button", { name: "Done" }).click();
	await expect(page.getByRole("button", { name: /^Charge/ })).toBeDisabled();

	expect(await stockOf(TRACKED)).toBe("18"); // 20 − 2 sold
});

test("order detail shows subtotal, discount and total", async () => {
	await page.goto(`/orders/${orderA}`);
	await expect(page.getByRole("heading", { name: /^Order #/ })).toBeVisible();
	await expect(page.getByText("Completed", { exact: true })).toBeVisible();
	await expect(page.getByText(TRACKED, { exact: true })).toBeVisible();
	await expect(page.getByText(PLAIN, { exact: true })).toBeVisible();
	// each line shows the picture the product had when sold (a copy of its own), or a plain box
	await expect(row(TRACKED).locator("img[data-line-image]")).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/orders\//,
	);
	await expect(row(PLAIN).locator("[data-line-placeholder]")).toBeVisible();

	const dl = page.locator("dl");
	await expect(dd(dl, "3 items · Subtotal")).toHaveText("$300");
	await expect(dd(dl, "Discount (10%)")).toHaveText("−$30");
	await expect(dd(dl, "Total")).toHaveText("$270");
	await expect(dd(dl, "Paid")).toHaveText("$300");
	await expect(dd(dl, "Change")).toHaveText("$30");
	await expect(page.getByRole("button", { name: "Print" })).toBeEnabled(); // not clicked: window.print() blocks
	await expect(page.getByText("Walk-in (no customer attached)")).toBeVisible();
	await expect(page.getByText("None.")).toBeVisible(); // no refunds yet
});

// --- refunds ----------------------------------------------------------------
test("partial refund of one unit, restocked", async () => {
	await page.getByRole("button", { name: "Refund" }).click();
	const dlg = page.getByRole("dialog");
	await expect(
		dlg.getByRole("heading", { name: /^Refund order #/ }),
	).toBeVisible();
	await expect(dlg.getByText("$270 can still be refunded")).toBeVisible();

	await dlg
		.getByRole("button", { name: `Return more ${TRACKED}`, exact: true })
		.click();
	// pro-rata share of what was paid: $120 × 270/300
	await expect(dlg.getByLabel("Amount to refund")).toHaveValue("108.00");
	await expect(
		dlg.getByRole("checkbox", { name: "Put returned items back into stock" }),
	).toBeChecked();
	await dlg.getByRole("button", { name: "Refund $108", exact: true }).click();

	await expect(page.getByText(amount("Refunded $108"))).toBeVisible(); // toast
	await expect(
		page.getByText("Partly refunded", { exact: true }),
	).toBeVisible();
	const dl = page.locator("dl");
	await expect(dd(dl, "Refunded")).toHaveText("−$108");
	await expect(dd(dl, "Net")).toHaveText("$162");
	await expect(page.getByText("1 returned")).toBeVisible();
	await expect(page.getByText(`1× ${TRACKED} · restocked`)).toBeVisible();

	expect(await stockOf(TRACKED)).toBe("19"); // the returned unit went back
});

test("money-only refund (no items) grows the refunded sum", async () => {
	await page.goto(`/orders/${orderA}`);
	await page.getByRole("button", { name: "Refund" }).click();
	const dlg = page.getByRole("dialog");
	await expect(dlg.getByText("$162 can still be refunded")).toBeVisible();
	await dlg.getByLabel("Amount to refund").fill("2.00");
	await dlg.getByLabel("Reason").fill(`goodwill ${run}`);
	await dlg.getByRole("button", { name: "Refund $2", exact: true }).click();

	await expect(page.getByText(amount("Refunded $2"))).toBeVisible();
	const dl = page.locator("dl");
	await expect(dd(dl, "Refunded")).toHaveText("−$110");
	await expect(dd(dl, "Net")).toHaveText("$160");
	await expect(page.getByText(`goodwill ${run}`)).toBeVisible();
	expect(await stockOf(TRACKED)).toBe("19"); // money only — stock untouched
});

test("the refund dialog refuses more than what is left", async () => {
	await page.goto(`/orders/${orderA}`);
	await page.getByRole("button", { name: "Refund" }).click();
	const dlg = page.getByRole("dialog");
	await expect(dlg.getByText(amount("Max $160"))).toBeVisible();
	await expect(dlg.locator("img[data-line-image]")).toHaveAttribute(
		"src",
		/^\/uploads\/\d+\/orders\//,
	); // the lines carry their pictures here too
	await dlg.getByLabel("Amount to refund").fill("200.00");
	await expect(
		dlg.getByRole("button", { name: "Refund $200", exact: true }),
	).toBeDisabled();
	await dlg.getByLabel("Amount to refund").fill("0");
	await expect(
		dlg.getByRole("button", { name: "Refund", exact: true }),
	).toBeDisabled();
	await dlg.getByRole("button", { name: "Cancel" }).click();
	await expect(
		page.getByText("Partly refunded", { exact: true }),
	).toBeVisible(); // still only partly
});

test("refund the rest → Refunded", async () => {
	await page.goto(`/orders/${orderA}`);
	await page.getByRole("button", { name: "Refund", exact: true }).click();
	const dlg = page.getByRole("dialog");
	await dlg
		.getByRole("button", { name: "Refund everything", exact: true })
		.click();
	await expect(dlg.getByLabel("Amount to refund")).toHaveValue("160.00");
	await dlg.getByRole("button", { name: "Refund $160", exact: true }).click();

	await expect(page.getByText(amount("Refunded $160"))).toBeVisible();
	await expect(
		page.getByText("Refunded", { exact: true }).first(),
	).toBeVisible();
	const dl = page.locator("dl");
	await expect(dd(dl, "Refunded")).toHaveText("−$270");
	await expect(dd(dl, "Net")).toHaveText("$0");
	await expect(page.getByText("2 returned")).toBeVisible();
	await expect(page.getByRole("button", { name: "Refund" })).toHaveCount(0); // nothing left to give back
	await expect(page.getByRole("button", { name: "Void" })).toHaveCount(0); // refunded orders can't be voided

	expect(await stockOf(TRACKED)).toBe("20"); // both units back on the shelf
});

// --- void -------------------------------------------------------------------
test("void a fresh sale: stock goes back and it can't be voided or refunded again", async () => {
	await page.goto("/pos");
	await card(TRACKED).click();
	await cart()
		.getByRole("button", { name: `Increase ${TRACKED}` })
		.click();
	await cart()
		.getByRole("button", { name: `Increase ${TRACKED}` })
		.click();
	await charge("$360").click();
	const pay = page.getByRole("dialog");
	await pay.getByRole("button", { name: "Card", exact: true }).click();
	await pay.getByRole("button", { name: "Confirm $360", exact: true }).click();
	await expect(
		pay.getByRole("heading", { name: "Sale complete" }),
	).toBeVisible();
	orderB = await orderIdOf(pay);
	await pay.getByRole("button", { name: "Done" }).click();
	expect(await stockOf(TRACKED)).toBe("17");

	await page.goto(`/orders/${orderB}`);
	await page.getByRole("button", { name: "Void" }).click();
	const dlg = page.getByRole("dialog");
	await expect(
		dlg.getByRole("heading", { name: /^Void order #/ }),
	).toBeVisible();
	await dlg.getByLabel("Reason").fill(`wrong items ${run}`);
	await dlg.getByRole("button", { name: "Void order" }).click();

	await expect(page.getByText(/^Order # \S+ voided$/)).toBeVisible(); // toast
	await expect(page.getByText("Voided", { exact: true })).toBeVisible();
	await expect(page.getByText(/This sale was voided/)).toBeVisible();
	await expect(page.getByText(`Reason: “wrong items ${run}”.`)).toBeVisible();
	await expect(page.getByRole("button", { name: "Void" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Refund" })).toHaveCount(0);

	expect(await stockOf(TRACKED)).toBe("20"); // all three units put back
});

// --- orders list ------------------------------------------------------------
test("orders list: status badges and totals for my two orders", async () => {
	await page.goto("/orders");
	await page.getByLabel("Search orders").fill(TRACKED);
	await expect(page.getByText("2 matching sales")).toBeVisible();

	await expect(orderRow(orderA)).toContainText("Refunded");
	await expect(orderRow(orderA)).toContainText(amount("$270"));
	await expect(orderRow(orderA)).toContainText(amount("−$270")); // refunded chip under the total
	await expect(orderRow(orderA)).toContainText("Cash");
	await expect(orderRow(orderB)).toContainText("Voided");
	await expect(orderRow(orderB)).toContainText(amount("$360"));
	await expect(orderRow(orderB)).toContainText("Card");
	await expect(orderRow(orderB).locator("img[data-line-image]")).toHaveCount(0); // pictures only on the order page, not the list
	await expect(orderRow(orderB)).toContainText(
		/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/,
	); // the order's public code, not the id

	const pickStatus = async (name: string) => {
		await page.getByRole("combobox", { name: "Order status" }).click();
		await page.getByRole("option", { name, exact: true }).click();
	};
	await pickStatus("Voided");
	await expect(page.getByText("1 matching sale")).toBeVisible();
	await expect(orderRow(orderA)).toHaveCount(0);
	await expect(orderRow(orderB)).toBeVisible();

	await pickStatus("Refunded");
	await expect(orderRow(orderA)).toBeVisible();
	await expect(orderRow(orderB)).toHaveCount(0);

	await pickStatus("All");
	await orderRow(orderA).click();
	await page.waitForURL(`**/orders/${orderA}`);
});

// --- reports ----------------------------------------------------------------
test("reports: summary cards, charts and breakdowns", async () => {
	await page.goto("/reports");
	await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
	for (const label of [
		"Net revenue",
		"Orders",
		"Avg. order",
		"Items sold",
		"Gross profit",
		"Discounts",
		"Refunds",
	])
		await expect(kpi(label)).toBeVisible();

	await page.getByRole("tab", { name: "Today" }).click();
	await expect(
		page.getByRole("img", { name: "Sales over time" }),
	).toBeVisible();
	await expect(
		page.getByRole("img", { name: "Sales by hour of day" }),
	).toBeVisible();
	// card titles are plain divs, not headings
	for (const title of [
		"Busiest hours",
		"Top products",
		"Top customers",
		"Sales by payment method",
		"Sales by cashier",
		"Sales by category",
	])
		await expect(page.getByText(title, { exact: true })).toBeVisible();

	// Top products — voided order #B is excluded, so only order #A counts (2× $120 + 1× $60),
	// and the fully-refunded units show as a returned count.
	await expect(item(TRACKED).getByText(amount("$240"))).toBeVisible();
	await expect(item(TRACKED)).toContainText("2 returned");
	await expect(item(PLAIN).getByText(amount("$60"))).toBeVisible();
	await expect(item(PLAIN)).toContainText("1 returned");

	// By category: both products sit in my category → 3 units, $300 gross
	await expect(item(CAT)).toContainText("3 sold");
	await expect(item(CAT).getByText(amount("$300"))).toBeVisible();

	await expect(
		panel("Sales by payment method").getByText("Cash", { exact: true }),
	).toBeVisible(); // order #A's method
	await expect(
		panel("Sales by cashier").getByText("Admin", { exact: true }),
	).toBeVisible();

	for (const label of ["Tracked", "Low stock", "Out of stock"])
		await expect(kpi(label)).toBeVisible();
});

test("reports: switching period and bucket keeps my products", async () => {
	await page.getByRole("tab", { name: "This month" }).click();
	await expect(item(TRACKED).getByText(amount("$240"))).toBeVisible();
	await expect(item(CAT).getByText(amount("$300"))).toBeVisible();

	await page.getByRole("tab", { name: "Week", exact: true }).click();
	await expect(
		page.getByRole("img", { name: "Sales over time" }),
	).toBeVisible();
	await expect(item(TRACKED).getByText(amount("$240"))).toBeVisible();

	await page.getByRole("tab", { name: "Custom" }).click();
	await expect(
		page.getByRole("textbox", { name: "From", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "To", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Apply" }).click();
	await expect(item(TRACKED).getByText(amount("$240"))).toBeVisible();
});
