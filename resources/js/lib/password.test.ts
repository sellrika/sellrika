import { expect, test } from "bun:test";
import { randomPassword } from "./password";

test("randomPassword: 8 readable characters, different every time", () => {
	const seen = new Set<string>();
	for (let i = 0; i < 200; i++) {
		const p = randomPassword();
		expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{8}$/);
		seen.add(p);
	}
	expect(seen.size).toBe(200);
	expect(randomPassword(12)).toHaveLength(12);
});
