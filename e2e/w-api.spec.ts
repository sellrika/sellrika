import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";
import { developerOf } from "./tmp";

// The REST API: a key made on Settings › MCP & API keys, calls to /api/v1 with it, and the docs page.

const run = Date.now().toString(36);

test("api key: made in a dialog, shown once, calls the API, and stops when deleted", async ({
	page,
	request,
}) => {
	await login(page);
	await page.goto("/api-keys");
	await expect(page.getByText("No keys yet.")).toBeVisible();
	// the page says where AI assistants connect, and how
	const mcpBox = page.getByRole("region", { name: "MCP server" });
	await expect(mcpBox).toContainText("/mcp");
	await expect(mcpBox).toContainText("claude mcp add --transport http");

	// create in the dialog; the key is shown there
	await page.getByRole("button", { name: "Create key" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill(`Sync ${run}`);
	await dialog.getByRole("button", { name: /^Manager/ }).click();
	await dialog.getByRole("button", { name: "Create key" }).click();
	const box = dialog.getByRole("textbox", { name: "Your new key" });
	await expect(box).toHaveValue(/^srk_/);
	const key = await box.inputValue();
	await dialog.getByRole("button", { name: "Done" }).click();

	// after the dialog closes the key is gone for good: only its last 4 characters stay
	const row = page.getByRole("row").filter({ hasText: `Sync ${run}` });
	await expect(row).toContainText(`srk_…${key.slice(-4)}`);
	await expect(row).toContainText("Manager");
	expect(await page.content()).not.toContain(key);
	await page.reload();
	await expect(row).toBeVisible();
	expect(await page.content()).not.toContain(key);
	const saved = await page.evaluate(() => JSON.stringify(history.state));
	expect(saved).not.toContain(key);

	// the key works, with the role it was given
	const auth = { Authorization: `Bearer ${key}` };
	const me = await request.get("/api/v1/me", { headers: auth });
	expect(me.status()).toBe(200);
	expect(await me.json()).toMatchObject({ key: { role: "manager" } });
	const made = await request.post("/api/v1/categories", {
		headers: auth,
		data: { name: `Api ${run}` },
	});
	expect(made.status()).toBe(201);
	// a manager key may not touch coupons
	expect(
		(await request.get("/api/v1/coupons", { headers: auth })).status(),
	).toBe(403);
	// no key, a wrong key, and the browser's own session cookie alone: all refused
	expect((await request.get("/api/v1/me")).status()).toBe(401);
	expect(
		(
			await request.get("/api/v1/me", {
				headers: { Authorization: "Bearer srk_wrong" },
			})
		).status(),
	).toBe(401);
	expect((await page.request.get("/api/v1/me")).status()).toBe(401);

	// the same key opens the MCP server, and its tools are the API's routes
	const rpc = (method: string, params = {}) =>
		request.post("/mcp", {
			headers: { "X-API-Key": key },
			data: { jsonrpc: "2.0", id: 1, method, params },
		});
	const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
	expect((await init.json()).result.serverInfo.name).toBe("sellrika");
	const tools = (await (await rpc("tools/list")).json()).result.tools;
	const names = tools.map((t: { name: string }) => t.name);
	expect(names).toContain("create_product");
	expect(names).not.toContain("create_coupon"); // a manager key: no coupon tools
	const called = await rpc("tools/call", {
		name: "list_categories",
		arguments: {},
	});
	const result = (await called.json()).result;
	expect(result.isError).toBe(false);
	expect(result.content[0].text).toContain(`Api ${run}`);
	expect(
		(
			await request.post("/mcp", {
				data: { jsonrpc: "2.0", id: 1, method: "ping" },
			})
		).status(),
	).toBe(401);
	expect((await request.get("/mcp", { headers: auth })).status()).toBe(405);

	// the category the key made shows in the app; the list says the key was used
	await page.goto("/categories");
	await expect(page.getByText(`Api ${run}`)).toBeVisible();
	await page.goto("/api-keys");
	await expect(row).not.toContainText("Never");

	// delete: the key stops at once
	await row.getByRole("button", { name: `Delete Sync ${run}` }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete" })
		.click();
	await expect(page.getByText(`Deleted “Sync ${run}”`)).toBeVisible();
	expect((await request.get("/api/v1/me", { headers: auth })).status()).toBe(
		401,
	);
});

test("oauth: an assistant sends a guest to sign in, the admin allows it, and the code becomes a key for the MCP server", async ({
	browser,
	request,
}) => {
	// the assistant's side: where it wants the person back, and its PKCE secret
	const callback = "http://127.0.0.1:9/callback";
	const verifier = `verifier-${run}`.padEnd(43, "x");
	const challenge = createHash("sha256").update(verifier).digest("base64url");

	// it finds the sign-in from the MCP server's own 401
	const refused = await request.post("/mcp", {
		data: { jsonrpc: "2.0", id: 1, method: "ping" },
	});
	const hint = refused.headers()["www-authenticate"] ?? "";
	const found = /resource_metadata="([^"]+)"/.exec(hint)?.[1] ?? "";
	const resource = await (await request.get(found)).json();
	const server = await (
		await request.get(
			`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`,
		)
	).json();
	const client = await (
		await request.post(server.registration_endpoint, {
			data: { client_name: `Helper ${run}`, redirect_uris: [callback] },
		})
	).json();

	// a guest lands on the sign-in, and after it on the consent page
	const guest = await browser.newPage();
	await guest.route(`${callback}*`, function answer(route) {
		return route.fulfill({ body: "back at the assistant" });
	});
	const ask = new URLSearchParams({
		response_type: "code",
		client_id: client.client_id,
		redirect_uri: callback,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: `state-${run}`,
		resource: resource.resource,
	});
	await guest.goto(`${server.authorization_endpoint}?${ask}`);
	await guest.waitForURL("**/login");
	await guest.getByLabel("Email").fill(ADMIN.email);
	await guest.getByLabel("Password").fill(ADMIN.password);
	await guest.getByRole("button", { name: "Sign in" }).click();
	await expect(
		guest.getByRole("heading", { name: `Connect Helper ${run}` }),
	).toBeVisible();
	// the page names the host the code goes to: a client can make up its name, not this
	await expect(guest.getByTestId("oauth-host")).toHaveText("127.0.0.1:9");

	// a link with a redirect address the client never registered is not offered
	const forged = new URLSearchParams(ask);
	forged.set("redirect_uri", "https://evil.example/cb");
	const bad = await browser.newPage({
		storageState: await guest.context().storageState(),
	});
	expect((await bad.goto(`/oauth/authorize?${forged}`))?.status()).toBe(400);
	await expect(bad.getByRole("alert")).toContainText("not valid");
	await expect(bad.getByRole("button", { name: "Allow" })).toHaveCount(0);
	await bad.close();

	// no role is picked for the admin: Allow waits for one
	await expect(guest.getByRole("button", { name: "Allow" })).toBeDisabled();
	// allow as a cashier: back at the assistant with a code and its state
	await guest.getByRole("button", { name: /^Cashier/ }).click();
	await guest.getByRole("button", { name: "Allow" }).click();
	await guest.waitForURL(`${callback}*`);
	const back = new URL(guest.url());
	expect(back.searchParams.get("state")).toBe(`state-${run}`);
	const form = {
		grant_type: "authorization_code",
		code: back.searchParams.get("code") ?? "",
		code_verifier: verifier,
		redirect_uri: callback,
		client_id: client.client_id,
	};

	// the code becomes a key, once
	const swap = await request.post(server.token_endpoint, { form });
	expect(swap.status()).toBe(200);
	const token = await swap.json();
	expect(token).toMatchObject({ token_type: "Bearer" });
	expect((await request.post(server.token_endpoint, { form })).status()).toBe(
		400,
	);

	// the key opens the MCP server as a Bearer key, with the role that was picked
	const called = await request.post("/mcp", {
		headers: { Authorization: `Bearer ${token.access_token}` },
		data: {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "who_am_i", arguments: {} },
		},
	});
	expect((await called.json()).result.content[0].text).toContain(
		'"role":"cashier"',
	);

	// it is an ordinary key on the keys page, where the admin can delete it
	await guest.goto("/api-keys");
	await expect(
		guest.getByRole("row").filter({ hasText: `Helper ${run} (127.0.0.1:9)` }),
	).toContainText("Cashier");
	await guest.close();
});

test("api keys page: admins only", async ({ page, browser }) => {
	await login(page);
	await page.goto("/users");
	await page.getByRole("button", { name: "Add staff" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill(`Till ${run}`);
	await dialog.getByLabel("Email").fill(`till-${run}@pos.local`);
	await dialog.getByRole("textbox", { name: "Password" }).fill("password-123");
	await dialog.getByRole("button", { name: /^Cashier/ }).click();
	await dialog.getByRole("button", { name: "Add staff" }).click();
	await expect(page.getByText(`till-${run}@pos.local`)).toBeVisible();

	const till = await browser.newPage();
	await till.goto("/login");
	await till.getByLabel("Email").fill(`till-${run}@pos.local`);
	await till.getByLabel("Password").fill("password-123");
	await till.getByRole("button", { name: "Sign in" }).click();
	await till.waitForURL("**/pos");
	await expect(till.getByRole("link", { name: "MCP & API keys" })).toHaveCount(
		0,
	);
	expect((await till.goto("/api-keys"))?.status()).toBe(403);
	// nor may a cashier let an assistant in
	expect((await till.goto("/oauth/authorize?client_id=x"))?.status()).toBe(403);
	expect(
		(await till.request.post("/oauth/authorize", { data: {} })).status(),
	).toBe(403);
	expect(
		(
			await till.request.post("/api-keys", {
				data: { name: "Mine", role: "admin" },
			})
		).status(),
	).toBe(403);
	await till.close();
});

test("the docs host may call the API from a browser; another site may not", async ({
	request,
}) => {
	const docs = developerOf("w-api");
	// the OpenAPI file is public, and built from the routes
	const spec = await request.get("/api/v1/openapi.json");
	expect(spec.status()).toBe(200);
	const doc = await spec.json();
	expect(doc.openapi).toBe("3.1.0");
	expect(doc.paths["/products"].post.summary).toBe("Create a product");

	// the docs host may read the API from a browser (Test Request); another site may not
	const pre = await request.fetch("/api/v1/products", {
		method: "OPTIONS",
		headers: { Origin: docs, "Access-Control-Request-Method": "GET" },
	});
	expect(pre.status()).toBe(204);
	expect(pre.headers()["access-control-allow-origin"]).toBe(docs);
	const refused = await request.get("/api/v1/me", {
		headers: { Origin: docs },
	});
	expect(refused.status()).toBe(401);
	expect(refused.headers()["access-control-allow-origin"]).toBe(docs);
	const other = await request.get("/api/v1/me", {
		headers: { Origin: "http://evil.localhost:1" },
	});
	expect(other.headers()["access-control-allow-origin"]).toBeUndefined();
});
