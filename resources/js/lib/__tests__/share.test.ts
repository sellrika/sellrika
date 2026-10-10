import { expect, test } from "bun:test";
import { productUrl, shareTargets, tagged } from "../share";

const shop = { online_enabled: true, slug: "cafe" };

test("the product link is <store address>/p/<product>", () => {
	expect(productUrl(shop, "flat-white", "https://cafe.shop.sellrika.com")).toBe(
		"https://cafe.shop.sellrika.com/p/flat-white",
	);
	expect(productUrl(shop, "flat-white", "https://cafe.com")).toBe(
		"https://cafe.com/p/flat-white",
	);
});

test("no link while the online store is off or has no slug", () => {
	expect(
		productUrl({ ...shop, online_enabled: false }, "a", "https://x"),
	).toBeNull();
	expect(productUrl({ ...shop, slug: null }, "a", "https://x")).toBeNull();
	expect(productUrl(shop, "a", null)).toBeNull();
});

test("tagged adds the utm source and medium", () => {
	const u = new URL(tagged("https://pos.test/store/cafe/p/a", "facebook"));
	expect(u.searchParams.get("utm_source")).toBe("facebook");
	expect(u.searchParams.get("utm_medium")).toBe("social");
});

test("every network gets its own tagged link and the product name", () => {
	const url = "https://pos.test/store/cafe/p/a";
	const targets = shareTargets(url, "Flat & White");
	expect(targets.map((s) => s.name)).toEqual([
		"Facebook",
		"X",
		"WhatsApp",
		"Telegram",
		"LINE",
		"Viber",
	]);
	for (const s of targets) {
		const source = s.name.toLowerCase();
		expect(decodeURIComponent(s.url)).toContain(`utm_source=${source}`);
	}
	const x = targets.find((s) => s.name === "X")?.url ?? "";
	expect(new URL(x).searchParams.get("text")).toBe("Flat & White");
});
