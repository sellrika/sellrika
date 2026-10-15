/**
 * A text import: it is embedded in the compiled binary too.
 */
import JSX_RUNTIME from "./jsx-runtime.txt";
import { app } from "@config/app";
import { EXTENSION_ASSETS_DIR } from "@constants/Extension.Constant";
import { EXTENSION_ASSET_CACHE_CONTROL } from "@constants/Http.Constant";
import { ExtensionFiles } from "@xcore/extensions/ExtensionFiles";

/**
 * A route handler an extension exports:
 * `{ "GET /path/:id": async (ctx) => Response }`.
 */
export type ExtensionRouteTable = Record<
	string,
	(ctx: Record<string, unknown>) => unknown
>;
/**
 * What an entry module may export:
 * listeners (default), staff routes, public storefront routes
 * and a payment gateway (`payment`, checked by ExtensionService).
 */
export type ExtensionModule = {
	on: Record<string, unknown>;
	routes: ExtensionRouteTable;
	publicRoutes: ExtensionRouteTable;
	payment: unknown;
	/** `export const storefront`: the store's menu links and sitemap entries. */
	storefront: Record<string, unknown>;
};

/**
 * The JSX settings every browser script is compiled with.
 * extensions/build.ts bundles with the same (from tsconfig.json).
 *
 * Browser code may be TypeScript, with JSX in .tsx files.
 * It is transpiled here when served
 * (Bun's own transpiler, in the binary too).
 * It is remembered per file until the file changes.
 * JSX compiles to the `__h` / `__F` factories.
 * These are the same settings as tsconfig.json,
 * so `bunx tsc` and the browser agree.
 * The runtime that defines the factories goes in front.
 */
export const JSX_COMPILER = {
	jsx: "react",
	jsxFactory: "__h",
	jsxFragmentFactory: "__F",
} as const;
export { JSX_RUNTIME };

/**
 * Loading an extension's code: its entry module, the handler
 * of one of its routes, and its browser files.
 */
export class ExtensionLoader {
	/**
	 * One import per file for the life of the process.
	 * Uploaded versions land in fresh stamped folders.
	 * So an upgrade is a new path, never a stale module.
	 * A failed import is not kept, so a fixed file loads next time.
	 */
	static #modules = new Map<string, Promise<ExtensionModule>>();
	/** Turns a `.ts` / `.tsx` browser script into JavaScript. */
	static #transpiler = new Bun.Transpiler({
		loader: "ts",
		target: "browser",
		tsconfig: { compilerOptions: JSX_COMPILER },
	});
	/** The transpiled scripts by path, with the file time they were made from. */
	static #transpiled = new Map<string, { at: number; js: string }>();

	/**
	 * Import an extension's entry module.
	 * `export default` = listeners by event.
	 * `export const routes` / `publicRoutes` = route tables.
	 * `export const payment` = a payment gateway.
	 * Each is optional. The module must have at least one.
	 * @param dir The extension folder (absolute).
	 * @param main The entry file, relative to it.
	 * @returns The module's three parts (missing ones as `{}`).
	 * @throws When the file can't be imported or exports none of them.
	 */
	static load(dir: string, main: string): Promise<ExtensionModule> {
		const file = `${ExtensionFiles.abs(dir)}/${main}`;
		let p = ExtensionLoader.#modules.get(file);
		if (!p) {
			p = import(file).then((m) => ExtensionLoader.#readModule(m, main));
			p.catch(() => ExtensionLoader.#modules.delete(file));
			ExtensionLoader.#modules.set(file, p);
		}
		return p;
	}

	/**
	 * Find the handler for a request in an extension's route table.
	 * Keys are `"METHOD /path"`.
	 * `:name` segments are captured:
	 * `"GET /items/:id"` + `/items/7` → `{ id: "7" }`.
	 * The first key that fits wins.
	 * @param table The exported route table.
	 * @param method The request method.
	 * @param path The path below the extension's mount (`/items/7`).
	 * @returns The handler and its params, or null.
	 */
	static matchRoute(
		table: ExtensionRouteTable,
		method: string,
		path: string,
	): {
		fn: ExtensionRouteTable[string];
		params: Record<string, string>;
	} | null {
		const want = path.replace(/\/+$/, "").split("/").slice(1);
		for (const [key, fn] of Object.entries(table)) {
			const [m, pattern] = key.split(/\s+/, 2);
			if (m?.toUpperCase() !== method || !pattern || typeof fn !== "function")
				continue;
			const parts = pattern.replace(/\/+$/, "").split("/").slice(1);
			if (parts.length !== want.length) continue;
			const params: Record<string, string> = {};
			if (parts.every(matchSegment)) return { fn, params };

			/**
			 * Does one pattern segment match the path?
			 * A `:name` segment always does and is kept in `params`.
			 * @param seg The pattern segment.
			 * @param i Its position in the path.
			 * @returns True when it matches.
			 */
			function matchSegment(seg: string, i: number) {
				if (!seg.startsWith(":")) return seg === want[i];
				params[seg.slice(1)] = decodeURIComponent(want[i]!);
				return true;
			}
		}
		return null;
	}

	/**
	 * A browser file of the extension (`assets/…`), as a response.
	 * A `.ts` / `.tsx` file is served as JavaScript
	 * (`.tsx` with the JSX runtime in front).
	 * @param dir The extension folder (absolute).
	 * @param rel The path below `assets/` as requested.
	 * @param versioned True when the URL carries `?v=<version>`.
	 *   In production the browser may then keep the file for an hour.
	 *   A new version is a new URL.
	 * @returns A response with the file (content type from its extension).
	 *   Null when the path is unsafe or the file is missing.
	 */
	static async asset(
		dir: string,
		rel: string,
		versioned = false,
	): Promise<Response | null> {
		if (!rel || !ExtensionFiles.safePath(rel)) return null;
		const path = `${ExtensionFiles.abs(dir)}/${EXTENSION_ASSETS_DIR}/${rel}`;
		const f = Bun.file(path);
		if (!(await f.exists())) return null;
		// pages load it with ?v=<version>, so an upgrade is never stale
		// in dev the files change under the same version, so never kept
		const headers = {
			"cache-control":
				app.isProd && versioned ? EXTENSION_ASSET_CACHE_CONTROL : "no-cache",
		};
		const loader = rel.endsWith(".tsx")
			? "tsx"
			: rel.endsWith(".ts")
				? "ts"
				: null;
		if (!loader) return new Response(f, { headers });
		let hit = ExtensionLoader.#transpiled.get(path);
		if (!hit || hit.at !== f.lastModified)
			ExtensionLoader.#transpiled.set(
				path,
				(hit = {
					at: f.lastModified,
					js:
						(loader === "tsx" ? `${JSX_RUNTIME}\n` : "") +
						ExtensionLoader.#transpiler.transformSync(await f.text(), loader),
				}),
			);
		return new Response(hit.js, {
			headers: { ...headers, "content-type": "text/javascript; charset=utf-8" },
		});
	}

	/**
	 * One export of an entry module, as an object.
	 * @param v The exported value.
	 * @param what What to call it in the error.
	 * @returns The object, `{}` when the export is missing.
	 * @throws When the export is not an object.
	 */
	static #objectOr(v: unknown, what: string) {
		if (v == null) return {};
		if (typeof v !== "object") throw new Error(`${what} must be an object`);
		return v as Record<string, never>;
	}

	/**
	 * Check an imported entry module and split it into its parts.
	 * @param m The imported module.
	 * @param main The entry file's name, for the error.
	 * @returns The module's parts (missing ones as `{}`).
	 * @throws When the module exports none of them.
	 */
	static #readModule(
		m: Record<string, unknown>,
		main: string,
	): ExtensionModule {
		if (
			m.default == null &&
			m.routes == null &&
			m.publicRoutes == null &&
			m.payment == null
		)
			throw new Error(
				`${main} must \`export default\` listeners, or \`export const routes\` / \`publicRoutes\` / \`payment\``,
			);
		return {
			on: ExtensionLoader.#objectOr(m.default, `${main}: the default export`),
			routes: ExtensionLoader.#objectOr(m.routes, `${main}: routes`),
			publicRoutes: ExtensionLoader.#objectOr(
				m.publicRoutes,
				`${main}: publicRoutes`,
			),
			payment: m.payment ?? null,
			storefront: ExtensionLoader.#objectOr(
				m.storefront,
				`${main}: storefront`,
			),
		};
	}
}
