import { expect, test, type Page } from "@playwright/test";
import {
	enableGlobally,
	login,
	packExtension as pack,
	uploadExtension,
} from "./helpers";
import { zip } from "../app/helpers/zip";

// Extensions, two pages. Admin › Global Extensions (/admin/extensions, platform admin): the repo's extensions are built
// in (the prod server reads build/extensions), a zip can be added, updated and deleted, and each one is switched on
// for all shops. Settings › Extensions (/extensions): the shop enables and configures what the platform switched on.
// The Webhook example is set up, switched and reconfigured;
// then an upgrade by re-upload, the cashier gate, and a plain shop owner who only sees what is switched on.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const CASHIER = { email: `ext-cash-${run}@pos.local`, password: "cashier123" };
const OWNER = { email: `ext-owner-${run}@pos.local`, password: "owner1234" };
let page: Page;
const row = (name: string) => page.getByRole("row").filter({ hasText: name });
const dlg = () => page.getByRole("dialog");
const uploadZip = (buffer: Buffer) => uploadExtension(page, buffer);
/** The webhook example under a key that is not built in: an uploaded extension. */
const myHook = (version = "1.0.0") =>
	pack("webhook", (m) => ({ ...m, key: "my-hook", name: "My Hook", version }));

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});
test.afterAll(async () => page.close());

test("Global Extensions lists the built-ins, off and not deletable; the shop's Extensions page starts empty", async () => {
	await page.goto("/pos");
	await page.getByRole("link", { name: "Global Extensions" }).click();
	await expect(page).toHaveURL(/\/admin\/extensions$/);
	await expect(row("Webhook").getByText("Built in")).toBeVisible();
	await expect(
		row("Webhook").getByLabel("Webhook enabled for all shops"),
	).not.toBeChecked();
	await expect(
		row("Webhook").getByRole("button", { name: /Delete/ }),
	).toHaveCount(0);
	// Settings › Extensions: nothing is switched on for the shops yet
	await page.getByRole("link", { name: "Extensions", exact: true }).click();
	await expect(page).toHaveURL(/\/extensions$/);
	await expect(page.getByText("No extensions are offered yet")).toBeVisible();
	await expect(page.getByRole("button", { name: "Add extension" })).toHaveCount(
		0,
	); // no upload here
});

test("add: a bad zip and a built-in key are refused; an uploaded one can be deleted", async () => {
	await page.goto("/admin/extensions");
	// Add extension › From URL: a link that is not https is refused before anything is downloaded
	await page.getByRole("button", { name: "Add extension" }).click();
	await page.getByRole("menuitem", { name: "From URL" }).click();
	await page.getByLabel("Zip URL").fill("http://example.com/ext.zip");
	await dlg().getByRole("button", { name: "Add extension" }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Enter an https:// link to a .zip file",
	);
	await page.getByRole("button", { name: "Cancel" }).click();
	await uploadZip(Buffer.from(zip({ "index.js": "export default {}" })));
	await expect(page.getByRole("alert")).toHaveText(
		"The zip has no extension.json at its root",
	);
	await uploadZip(pack("webhook"));
	await expect(page.getByRole("alert")).toHaveText(
		"webhook is built in — its updates ship with the app",
	);
	await uploadZip(myHook());
	await expect(page.getByText("Extension added").last()).toBeVisible();
	await expect(row("My Hook").getByText("Uploaded")).toBeVisible();
	await expect(
		row("My Hook").getByLabel("My Hook enabled for all shops"),
	).not.toBeChecked(); // new = off
	page.once("dialog", (d) => d.accept());
	await row("My Hook").getByRole("button", { name: "Delete My Hook" }).click();
	await expect(page.getByText("My Hook deleted")).toBeVisible();
	await expect(row("My Hook")).toHaveCount(0);
});

test("switched on for all shops, the shop enables Webhook; it needs its URL first", async () => {
	await enableGlobally(page, "Webhook");
	await page.goto("/extensions");
	await expect(row("Webhook").getByText("v1.0.0")).toBeVisible();
	await expect(row("Webhook").getByText("Needs setup")).toBeVisible();
	await expect(row("Webhook").getByLabel("Webhook enabled")).not.toBeChecked();
	await expect(row("PromptPay QR")).toHaveCount(0); // still off for all shops
	// switching on before it is set up opens the settings instead; a webhook row (a list field) is added and checked
	await row("Webhook").getByLabel("Webhook enabled").click();
	await expect(dlg().getByText("None yet.")).toBeVisible();
	await dlg().getByRole("button", { name: "Add webhook" }).click();
	await dlg().getByLabel("URL").fill("not a url");
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(dlg().getByText("Enter a full http(s) URL")).toBeVisible();
	await dlg().getByLabel("URL").fill("https://hooks.example.com/pos");
	await dlg().getByLabel("Signing secret").fill("s3cret");
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(dlg().getByText("Events is required")).toBeVisible(); // a row must tick at least one event
	await dlg().getByRole("combobox", { name: "Events" }).click(); // a tag picker: search, pick, close
	await page.getByPlaceholder("Search…").fill("order cre");
	await page.getByRole("option", { name: "Order created" }).click();
	await page.keyboard.press("Escape");
	await expect(dlg().getByRole("combobox", { name: "Events" })).toContainText(
		"Order created",
	);
	// a second row can be added and removed again
	await dlg().getByRole("button", { name: "Add webhook" }).click();
	await expect(dlg().getByRole("group", { name: "Webhooks 2" })).toBeVisible();
	await dlg().getByRole("button", { name: "Remove Webhooks 2" }).click();
	await expect(dlg().getByRole("group", { name: "Webhooks 2" })).toHaveCount(0);
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Extension saved").last()).toBeVisible();
	await expect(row("Webhook").getByText("Ready")).toBeVisible();
	await expect(row("Webhook").getByLabel("Webhook enabled")).toBeChecked();
});

test("the switch turns it off and on; configure shows the secret as saved and keeps it", async () => {
	await row("Webhook").getByLabel("Webhook enabled").click();
	await expect(page.getByText("Webhook disabled")).toBeVisible();
	await expect(row("Webhook").getByLabel("Webhook enabled")).not.toBeChecked();
	await row("Webhook")
		.getByRole("button", { name: "Configure Webhook" })
		.click();
	await expect(dlg().getByText("Saved")).toBeVisible();
	await expect(dlg().getByLabel("URL")).toHaveValue(
		"https://hooks.example.com/pos",
	);
	await expect(dlg().getByLabel("Signing secret")).toHaveValue(""); // never echoed
	await dlg().getByLabel("Webhook enabled").click();
	await dlg().getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Extension saved").last()).toBeVisible();
	await expect(row("Webhook").getByLabel("Webhook enabled")).toBeChecked();
});

test("off for all shops hides it from the shop; on again brings it back with its settings", async () => {
	await page.goto("/admin/extensions");
	await row("Webhook").getByLabel("Webhook enabled for all shops").click();
	await expect(page.getByText("Webhook is off for all shops")).toBeVisible();
	await page.goto("/extensions");
	await expect(row("Webhook")).toHaveCount(0);
	await enableGlobally(page, "Webhook");
	await page.goto("/extensions");
	await expect(row("Webhook").getByLabel("Webhook enabled")).toBeChecked();
});

test("upload again upgrades it and keeps the key; a cashier sees neither page", async ({
	browser,
}) => {
	await page.goto("/admin/extensions");
	await uploadZip(myHook());
	await expect(row("My Hook").getByText("v1.0.0")).toBeVisible();
	await row("My Hook").getByLabel("My Hook enabled for all shops").click();
	await expect(page.getByText("My Hook is on for all shops")).toBeVisible();
	await uploadZip(myHook("1.1.0"));
	await expect(page.getByText("Extension added").last()).toBeVisible();
	await expect(row("My Hook").getByText("v1.1.0")).toBeVisible();
	await expect(
		row("My Hook").getByLabel("My Hook enabled for all shops"),
	).toBeChecked(); // the update keeps its switch

	await page.goto("/users");
	await page.getByRole("button", { name: "Add staff" }).click();
	await dlg().getByLabel("Name", { exact: true }).fill(`Cash ${run}`);
	await dlg().getByLabel("Email", { exact: true }).fill(CASHIER.email);
	await dlg().getByLabel("Password", { exact: true }).fill(CASHIER.password);
	await dlg()
		.getByRole("button", { name: /^Cashier/ })
		.click();
	await dlg().getByRole("button", { name: "Add staff" }).click();
	await expect(page.getByText("Staff added")).toBeVisible();

	const cash = await browser.newPage();
	await cash.goto("/login");
	await cash.getByLabel("Email").fill(CASHIER.email);
	await cash.getByLabel("Password").fill(CASHIER.password);
	await cash.getByRole("button", { name: "Sign in" }).click();
	await cash.waitForURL("**/pos");
	await expect(cash.getByRole("link", { name: "Extensions" })).toHaveCount(0);
	await cash.goto("/extensions");
	await expect(cash.getByText("Admins only")).toBeVisible();
	expect((await cash.request.get("/admin/extensions")).status()).toBe(403);
	await cash.close();
});

test("a shop owner: no Global Extensions, only what is switched on for all shops, and they enable + configure it", async ({
	browser,
}) => {
	// the platform admin creates a shop for a new owner, who accepts the invitation
	await page.goto("/shops/create");
	await page.getByLabel("Name", { exact: true }).fill(`Ext Owner Shop ${run}`);
	await page.getByLabel("Owner email").fill(OWNER.email);
	await page.getByRole("button", { name: "Create shop" }).click();
	const link = await page.getByLabel("Invitation link").inputValue();
	// PromptPay QR goes on for all shops: the owner will set it up
	await enableGlobally(page, "PromptPay QR");
	// My Hook goes off for all shops: the owner must not see it
	await page.goto("/admin/extensions");
	await row("My Hook").getByLabel("My Hook enabled for all shops").click();
	await expect(page.getByText("My Hook is off for all shops")).toBeVisible();

	const owner = await (await browser.newContext()).newPage();
	await owner.goto(new URL(link).pathname);
	await owner.getByLabel("Name", { exact: true }).fill("Otto Owner");
	await owner.getByLabel("New password", { exact: true }).fill(OWNER.password);
	await owner.getByLabel("Confirm new password").fill(OWNER.password);
	await owner.getByRole("button", { name: "Save and sign in" }).click();
	await owner.waitForURL("**/pos");
	// the platform page and its endpoints refuse; no sidebar link
	await expect(
		owner.getByRole("link", { name: "Global Extensions" }),
	).toHaveCount(0);
	expect((await owner.request.get("/admin/extensions")).status()).toBe(403);
	expect(
		(
			await owner.request.post("/admin/extensions", {
				data: { url: "https://example.com/x.zip" },
			})
		).status(),
	).toBe(403);
	expect(
		(
			await owner.request.put("/admin/extensions/webhook", {
				data: { enabled: false },
			})
		).status(),
	).toBe(403);
	expect(
		(await owner.request.delete("/admin/extensions/my-hook")).status(),
	).toBe(403);
	// Settings › Extensions: the switched-on ones only, fresh for this shop
	await owner.getByRole("link", { name: "Extensions", exact: true }).click();
	await expect(owner).toHaveURL(/\/extensions$/);
	const ownRow = (name: string) =>
		owner.getByRole("row").filter({ hasText: name });
	await expect(
		ownRow("Webhook").getByLabel("Webhook enabled"),
	).not.toBeChecked();
	await expect(ownRow("PromptPay QR")).toHaveCount(1);
	await expect(ownRow("My Hook")).toHaveCount(0);
	// Enable opens the settings (it needs a key), Configure keeps it
	await ownRow("PromptPay QR").getByLabel("PromptPay QR enabled").click();
	await owner.getByRole("dialog").getByLabel("PromptPay ID").fill("0812345678");
	await owner.getByRole("dialog").getByRole("button", { name: "Save" }).click();
	await expect(owner.getByText("Extension saved").last()).toBeVisible();
	await expect(
		ownRow("PromptPay QR").getByLabel("PromptPay QR enabled"),
	).toBeChecked();
	await ownRow("PromptPay QR")
		.getByRole("button", { name: "Configure PromptPay QR" })
		.click();
	await expect(
		owner.getByRole("dialog").getByLabel("PromptPay ID"),
	).toHaveValue("0812345678");
	await owner.getByRole("button", { name: "Cancel" }).click();
	// its routes answer the owner while the extension is theirs
	expect((await owner.request.get("/ext/promptpay/config")).status()).toBe(200);

	// Available to: the platform admin gives PromptPay QR to one other user only
	await page.goto("/admin/extensions");
	await row("PromptPay QR")
		.getByRole("button", { name: "Choose who may use PromptPay QR" })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("combobox", { name: "Available to" }).click();
	await page.getByPlaceholder("Search by name or email").fill("admin@sell");
	await page
		.getByRole("option", { name: "admin@sellrika.local", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Saved who may use PromptPay QR")).toBeVisible();
	await expect(row("PromptPay QR")).toContainText("admin@sellrika.local");
	// the owner is not on the list: gone from their Extensions page, their routes 404
	await owner.reload();
	await expect(ownRow("PromptPay QR")).toHaveCount(0);
	expect((await owner.request.get("/ext/promptpay/config")).status()).toBe(404);
	// back to every user: it is theirs again, with the key they saved
	await row("PromptPay QR")
		.getByRole("button", { name: "Choose who may use PromptPay QR" })
		.click();
	await dialog
		.getByRole("button", { name: "Remove admin@sellrika.local" })
		.click();
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(row("PromptPay QR")).toContainText("All users");
	await owner.reload();
	await expect(
		ownRow("PromptPay QR").getByLabel("PromptPay QR enabled"),
	).toBeChecked();
	await owner.context().close();
});
