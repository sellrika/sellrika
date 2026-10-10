import { expect, test, type Page } from "@playwright/test";
import { login, search, submitProduct } from "./helpers";

// Stock tracking end to end: product form → /stock list (badges, filters, search) → Adjust dialog
// (add / remove / set + reason + note) → movement history → POS caps & out-of-stock → sale ledger →
// negative guard. Serial: every step builds on the counts the previous one left behind.
// Runs after flow.spec.ts (h > f) and never asserts on global counts — only on its own `${run}` rows.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const TRACKED = `Beans ${run}`; // simple, tracked, starts at 5, alert at 3
const VAR = `Mug ${run}`; // tracked, variants Small (2 = low) / Large (0 = out), alert at 3
const UNTRACKED = `Napkin ${run}`; // tracking off → never on /stock
const NOTE = `delivery ${run}`;

let page: Page;
test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});
test.afterAll(() => page.close());

// --- /stock helpers ----------------------------------------------------------
const STOCK_URL = `/stock?q=${encodeURIComponent(run)}`; // only this run's units
const goStock = () => page.goto(STOCK_URL);
/** A stock row, narrowed by every given text (product name, then variant name). */
const srow = (...texts: string[]) =>
	texts.reduce((l, t) => l.filter({ hasText: t }), page.getByRole("row"));
const onHand = (n: number, ...texts: string[]) =>
	expect(srow(...texts).getByText(String(n), { exact: true })).toBeVisible();

async function adjust(
	row: ReturnType<typeof srow>,
	mode: "Add" | "Remove" | "Set count",
	qty: string,
	opts: { reason?: string; note?: string } = {},
) {
	await row.getByRole("button", { name: "Adjust" }).click();
	const dlg = page.getByRole("dialog");
	await expect(
		dlg.getByRole("heading", { name: "Adjust stock" }),
	).toBeVisible();
	await dlg.getByRole("tab", { name: mode }).click();
	await dlg
		.getByLabel(mode === "Set count" ? "New count" : "Quantity")
		.fill(qty);
	if (opts.reason) {
		await dlg.getByLabel("Reason").click();
		await page.getByRole("option", { name: opts.reason }).click();
	}
	if (opts.note) await dlg.getByLabel("Note").fill(opts.note);
	return dlg;
}
const save = (dlg: ReturnType<typeof page.getByRole>) =>
	dlg.getByRole("button", { name: "Save adjustment" }).click();

async function history(...texts: string[]) {
	await srow(...texts)
		.getByRole("button", { name: "History" })
		.click();
	const sheet = page.getByRole("dialog");
	await expect(
		sheet.getByRole("heading", { name: "Stock history" }),
	).toBeVisible();
	return sheet;
}

// --- POS helpers -------------------------------------------------------------
const card = (name: string) =>
	page.locator("section button", { hasText: name }).first();
async function checkout(total: string) {
	await page
		.getByRole("button", { name: `Charge ${total}`, exact: true })
		.click();
	const dlg = page.getByRole("dialog");
	await dlg.getByRole("button", { name: "Cash", exact: true }).click();
	await dlg
		.getByRole("button", { name: `Confirm ${total}`, exact: true })
		.click();
	await expect(
		dlg.getByRole("heading", { name: "Sale complete" }),
	).toBeVisible();
	await dlg.getByRole("button", { name: "Done" }).click();
}

// -----------------------------------------------------------------------------

test("create a tracked product, a tracked product with variants, and an untracked one", async () => {
	// simple + tracked
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(TRACKED);
	await page.getByLabel("Base price").fill("2.00");
	await page.getByRole("switch", { name: /Track stock/ }).click();
	await expect(page.getByLabel("In stock", { exact: true })).toHaveCount(0); // the form never edits counts — /stock does
	await page.getByLabel("Low-stock alert at").fill("3");
	await submitProduct(page);
	await page.goto(`/products?q=${TRACKED}`);
	await expect(
		page.getByRole("link", { name: TRACKED, exact: true }),
	).toBeVisible();
	await goStock();
	await save(await adjust(srow(TRACKED), "Set count", "5"));
	await onHand(5, TRACKED);

	// variants, each with its own count
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(VAR);
	await page.getByLabel("Base price").fill("6.00");
	await page.getByRole("switch", { name: /Track stock/ }).click();
	await page.getByLabel("Low-stock alert at").fill("3");
	await page.getByRole("tab", { name: /^Variants/ }).click();
	await page.getByRole("button", { name: "Add variant" }).click();
	await page.getByRole("button", { name: "Add variant" }).click();
	await page.getByLabel("Variant name").nth(0).fill("Small");
	await page.getByLabel("Variant name").nth(1).fill("Large");
	await submitProduct(page);
	await page.goto(`/products?q=${VAR}`);
	await expect(
		page.getByRole("link", { name: VAR, exact: true }),
	).toBeVisible();

	// variants start at 0; per-variant counts are set on /stock, not in the form
	await goStock();
	await save(await adjust(srow(VAR, "Small"), "Set count", "2"));
	await onHand(2, VAR, "Small");

	// tracking off
	await page.goto("/products/create");
	await page.getByLabel("Name", { exact: true }).fill(UNTRACKED);
	await page.getByLabel("Base price").fill("1.00");
	await submitProduct(page);
	await page.goto(`/products?q=${UNTRACKED}`);
	await expect(
		page.getByRole("link", { name: UNTRACKED, exact: true }),
	).toBeVisible();
});

test("stock list shows one row per tracked unit, with low / out badges", async () => {
	await goStock();
	await expect(page.getByLabel("Search stock")).toHaveValue(run);

	await onHand(5, TRACKED);
	await expect(srow(TRACKED).getByText("Low")).toHaveCount(0);
	await expect(srow(TRACKED)).toContainText("3"); // alert threshold column

	await onHand(2, VAR, "Small");
	await expect(
		srow(VAR, "Small").getByText("Low", { exact: true }),
	).toBeVisible();
	await onHand(0, VAR, "Large");
	await expect(srow(VAR, "Large").getByText("Out of stock")).toBeVisible();

	await expect(srow(UNTRACKED)).toHaveCount(0); // untracked products are never listed

	// sidebar badge = shop-wide low+out count; Small (low) + Large (out) make it ≥ 2
	const badge = page.getByTestId("stock-badge");
	await expect(badge).toBeVisible();
	expect(Number(await badge.textContent())).toBeGreaterThanOrEqual(2);
});

test("low and out filters", async () => {
	await page.getByRole("tab", { name: "Low", exact: true }).click();
	await page.waitForURL(/filter=low/);
	await expect(srow(VAR, "Small")).toBeVisible();
	await expect(srow(VAR, "Large")).toBeVisible(); // out counts as low too
	await expect(srow(TRACKED)).toHaveCount(0);

	await page.getByRole("tab", { name: "Out", exact: true }).click();
	await page.waitForURL(/filter=out/);
	await expect(srow(VAR, "Large")).toBeVisible();
	await expect(srow(VAR, "Small")).toHaveCount(0);
	await expect(srow(TRACKED)).toHaveCount(0);

	await page.getByRole("tab", { name: "All", exact: true }).click();
	await page.waitForURL((u) => !u.searchParams.has("filter"));
	await expect(srow(TRACKED)).toBeVisible();

	// search narrows to a single product
	await search(page, "Search stock", VAR);
	await expect(srow(VAR, "Small")).toBeVisible();
	await expect(srow(TRACKED)).toHaveCount(0);
	await search(page, "Search stock", `nothing ${run}`);
	await expect(page.getByText("Nothing matches")).toBeVisible();
	await goStock();
});

test("adjust: add, remove and set the count", async () => {
	// +3 with a reason and a note → 8
	let dlg = await adjust(srow(TRACKED), "Add", "3", {
		reason: "Stock received",
		note: NOTE,
	});
	await expect(dlg.getByText("5 → 8")).toBeVisible();
	await save(dlg);
	await expect(page.getByText(`Stock updated — ${TRACKED}`)).toBeVisible();
	await onHand(8, TRACKED);

	// −2 → 6
	dlg = await adjust(srow(TRACKED), "Remove", "2", {
		reason: "Damaged / lost",
	});
	await expect(dlg.getByText("8 → 6")).toBeVisible();
	await save(dlg);
	await onHand(6, TRACKED);

	// set to 4
	dlg = await adjust(srow(TRACKED), "Set count", "4", {
		reason: "Count correction",
	});
	await expect(dlg.getByText("6 → 4")).toBeVisible();
	await save(dlg);
	await onHand(4, TRACKED);
	await expect(srow(TRACKED).getByText("Low", { exact: true })).toHaveCount(0); // 4 > alert 3
});

test("history lists the adjustments with reason and user", async () => {
	const sheet = await history(TRACKED);
	await expect(sheet.getByText("adjustment").first()).toBeVisible();
	await expect(sheet.getByText(`Stock received — ${NOTE}`)).toBeVisible();
	await expect(
		sheet.getByText("Damaged / lost", { exact: true }),
	).toBeVisible();
	await expect(
		sheet.getByText("Count correction", { exact: true }),
	).toBeVisible();
	await expect(sheet.getByText("+3", { exact: true })).toBeVisible();
	await expect(sheet.getByText("-2", { exact: true })).toHaveCount(2); // the −2 removal and the 6 → 4 "set"
	await expect(sheet.getByText("Admin").first()).toBeVisible(); // seeded admin's name
	await page.keyboard.press("Escape");
});

test("the product form has no stock field — the count is set on the Stock page", async () => {
	await srow(TRACKED).getByRole("link", { name: TRACKED, exact: true }).click();
	await page.waitForURL("**/products/*/edit");
	await expect(page.getByLabel("In stock", { exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Low-stock alert at")).toHaveValue("3");
	await submitProduct(page);

	await goStock();
	await onHand(4, TRACKED);
	await save(await adjust(srow(TRACKED), "Set count", "2"));
	await onHand(2, TRACKED);
});

test("POS caps the cart at the available stock", async () => {
	await page.goto("/pos");
	await expect(card(TRACKED)).toContainText("2 left"); // low badge on the card
	await card(TRACKED).click();
	await card(TRACKED).click();
	await expect(page.getByText("· last 2")).toBeVisible();
	await expect(
		page.getByRole("button", { name: `Increase ${TRACKED}` }),
	).toBeDisabled();

	await card(TRACKED).click(); // one too many
	await expect(page.getByText(`Only 2 × ${TRACKED} in stock`)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Charge $4", exact: true }),
	).toBeVisible(); // still 2 × $2

	// variant picker: the out-of-stock option can't be selected
	await card(VAR).click();
	const pick = page.getByRole("dialog");
	const large = pick.getByRole("button").filter({ hasText: "Large" });
	await expect(large).toContainText("Out of stock");
	await expect(large).toBeDisabled();
	await pick.getByRole("button").filter({ hasText: "Small" }).click();
	await expect(pick.getByText("2 in stock")).toBeVisible();
	await pick.getByRole("button", { name: /Add to cart/ }).click();
	await expect(
		page.getByRole("button", { name: "Charge $10", exact: true }),
	).toBeVisible();
});

test("selling reduces the stock and records a sale movement", async () => {
	await checkout("$10");
	await expect(card(TRACKED)).toContainText("Out of stock"); // the card shows the new count without a reload

	await goStock();
	await onHand(0, TRACKED);
	await expect(srow(TRACKED).getByText("Out of stock")).toBeVisible();
	await onHand(1, VAR, "Small");

	const sheet = await history(TRACKED);
	await expect(sheet.getByText("sale", { exact: true })).toBeVisible();
	await expect(sheet.getByRole("link", { name: /^Order #/ })).toBeVisible();
	await expect(sheet.getByText("-2", { exact: true }).first()).toBeVisible();
	await page.keyboard.press("Escape");
});

test("an out-of-stock product can't be added on the POS", async () => {
	await page.goto("/pos");
	await expect(card(TRACKED)).toContainText("Out of stock");
	await card(TRACKED).click();
	await expect(page.getByText(`${TRACKED} is out of stock`)).toBeVisible();
	await expect(page.getByRole("button", { name: /^Charge/ })).toBeDisabled(); // cart still empty
});

test("removing more than is on hand is refused", async () => {
	await goStock();
	const dlg = await adjust(srow(TRACKED), "Remove", "1");
	await save(dlg);
	await expect(dlg.getByText("Only 0 in stock")).toBeVisible();
	await dlg.getByRole("button", { name: "Cancel" }).click();

	await goStock();
	await onHand(0, TRACKED);
});
