import { tmpdir } from "node:os"; // Bun has no equivalent
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`; // before any app import
process.env.APP_KEY ??= "test-app-key-for-extensions";
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { app } = await import("@config/app");
const { ExtensionService: _ExtensionService } = await import(
	"../extensions/Extension.Service"
);
const ExtensionService = Container.get(_ExtensionService);
const { ExtensionController: _ExtensionController } = await import(
	"@controllers/Extension.Controller"
);
const ExtensionController = Container.get(_ExtensionController);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { UploadRepository: _UploadRepository } = await import(
	"@repositories/Upload.Repository"
);
const UploadRepository = Container.get(_UploadRepository);
const { ExtensionHandles: _ExtensionHandles } = await import(
	"@controllers/support/Extension.Handles"
);
const { ExtensionManifest } = await import("@validators/Extension.Validator");
const { apiDocs } = await import("@xcore/api/OpenApi");
const { apiRoutes } = await import("@routes/api");
if (!apiDocs.length) apiRoutes();
const { zip } = await import("@helpers/zip");

/*
 * The pages an extension brings to a shop's online store (manifest
 * `storefront`): who owns an address, the themed page, the menu links,
 * the sitemap entries, and the pictures its data keeps alive.
 */

await migrate(true);

/**
 * Make a shop whose online store is on.
 * @param slug The shop's slug, its store is at `<slug>.localhost`.
 * @returns The shop's id.
 */
async function makeShop(slug: string): Promise<number> {
	const [row] = await Db.insert(
		sql,
		"shops",
		sql`insert into shops (name, currency, timezone, slug, online_enabled) values (${slug}, 'USD', 'UTC', ${slug}, ${true})`,
		sql`id`,
	);
	return row.id as number;
}
const A = await makeShop("sf-one");
const B = await makeShop("sf-two");
const shopA = (await ShopRepository.find(A))!;
const shopB = (await ShopRepository.find(B))!;

// A tiny extension with store pages below /notes: each shop keeps its own note.
const MODULE = `
export const routes = {
	"POST /note": async (ctx) => { await ctx.data.set("note", await ctx.req.json()); return { ok: true }; },
};
export const publicRoutes = {
	"GET /notes": async (ctx) => {
		const note = await ctx.data.get("note");
		if (!note) return new Response("", { status: 404 });
		return ctx.storefront.page({ title: note.title, body: note.body, description: "About notes", image: note.image, back: note.back, css: ".n{color:red}</style><script>bad()</script>" });
	},
};
export const storefront = {
	links: async (ctx) => (await ctx.data.get("note")) ? [
		{ title: "Notes", path: "/notes" },
		{ title: "Elsewhere", path: "/checkout" },
		{ title: "", path: "/notes/x" },
	] : [],
	sitemap: async (ctx) => (await ctx.data.get("note")) ? ["/notes", "/notes/a b", "/account", "/notes/first"] : [],
};`;
const MANIFEST = JSON.stringify({
	key: "notes",
	name: "Notes",
	main: "index.js",
	storefront: { path: "notes" },
});

const installed = await ExtensionService.upload(
	new File(
		[
			zip({
				"extension.json": new TextEncoder().encode(MANIFEST),
				"index.js": new TextEncoder().encode(MODULE),
			}).slice().buffer as ArrayBuffer,
		],
		"notes.zip",
		{ type: "application/zip" },
	),
);
await ExtensionService.setGlobal("notes", true);
await ExtensionService.save(A, "notes", { enabled: true, config: {} });
await ExtensionService.save(B, "notes", { enabled: true, config: {} });

const savedUrl = app.url;
afterAll(async () => {
	app.url = savedUrl;
	await ExtensionService.remove("notes");
});

const admin = { id: 1, name: "Admin", email: "a@x.io", role: "admin" } as any;

/**
 * Keep a shop's note through the extension's own staff route.
 * @param shop The shop.
 * @param note The note.
 */
async function keep(shop: typeof shopA, note: Record<string, unknown>) {
	await ExtensionService.handle(
		"routes",
		shop,
		"notes",
		new Request("http://localhost/ext/notes/note", {
			method: "POST",
			body: JSON.stringify(note),
		}),
		"/note",
		{ user: admin },
	);
}

/**
 * Ask a store for a page, like a visitor's browser.
 * @param slug The shop's slug.
 * @param path The page's path.
 * @returns The response.
 */
function visit(slug: string, path: string) {
	return ExtensionController.storePage(
		new Request(`http://${slug}.localhost${path}`) as any,
	);
}

test("the manifest takes a storefront path of lower-case letters, digits and dashes only", () => {
	expect(installed).toEqual({ key: "notes" });
	const base = { key: "x1", name: "X", main: "index.js" };
	const good = { ...base, storefront: { path: "blog" } };
	expect(ExtensionManifest.safeParse(good).success).toBe(true);
	for (const path of ["Blog", "a", "blog/posts", "../x", ""])
		expect(
			ExtensionManifest.safeParse({ ...base, storefront: { path } }).success,
			path,
		).toBe(false);
});

test("a store page is drawn in the shop's theme, cleaned, and only from the shop's own data", async () => {
	await keep(shopA, {
		title: "Hello <b>",
		body: `<p class="n">First note</p><script>alert(1)</script><img src="/uploads/${A}/extensions/a.webp" onerror="x()">`,
		image: `/uploads/${A}/extensions/a.webp`,
		back: { title: "Back to notes", path: "/notes" },
	});
	expect(await ExtensionService.storeOwner(shopA, "notes")).toBe("notes");
	expect(await ExtensionService.storeOwner(shopA, "nope")).toBeNull();

	app.url = "https://sellrika.test";
	const res = await visit("sf-one", "/notes");
	expect(res.status).toBe(200);
	const html = await res.text();
	// the theme's own frame, the page's head tags
	expect(html).toContain('aria-label="Open cart"');
	expect(html).toContain("<title>Hello &lt;b&gt; · sf-one</title>");
	expect(html).toContain('content="About notes"');
	expect(html).toContain("First note");
	// the page's own back link, in place of the theme's "Back to shop"
	expect(html).toMatch(
		/<a class="back" href="\/notes">[\s\S]*?Back to notes\s*<\/a>/,
	);
	// nothing a person typed runs: no script, no handler, no way out of the style tag
	expect(html).not.toContain("alert(1)");
	expect(html).not.toContain("onerror");
	// the page's CSS can't close its own style tag: what follows stays CSS text
	expect(html).not.toContain("</style><script>bad()");
	// a picture of ours loads from the app's own host (the CDN), never the store's
	expect(html).toContain(
		`src="https://sellrika.test/uploads/${A}/extensions/a.webp"`,
	);
	expect(html).toContain(
		`property="og:image" content="https://sellrika.test/uploads/${A}/extensions/a.webp"`,
	);

	// shop B runs the same extension, but has no note: its store has no such page
	const other = await visit("sf-two", "/notes");
	expect(other.status).toBe(404);
	expect(await other.text()).not.toContain("First note");
	// an address the extension has no page for: the theme's not-found page
	const missing = await visit("sf-one", "/notes/nothing");
	expect(missing.status).toBe(404);
	expect(await missing.text()).toContain('aria-label="Open cart"');
	// an address nobody owns, and a host that is no store: plain "not found"
	expect((await visit("sf-one", "/whatever")).status).toBe(404);
	expect((await visit("no-such-shop", "/notes")).status).toBe(404);
});

test("menu links and sitemap entries: only paths below the extension's own, per shop", async () => {
	expect(await ExtensionService.storeLinks(shopA)).toEqual([
		{ slug: "/notes", title: "Notes" },
	]);
	expect(await ExtensionService.storePaths(shopA)).toEqual([
		"/notes",
		"/notes/first",
	]);
	expect(await ExtensionService.storeLinks(shopB)).toEqual([]);
	expect(await ExtensionService.storePaths(shopB)).toEqual([]);
	// switched off for the shop: its pages, links and entries are gone
	await ExtensionService.save(A, "notes", { enabled: false });
	expect(await ExtensionService.storeOwner(shopA, "notes")).toBeNull();
	expect(await ExtensionService.storeLinks(shopA)).toEqual([]);
	expect((await visit("sf-one", "/notes")).status).toBe(404);
	await ExtensionService.save(A, "notes", { enabled: true });
});

test("a picture an extension's data names counts as used; html.clean cleans", async () => {
	const url = `/uploads/${A}/extensions/a.webp`;
	expect(await UploadRepository.inUse(url)).toBe(true);
	expect(await UploadRepository.inUse(`/uploads/${A}/extensions/b.webp`)).toBe(
		false,
	);
	const handles = Container.get(_ExtensionHandles).for(A);
	expect(
		await handles.html.clean(
			'<p onclick="x()">Hi</p><iframe src="x"></iframe>',
		),
	).toBe("<p>Hi</p>");
	// a path of another shop is never looked at
	await handles.uploads.drop([`/uploads/${B}/extensions/z.webp`, url]);
	expect(await UploadRepository.inUse(url)).toBe(true);
});
