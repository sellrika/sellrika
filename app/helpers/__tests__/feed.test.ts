import { expect, test } from "bun:test";
import { type FeedProduct, productFeed } from "@helpers/feed";

const shop = { name: "Tea & Co", url: "https://tea.test", currency: "USD" };

/**
 * A feed product with the given fields changed.
 * @param over The fields to change.
 * @returns The product.
 */
function product(over: Partial<FeedProduct> = {}): FeedProduct {
	return {
		id: 7,
		name: "Green <tea>",
		slug: "green-tea",
		description: "<p>Fresh &amp; light</p>",
		price: 1800,
		original_price: null,
		images: ["/uploads/1/products/a.webp", "https://cdn.test/b.webp"],
		sold_out: false,
		...over,
	};
}

test("a product becomes one item with Google's tags", () => {
	const xml = productFeed(shop, [product()]);
	expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
	expect(xml).toContain("<title>Tea &amp; Co</title>");
	expect(xml).toContain("<g:id>7</g:id>");
	expect(xml).toContain("<g:title>Green &lt;tea&gt;</g:title>");
	expect(xml).toContain("<g:description>Fresh &amp; light</g:description>");
	expect(xml).toContain("<g:link>https://tea.test/p/green-tea</g:link>");
	expect(xml).toContain(
		"<g:image_link>https://tea.test/uploads/1/products/a.webp</g:image_link>",
	);
	expect(xml).toContain(
		"<g:additional_image_link>https://cdn.test/b.webp</g:additional_image_link>",
	);
	expect(xml).toContain("<g:availability>in_stock</g:availability>");
	expect(xml).toContain("<g:price>18.00 USD</g:price>");
	expect(xml).not.toContain("g:sale_price");
	expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
});

test("a reduced, sold-out, branded product", () => {
	const reduced = product({
		original_price: 2500,
		sold_out: true,
		brand: "Acme",
	});
	const xml = productFeed(shop, [reduced]);
	expect(xml).toContain("<g:price>25.00 USD</g:price>");
	expect(xml).toContain("<g:sale_price>18.00 USD</g:sale_price>");
	expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
	expect(xml).toContain("<g:brand>Acme</g:brand>");
	expect(xml).not.toContain("identifier_exists");
});

test("a product with no picture is left out, no description falls back to the name", () => {
	const xml = productFeed(shop, [
		product({ images: [] }),
		product({ id: 8, description: "" }),
	]);
	expect(xml.match(/<item>/g)?.length).toBe(1);
	expect(xml).toContain("<g:id>8</g:id>");
	expect(xml).toContain("<g:description>Green &lt;tea&gt;</g:description>");
});
