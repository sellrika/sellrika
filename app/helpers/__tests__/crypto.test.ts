import { expect, test } from "bun:test";
import {
	decrypt,
	encrypt,
	normalizeReference,
	orderReference,
} from "@helpers/crypto";
import { slugify } from "@helpers/slug";

test("encrypt/decrypt roundtrip; tampering and missing APP_KEY fail loudly", () => {
	const prev = process.env.APP_KEY;
	process.env.APP_KEY = "unit-test-key";
	try {
		const box = encrypt("sk_test_abc123");
		expect(box.startsWith("v1.")).toBe(true);
		expect(box).not.toContain("sk_test_abc123");
		expect(decrypt(box)).toBe("sk_test_abc123");
		expect(encrypt("sk_test_abc123")).not.toBe(box); // fresh IV every time
		const [v, iv, tag, data] = box.split(".");
		expect(() =>
			decrypt([v, iv, tag, `${data!.slice(0, -4)}AAAA`].join(".")),
		).toThrow(); // GCM auth catches tampering
		expect(() => decrypt("garbage")).toThrow(/Unrecognized/);
		delete process.env.APP_KEY;
		expect(() => encrypt("x")).toThrow(/APP_KEY/);
		expect(() => decrypt(box)).toThrow(/APP_KEY/);
	} finally {
		if (prev !== undefined) process.env.APP_KEY = prev;
		else delete process.env.APP_KEY;
	}
});

test("slugify", () => {
	expect(slugify("Corner Coffee!")).toBe("corner-coffee");
	expect(slugify("Café Zürich")).toBe("cafe-zurich");
	expect(slugify("店")).toBe(""); // caller must fall back
});

test("order codes: 12 random symbols without look-alikes, normalised from whatever the buyer types; older 16-symbol codes still normalise", () => {
	const codes = Array.from({ length: 200 }, orderReference);
	for (const c of codes)
		expect(c).toMatch(/^(?:[A-HJ-NP-Z2-9]{4}-){2}[A-HJ-NP-Z2-9]{4}$/); // no I, O, 0, 1
	expect(new Set(codes).size).toBe(200);
	expect(normalizeReference(" p8j4mjsq4z8t ")).toBe("P8J4-MJSQ-4Z8T");
	expect(normalizeReference("P8J4-MJSQ-4Z8T")).toBe("P8J4-MJSQ-4Z8T");
	expect(normalizeReference("k7qx-4mzp-3rjt-8hvw")).toBe("K7QX-4MZP-3RJT-8HVW"); // an order from before the codes got shorter
	expect(normalizeReference("p8j4-mjsq-4z8")).toBeNull(); // too short
	expect(normalizeReference("P8J4-MJSQ-4Z8T-X")).toBeNull(); // neither length
	expect(normalizeReference("P8J4-MJSQ-4Z80")).toBeNull(); // 0 is not in the alphabet
	expect(normalizeReference("1042")).toBeNull(); // an id is not a code
});
