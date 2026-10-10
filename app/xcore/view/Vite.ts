import { app } from "@config/app";

/**
 * One file of `public/build/.vite/manifest.json`.
 * `css` = the stylesheets a JS entry imports.
 */
type ManifestEntry = { file: string; css?: string[] };

/**
 * The Vite build: source paths to public URLs, and the tags of a page.
 */
export class Vite {
	/**
	 * The parsed manifest and its hash, read once in production.
	 * The hash is the Inertia asset version.
	 */
	static #manifest: {
		entries: Record<string, ManifestEntry>;
		version: string;
	} | null = null;

	/**
	 * A lookup from Vite source paths to their public URLs.
	 * Async once (the manifest), then plain calls, so templates can use it.
	 * In dev every path is served by the Vite server as is.
	 * @returns entry → URL, or null when the build does not list it.
	 */
	static async resolver(): Promise<(entry: string) => string | null> {
		if (!app.isProd)
			return function devUrl(entry: string) {
				return `${app.viteUrl}/build/${entry}`;
			};
		const { entries } = await Vite.#readManifest();
		return function builtUrl(entry: string) {
			const file = entries[entry]?.file;
			return file ? `/build/${file}` : null;
		};
	}

	/**
	 * The `<link>` and `<script>` tags for some Vite entries.
	 * A stylesheet entry becomes a `<link>`, a script entry a module script
	 * (plus a `<link>` per stylesheet it imports, in production).
	 * An entry that is not built (or not on disk in dev) is skipped,
	 * so a page still renders while a file is missing.
	 * @param entries Source paths, like `resources/js/app.ts`.
	 * @returns `css` and `js` tags, and the asset version ("dev" in dev).
	 */
	static async tags(entries: string[]) {
		const css: string[] = [];
		const js: string[] = [];
		if (!app.isProd) {
			js.push(
				`<script type="module" src="${app.viteUrl}/build/@vite/client"></script>`,
			);
			for (const entry of entries) {
				if (!(await Bun.file(entry).exists())) continue;
				const src = `${app.viteUrl}/build/${entry}`;
				if (entry.endsWith(".css"))
					css.push(`<link rel="stylesheet" href="${src}">`);
				else js.push(`<script type="module" src="${src}"></script>`);
			}
			return { css: css.join("\n"), js: js.join("\n"), version: "dev" };
		}
		const { entries: built, version } = await Vite.#readManifest();
		for (const entry of entries) {
			const hit = built[entry];
			if (!hit) continue;
			if (entry.endsWith(".css")) {
				css.push(`<link rel="stylesheet" href="/build/${hit.file}">`);
				continue;
			}
			for (const f of hit.css ?? [])
				css.push(`<link rel="stylesheet" href="/build/${f}">`);
			js.push(`<script type="module" src="/build/${hit.file}"></script>`);
		}
		return { css: css.join("\n"), js: js.join("\n"), version };
	}

	/**
	 * The production manifest, read once.
	 * @returns Its entries by source path, and a hash of the file.
	 */
	static async #readManifest() {
		if (Vite.#manifest) return Vite.#manifest;
		const raw = await Bun.file(`${app.buildDir}/.vite/manifest.json`).text();
		Vite.#manifest = {
			entries: JSON.parse(raw),
			version: Bun.hash(raw).toString(16),
		};
		return Vite.#manifest;
	}
}
