import { expect, type Page, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";

// Passkeys: /settings › Passkeys and "Use a passkey" on /login.
// Chromium's virtual authenticator stands in for the fingerprint reader.

/**
 * Give the page a passkey device that always says yes.
 * @param page The page.
 */
async function addAuthenticator(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
}

/**
 * Sign out through the user menu.
 * @param page A page inside the app.
 */
async function logout(page: Page) {
	await page.getByRole("button", { name: "Admin", exact: true }).click();
	await page.getByRole("menuitem", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/login$/);
}

test("passkey: add one in settings, sign in with it, delete it", async ({
	page,
}) => {
	await addAuthenticator(page);

	// a guest cannot start adding a passkey
	const guest = await page.request.post("/settings/passkeys/options", {
		data: { current_password: ADMIN.password },
		maxRedirects: 0,
	});
	expect(guest.status()).toBe(303);
	expect(guest.headers().location).toBe("/login");
	// and an answer nobody asked for does not sign in
	const forged = await page.request.post("/login/passkey", {
		data: {
			id: "AA",
			client_data: "AA",
			authenticator_data: "AA",
			signature: "AA",
		},
		maxRedirects: 0,
	});
	expect(forged.status()).toBe(200);

	await login(page);
	await page.goto("/settings");
	await page.getByRole("button", { name: "Passkeys" }).click();
	await expect(page).toHaveURL(/section=passkeys$/);
	await expect(page.getByText("No passkeys yet.")).toBeVisible();

	// the password is checked before the device is asked
	const add = page.getByRole("button", { name: "Add a passkey" });
	await page.getByLabel("Passkey name").fill("Test laptop");
	await page.getByLabel("Your current password").fill("not-my-password");
	await add.click();
	await expect(page.getByText("Current password is incorrect")).toBeVisible();

	await page.getByLabel("Your current password").fill(ADMIN.password);
	await add.click();
	await expect(page.getByText("Passkey added")).toBeVisible();
	const list = page.getByRole("list", { name: "Passkeys" });
	await expect(list).toContainText("Test laptop");
	await expect(list).toContainText("Never used");
	await expect(page.getByLabel("Your current password")).toHaveValue("");

	// the same device cannot add a second one
	await page.getByLabel("Your current password").fill(ADMIN.password);
	await add.click();
	await expect(
		page.getByText("This device already has a passkey for your account."),
	).toBeVisible();

	// sign in with it: no email, no password
	await logout(page);
	await page.getByRole("button", { name: "Use a passkey" }).click();
	await page.waitForURL("**/pos");
	await page.goto("/settings?section=passkeys");
	await expect(list).toContainText("Last used");

	// delete it: the device still offers it, the server refuses it
	await page.getByRole("button", { name: "Delete Test laptop" }).click();
	await expect(page.getByText("Passkey deleted")).toBeVisible();
	await expect(page.getByText("No passkeys yet.")).toBeVisible();
	await logout(page);
	await page.getByRole("button", { name: "Use a passkey" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"This passkey did not work",
	);
	await expect(page).toHaveURL(/\/login/);
});
