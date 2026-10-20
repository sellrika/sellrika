import { formatMoney } from "@helpers/currency";

/**
 * What llms.txt needs to know of one product.
 * The storefront's public product fits it.
 */
export type LlmsProduct = {
	name: string;
	slug: string;
	/** In cents. */
	price: number;
	sold_out: boolean;
};

/**
 * The shop an llms.txt belongs to.
 */
export type LlmsShop = {
	name: string;
	/** Absolute address of the store, no `/` at the end. */
	url: string;
	currency: string;
	/** One short line about the shop. */
	description: string;
};

/**
 * Text made safe for the label of a Markdown link.
 * A bracket in a name would end the label early.
 * @param text The raw text.
 * @returns The text with its brackets escaped.
 */
function label(text: string) {
	return text.replace(/[[\]\\]/g, "\\$&").replace(/\s+/g, " ");
}

/**
 * A shop's store as an llms.txt file.
 * It is Markdown, as the llms.txt convention asks:
 * the shop name, a short line, then the products and the pages.
 * It never carries costs: only the public price.
 * @param shop The selling shop.
 * @param products The shop's public products.
 * @param pages The shop's custom pages.
 * @returns The Markdown text.
 */
export function llmsTxt(
	shop: LlmsShop,
	products: LlmsProduct[],
	pages: { slug: string; title: string }[],
) {
	const lines = [`# ${shop.name}`, "", `> ${shop.description}`, ""];
	lines.push("## Products", "");
	for (const p of products) {
		const price = formatMoney(p.price, shop.currency, "en");
		const stock = p.sold_out ? "sold out" : "in stock";
		lines.push(
			`- [${label(p.name)}](${shop.url}/p/${p.slug}): ${price}, ${stock}`,
		);
	}
	if (pages.length) {
		lines.push("", "## Pages", "");
		for (const p of pages)
			lines.push(`- [${label(p.title)}](${shop.url}/pages/${p.slug})`);
	}
	return `${lines.join("\n")}\n`;
}
