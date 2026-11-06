import { expect, test } from "bun:test";
import { EXTENSION_LIST_ROWS_MAX } from "@constants/Extension.Constant";
import { parseSetting } from "@services/settings/extensions/Extension.Field";
import type { ExtensionField } from "@validators/Extension.Validator";

/** A list of links with at most two rows. */
const links = {
	name: "menu",
	label: "Menu",
	type: "list",
	max: 2,
	fields: [{ name: "name", label: "Name", type: "text", required: true }],
} as unknown as ExtensionField;

test("a list keeps at most its own max of rows", () => {
	const row = { name: "Docs" };
	expect(parseSetting(links, [row, row])).toEqual({ value: [row, row] });
	expect(parseSetting(links, [row, row, row])).toHaveProperty("error");
});

test("a list with no max of its own keeps at most EXTENSION_LIST_ROWS_MAX rows", () => {
	const open = { ...links, max: undefined } as ExtensionField;
	const rows = Array.from({ length: EXTENSION_LIST_ROWS_MAX + 1 }, () => ({
		name: "x",
	}));
	expect(parseSetting(open, rows)).toHaveProperty("error");
	expect(parseSetting(open, rows.slice(1))).toHaveProperty("value");
});
