/**
 * Extension code on disk. The mechanics only:
 * finding folders, unpacking a zip safely, importing the module.
 * What a manifest must say, who may run what and the per-shop state
 * are ExtensionService's business.
 */
/**
 * `node:` because Bun has no recursive delete and no rename.
 */
import { mkdir, rename, rm } from "node:fs/promises";
import { unzip } from "@helpers/zip";
import {
	EXTENSION_MANIFEST,
	MAX_EXTENSION_FILES,
	MAX_EXTENSION_UNPACKED_BYTES,
} from "@constants/Extension.Constant";

/**
 * A folder holding an `extension.json`.
 * The manifest is parsed, not yet validated.
 * `dir` is absolute.
 */
export type ExtensionDir = { dir: string; manifest: unknown };

/**
 * Extension code on disk: the mechanics only.
 * Finding folders, unpacking a zip safely, writing, moving and deleting.
 * What a manifest must say and who may run what is ExtensionService's business.
 */
export class ExtensionFiles {
	/**
	 * A path as an absolute one.
	 * @param p An absolute path, or one relative to the working directory.
	 * @returns The absolute path.
	 */
	static abs(p: string) {
		return p.startsWith("/") ? p : `${process.cwd()}/${p}`;
	}

	/**
	 * Every extension folder under a root.
	 * Each `<pattern>` match is a manifest, its folder the extension.
	 * @param root Where to look (may not exist yet → none).
	 * @param pattern Glob for the manifests, relative to the root.
	 * @returns The folders, unreadable manifests skipped with a warning.
	 */
	static async scan(
		root: string,
		pattern = `*/${EXTENSION_MANIFEST}`,
	): Promise<ExtensionDir[]> {
		const out: ExtensionDir[] = [];
		const base = ExtensionFiles.abs(root);
		let names: string[];
		try {
			names = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: base }));
		} catch {
			// no such folder yet
			return out;
		}
		for (const rel of names.sort()) {
			const file = `${base}/${rel}`;
			try {
				out.push({
					dir: file.slice(0, -EXTENSION_MANIFEST.length - 1),
					manifest: await Bun.file(file).json(),
				});
			} catch (e) {
				console.warn(
					`[extensions] ${file}: ${e instanceof Error ? e.message : e}`,
				);
			}
		}
		return out;
	}

	/**
	 * Is this a relative posix path that stays inside the folder?
	 * No leading slash, no drive letter, no backslash, no `..` part.
	 * No control character either (a newline once hid a `..`).
	 * @param name The path as written in the zip or the URL.
	 * @returns True when it is safe to join to the folder.
	 */
	static safePath(name: string) {
		if (!name || name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
		if (/[\\\p{Cc}]/u.test(name)) return false;
		return !name.split("/").includes("..");
	}

	/**
	 * The files of an uploaded extension zip, checked for safety.
	 * A single top-level folder is stripped,
	 * so `extension.json` sits at the root.
	 * That is how "compress folder" and GitHub zips come.
	 * @param bytes The zip.
	 * @returns Entry name → contents.
	 * @throws With a message the admin can read,
	 *   when the zip is damaged, unsafe or too big.
	 */
	static unpack(bytes: Uint8Array): Record<string, Uint8Array> {
		let entries = unzip(bytes, MAX_EXTENSION_UNPACKED_BYTES).filter(
			ExtensionFiles.#isRealFile,
		);
		if (entries.length > MAX_EXTENSION_FILES)
			throw new Error(`Too many files (at most ${MAX_EXTENSION_FILES})`);
		const top = entries[0]?.name.split("/")[0];
		if (
			top &&
			entries.every((e) => e.name.startsWith(`${top}/`)) &&
			!entries.some((e) => e.name === EXTENSION_MANIFEST)
		)
			entries = entries.map((e) => ({
				...e,
				name: e.name.slice(top.length + 1),
			}));
		const files: Record<string, Uint8Array> = {};
		let total = 0;
		for (const e of entries) {
			if (!ExtensionFiles.safePath(e.name))
				throw new Error(`Unsafe file name in the zip: ${e.name}`);
			total += e.data.length;
			if (total > MAX_EXTENSION_UNPACKED_BYTES)
				throw new Error("The zip unpacks to more than 20 MB");
			files[e.name] = e.data;
		}
		if (!files[EXTENSION_MANIFEST])
			throw new Error(`The zip has no ${EXTENSION_MANIFEST} at its root`);
		return files;
	}

	/**
	 * Write unpacked files into a folder (created as needed).
	 * @param dir Absolute or cwd-relative target folder.
	 * @param files Entry name → contents (already checked by `unpackExtension`).
	 */
	static async write(dir: string, files: Record<string, Uint8Array>) {
		for (const [name, data] of Object.entries(files))
			await Bun.write(`${ExtensionFiles.abs(dir)}/${name}`, data);
	}

	/**
	 * Delete an extension folder (an uploaded one, versions and all).
	 * @param dir The folder.
	 * @returns A promise that ends when the folder is gone.
	 */
	static remove(dir: string) {
		return rm(ExtensionFiles.abs(dir), { recursive: true, force: true });
	}

	/**
	 * Move an extension folder to a new place.
	 * Parent folders are created as needed.
	 * @param from The folder now.
	 * @param to Where it goes.
	 */
	static async move(from: string, to: string) {
		await mkdir(ExtensionFiles.abs(to).split("/").slice(0, -1).join("/"), {
			recursive: true,
		});
		await rename(ExtensionFiles.abs(from), ExtensionFiles.abs(to));
	}

	/**
	 * Is this zip entry a file the extension brought?
	 * Folders, macOS's `__MACOSX/` copies and dot files are left out.
	 * @param e The zip entry.
	 * @returns True for a real file.
	 */
	static #isRealFile(e: { name: string }) {
		return (
			!e.name.endsWith("/") &&
			!e.name.startsWith("__MACOSX/") &&
			!e.name.split("/").pop()!.startsWith(".")
		);
	}
}
