import { afterAll, expect, test } from "bun:test";
import { app } from "@config/app";
import { Url } from "@xcore/http/Url";

const saved = { store: app.domains.store, url: app.url };
afterAll(() => {
	app.domains.store = saved.store;
	app.url = saved.url;
});

test("slugOfHost: one label under the store domain is a slug, anything else is not", () => {
	app.domains.store = "shop.sellrika.com";
	expect(Url.slugOfHost("corner-coffee.shop.sellrika.com")).toBe(
		"corner-coffee",
	);
	expect(Url.slugOfHost("shop.sellrika.com")).toBeNull(); // the store domain itself
	expect(Url.slugOfHost("a.b.shop.sellrika.com")).toBeNull(); // two labels deep
	expect(Url.slugOfHost("sellrika.com")).toBeNull();
	expect(Url.slugOfHost("evilshop.sellrika.com")).toBeNull(); // must end with ".shop.sellrika.com"
});

test("storeOrigin: the shop's own domain, else its subdomain with APP_URL's scheme and port", () => {
	app.domains.store = "shop.sellrika.com";
	app.url = "https://sellrika.com";
	expect(Url.storeOrigin({ domain: "cafe.com", slug: "cafe" })).toBe(
		"https://cafe.com",
	);
	expect(Url.storeOrigin({ domain: null, slug: "cafe" })).toBe(
		"https://cafe.shop.sellrika.com",
	);
	app.url = "http://sellrika.com:3000"; // the app's own port never leaks into a real store link
	expect(Url.storeOrigin({ domain: null, slug: "cafe" })).toBe(
		"https://cafe.shop.sellrika.com",
	);
	app.domains.store = "localhost";
	app.url = "http://localhost:3000";
	expect(Url.storeOrigin({ domain: null, slug: "cafe" })).toBe(
		"http://cafe.localhost:3000",
	);
});

test("foreign: a change must come from the host it is sent to", () => {
	/**
	 * A request to the staff host.
	 * @param method The HTTP method.
	 * @param headers The request headers.
	 * @returns The request.
	 */
	function to(method: string, headers: Record<string, string>) {
		return new Request("http://pos.test/users", {
			method,
			headers: { host: "pos.test", ...headers },
		});
	}
	const cookie = "sid=abc";
	const store = "http://evil.shop.pos.test";
	expect(Url.foreign(to("POST", { cookie, origin: store }))).toBe(true);
	expect(Url.foreign(to("DELETE", { cookie: "csid=abc", origin: store }))).toBe(
		true,
	);
	expect(Url.foreign(to("POST", { cookie, origin: "null" }))).toBe(true);
	expect(
		Url.foreign(to("POST", { cookie, "sec-fetch-site": "same-site" })),
	).toBe(true);
	// the app's own page, a tool with no Origin, a read, and a request with no session
	expect(
		Url.foreign(to("POST", { cookie, origin: "http://pos.test:3000" })),
	).toBe(false);
	expect(Url.foreign(to("POST", { cookie }))).toBe(false);
	expect(Url.foreign(to("GET", { cookie, origin: store }))).toBe(false);
	// a sign-in needs no session: a foreign page is refused without one too
	expect(Url.foreign(to("POST", { origin: store }))).toBe(true);
	// meant to be called from elsewhere: the API, MCP, a provider's return, one-click unsubscribe
	for (const path of ["/api/v1/products", "/mcp", "/done", "/unsubscribe/abc"])
		expect(
			Url.foreign(
				new Request(`http://pos.test${path}`, {
					method: "POST",
					headers: { host: "pos.test", origin: store },
				}),
			),
		).toBe(false);
	expect(Url.foreign(to("OPTIONS", { origin: store }))).toBe(false);
});

test("upload: a stored picture is loaded from APP_URL, other links stay as they are", () => {
	app.url = "https://sellrika.com/";
	expect(Url.upload("/uploads/3/products/a.webp")).toBe(
		"https://sellrika.com/uploads/3/products/a.webp",
	);
	expect(Url.upload("https://cdn.example.com/a.png")).toBe(
		"https://cdn.example.com/a.png",
	);
	app.url = null; // no APP_URL: the path stays relative
	expect(Url.upload("/uploads/3/products/a.webp")).toBe(
		"/uploads/3/products/a.webp",
	);
});
