import { expect, test } from "bun:test";
import { edge } from "@xcore/view/Edge";
import { StoreView } from "@xcore/view/StoreView";
import type {
	ActiveTheme,
	StorePageName,
} from "@services/sales/StoreView.Service";
import { STORE_THEME_PAGES } from "@constants/Store.Constant";
import aurora from "../../../../extensions/aurora/i18n/en";
import { EVIL, PAGES, render } from "./fixtures";

/**
 * The aurora folder in the repo.
 */
const DIR = `${process.cwd()}/extensions/aurora`;

/**
 * Aurora as the storefront's theme, templates registered from the repo.
 * @returns The theme.
 */
async function auroraTheme(): Promise<ActiveTheme> {
	const views = await StoreView.useExtensionTheme("aurora", `${DIR}/views`);
	return {
		name: "ext:aurora",
		views,
		layout: `${views}/layout`,
		css: "/store/tea/ext/aurora/assets/theme.css?v=2.0.0",
		script: "/store/tea/ext/aurora/assets/script.js?v=2.0.0",
		assets: "/store/tea/ext/aurora/assets",
		config: { accent: "#e07a20", hero_title: "", hero_off: false },
		scheme: "light",
		featured: 6,
		strings: aurora as Record<string, string>,
	};
}

test("aurora ships every page a theme must draw", async () => {
	for (const page of STORE_THEME_PAGES)
		expect(await Bun.file(`${DIR}/views/${page}.edge`).exists()).toBe(true);
});

test("every aurora page renders inside its own layout, text escaped", async () => {
	const theme = await auroraTheme();
	for (const page of Object.keys(PAGES) as StorePageName[]) {
		const html = await render(theme, page);
		// the shell and header come from aurora's layout, on every page
		expect(html).toContain('class="aurora-shell"');
		expect(html).toContain('class="aurora-bar"');
		// its own word for the cart, over the app's
		expect(html).toContain('aria-label="Open bag"');
		expect(html).toContain("/store/tea/ext/aurora/assets/theme.css?v=2.0.0");
		expect(html).toContain("/store/tea/ext/aurora/assets/script.js?v=2.0.0");
		// the shop's colour, on :root
		expect(html).toContain("--aurora-accent: #e07a20;");
		expect(html).not.toContain(EVIL);
	}
});

test("the aurora catalog: hero from its own words, featured rail, cards", async () => {
	const html = await render(await auroraTheme(), "home");
	expect(html).toContain("Everything for a good morning");
	expect(html).toContain('src="/store/tea/ext/aurora/assets/hero.svg"');
	expect(html).toContain('class="aurora-rail"');
	expect(html).toContain('data-product="1"');
	expect(html).toContain('data-add="1"');
	expect(html).toContain("25% off");
	expect(html).toContain('href="/store/tea?page=2"');
	expect(html).toContain("Green &amp; fresh"); // decoded once, escaped once
});

test("a theme that throws while rendering falls back to Classic", async () => {
	edge.registerTemplate("ext/broken/layout", {
		template: "{{ nothing.here.at.all }}",
	});
	edge.registerTemplate("ext/broken/home", {
		template: "@component(theme.layout)\n@end",
	});
	const broken: ActiveTheme = {
		...(await auroraTheme()),
		name: "ext:broken",
		views: "ext/broken",
		layout: "ext/broken/layout",
	};
	const html = await render(broken, "home");
	expect(html).not.toContain("aurora-shell");
	expect(html).toContain('data-cart-open aria-label="Open cart"');
});
