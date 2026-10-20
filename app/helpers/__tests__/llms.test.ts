import { expect, test } from "bun:test";
import { llmsTxt } from "@helpers/llms";

const shop = {
	name: "Tea & Co",
	url: "https://tea.test",
	currency: "USD",
	description: "Shop online at Tea & Co.",
};

test("llms.txt lists the products and the pages as Markdown", () => {
	const text = llmsTxt(
		shop,
		[
			{ name: "Green [tea]", slug: "green-tea", price: 1800, sold_out: false },
			{ name: "Mug", slug: "mug", price: 1823, sold_out: true },
		],
		[{ slug: "about", title: "About us" }],
	);
	expect(text).toBe(
		[
			"# Tea & Co",
			"",
			"> Shop online at Tea & Co.",
			"",
			"## Products",
			"",
			// shown money drops ".00"; a bracket is escaped
			"- [Green \\[tea\\]](https://tea.test/p/green-tea): $18, in stock",
			"- [Mug](https://tea.test/p/mug): $18.23, sold out",
			"",
			"## Pages",
			"",
			"- [About us](https://tea.test/pages/about)",
			"",
		].join("\n"),
	);
});

test("llms.txt with no custom pages has no Pages section", () => {
	const text = llmsTxt(shop, [], []);
	expect(text).toContain("## Products");
	expect(text).not.toContain("## Pages");
});
