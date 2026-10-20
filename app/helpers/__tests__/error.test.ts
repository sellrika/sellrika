import { expect, test } from "bun:test";
import { messageOf } from "@helpers/error";

test("messageOf: an Error gives its message", () => {
	expect(messageOf(new Error("boom"), "fallback")).toBe("boom");
});

test("messageOf: anything else gives the fallback", () => {
	expect(messageOf("oops", "fallback")).toBe("fallback");
});

test("messageOf: no fallback gives the value as text", () => {
	expect(messageOf("oops")).toBe("oops");
	expect(messageOf(42)).toBe("42");
});
