import { expect, test, type Page } from "@playwright/test";
import { fakeFirebase, login } from "./helpers";
import { BASE_PORT } from "./tmp";

// Self sign-up: the platform admin switches it on, then a stranger creates their own account
// and first shop on /register. While it is off, /register does not exist.
// The new owner must confirm their email before the app works. Email goes through Resend,
// which the e2e fixture server stands in for (RESEND_API_URL in playwright.config.ts).
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const EMAIL = `signup-${run}@pos.local`;
const SHOP = `Signup Shop ${run}`;

const FIXTURES = `http://localhost:${BASE_PORT - 1}`;

let admin: Page;
let stranger: Page;

/**
 * Switch sign-up on or off as the platform admin.
 * @param enabled True = on.
 */
async function setSignup(enabled: boolean) {
	const res = await admin.request.put("/owners/signup", {
		data: { enabled },
		maxRedirects: 0,
	});
	expect(res.status()).toBe(303);
}

/**
 * Switch outgoing email on (Resend) or off, as the platform admin.
 * @param on True = on.
 */
async function setMail(on: boolean) {
	const res = await admin.request.put("/email", {
		data: {
			driver: on ? "resend" : "",
			from_email: "noreply@pos.local",
			credentials: { resend: { api_key: on ? "re_e2e" : "" } },
		},
		maxRedirects: 0,
	});
	expect(res.status()).toBe(303);
}

/**
 * The confirmation link in the last email sent to an address.
 * @param to The address.
 * @returns The link's path, like `/confirm/abc`.
 */
async function confirmLink(to: string) {
	const mail = await (
		await admin.request.get(
			`${FIXTURES}/resend/last?to=${encodeURIComponent(to)}`,
		)
	).json();
	expect(mail.subject).toBe("Confirm your email");
	return (mail.text as string).match(/\/confirm\/[\w-]+/)![0];
}

test.beforeAll(async ({ browser }) => {
	admin = await browser.newPage();
	await login(admin);
	stranger = await (await browser.newContext()).newPage(); // no cookies
});
test.afterAll(async () => {
	await stranger.context().close();
	await admin.close();
});

test("sign-up is off by default: no page, no link", async () => {
	expect((await stranger.request.get("/register")).status()).toBe(404);
	expect(
		(await stranger.request.post("/register", { data: {} })).status(),
	).toBe(404);
	await stranger.goto("/login");
	await expect(stranger.getByRole("button", { name: "Sign in" })).toBeVisible();
	await expect(stranger.getByText("Create an account")).toHaveCount(0);
});

test("sign-up needs outgoing email: with none, nobody can sign up", async () => {
	await setSignup(true);
	await setMail(false);
	await stranger.goto("/register");
	await stranger.getByLabel("Name", { exact: true }).fill("No Mail");
	await stranger.getByLabel("Email").fill(`nomail-${run}@pos.local`);
	await stranger.getByLabel("Password", { exact: true }).fill("nomail1234");
	await stranger.getByLabel("Confirm password").fill("nomail1234");
	await stranger.getByRole("button", { name: "Continue", exact: true }).click();
	await stranger.getByLabel("Shop name").fill("No Mail Shop");
	await stranger.getByRole("button", { name: "Create account" }).click();
	await expect(
		stranger.getByText("Sign-up is not possible right now"),
	).toBeVisible();
});

test("once on, a stranger signs up, confirms the email, and lands in their own shop", async () => {
	await setMail(true);
	await stranger.goto("/login");
	await stranger.getByRole("link", { name: "Create an account" }).click();
	await stranger.waitForURL("**/register");
	await stranger.getByLabel("Name", { exact: true }).fill("Sally Signup");
	await stranger.getByLabel("Email").fill(EMAIL);
	await stranger.getByLabel("Password", { exact: true }).fill("short");
	await stranger.getByLabel("Confirm password").fill("short");
	// step 1 checks the password before the shop is asked for
	await stranger.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(stranger.getByText("at least 8")).toBeVisible();

	await stranger.getByLabel("Password", { exact: true }).fill("signup1234");
	await stranger.getByLabel("Confirm password").fill("signup1234");
	await stranger.getByRole("button", { name: "Continue", exact: true }).click();
	// step 2: the shop, with who is signing up shown above it
	await expect(stranger.getByText(EMAIL)).toBeVisible();
	await expect(stranger.getByLabel("Currency")).toContainText("THB"); // the default
	await stranger.getByLabel("Shop name").fill(SHOP);
	await stranger.getByRole("button", { name: "Create account" }).click();
	await stranger.waitForURL("**/pos");

	// not confirmed yet: every app page is the "Confirm your email" screen, and actions are refused
	const heading = stranger.getByRole("heading", { name: "Confirm your email" });
	await expect(heading).toBeVisible();
	await expect(stranger.getByText(EMAIL)).toBeVisible();
	await stranger.goto("/shops");
	await expect(heading).toBeVisible();
	await expect(stranger.getByText(SHOP)).toHaveCount(0);
	expect((await stranger.request.get("/search?q=a")).status()).toBe(403);

	// resend: a new link replaces the first one
	const first = await confirmLink(EMAIL);
	await stranger.getByRole("button", { name: "Resend email" }).click();
	await expect(stranger.getByText("A new link is on its way")).toBeVisible();
	const link = await confirmLink(EMAIL);
	expect(link).not.toBe(first);
	await stranger.goto(first);
	await expect(stranger.getByText("This link no longer works")).toBeVisible();

	// the newest link opens the app
	await stranger.goto(link);
	await stranger.waitForURL("**/pos");
	await expect(heading).toHaveCount(0);
	await stranger.goto("/shops");
	await expect(stranger.getByText(SHOP).first()).toBeVisible();
	await expect(stranger.getByText("Main Shop")).toHaveCount(0);
	// signed in: /register sends them to the POS
	await stranger.goto("/register");
	await stranger.waitForURL("**/pos");
});

test("forgot password: the emailed link sets a new password, once", async ({
	browser,
}) => {
	const lost = await (await browser.newContext()).newPage();
	await lost.goto("/login");
	await lost.getByRole("link", { name: "Forgot password?" }).click();
	await lost.waitForURL("**/forgot-password");

	// an unknown email gets the same answer, and no email
	await lost.getByLabel("Email").fill(`nobody-${run}@pos.local`);
	await lost.getByRole("button", { name: "Send the link" }).click();
	await expect(
		lost.getByRole("heading", { name: "Check your email" }),
	).toBeVisible();

	await lost.goto("/forgot-password");
	await lost.getByLabel("Email").fill(EMAIL);
	await lost.getByRole("button", { name: "Send the link" }).click();
	await expect(lost.getByText(`If ${EMAIL} has an account`)).toBeVisible();

	// the email goes out after the answer
	let mail: { subject: string; text: string } | undefined;
	await expect
		.poll(async function subject() {
			mail = await (
				await admin.request.get(
					`${FIXTURES}/resend/last?to=${encodeURIComponent(EMAIL)}`,
				)
			).json();
			return mail?.subject;
		})
		.toBe("Choose a new password");
	const link = mail!.text.match(/\/reset-password\/[\w-]+/)![0];

	await lost.goto(link);
	await expect(lost.getByText(`The new password for ${EMAIL}.`)).toBeVisible();
	await lost.getByLabel("New password", { exact: true }).fill("changed1234");
	await lost.getByLabel("Confirm new password").fill("different1234");
	await lost.getByRole("button", { name: "Save and sign in" }).click();
	await expect(lost.getByText("do not match")).toBeVisible();
	await lost.getByLabel("Confirm new password").fill("changed1234");
	await lost.getByRole("button", { name: "Save and sign in" }).click();
	await lost.waitForURL("**/pos");

	// the owner who was signed in with the old password is signed out
	await stranger.goto("/shops");
	await stranger.waitForURL("**/login");
	await stranger.getByLabel("Email").fill(EMAIL);
	await stranger.getByLabel("Password").fill("signup1234");
	await stranger.getByRole("button", { name: "Sign in" }).click();
	await expect(stranger.getByText("do not match our records")).toBeVisible();
	await stranger.getByLabel("Password").fill("changed1234");
	await stranger.getByRole("button", { name: "Sign in" }).click();
	await stranger.waitForURL("**/pos");

	// the link works once
	await lost.goto(link);
	await expect(
		lost.getByRole("heading", { name: "This link does not work any more" }),
	).toBeVisible();
	await expect(
		lost.getByRole("link", { name: "Send a new link" }),
	).toHaveAttribute("href", "/forgot-password");
	await lost.context().close();
});

test("the same email can't sign up twice, and the platform admin's email is taken", async ({
	browser,
}) => {
	const other = await (await browser.newContext()).newPage();
	for (const email of [EMAIL, "admin@sellrika.local"]) {
		await other.goto("/register");
		await other.getByLabel("Name", { exact: true }).fill("Copy Cat");
		await other.getByLabel("Email").fill(email);
		await other.getByLabel("Password", { exact: true }).fill("copycat123");
		await other.getByLabel("Confirm password").fill("copycat123");
		await other.getByRole("button", { name: "Continue", exact: true }).click();
		await other.getByLabel("Shop name").fill("Copy Shop");
		await other.getByRole("button", { name: "Create account" }).click();
		await expect(other.getByText("That email is already in use")).toBeVisible();
	}
	await other.context().close();
});

test("sign-up with Google: pick the account, then the shop, and signed in at once with no email to confirm", async ({
	browser,
}) => {
	// e2e/fixtures/serve.ts answers this token with a verified email that has no account
	const person = await (await browser.newContext()).newPage();
	await person.route("https://www.gstatic.com/firebasejs/**", (route) =>
		route.fulfill({
			contentType: "application/javascript",
			body: fakeFirebase("e2e-stranger-token-0123456789"),
		}),
	);
	await person.goto("/register");
	// step 1: pick the account; step 2 shows who it is and asks only for the shop
	await person.getByRole("button", { name: "Continue with Google" }).click();
	await expect(person.getByText("Signed in with Google")).toBeVisible();
	await expect(person.getByText("stranger@example.com")).toBeVisible();
	await expect(person.getByLabel("Password", { exact: true })).toHaveCount(0);
	await expect(person.getByLabel("Shop name")).toHaveValue("Gina's Shop");
	await person.getByLabel("Shop name").fill(`Google Shop ${run}`);
	await person.getByRole("button", { name: "Create account" }).click();
	// no "Confirm your email" page: Google proved the email
	await expect(person).toHaveURL(/\/pos$/);
	await expect(person.getByText(`Google Shop ${run}`).first()).toBeVisible();

	// the same account can't sign up twice, with either button
	await person.context().clearCookies();
	await person.goto("/register");
	await person.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(person.getByText("Signed in with Microsoft")).toBeVisible();
	await person.getByRole("button", { name: "Create account" }).click();
	await expect(person.getByRole("alert")).toContainText(
		"That email is already in use",
	);
	// "Use a different way" goes back to step 1
	await person.getByRole("button", { name: "Use a different way" }).click();
	await expect(person.getByLabel("Password", { exact: true })).toBeVisible();
	// but it signs in
	await person.goto("/login");
	await person.getByRole("button", { name: "Continue with Google" }).click();
	await expect(person).toHaveURL(/\/pos$/);
	await person.context().close();
});

test("sign-up with Microsoft from the login page: straight to the shop step, no email to confirm, and the same account signs in again", async ({
	browser,
}) => {
	// e2e/fixtures/serve.ts answers this token with an email Firebase does not call verified
	const person = await (await browser.newContext()).newPage();
	await person.route("https://www.gstatic.com/firebasejs/**", (route) =>
		route.fulfill({
			contentType: "application/javascript",
			body: fakeFirebase("e2e-ms-token-0123456789"),
		}),
	);
	// the login button finds nobody with this account,
	// so it goes on to the create-shop step of the sign-up
	await person.goto("/login");
	await person.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(person).toHaveURL(/\/register$/);
	await expect(person.getByText("Signed in with Microsoft")).toBeVisible();
	await expect(person.getByLabel("Password", { exact: true })).toHaveCount(0);
	await person.getByLabel("Shop name").fill(`Microsoft Shop ${run}`);
	await person.getByRole("button", { name: "Create account" }).click();
	// straight in: no "Confirm your email" page
	await expect(person).toHaveURL(/\/pos$/);
	await expect(person.getByText("Confirm your email")).toHaveCount(0);
	await expect(person.getByText(`Microsoft Shop ${run}`).first()).toBeVisible();

	// signed out, the Microsoft button brings the same person back
	await person.context().clearCookies();
	await person.goto("/login");
	await person.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(person).toHaveURL(/\/pos$/);
	await person.context().close();
});

test("only the platform admin may flip the switch", async () => {
	expect(
		(
			await stranger.request.put("/owners/signup", {
				data: { enabled: false },
			})
		).status(),
	).toBe(403);
});

test("turned off again, /register is gone", async ({ browser }) => {
	await setSignup(false);
	await setMail(false);
	const fresh = await (await browser.newContext()).newPage();
	expect((await fresh.request.get("/register")).status()).toBe(404);
	await fresh.goto("/login");
	await expect(fresh.getByRole("button", { name: "Sign in" })).toBeVisible();
	await expect(fresh.getByText("Create an account")).toHaveCount(0);
	await fresh.context().close();
});
