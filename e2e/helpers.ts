import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, type Page } from "@playwright/test";
import { zip } from "../app/helpers/zip";

export const ADMIN = { email: "admin@sellrika.local", password: "password" }; // seeded on first boot (database/seed.ts)

/**
 * Match a shown amount on its own: "$5" but not "$50" or "$5.25".
 * Whole amounts drop ".00", so a plain substring match would be too loose.
 * @param text The amount as shown, e.g. "$5" or "Refunded $2".
 * @returns A regex for toContainText / getByText.
 */
export function amount(text: string) {
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`${escaped}(?!\\d|[.,]\\d)`);
}

export async function login(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(ADMIN.email);
	await page.getByLabel("Password").fill(ADMIN.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL("**/pos");
}

/** Type into a debounced search box and wait for the ?q= visit it fires (waitForURL is event-driven; expect polling would add ~500ms). */
export async function search(page: Page, label: string, q: string) {
	await page.getByLabel(label).fill(q);
	await page.waitForURL((u) => (u.searchParams.get("q") ?? "") === q.trim());
}

/** Click "Save product" and wait for the save to be acknowledged: the 303 (create → the new product's edit page,
 * update → back to the form) and the toast. The test then navigates wherever it needs — the form stays put. */
export async function submitProduct(page: Page) {
	const saved = page.waitForResponse(
		(r) =>
			["POST", "PUT"].includes(r.request().method()) &&
			/\/products(\/\d+)?$/.test(new URL(r.url()).pathname),
	);
	await page.getByRole("button", { name: "Save product" }).click();
	expect((await saved).status()).toBe(303);
	await expect(
		page.getByText(/^Product (created|updated)$/).last(),
	).toBeVisible();
}

/** 1×1 transparent PNG — enough for the magic-byte sniff in app/xcore/storage/Storage.ts. */
export const TINY_PNG = {
	name: "tiny.png",
	mimeType: "image/png",
	buffer: Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
		"base64",
	),
};

/**
 * Give the open product form a picture: pick a tiny PNG, then Save in the square editor.
 * @param page A page on the product form.
 */
export async function addProductImage(page: Page) {
	await page.locator('input[type="file"]').first().setInputFiles(TINY_PNG);
	const editor = page.getByRole("dialog", { name: "Edit image" });
	await editor.getByRole("button", { name: "Save" }).click();
	await expect(editor).toBeHidden();
	await expect(page.getByAltText("Cover image")).toBeVisible();
}

/** `extensions/<name>` zipped as-is (the server runs .ts too; `bun run build:extension` is the normal way), with an optional manifest tweak. */
export function packExtension(
	name: string,
	patch: (m: Record<string, unknown>) => Record<string, unknown> = (m) => m,
) {
	const dir = join(import.meta.dirname, "../extensions", name);
	const files: Record<string, Uint8Array> = {};
	for (const d of readdirSync(dir, { recursive: true, withFileTypes: true })) {
		if (!d.isFile()) continue;
		const rel = relative(dir, join(d.parentPath, d.name));
		if (rel.startsWith("dist/")) continue;
		files[rel] =
			rel === "extension.json"
				? new TextEncoder().encode(
						JSON.stringify(
							patch(JSON.parse(readFileSync(join(dir, rel), "utf8"))),
						),
					)
				: new Uint8Array(readFileSync(join(dir, rel)));
	}
	return Buffer.from(zip(files));
}

/** Upload a zip on Admin › Global Extensions (`/admin/extensions`, the page must be open). */
export const uploadExtension = (page: Page, buffer: Buffer) =>
	page
		.getByLabel("Extension zip", { exact: true })
		.setInputFiles({ name: "ext.zip", mimeType: "application/zip", buffer });

/**
 * Switch an extension on for all shops on Admin › Global Extensions, as the platform admin.
 * The repo's extensions are built in: the e2e server reads them from build/extensions.
 * @param page A page signed in as the platform admin.
 * @param name The extension's name as the list shows it.
 */
export async function enableGlobally(page: Page, name: string) {
	await page.goto("/admin/extensions");
	const toggle = page.getByLabel(`${name} enabled for all shops`, {
		exact: true,
	});
	await toggle.click();
	await expect(page.getByText(`${name} is on for all shops`)).toBeVisible();
	await expect(toggle).toBeChecked();
}

/**
 * The browser side of Firebase is its CDN SDK.
 * This stands in for it: the pop-up "answers" with a fixed token,
 * which e2e/fixtures/serve.ts knows.
 * @param token The token the pop-up hands back.
 * @returns The script body.
 */
export function fakeFirebase(token: string) {
	return `window.firebase = window.firebase || (() => {
  const auth = { signInWithPopup: async () => ({ user: { displayName: "Gina Google", email: "stranger@example.com", getIdToken: async () => "${token}" } }) };
  const fb = { apps: [], initializeApp(c) { fb.apps.push(c); }, auth: Object.assign(() => auth, { GoogleAuthProvider: function () {}, OAuthProvider: function () {} }) };
  return fb;
})();`;
}
