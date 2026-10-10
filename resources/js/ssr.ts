import { createInertiaApp, usePage } from "@inertiajs/vue3";
import { extend, type Locale, translate } from "@i18n";
import type { Page } from "@inertiajs/core";
import { createSSRApp, type DefineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { type PageProps, useDictionary } from "@/lib/i18n";

/**
 * The server side of the public pages an add-on brings (`cloud/`, see `app/cloud.ts`):
 * the front page and the pricing page of the hosted edition.
 * The source-available app has none, so its bundle renders nothing.
 * `bun run build` bundles this file to `build/ssr/ssr.js`.
 * The Bun server loads the bundle and calls `render()` (`app/xcore/view/Ssr.ts`),
 * so the HTML holds the real text for search engines, and the browser takes the page over.
 */

// eager: one file, nothing to load while a request waits.
// Only the public pages: a staff page needs a session, so no crawler sees it.
const pages = import.meta.glob<DefineComponent>(
	"../../cloud/resources/js/Pages/Home/*.vue",
	{ eager: true, import: "default" },
);

// the add-on's own words join the app's dictionary of this bundle
const cloudWords = import.meta.glob<Record<string, Record<string, string>>>(
	["../../cloud/i18n/*.ts", "!../../cloud/i18n/index.ts"],
	{ eager: true },
);
for (const file of Object.values(cloudWords))
	for (const [locale, words] of Object.entries(file))
		extend(locale as Locale, words);

useDictionary(translate, function pageProps() {
	return usePage().props as PageProps;
});

/**
 * Render one page, alone.
 * @param page The Inertia page: component, props, url, version.
 * @returns The HTML that goes inside `<div id="app">`.
 */
async function renderOne(page: Page): Promise<string> {
	let html = "";
	await createInertiaApp({
		page,
		resolve: function resolve(name) {
			const found = pages[`../../cloud/resources/js/Pages/${name}.vue`];
			if (!found) throw new Error(`No server-rendered page "${name}"`);
			return found;
		},
		setup: function setup({ App, props, plugin }) {
			return createSSRApp({ render: () => h(App, props) }).use(plugin);
		},
		// Inertia wraps the HTML in its own tags; the server writes those itself, so keep the inner part
		render: async function capture(app) {
			html = await renderToString(app);
			return html;
		},
	});
	return html;
}

/** The render that runs now, or the last one that ran. */
let last: Promise<unknown> = Promise.resolve();

/**
 * Render a page to HTML.
 * ponytail: one render at a time. Inertia keeps the current page in one place for the whole process,
 * so two renders at once could read each other's language or user. A render takes a few milliseconds;
 * cache the HTML per language for guests if the front page ever needs more.
 * @param page The Inertia page: component, props, url, version.
 * @returns The HTML that goes inside `<div id="app">`.
 */
export function render(page: Page): Promise<string> {
	const next = last.then(function run() {
		return renderOne(page);
	});
	last = next.catch(function ignore() {});
	return next;
}
