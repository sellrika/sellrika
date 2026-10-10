import { expect, test } from "@playwright/test";
import { ADMIN, fakeFirebase, login } from "./helpers";
import { CLOUD_SPECS } from "./tmp";

test("guest is sent to login", async ({ page }) => {
	await page.goto("/pos");
	await expect(page).toHaveURL(/\/login$/);
});

test("the app's own host has no front page: a guest goes to the login", async ({
	page,
}) => {
	// an add-on (cloud/) may put its own front page there
	test.skip(CLOUD_SPECS.length > 0, "the add-on has a front page");
	await page.goto("/");
	await expect(page).toHaveURL(/\/login$/);
});

test("wrong password shows an error", async ({ page }) => {
	await page.goto("/login");
	await page.getByLabel("Email").fill(ADMIN.email);
	await page.getByLabel("Password").fill("nope-nope");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(
		page.getByText("These credentials do not match our records"),
	).toBeVisible();
});

test("login then logout", async ({ page }) => {
	// 1Password may fill the sign-in page only; every other page carries data-1p-ignore
	const body = page.locator("body");
	await page.goto("/login");
	await expect(body).not.toHaveAttribute("data-1p-ignore");
	await login(page);
	await expect(page.getByPlaceholder(/Search or scan barcode/)).toBeVisible();
	await expect(body).toHaveAttribute("data-1p-ignore");
	await page.reload();
	await expect(body).toHaveAttribute("data-1p-ignore");
	await page.getByRole("button", { name: "Admin", exact: true }).click();
	await page.getByRole("menuitem", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(body).not.toHaveAttribute("data-1p-ignore");
});

test("theme switch persists across reloads", async ({ page }) => {
	await login(page);
	await page.getByRole("button", { name: "Admin", exact: true }).click();
	await page.getByRole("menuitem", { name: "Theme" }).hover();
	await page.getByRole("menuitemradio", { name: "Dark" }).click();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.getByRole("button", { name: "Admin", exact: true }).click();
	await page.getByRole("menuitem", { name: "Theme" }).hover();
	await page.getByRole("menuitemradio", { name: "Light" }).click();
	await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("google and microsoft sign-in: an email with no account is refused, the admin's own signs in", async ({
	page,
}) => {
	let token = "e2e-stranger-token-0123456789";
	await page.route("https://www.gstatic.com/firebasejs/**", (route) =>
		route.fulfill({
			contentType: "application/javascript",
			body: fakeFirebase(token),
		}),
	);
	// a token Firebase does not know signs nobody in
	const forged = await page.request.post("/login/google", {
		data: { token: "forged-token-0123456789abcdef" },
		maxRedirects: 0,
	});
	expect(forged.status()).toBe(200);

	await page.goto("/login");
	await page.getByRole("button", { name: "Continue with Google" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Google sign-in did not work",
	);
	await expect(page).toHaveURL(/\/login/);
	await page.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Microsoft sign-in did not work",
	);

	// a fresh page: the stand-in SDK keeps the token it was loaded with
	token = "e2e-staff-token-0123456789";
	await page.goto("/login");
	await page.getByRole("button", { name: "Continue with Google" }).click();
	await expect(page).toHaveURL(/\/pos$/);

	// signed out again, the Microsoft button signs the same person in
	await page.context().clearCookies();
	await page.goto("/login");
	await page.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(page).toHaveURL(/\/pos$/);
});

test("microsoft sign-in: claiming a user's email does not get in; connected in settings it does", async ({
	page,
}) => {
	// e2e/fixtures/serve.ts answers this token with the admin's email, not verified
	await page.route("https://www.gstatic.com/firebasejs/**", (route) =>
		route.fulfill({
			contentType: "application/javascript",
			body: fakeFirebase("e2e-ms-claim-token-0123456789"),
		}),
	);
	await page.goto("/login");
	await page.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Microsoft sign-in did not work",
	);
	await expect(page).toHaveURL(/\/login/);

	// a guest cannot connect anything
	const guest = await page.request.post("/settings/microsoft", {
		data: { token: "e2e-ms-claim-token-0123456789", current_password: "x" },
		maxRedirects: 0,
	});
	expect(guest.status()).toBe(303);

	// signed in with the password, the admin connects that Microsoft account
	await login(page);
	await page.goto("/settings?section=microsoft");
	await page.getByLabel("Confirm with your password").fill("wrong-password");
	await page.getByRole("button", { name: "Connect Microsoft account" }).click();
	await expect(page.getByText("Current password is incorrect")).toBeVisible();
	await page.getByLabel("Confirm with your password").fill(ADMIN.password);
	await page.getByRole("button", { name: "Connect Microsoft account" }).click();
	await expect(page.getByText("Microsoft account connected")).toBeVisible();
	await expect(
		page.getByText("A Microsoft account is connected."),
	).toBeVisible();

	// signed out, the Microsoft button signs the admin in
	await page.context().clearCookies();
	await page.goto("/login");
	await page.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(page).toHaveURL(/\/pos$/);

	// disconnected again, it is refused like before
	await page.goto("/settings?section=microsoft");
	await page.getByRole("button", { name: "Disconnect" }).click();
	await expect(page.getByText("Microsoft account disconnected")).toBeVisible();
	await page.context().clearCookies();
	await page.goto("/login");
	await page.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Microsoft sign-in did not work",
	);
});
