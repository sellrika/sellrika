import { expect, test } from "bun:test";
import type { StorePageName } from "@services/sales/StoreView.Service";
import { StoreViewService } from "@services/sales/StoreView.Service";
import { STORE_TEMPLATES, STORE_THEME_PAGES } from "@constants/Store.Constant";
import themes from "@resources/views/themes/index.ts";
import { EVIL, PAGES, render, view } from "./fixtures";

/*
 * Every built-in theme draws every store page (docs/features/store-themes.md).
 * A page that is missing, throws, or prints a product name unescaped fails here.
 */

test("every built-in theme has every page a theme must draw", () => {
	for (const name of STORE_TEMPLATES)
		for (const page of STORE_THEME_PAGES)
			expect(themes[name]?.[page], `${name}/${page}.edge`).toBeString();
});

for (const name of STORE_TEMPLATES) {
	test(`${name}: every page renders inside its own layout, text escaped`, async () => {
		const theme = await view.builtin(name);
		for (const page of Object.keys(PAGES) as StorePageName[]) {
			const html = await render(theme, page);
			// the shared document: head, data island, and the theme's cart button
			expect(html, `${name}/${page}`).toContain("<title>");
			expect(html, `${name}/${page}`).toContain('id="store-data"');
			expect(html, `${name}/${page}`).toContain('aria-label="Open cart"');
			expect(html, `${name}/${page}`).not.toContain(EVIL);
		}
	});

	test(`${name}: the catalog shows the products, prices and paging`, async () => {
		const html = await render(await view.builtin(name), "home");
		expect(html).toContain('href="/store/tea/p/tea-1"');
		expect(html).toContain("$18");
		expect(html).toContain('href="/store/tea?page=2"');
	});

	test(`${name}: checkout and done mount the shared island`, async () => {
		const theme = await view.builtin(name);
		expect(await render(theme, "checkout")).toContain('id="store-checkout"');
		expect(await render(theme, "done")).toContain('id="store-done"');
	});
}

test("the shop's own look: its colours and font are printed after the theme's stylesheet", async () => {
	const theme = await view.builtin("classic", {
		primary: "#ffee00",
		secondary: "#101010",
		font: "georgia",
	});
	const html = await render(theme, "home");
	// black text on the light primary, white on the dark secondary
	expect(html).toContain(
		"<style>:root{--store-accent:#ffee00;--store-on-accent:#000000;--theme-secondary:#101010;--theme-on-secondary:#ffffff;--store-font:Georgia, ui-serif,ui-sans-serif,system-ui,sans-serif;--store-font-heading:var(--store-font)}</style>",
	);
	expect(html).toMatch(
		/<html lang="en" class="[^"]*theme-primary theme-secondary"/,
	);
	expect(html).not.toContain("store-fonts"); // Georgia is on every device: no font file
	expect(
		(
			await view.builtin("classic", {
				primary: "",
				secondary: "",
				font: "archivo",
			})
		).look?.font,
	).toContain("archivo");
});

test("the shop's own look: a stored value that is not a colour or a known font is never printed", () => {
	expect(
		StoreViewService.lookStyle({
			primary: "red}</style><script>",
			secondary: "#12345",
			font: "constructor",
		}),
	).toBeNull();
	expect(StoreViewService.lookStyle(undefined)).toBeNull();
	expect(
		StoreViewService.lookStyle({ primary: "", secondary: "#000000", font: "" }),
	).toEqual({
		style: ":root{--theme-secondary:#000000;--theme-on-secondary:#ffffff}",
		classes: "theme-secondary",
		font: null,
	});
});

test("the shop's own look: background and footer; a theme that follows the device keeps its dark page", () => {
	const look = {
		primary: "",
		secondary: "",
		background: "#fafafa",
		footer: "#002244",
		font: "",
	};
	expect(StoreViewService.lookStyle(look, "light")).toEqual({
		style:
			":root{--theme-footer:#002244;--theme-on-footer:#ffffff}:root{--store-bg:#fafafa}",
		classes: "theme-footer theme-footer-text theme-background",
		font: null,
	});
	// Minimal: the background is for the light look only
	expect(StoreViewService.lookStyle(look, "auto")?.style).toEndWith(
		":root:not(.dark){--store-bg:#fafafa}",
	);
	expect(
		StoreViewService.lookStyle({ ...look, footer: "", background: "url(x)" }),
	).toBeNull();
	// the shop's own text colours: the page's, and the footer's even with no footer background
	expect(
		StoreViewService.lookStyle({
			...look,
			background: "",
			footer: "",
			text: "#333333",
			footer_text: "#ffcc00",
		}),
	).toEqual({
		style:
			":root{--theme-on-footer:#ffcc00}:root{--store-fg:#333333;--store-muted:color-mix(in srgb,#333333 65%,transparent)}",
		classes: "theme-footer-text",
		font: null,
	});
	// the small text: the shop's own wins over the softer shade of the text
	expect(
		StoreViewService.lookStyle({
			...look,
			background: "",
			footer: "",
			text: "#333333",
			muted: "#777777",
		})?.style,
	).toBe(":root{--store-fg:#333333;--store-muted:#777777}");
	// cards: their colour, and black text on it when the shop picked none
	expect(
		StoreViewService.lookStyle({
			...look,
			background: "",
			footer: "",
			surface: "#ffeeee",
		}),
	).toEqual({
		style: ":root{--theme-on-surface:#000000}:root{--store-surface:#ffeeee}",
		classes: "theme-surface theme-surface-text",
		font: null,
	});
	expect(
		StoreViewService.lookStyle({ ...look, footer_text: "#ffcc00" })?.style,
	).toContain("--theme-on-footer:#ffcc00"); // wins over the black-or-white pick
});
