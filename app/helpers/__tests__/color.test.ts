import { expect, test } from "bun:test";
import { HEX_COLOR, onColor } from "@helpers/color";

test("onColor: black on a light background, white on a dark one", () => {
	expect(onColor("#ffffff")).toBe("#000000");
	expect(onColor("#ffeb3b")).toBe("#000000"); // yellow
	expect(onColor("#000000")).toBe("#ffffff");
	expect(onColor("#1e3a8a")).toBe("#ffffff"); // dark blue
});

test("HEX_COLOR: only #rrggbb in lower case", () => {
	expect(HEX_COLOR.test("#a1b2c3")).toBe(true);
	expect(HEX_COLOR.test("#A1B2C3")).toBe(false);
	expect(HEX_COLOR.test("#abc")).toBe(false);
	expect(HEX_COLOR.test("red")).toBe(false);
	expect(HEX_COLOR.test("#a1b2c3;}")).toBe(false);
});
