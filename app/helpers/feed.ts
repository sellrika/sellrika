import { stripTags } from "@helpers/html";

/**
 * The most pictures one feed item may carry next to its main one.
 * Google's limit.
 */
const EXTRA_IMAGES = 10;

/**
 * The longest title and description a feed item may carry.
 * Google's limits.
 */
const TITLE_MAX = 150;
const DESCRIPTION_MAX = 5000;

/**
 * What the feed needs to know of one product.
 * The storefront's public product fits it.
 */
export type FeedProduct = {
	id: number;
	name: string;
	slug: string;
	description: string;
	/** In cents. */
	price: number;
	/** The "was" price in cents, or null. */
	original_price: number | null;
	images: string[];
	sold_out: boolean;
	/** The product's brand, when it names one. */
	brand?: string;
};

/**
 * The shop a feed belongs to.
 */
export type FeedShop = {
	name: string;
	/** Absolute address of the store, no `/` at the end. */
	url: string;
	currency: string;
};

/**
 * Text made safe for XML.
 * @param text The raw text.
 * @returns The escaped text.
 */
function esc(text: string) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * One XML tag with text in it.
 * @param name The tag name.
 * @param text The raw text.
 * @returns The tag.
 */
function tag(name: string, text: string) {
	return `<${name}>${esc(text)}</${name}>`;
}

/**
 * Cents as a feed price.
 * @param cents The amount in cents.
 * @param currency The shop's currency code.
 * @returns For example "18.00 USD".
 */
function feedPrice(cents: number, currency: string) {
	return `${(cents / 100).toFixed(2)} ${currency}`;
}

/**
 * One product as a feed item.
 * ponytail: one item per product at its lowest price.
 * Add one item per variant (`g:item_group_id`) when a shop asks.
 * @param shop The selling shop.
 * @param p The product.
 * @returns The `<item>` tag.
 */
function feedItem(shop: FeedShop, p: FeedProduct) {
	const origin = new URL(shop.url).origin;
	const images = p.images.map((i) => (i.startsWith("http") ? i : origin + i));
	const plain = stripTags(p.description).replace(/\s+/g, " ").trim();
	const sale = p.original_price !== null;
	const lines = [
		tag("g:id", String(p.id)),
		tag("g:title", p.name.slice(0, TITLE_MAX)),
		tag("g:description", (plain || p.name).slice(0, DESCRIPTION_MAX)),
		tag("g:link", `${shop.url}/p/${p.slug}`),
		tag("g:image_link", images[0] ?? ""),
		...images
			.slice(1, EXTRA_IMAGES + 1)
			.map((i) => tag("g:additional_image_link", i)),
		tag("g:availability", p.sold_out ? "out_of_stock" : "in_stock"),
		tag("g:price", feedPrice(p.original_price ?? p.price, shop.currency)),
		...(sale ? [tag("g:sale_price", feedPrice(p.price, shop.currency))] : []),
		tag("g:condition", "new"),
		// no barcode in the public product, so say there is none
		p.brand ? tag("g:brand", p.brand) : tag("g:identifier_exists", "no"),
	];
	return `<item>\n${lines.join("\n")}\n</item>`;
}

/**
 * A shop's products as a product feed.
 * The format is RSS 2.0 with Google's `g:` tags.
 * Google Merchant Center, Facebook / Instagram and TikTok read it.
 * A product with no picture is left out: all three refuse it.
 * @param shop The selling shop.
 * @param products The shop's public products.
 * @returns The XML document, without its `<?xml?>` line.
 */
export function productFeed(shop: FeedShop, products: FeedProduct[]) {
	const items = [];
	for (const p of products) if (p.images.length) items.push(feedItem(shop, p));
	return [
		`<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`,
		"<channel>",
		tag("title", shop.name),
		tag("link", shop.url),
		tag("description", shop.name),
		...items,
		"</channel>",
		"</rss>",
	].join("\n");
}
