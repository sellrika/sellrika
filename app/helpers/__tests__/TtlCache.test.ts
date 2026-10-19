import { expect, test } from "bun:test";
import { TtlCache } from "@helpers/TtlCache";

test("TtlCache: keeps a value until it gets old", async () => {
	const cache = new TtlCache<number, number>(20);
	let loads = 0;
	const load = async () => ++loads;
	expect(await cache.get(1, load)).toBe(1);
	expect(await cache.get(1, load)).toBe(1); // kept
	expect(await cache.get(2, load)).toBe(2); // other key, own value
	await Bun.sleep(30);
	expect(await cache.get(1, load)).toBe(3); // too old, read again
});

test("TtlCache: delete makes the next get read again", async () => {
	const cache = new TtlCache<string, number>(60_000);
	let loads = 0;
	const load = async () => ++loads;
	await cache.get("a", load);
	cache.delete("a");
	expect(await cache.get("a", load)).toBe(2);
});

test("TtlCache: a read that started before a delete is not kept", async () => {
	const cache = new TtlCache<string, string>(60_000);
	const { promise, resolve } = Promise.withResolvers<string>();
	const slow = cache.get("a", () => promise);
	cache.delete("a"); // the value changed while we read
	resolve("old");
	expect(await slow).toBe("old");
	expect(await cache.get("a", async () => "new")).toBe("new");
});
