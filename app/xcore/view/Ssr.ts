import { app } from "@config/app";
import { Hooks } from "@xcore/hooks/Hooks";

/**
 * Server-side rendering of the app's public Inertia pages.
 * The pages are Vue components, so Vite bundles them for the server
 * (`resources/js/ssr.ts` → `build/ssr/ssr.js`).
 * This file loads that bundle once and asks it for the HTML of a page.
 * It never breaks a page.
 * With no bundle, or when a render fails,
 * the browser renders the page as before.
 */

/** `render()` of the bundle. */
type Render = (page: unknown) => Promise<string>;

/**
 * Server-side rendering of the app's public Inertia pages.
 */
export class Ssr {
	/**
	 * The bundle, loaded on the first render.
	 * null = none on disk, or it did not load.
	 */
	static #bundle: Promise<Render | null> | null = null;

	/**
	 * The HTML of a page, rendered on the server.
	 * @param page The Inertia page: component, props, url, version.
	 * @returns The HTML for inside `<div id="app">`.
	 *   Null when the browser has to render the page.
	 */
	static async render(page: { component: string }): Promise<string | null> {
		if (!Hooks.ssrPages.includes(page.component)) return null;
		Ssr.#bundle ??= Ssr.#load();
		const render = await Ssr.#bundle;
		if (!render) return null;
		try {
			return await render(page);
		} catch (error) {
			console.error(`[ssr] ${page.component} did not render`, error);
			return null;
		}
	}

	/**
	 * Load the bundle from disk.
	 * In dev there is none on purpose.
	 * Vite serves the source, so a built bundle would be older than the page.
	 * @returns `render()` of the bundle, or null.
	 */
	static async #load(): Promise<Render | null> {
		if (!app.isProd) return null;
		try {
			if (!(await Bun.file(app.ssrBundle).exists())) {
				console.warn(
					`[ssr] ${app.ssrBundle} is missing — public pages are rendered in the browser only (run \`bun run build\`)`,
				);
				return null;
			}
			const m = await import(Bun.pathToFileURL(app.ssrBundle).href);
			return m.render as Render;
		} catch (error) {
			console.error("[ssr] the bundle did not load", error);
			return null;
		}
	}
}
