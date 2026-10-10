import { expect, test } from "bun:test";
import { zip } from "@helpers/zip";
import { ExtensionFiles } from "@xcore/extensions/ExtensionFiles";

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
