import { expect, test } from "bun:test";
import { edge } from "@xcore/view/Edge";
import { safeJson, StoreView } from "@xcore/view/StoreView";

/**
 * A tiny theme: a layout with a main slot, and a home page that
 * prints the products' names.
 */
edge.registerTemplate("themes/fake/layout", {
	template: `<header>{{ store.name }}</header>
<main>{{{ await $slots.main() }}}</main>`,
});
edge.registerTemplate("themes/fake/home", {
	template: `@component(theme.layout, { search: true })
@each(p in catalog.data)
<p class="name">{{ p.name }}</p>
<p class="price">{{ price(p.price) }}</p>
@end
@end`,
});

const EVIL = "<img src=x onerror=1>";

/**
 * The shared variables, by hand: the view service builds the real ones.
 * @returns A context for `StoreView.render`.
 */
function context() {
	return {
		store: { name: "Tea & Co", slug: "tea", base: "" },
		theme: {
			name: "fake",
			layout: "themes/fake/layout",
			assets: "",
			config: {},
			scheme: "light",
			featured: 0,
		},
		pageName: "home",
		locale: "en",
		t: function t(key: string) {
			return key;
		},
		price: function price(cents: number) {
			return `$${cents / 100}`;
		},
	};
}

/**
 * The document's own variables.
 * @param noindex Whether the page asks search engines to skip it.
 * @returns The props for `StoreView.render`.
 */
function props(noindex = false) {
	const product = { id: 1, name: EVIL, price: 1800 };
	return {
		catalog: { data: [product] },
		seo: {
			title: `${EVIL} · Tea & Co`,
			description: "Fine tea",
			url: "https://shop.test/store/tea",
			type: "website",
			image: null,
			noindex,
			verification: null,
			meta: [],
			ld: { "@type": "Product", name: `</script>${EVIL}` },
			ga: "G-TEST1",
			pixel: null,
			icon: "/logo.png",
		},
		assets: { css: "", js: "" },
		island: {
			store: { name: "Tea & Co" },
			locale: "en",
			strings: {},
			products: [product],
			page: "home",
		},
	};
}

/**
 * Render the fake home page to text.
 * @param noindex Whether to ask for noindex.
 * @returns The response and its HTML.
 */
async function render(noindex = false) {
	const res = await StoreView.render(
		"themes/fake/home",
		context(),
		props(noindex),
	);
	return { res, html: await res.text() };
}

test("the document prints the head, the page inside the theme layout, and the scripts", async () => {
	const { res, html } = await render();
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toContain("text/html");
	expect(html).toStartWith("<!DOCTYPE html>");
	expect(html).toContain(
		"<title>&lt;img src=x onerror=1&gt; · Tea &amp; Co</title>",
	);
	expect(html).toContain(
		'<link rel="canonical" href="https://shop.test/store/tea">',
	);
	expect(html).toContain("<header>Tea &amp; Co</header>");
	expect(html).toContain('<p class="price">$18</p>');
	expect(html).toContain('gtag("config","G-TEST1")');
	expect(html).not.toContain("send_page_view");
	expect(html).not.toContain('content="noindex"');
});

test("the data island is valid JSON with no raw <", async () => {
	const { html } = await render();
	const m = html.match(
		/<script type="application\/json" id="store-data">(.*?)<\/script>/s,
	);
	expect(m).not.toBeNull();
	expect(m![1]).not.toContain("<");
	const data = JSON.parse(m![1]!);
	expect(data.products[0].name).toBe(EVIL);
	expect(data.page).toBe("home");
});

test("JSON-LD cannot close its script tag", async () => {
	const { html } = await render();
	const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
	expect(m).not.toBeNull();
	expect(m![1]).not.toContain("<");
	expect(JSON.parse(m![1]!).name).toBe(`</script>${EVIL}`);
});

test("noindex is printed only when asked", async () => {
	const { html } = await render(true);
	expect(html).toContain('<meta name="robots" content="noindex">');
});

test("a product name with HTML is printed escaped", async () => {
	const { html } = await render();
	expect(html).not.toContain(EVIL);
	expect(html).toContain('<p class="name">&lt;img src=x onerror=1&gt;</p>');
});

test("safeJson escapes < and prints null for undefined", () => {
	expect(safeJson({ a: "</script>" })).toBe('{"a":"\\u003c/script>"}');
	expect(safeJson(undefined)).toBe("null");
});
