import { expect, test } from "bun:test";
import { zip } from "@helpers/zip";
import { ExtensionFiles } from "@xcore/extensions/ExtensionFiles";
import { ExtensionLoader } from "@xcore/extensions/ExtensionLoader";

test("unpackExtension refuses names that climb out of the folder", () => {
	const manifest = { "extension.json": "{}" };
	expect(
		Object.keys(ExtensionFiles.unpack(zip({ ...manifest, "a/b.js": "" }))),
	).toEqual(["extension.json", "a/b.js"]);
	for (const bad of [
		"a\n/../../x.js",
		"../x.js",
		"/x.js",
		"a\\..\\x.js",
		"C:x.js",
	])
		expect(() =>
			ExtensionFiles.unpack(zip({ ...manifest, [bad]: "" })),
		).toThrow(/Unsafe file name/);
});

test("matchRoute: a HEAD request fits a GET route", () => {
	/**
	 * A route handler for the table.
	 * @returns Nothing.
	 */
	function handler() {
		return null;
	}
	const table = { "GET /items/:id": handler, "POST /items": handler };
	expect(ExtensionLoader.matchRoute(table, "GET", "/items/7")?.params).toEqual({
		id: "7",
	});
	expect(ExtensionLoader.matchRoute(table, "HEAD", "/items/7")?.params).toEqual(
		{
			id: "7",
		},
	);
	// HEAD never fits another method
	expect(ExtensionLoader.matchRoute(table, "HEAD", "/items")).toBeNull();
	expect(ExtensionLoader.matchRoute(table, "GET", "/items")).toBeNull();
});
