import { app } from "@config/app";
import { safeJson } from "@helpers/json";
import { HttpResponse } from "@xcore/http/Response";
import { edge } from "@xcore/view/Edge";
import shared from "@resources/views/store/index.ts";
import themes from "@resources/views/themes/index.ts";

/**
 * The Edge templates of the online store, and the page renderer.
 */
export class StoreView {
	/**
	 * The extension themes registered so far, by extension key.
	 * `at` = the newest file time (dev only), so an edit is picked up.
	 */
	static #extensionThemes = new Map<
		string,
		{ dir: string; at: number; names: string[] }
	>();

	/** Register the built-in templates once, when the module loads. */
	static {
		StoreView.#registerAll("store", shared);
		for (const [name, files] of Object.entries(themes))
			StoreView.#registerAll(`themes/${name}`, files);
	}

	/**
	 * Register an extension theme's templates.
	 * That is every `**\/*.edge` of its views folder,
	 * as `ext/<key>/<file>` (the path without ".edge").
	 * Done once per folder.
	 * An update (a new upload folder) or, in dev, a changed file
	 * registers them again.
	 * @param key The extension key.
	 * @param dir The theme's views folder (manifest `theme.views`), absolute.
	 * @returns The template prefix, `ext/<key>`.
	 */
	static async useExtensionTheme(key: string, dir: string): Promise<string> {
		const prefix = `ext/${key}`;
		const hit = StoreView.#extensionThemes.get(key);
		if (app.isProd && hit?.dir === dir) return prefix;
		const files = await Array.fromAsync(
			new Bun.Glob("**/*.edge").scan({ cwd: dir }),
		);
		let at = 0;
		for (const f of files)
			at = Math.max(at, Bun.file(`${dir}/${f}`).lastModified);
		if (hit?.dir === dir && hit.at === at) return prefix;
		for (const name of hit?.names ?? []) edge.removeTemplate(name);
		const names: string[] = [];
		for (const f of files) {
			const name = `${prefix}/${f.replace(/\.edge$/, "")}`;
			edge.registerTemplate(name, {
				template: await Bun.file(`${dir}/${f}`).text(),
			});
			names.push(name);
		}
		StoreView.#extensionThemes.set(key, { dir, at, names });
		return prefix;
	}

	/**
	 * Render one store page through `store/document`.
	 * @param view The page template,
	 *   e.g. `themes/classic/home` or `store/checkout`.
	 * @param context The shared variables every template sees,
	 *   the theme layout too.
	 * @param props The page's own variables, plus the document's
	 *   (`seo`, `island`, `assets`).
	 * @param status The HTTP status.
	 * @returns The HTML response.
	 */
	static async render(
		view: string,
		context: Record<string, unknown>,
		props: Record<string, unknown>,
		status = 200,
	): Promise<Response> {
		const page = await edge
			.createRenderer()
			.share(context)
			.render("store/document", { ...props, view, json: safeJson });
		return HttpResponse.html(page, status);
	}

	/**
	 * Register a folder's templates under one prefix.
	 * @param prefix For example `store` or `themes/classic`.
	 * @param files File name (with or without ".edge") → template text.
	 */
	static #registerAll(prefix: string, files: Record<string, string>) {
		for (const [file, template] of Object.entries(files))
			edge.registerTemplate(`${prefix}/${file.replace(/\.edge$/, "")}`, {
				template,
			});
	}
}

export { safeJson };
