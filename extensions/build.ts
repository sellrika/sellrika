/**
 * Packs an extension folder into a zip you can upload.
 * `bun run build:extension my-thing` writes
 * extensions/my-thing/dist/my-thing-<version>.zip, ready for
 * Admin › Global Extensions › Upload zip.
 * `bun extensions/build.ts --out build/extensions` writes every one unpacked
 * instead: the built-in extensions production reads (part of `bun run build`).
 * `bun run build:extensions` does the same for every folder in
 * extensions/ that has a manifest.
 * The entry module and every page and slot script are bundled to plain
 * JavaScript: types erased, JSX compiled, local imports inlined.
 * The manifest is rewritten to point at the .js files, and everything
 * else in the folder (css, images, …) is copied.
 * Browser bundles get the JSX runtime in front, the same text the server
 * puts before a raw .tsx, so a built zip and a raw one behave the same.
 * The JSX settings come from the root tsconfig.json, which Bun.build
 * reads.
 */
import { zip } from "../app/helpers/zip";
import JSX_RUNTIME from "../app/xcore/extensions/jsx-runtime.txt";

/**
 * The manifest file name every extension folder must hold.
 */
const MANIFEST = "extension.json";

/**
 * Bundle one extension folder into an upload-ready zip.
 * @param dir The extension folder (holds `extension.json`).
 * @returns The zip bytes and the file name to save them as.
 */
export async function buildExtension(
	dir: string,
): Promise<{ name: string; bytes: Uint8Array }> {
	const { manifest, files } = await bundleExtension(dir);
	return {
		name: `${manifest.key}-${manifest.version ?? "1.0.0"}.zip`,
		bytes: zip(files),
	};
}

/**
 * Bundle one extension folder: the files a zip of it holds, unpacked.
 * @param dir The extension folder (holds `extension.json`).
 * @returns The rewritten manifest, and every file by its path.
 */
export async function bundleExtension(dir: string): Promise<{
	manifest: { key: string; version?: string };
	files: Record<string, Uint8Array>;
}> {
	const root = dir.replace(/\/$/, "");
	const manifest = await Bun.file(`${root}/${MANIFEST}`).json();
	const files: Record<string, Uint8Array> = {};
	/**
	 * Bundles one source file and keeps the result for the zip.
	 * @param rel The file's path inside the extension folder.
	 * @param target Where it runs: the server ("bun") or the browser.
	 * @returns The path the bundle was stored under, with a .js ending.
	 */
	const bundle = async (rel: string, target: "bun" | "browser") => {
		const out = await Bun.build({
			entrypoints: [`${root}/${rel}`],
			target,
			format: "esm",
			banner: target === "browser" ? JSX_RUNTIME : undefined,
		});
		if (!out.success)
			throw new Error(`${rel}: ${out.logs.map((l) => l.message).join("; ")}`);
		const js = rel.replace(/\.(tsx?|mjs|cjs)$/, ".js");
		files[js] = new Uint8Array(await out.outputs[0]!.arrayBuffer());
		return js;
	};
	manifest.main = await bundle(manifest.main ?? "index.js", "bun");
	for (const p of manifest.pages ?? [])
		p.script = await bundle(p.script, "browser");
	for (const s of manifest.slots ?? [])
		s.script = await bundle(s.script, "browser");
	/**
	 * A tokenising payment gateway's checkout script runs in the buyer's
	 * browser, the same as a page or slot script.
	 */
	if (manifest.payment?.script)
		manifest.payment.script = await bundle(manifest.payment.script, "browser");
	/**
	 * A store theme's script runs on every page of the storefront.
	 * Its .edge templates and CSS are copied below, as they are.
	 */
	if (manifest.theme?.script)
		manifest.theme.script = await bundle(manifest.theme.script, "browser");
	/**
	 * The dictionaries (i18n/<locale>.ts) are plain data.
	 * One bundle each, so the zip speaks every language the folder does.
	 */
	for await (const rel of new Bun.Glob("i18n/*.{ts,js,mjs}").scan({
		cwd: root,
	}))
		await bundle(rel, "bun");
	// everything that is not source: copied as-is
	for await (const rel of new Bun.Glob("**/*").scan({ cwd: root }))
		if (
			!/\.(tsx?|js|mjs|cjs)$/.test(rel) &&
			rel !== MANIFEST &&
			!rel.startsWith("dist/")
		)
			files[rel] = new Uint8Array(
				await Bun.file(`${root}/${rel}`).arrayBuffer(),
			);
	files[MANIFEST] = new TextEncoder().encode(
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return { manifest, files };
}

if (import.meta.main) {
	const here = new URL("./", import.meta.url).pathname;
	const args = process.argv.slice(2);
	/**
	 * `--out <dir>`: write every extension unpacked into `<dir>/<key>/`
	 * instead of a zip. `bun run build` uses it for the built-ins
	 * production reads (build/extensions).
	 */
	const outAt = args.indexOf("--out");
	const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
	const arg = args[0];
	/**
	 * With no argument, build every extension folder here.
	 * A folder counts as one when it holds a manifest.
	 */
	/**
	 * The folders that hold extensions: this one, an add-on's own
	 * (`cloud/extensions`, see `app/cloud.ts`) and `custom-extensions`,
	 * when they are there.
	 */
	const roots = [
		here,
		`${here}../cloud/extensions/`,
		`${here}../custom-extensions/`,
	];
	const dirs: string[] = [];
	for (const root of roots) {
		if (arg) {
			if (await Bun.file(`${root}${arg}/${MANIFEST}`).exists())
				dirs.push(`${root}${arg}`);
			continue;
		}
		let found: string[] = [];
		try {
			found = await Array.fromAsync(
				new Bun.Glob(`*/${MANIFEST}`).scan({ cwd: root }),
			);
		} catch {
			// no such folder: the source-available app has no add-on
		}
		for (const m of found.sort())
			dirs.push(root + m.slice(0, -MANIFEST.length - 1));
	}
	// a path that is not a key: an extension folder somewhere else
	if (arg && !dirs.length) dirs.push(arg);
	for (const d of dirs) {
		const dir = d.replace(/\/$/, "");
		if (out) {
			const { manifest, files } = await bundleExtension(dir);
			for (const [rel, bytes] of Object.entries(files))
				await Bun.write(`${out}/${manifest.key}/${rel}`, bytes);
			console.log(`built ${out}/${manifest.key}/`);
			continue;
		}
		const { name, bytes } = await buildExtension(dir);
		await Bun.write(`${dir}/dist/${name}`, bytes);
		console.log(
			`built ${dir}/dist/${name} — upload it on Admin › Global Extensions`,
		);
	}
}
