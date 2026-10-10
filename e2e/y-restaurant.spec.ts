import { expect, test, type Page } from "@playwright/test";
import { amount, enableGlobally, login, submitProduct } from "./helpers";
import { storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("y-restaurant");

// The Restaurant extension: tables with QR codes. The admin sets the tables up (each one becomes a customer; the
// sidebar's Customers link is hidden and the extension's Tables page takes its place), staff make a table's QR code on
// the Tables page and print it, a guest who opens that link orders from the online store with "Send to kitchen", every
// round lands on the table's one unpaid order, paying it kills the code, and on the Sell screen the customer picker
// picks a table and Pay later is the main button that joins the table's bill.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const P = `Table Soup ${run}`;

let admin: Page;
let guest: Page; // separate context → no session cookie
let link = ""; // the table's QR link
test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	// count the slips instead of opening the print dialog
	await admin.addInitScript(() => {
		window.print = () => {
			const w = window as unknown as { printed?: number };
			w.printed = (w.printed ?? 0) + 1;
		};
	});
	await login(admin);
	guest = await (await browser.newContext()).newPage();
});
/**
 * Pick a table on the Tables page: its tile, and the side panel it opens.
 * @param name The table.
 * @returns The tile and the panel.
 */
async function pick(name: string) {
	const tile = admin.locator(`[data-table="${name}"]`);
	await tile.click();
	const panel = admin.locator(`[data-table-panel="${name}"]`);
	await expect(panel).toBeVisible();
	return { tile, panel };
}

test.afterAll(async () => {
	await admin.close();
	await guest.context().close();
});

test("admin: a product, the store on, the extension switched on, tables added on its page", async () => {
	await admin.goto("/products/create");
	await admin.getByLabel("Name", { exact: true }).fill(P);
	await admin.getByLabel("Base price").fill("6.00");
	await submitProduct(admin);

	await admin.goto("/online-store");
	await admin.getByRole("switch", { name: "Enable online store" }).click();
	await admin.getByRole("button", { name: "Save settings" }).click();
	await expect(admin.getByText("Online store settings saved")).toBeVisible();

	await enableGlobally(admin, "Restaurant");
	await admin.goto("/extensions");
	const row = admin.getByRole("row").filter({ hasText: "Restaurant" });
	// nothing to fill in: the switch turns it on
	await row.getByLabel("Restaurant enabled").click();
	await expect(row.getByLabel("Restaurant enabled")).toBeChecked();

	// the sidebar: no Customers link, the extension's own Restaurant section above Sales
	await expect(admin.getByRole("link", { name: "Customers" })).toHaveCount(0);
	const sections = await admin
		.locator("aside nav div.uppercase, nav div.uppercase")
		.allTextContents();
	expect(sections.indexOf("Restaurant")).toBeGreaterThanOrEqual(0);
	expect(sections.indexOf("Restaurant")).toBeLessThan(
		sections.indexOf("Sales"),
	);
	await admin.getByRole("link", { name: "Tables", exact: true }).click();
	await expect(admin).toHaveURL(/\/extensions\/restaurant\/tables$/);
	await expect(admin.getByText("No tables yet. Add them above.")).toBeVisible();
	// add two at once with a range, and one by name, then remove that one
	const add = admin.getByLabel("Add tables");
	await add.fill("1-2");
	await add.press("Enter");
	await expect(admin.locator("[data-table]")).toHaveCount(2);
	await add.fill("Bar");
	await admin.getByRole("button", { name: "Add tables" }).click();
	await expect(admin.locator("[data-table]")).toHaveCount(3);
	const bar = await pick("Bar");
	await bar.panel.getByRole("button", { name: "Table setup" }).click();
	// rename it on the Table setup tab: the tile and the panel follow; a name in use is refused
	await bar.panel.getByLabel("Table name").fill("Table 2");
	await bar.panel.getByRole("button", { name: "Rename" }).click();
	await expect(
		admin.getByText("Those tables are there already."),
	).toBeVisible();
	await bar.panel.getByLabel("Table name").fill("Terrace");
	await bar.panel.getByRole("button", { name: "Rename" }).click();
	await expect(admin.getByText("Renamed to Terrace")).toBeVisible();
	await expect(admin.locator('[data-table="Bar"]')).toHaveCount(0);
	const terrace = admin.locator('[data-table-panel="Terrace"]');
	await terrace.getByRole("button", { name: "Remove table" }).click();
	await admin
		.getByRole("dialog")
		.getByRole("button", { name: "Remove" })
		.click();
	await expect(admin.getByText("Terrace removed")).toBeVisible();
	await expect(admin.locator("[data-table]")).toHaveCount(2);

	// each table is a customer; the Customers page itself is as it was
	await admin.goto("/customers");
	await expect(admin.getByRole("heading", { name: "Customers" })).toBeVisible();
	await expect(admin.getByText("Table 1", { exact: true })).toBeVisible();
	await expect(admin.getByText("Table 2", { exact: true })).toBeVisible();
});

test("staff: the Tables page makes a table's QR code and prints it", async () => {
	await admin.goto("/pos");
	await admin.getByRole("link", { name: "Tables", exact: true }).click();
	await expect(admin).toHaveURL(/\/extensions\/restaurant\/tables$/);
	await expect(admin.locator("[data-table]")).toHaveCount(2);
	// the numbers: nothing open, both tables free, no QR codes yet
	await expect(admin.locator('[data-stat="open"]')).toContainText("0");
	await expect(admin.locator('[data-stat="free"]')).toContainText("2");
	await expect(admin.locator('[data-stat="qr"]')).toContainText("0");
	const { tile, panel: card } = await pick("Table 1");
	await expect(tile).toContainText("No QR");
	await expect(tile.locator("[data-table-status]")).toHaveText("Free");
	// the Bill tab first: nothing ordered, so nothing to pay, print or move
	await expect(card).toContainText("No open bill");
	for (const name of ["Pay", "Print bill", "Move or join"])
		await expect(card.getByRole("button", { name })).toBeDisabled();
	// the QR code is on the Table setup tab
	await card.getByRole("button", { name: "Table setup" }).click();
	await expect(card).toContainText("No QR code yet");
	await expect(card.getByRole("button", { name: "Print QR" })).toBeDisabled();
	await card.getByRole("button", { name: "Make QR code" }).click();
	await expect(card.getByRole("img", { name: "QR code" })).toBeVisible();
	await expect(card).toContainText("Made ");
	await expect(admin.locator('[data-stat="qr"]')).toContainText("1");
	// it printed at once, and prints again on demand
	const printed = () =>
		admin.evaluate(() => (window as { printed?: number }).printed);
	await expect.poll(printed).toBe(1);
	await card.getByRole("button", { name: "Print QR" }).click();
	await expect.poll(printed).toBe(2);
	// Remove QR code asks first; then the table has none, and a new one is made (and printed)
	await card.getByRole("button", { name: "Remove QR code" }).click();
	await admin
		.getByRole("dialog")
		.getByRole("button", { name: "Remove", exact: true })
		.click();
	await expect(card).toContainText("No QR code yet");
	await expect(admin.locator('[data-stat="qr"]')).toContainText("0");
	await card.getByRole("button", { name: "Make QR code" }).click();
	await expect(card.getByRole("img", { name: "QR code" })).toBeVisible();
	// the link the code holds: the store, opened for that table, with its token
	const answer = await (
		await admin.request.get("/ext/restaurant/tables")
	).json();
	link = answer.tables[0].qr.url;
	expect(link).toContain(`${STORE}/?table=Table%201&t=`);
});

test("guest: the QR link orders for the table — two rounds, one bill; a forged link is refused", async () => {
	await guest.goto(link);
	const bar = guest.locator("[data-restaurant-bar]");
	await expect(bar).toHaveText("Table 1");

	// round one: the cart's button shows the order once more, with a note box per dish
	await guest.getByRole("link", { name: P, exact: true }).click();
	await guest.getByRole("button", { name: /^Add to cart/ }).click();
	await guest.getByRole("button", { name: "Open cart" }).click();
	await guest.getByRole("button", { name: "Send to kitchen" }).click();
	const review = guest.locator("[data-restaurant-review]");
	await expect(review).toContainText(`1× ${P}`);
	await review.getByLabel(`Note for 1× ${P}`).fill("Less salt");
	await review.getByRole("button", { name: "Send to kitchen" }).click();
	const bill = guest.locator("[data-restaurant-bill]");
	await expect(bill).toContainText("Sent to the kitchen");
	await expect(bill).toContainText(`1× ${P}`);
	await expect(bill).toContainText("Less salt");
	await expect(bill).toContainText(amount("Total: $6"));
	await bill.getByRole("button", { name: "Close" }).click();
	await expect(bar).toContainText(amount("$6"));

	// round two, after browsing on: back to the menu and to the product, the table still on the address
	await guest.getByRole("link", { name: "Main Shop" }).first().click();
	await guest.waitForLoadState("load");
	await expect(guest).toHaveURL(/\?table=Table(%20|\+)1&t=/);
	await expect(bar).toContainText("Table 1");
	await guest.getByRole("link", { name: P, exact: true }).click();
	await guest.getByRole("button", { name: /^Add to cart/ }).click();
	await guest.getByRole("button", { name: "Open cart" }).click();
	await guest.getByRole("button", { name: `Increase ${P}` }).click();
	await guest.getByRole("button", { name: "Send to kitchen" }).click();
	await review.getByRole("button", { name: "Send to kitchen" }).click();
	await expect(bill).toContainText(`2× ${P}`);
	await expect(bill).toContainText(amount("Total: $18"));
	await bill.getByRole("button", { name: "Close" }).click();
	// the bar opens the bill again
	await bar.click();
	await expect(bill).toContainText("Your bill");
	await bill.getByRole("button", { name: "Close" }).click();

	// a guessed signature gets nothing
	const forged = await guest.request.post(
		`${STORE}/store/main-shop/ext/restaurant/order`,
		{ data: { table: "Table 1", t: "guess", items: [] } },
	);
	expect(forged.status()).toBe(422);
	expect(
		(
			await guest.request.get(
				`${STORE}/store/main-shop/ext/restaurant/bill?table=Table%201&t=guess`,
			)
		).status(),
	).toBe(422);
});

test("the store works only on a table's link: any other address is an invalid link, nothing is remembered", async ({
	browser,
}) => {
	const visitor = await (await browser.newContext()).newPage();
	await visitor.goto(STORE);
	await expect(visitor.locator("[data-restaurant-blocked]")).toContainText(
		"Invalid link",
	);
	await expect(visitor.locator("[data-restaurant-bar]")).toHaveCount(0);
	await visitor.context().close();
	// the guest's own tab too: the plain address is refused, a made-up code is an old code
	await guest.goto(STORE);
	await expect(guest.locator("[data-restaurant-blocked]")).toContainText(
		"Invalid link",
	);
	await guest.goto(`${STORE}/?table=Table%201&t=guess`);
	await expect(guest.locator("[data-restaurant-blocked]")).toContainText(
		"This QR code has expired",
	);
});

test("kitchen: both rounds land in To do; Start, Done, Back and drag and drop move a line", async () => {
	await admin.goto("/pos");
	const link = admin.getByRole("link", { name: "Kitchen", exact: true });
	await expect(link.locator('img[src*="kitchen.svg"]')).toHaveCount(1); // its own icon
	await link.click();
	await expect(admin).toHaveURL(/\/extensions\/restaurant\/kitchen$/);
	const column = (step: string) =>
		admin.locator(`[data-kitchen-step="${step}"] [data-kitchen-item]`);
	await expect(column("todo")).toHaveCount(2);
	await expect(column("todo").first()).toHaveAttribute(
		"data-kitchen-item",
		`1× ${P}`,
	);
	// each round is a ticket of its own, with the table and its wait
	await expect(
		admin
			.locator('[data-kitchen-step="todo"] [data-kitchen-group="Table 1"]')
			.first(),
	).toContainText("just now");
	await expect(admin.locator("[data-longest-wait]")).toContainText("just now");
	// the guest's note for the first round, and a picture box on every dish
	await expect(column("todo").first().locator("[data-note]")).toHaveText(
		"Less salt",
	);
	await expect(column("todo").locator("[data-kitchen-image]")).toHaveCount(2);

	await column("todo").first().getByRole("button", { name: "Start" }).click();
	await expect(column("preparing")).toHaveCount(1);
	await expect(column("todo")).toHaveCount(1);
	await column("preparing").getByRole("button", { name: "Done" }).click();
	await expect(column("done")).toHaveCount(1);
	await column("done").getByRole("button", { name: "Back" }).click();
	await expect(column("preparing")).toHaveCount(1);
	// drag and drop: the last To do card onto Done, then back to To do
	await column("todo")
		.first()
		.dragTo(admin.locator('[data-kitchen-step="done"]'));
	await expect(column("done")).toHaveCount(1);
	await expect(column("todo")).toHaveCount(0);
	await column("done")
		.first()
		.dragTo(admin.locator('[data-kitchen-step="todo"]'));
	await expect(column("todo")).toHaveCount(1);
	// the step is kept: a reload shows the same
	await admin.reload();
	await expect(column("preparing")).toHaveCount(1);
	await expect(column("todo")).toHaveCount(1);
});

test("staff: the table shows its open bill, the order holds both rounds, and paying it kills the QR code", async () => {
	// the Orders list: the guests' order is under "QR Scan" (the Online tab, renamed), not under POS; nothing is shipped, so no delivery steps
	await admin.goto("/orders");
	const rows = admin.getByRole("button", { name: /^Open order \d+$/ });
	await admin.getByRole("tab", { name: "QR Scan" }).click();
	await expect(admin).toHaveURL(/source=online/);
	await expect(rows).toHaveCount(1);
	await expect(admin.getByRole("tab", { name: "Any stage" })).toHaveCount(0);
	await expect(
		admin.getByRole("button", { name: "Delivery status settings" }),
	).toHaveCount(0);
	await admin.getByRole("tab", { name: "POS" }).click();
	await expect(admin).toHaveURL(/source=pos/);
	await expect(rows).toHaveCount(0);
	await admin.goto("/extensions/restaurant/tables");
	// the numbers and the filters count the open bill
	await expect(admin.locator('[data-stat="unpaid"]')).toContainText(
		amount("$18"),
	);
	await admin.locator('[data-filter="free"]').click();
	await expect(admin.locator("[data-table]")).toHaveCount(1);
	await admin.locator('[data-filter="open"]').click();
	await expect(admin.locator("[data-table]")).toHaveCount(1);
	const { tile, panel: card } = await pick("Table 1");
	await expect(tile.locator("[data-table-status]")).toContainText("Open · ");
	await expect(tile.getByText(amount("$18"))).toBeVisible();
	await expect(tile).toContainText("3 items");
	await expect(card.locator("[data-bill] li")).toHaveCount(2);
	await expect(card).toContainText(amount("$18"));
	// the bill prints before the guests pay
	const slips = () =>
		admin.evaluate(() => (window as { printed?: number }).printed ?? 0);
	const had = await slips();
	await card.getByRole("button", { name: "Print bill" }).click();
	await expect.poll(slips).toBe(had + 1);
	await card.getByRole("link", { name: "View order" }).click();
	await admin.waitForURL(/\/orders\/\d+$/);
	// one order for the table (a customer), with the second round in its history
	await expect(admin.getByRole("link", { name: /Table 1/ })).toBeVisible();
	await expect(
		admin
			.locator("[data-order-items]")
			.getByRole("row", { name: new RegExp(P) }),
	).toHaveCount(2);
	await expect(admin.locator("[data-history-changed]")).toHaveText(`+ 2× ${P}`);
	await admin.getByRole("button", { name: "Record payment" }).click();
	await expect(admin.getByLabel("Amount received")).toHaveValue("18.00");
	await admin.getByRole("button", { name: /^Record \$18$/ }).click();
	await expect(admin.getByText("Still due")).toHaveCount(0);

	// the old code is dead: its link shows the notice, staff see "No QR code yet"
	await guest.goto(link);
	await expect(guest.locator("[data-restaurant-blocked]")).toContainText(
		"This QR code has expired",
	);
	await admin.goto("/extensions/restaurant/tables");
	await pick("Table 1");
	await card.getByRole("button", { name: "Table setup" }).click();
	await expect(card).toContainText("No QR code yet");
	await expect(tile.locator("[data-table-status]")).toHaveText("Free");
	// the paid bill left the kitchen
	await admin.goto("/extensions/restaurant/kitchen");
	await expect(admin.locator("[data-kitchen-item]")).toHaveCount(0);
});

test("staff: on the Sell screen Pay later is the main button, and it puts every cart on the table's one bill", async () => {
	for (let round = 0; round < 2; round++) {
		await admin.goto("/pos");
		await admin.locator("section button", { hasText: P }).click();
		await admin.getByRole("button", { name: "Select table" }).click();
		const picker = admin.getByRole("dialog", { name: "Table" });
		await picker.getByPlaceholder("Search tables").fill("Table 2");
		await picker.getByRole("button", { name: "Table 2", exact: true }).click();
		await admin.getByRole("button", { name: "Charge $6", exact: true }).click();
		const dlg = admin.getByRole("dialog");
		const later = dlg.getByRole("button", { name: "Pay later" });
		await expect(later).toHaveAttribute("data-primary", "true");
		await later.click();
		await expect(
			dlg.getByRole("heading", { name: "Order saved, not paid yet" }),
		).toBeVisible();
		await dlg.getByRole("button", { name: "Done" }).click();
	}
	// two carts, one bill
	await admin.goto("/extensions/restaurant/tables");
	await expect(
		admin.locator('[data-table="Table 2"]').getByText(amount("$12")),
	).toBeVisible();
});

test("staff: Add items starts the bill (with a note for the kitchen), then adds to it; a removed dish shows as cancelled in the kitchen", async () => {
	for (const [round, banner, total] of [
		[0, "New order for Table 1", "$6"],
		[1, "Adding items to order #", "$12"],
	] as const) {
		await admin.goto("/extensions/restaurant/tables");
		const { panel: card } = await pick("Table 1");
		if (round === 0)
			await expect(card.getByRole("button", { name: "Pay" })).toBeDisabled();
		await card.getByRole("button", { name: "Add items" }).click();
		await admin.waitForURL(/\/pos\?customer=\d+/);
		await expect(admin.locator("[data-adding-to-order]")).toContainText(banner);
		await admin.locator("section button", { hasText: P }).click();
		if (round === 0) {
			// the cart line's note button: typed, kept on the line, sent with the order
			await admin.getByRole("button", { name: `Note for ${P}` }).click();
			await admin
				.getByRole("textbox", { name: `Note for ${P}` })
				.fill("No onions");
			await admin
				.getByRole("textbox", { name: `Note for ${P}` })
				.press("Enter");
			await expect(admin.locator("[data-line-note]")).toHaveText("No onions");
		}
		await admin.getByRole("button", { name: /^Add to order/ }).click();
		// back on the Tables page, with the bill grown
		await admin.waitForURL(/\/extensions\/restaurant\/tables$/);
		await expect(
			admin.locator('[data-table="Table 1"]').getByText(amount(total)),
		).toBeVisible();
	}
	// the note shows on the table's bill and in the kitchen; each round is its own ticket
	const { panel } = await pick("Table 1");
	await expect(panel.locator("[data-note]")).toHaveText("No onions");
	await admin.goto("/extensions/restaurant/kitchen");
	const tickets = admin.locator(
		'[data-kitchen-step="todo"] [data-kitchen-group="Table 1"]',
	);
	await expect(tickets).toHaveCount(2);
	await expect(tickets.first().locator("[data-note]")).toHaveText("No onions");
	// every dish has its picture box (the product's picture, or a chef's hat)
	await expect(
		tickets.first().locator("[data-kitchen-image]").first(),
	).toBeVisible();

	// a waiter takes the first dish off the bill: the kitchen is told, until Got it
	await admin.goto("/extensions/restaurant/tables");
	const bill = (await pick("Table 1")).panel;
	const lines = bill.locator("[data-bill-line]");
	const before = await lines.count();
	await bill
		.getByRole("button", { name: `Remove one ${P}` })
		.first()
		.click();
	// a draft on screen: nothing leaves the bill until Save changes; Undo brings it back
	const draft = bill.locator("[data-remove-draft]");
	await expect(draft).toContainText("1 item will be removed");
	await expect(lines).toHaveCount(before - 1);
	await draft.getByRole("button", { name: "Undo" }).click();
	await expect(lines).toHaveCount(before);
	await bill
		.getByRole("button", { name: `Remove one ${P}` })
		.first()
		.click();
	await draft.getByRole("button", { name: "Save changes" }).click();
	await expect(admin.getByText("Items removed")).toBeVisible();
	await expect(draft).toHaveCount(0);
	await expect(lines).toHaveCount(before - 1);
	await admin.goto("/extensions/restaurant/kitchen");
	const banner = admin.locator("[data-kitchen-banner]");
	await expect(banner).toContainText("1 dish was cancelled.");
	const cancelled = admin.locator("[data-kitchen-cancelled]");
	await expect(cancelled).toHaveCount(1);
	await expect(cancelled).toContainText("do not start");
	await cancelled.getByRole("button", { name: "Got it" }).click();
	await expect(banner).toBeHidden();
	await expect(cancelled).toHaveCount(0);
});

test("staff: Table 1 joins Table 2 — one bill; Pay takes a discount, records the money in its own dialog and prints the receipt", async () => {
	await admin.goto("/extensions/restaurant/tables");
	const one = await pick("Table 1");
	await one.panel.getByRole("button", { name: "Move or join" }).click();
	const dlg = admin.getByRole("dialog");
	await expect(dlg).toContainText("Move or join Table 1");
	const confirm = dlg.getByRole("button", { name: "Pick a table" });
	await expect(confirm).toBeDisabled();
	// no table is free, so it opens on Join; the Move tab says so
	await expect(dlg.locator('[data-move-mode="join"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await dlg.locator('[data-move-mode="move"]').click();
	await expect(dlg).toContainText("There is no free table.");
	// Table 2 has a bill of its own: it is on the Join tab, and picking it joins the two
	await dlg.locator('[data-move-mode="join"]').click();
	await expect(dlg).toContainText("The two bills become one bill.");
	await expect(dlg).toContainText("1 table with a bill");
	await dlg.locator('[data-pick="Table 2"]').click();
	await expect(dlg.locator("[data-move-summary]")).toContainText(
		"One bill on Table 2",
	);
	await dlg.getByRole("button", { name: "Join with Table 2" }).click();
	await expect(admin.getByText("Table 1 joined Table 2")).toBeVisible();
	await expect(one.tile.locator("[data-table-status]")).toHaveText("Free");
	const two = admin.locator('[data-table-panel="Table 2"]');
	await expect(two).toBeVisible(); // the joined table is picked
	await expect(
		admin.locator('[data-table="Table 2"]').getByText(amount("$18")),
	).toBeVisible();

	// pay: the dialog starts at what is due, records it, and offers the receipt
	await two.getByRole("button", { name: "Pay" }).click();
	const pay = admin.getByRole("dialog");
	await expect(pay.getByLabel("Amount received")).toHaveValue("18.00");
	// the customer's screen is told the picked method and the money asked for, like at the Sell screen
	const shown = () =>
		admin.evaluate(() => {
			const key = Object.keys(localStorage).find((k) =>
				k.startsWith("display:"),
			);
			return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
		});
	await expect.poll(shown).toMatchObject({ name: "Cash", amount: 1800 });
	// a discount first, like on the Sell screen: 10% off, then a wrong code is refused, then taken off
	const discount = pay.locator("[data-discount]");
	await discount.locator("summary").click();
	await discount.getByRole("button", { name: "10%" }).click();
	await expect(pay.getByLabel("Amount received")).toHaveValue("16.20");
	await expect(pay.locator("[data-discount-amount]")).toContainText("1.80");
	await expect(two.locator("[data-bill-discount]")).toContainText("10% off");
	await discount.locator("summary").click();
	await discount.getByLabel("Discount code").fill("NOPE");
	await discount.getByRole("button", { name: "Apply code" }).click();
	await expect(discount.locator("p.text-destructive")).toBeVisible();
	await discount.getByRole("button", { name: "Remove discount" }).click();
	await expect(pay.getByLabel("Amount received")).toHaveValue("18.00");
	// like the Sell screen: the method, the cash handed over, the change
	await expect(
		pay.locator("[data-pay-methods]").getByRole("button", { name: "Cash" }),
	).toHaveAttribute("aria-pressed", "true");
	await pay.getByLabel("Amount received").fill("20");
	await expect(pay.locator("[data-pay-sums]")).toContainText(amount("$2"));
	await pay.getByRole("button", { name: /^Confirm \$18$/ }).click();
	await expect(pay.locator("[data-paid]")).toContainText("Table 2 is paid");
	await expect(pay.locator("[data-paid-change]")).toHaveText(amount("$2"));
	const printed = () =>
		admin.evaluate(() => (window as { printed?: number }).printed ?? 0);
	const before = await printed();
	await pay.getByRole("button", { name: "Print receipt" }).click();
	await expect.poll(printed).toBe(before + 1);
	await pay.getByRole("button", { name: "Done" }).click();
	await expect(
		admin.locator('[data-table="Table 2"] [data-table-status]'),
	).toHaveText("Free");
	await expect(admin).toHaveURL(/\/extensions\/restaurant\/tables$/); // never left the page
});

test("admin: the product form's Send to kitchen switch is saved at once", async () => {
	const found = await (
		await admin.request.get(`/pos/products?q=${encodeURIComponent(P)}`)
	).json();
	const id = found.data[0].id;
	await admin.goto(`/products/${id}/edit`);
	const toggle = admin
		.locator("[data-send-to-kitchen]")
		.getByRole("switch", { name: "Send to kitchen" });
	await expect(toggle).toBeChecked();
	await toggle.click();
	await expect(admin.getByText("This product skips the kitchen")).toBeVisible();
	await admin.reload();
	await expect(toggle).not.toBeChecked();
	// a new product has no id yet: the switch waits for the first save
	await admin.goto("/products/create");
	await expect(
		admin
			.locator("[data-send-to-kitchen]")
			.getByRole("switch", { name: "Send to kitchen" }),
	).toBeDisabled();
});
