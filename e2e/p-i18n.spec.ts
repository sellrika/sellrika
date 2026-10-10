import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { storeOf } from "./tmp";
/** The shop's store: its free subdomain on this spec's server. */
const STORE = storeOf("p-i18n");

// The language switch: the user menu (staff app) and the storefront footer set the `lang` cookie through
// POST /lang; every text — sidebar, pages, server validation messages — follows it, and English is the default.

test("staff app: switch to German, see German texts and a German validation message, switch back", async ({
	page,
}) => {
	await login(page);
	await expect(
		page.getByRole("link", { name: "Products" }).first(),
	).toBeVisible();

	await page.getByRole("button", { name: "Admin", exact: true }).click();
	await page.getByRole("menuitem", { name: "Language" }).hover();
	await page.getByRole("menuitemradio", { name: "Deutsch" }).click();
	await expect(
		page.getByRole("link", { name: "Produkte" }).first(),
	).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "de");

	// the server answers in German too: a category name over the 100-character limit (Zod's own message, localized)
	await page.goto("/categories");
	await page.getByRole("button", { name: "Kategorie hinzufügen" }).click();
	await page.getByLabel("Name der neuen Kategorie").fill("x".repeat(101));
	await page.getByRole("dialog").locator('button[type="submit"]').click();
	await expect(page.getByText(/Zu groß/)).toBeVisible();

	// the choice survives a reload (cookie)
	await page.reload();
	await expect(
		page.getByRole("link", { name: "Produkte" }).first(),
	).toBeVisible();

	// an extension's own dictionary: the webhook example's manifest reads in German on /extensions
	await page.goto("/admin/extensions");
	await expect(
		page.getByRole("heading", { name: "Globale Erweiterungen" }),
	).toBeVisible();
	await page
		.getByLabel("Webhook für alle Shops aktiv", { exact: true })
		.click();
	await expect(page.getByText("Webhook ist für alle Shops an")).toBeVisible();
	await page.goto("/extensions");
	await page.getByRole("button", { name: "Webhook konfigurieren" }).click();
	await expect(
		page.getByRole("dialog").getByLabel("Signaturschlüssel"),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Admin", exact: true }).click();
	await page.getByRole("menuitem", { name: "Sprache" }).hover();
	await page.getByRole("menuitemradio", { name: "English" }).click();
	await expect(
		page.getByRole("link", { name: "Products" }).first(),
	).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("storefront: the footer switch and Accept-Language", async ({
	page,
	browser,
}) => {
	// a fresh DB: the seeded shop's store is off until an admin switches it on
	await login(page);
	await page.goto("/online-store");
	await page.getByRole("switch", { name: "Enable online store" }).click();
	await page.getByRole("button", { name: "Save settings" }).click();
	await expect(page.getByText("Online store settings saved")).toBeVisible();
	// a German browser gets German with no cookie at all
	const de = await browser.newContext({ locale: "de-DE" });
	const visitor = await de.newPage();
	await visitor.goto(STORE);
	await expect(
		visitor.getByRole("link", { name: "Bestellung verfolgen" }),
	).toBeVisible();
	// and can switch to English from the footer
	await visitor.getByRole("button", { name: "English" }).click();
	await expect(
		visitor.getByRole("link", { name: "Track order" }),
	).toBeVisible();

	// the shop offers German only: English goes, German becomes the default
	await page.goto("/online-store?section=languages");
	await page.getByRole("switch", { name: "English" }).click();
	await expect(page.locator("[data-language]").first()).not.toContainText(
		"Default",
	);
	await expect(page.locator("[data-language]").nth(1)).toContainText("Default"); // Deutsch, second row, is now the default
	await page.getByRole("button", { name: "Save languages" }).click();
	await expect(page.getByText("Languages saved")).toBeVisible();
	// the visitor's English cookie no longer counts: the store is German, with no switcher
	await visitor.reload();
	await expect(
		visitor.getByRole("link", { name: "Bestellung verfolgen" }),
	).toBeVisible();
	await expect(visitor.locator("html")).toHaveAttribute("lang", "de");
	await expect(visitor.getByRole("button", { name: "English" })).toHaveCount(0);
	await expect(visitor.getByRole("button", { name: "Deutsch" })).toHaveCount(0);
	await de.close();
});
