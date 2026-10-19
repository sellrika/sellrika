import { expect, test } from "bun:test";
import { catalogChanged, catalogVersion } from "@helpers/catalogVersion";

test("catalogVersion: a shop starts at 0", () => {
	expect(catalogVersion(990001)).toBe(0);
});

test("catalogChanged: each change adds one", () => {
	catalogChanged(990002);
	expect(catalogVersion(990002)).toBe(1);
	catalogChanged(990002);
	expect(catalogVersion(990002)).toBe(2);
});

test("catalogChanged: other shops keep their own number", () => {
	catalogChanged(990003);
	expect(catalogVersion(990003)).toBe(1);
	expect(catalogVersion(990004)).toBe(0);
});
