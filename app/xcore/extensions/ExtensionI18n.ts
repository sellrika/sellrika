import { EXTENSION_I18N_DIR } from "@constants/Extension.Constant";
import { DEFAULT_LOCALE, fill, type Params } from "@i18n";
import { ExtensionFiles } from "@xcore/extensions/ExtensionFiles";

/**
 * Languages.
 * An extension speaks a language by shipping `i18n/<locale>.ts` (or .js):
 * `export default { "key": "text" }`, flat, with `{placeholders}`.
 * Nothing registers them: a new file is a new language.
 * The manifest names keys where it shows text.
 * Listeners / routes get `t`, browser scripts get `api.t`.
 * English (`en`) is the fallback for a missing key or language.
 */

/** locale → key → text. */
export type ExtensionDicts = Record<string, Record<string, string>>;
/** What an extension translates with: `t("key", { name })`. */
export type ExtensionTranslate = (key: string, params?: Params) => string;

/**
 * The languages of an extension: its `i18n/<locale>` dictionaries.
 */
export class ExtensionI18n {
	/**
	 * The dictionaries per folder, kept for the life of the process.
	 * Uploads are stamped folders, so a new version is a new entry.
	 */
	static #dicts = new Map<string, Promise<ExtensionDicts>>();

	/**
	 * Every dictionary of an extension folder: `i18n/<locale>.ts|js|mjs`.
	 * A dictionary is the file's default export (or the module itself).
	 * A file that fails to load is skipped with a warning.
	 * No folder = no languages.
	 * @param dir The extension folder (absolute).
	 * @returns locale → dictionary.
	 */
	static load(dir: string): Promise<ExtensionDicts> {
		const root = `${ExtensionFiles.abs(dir)}/${EXTENSION_I18N_DIR}`;
		let p = ExtensionI18n.#dicts.get(root);
		if (!p) {
			p = ExtensionI18n.#readDicts(root);
			ExtensionI18n.#dicts.set(root, p);
		}
		return p;
	}

	/**
	 * The `t()` of one extension in one language.
	 * It gives the locale's text, else English, else the key itself.
	 * So a manifest value or message that is not a key comes back unchanged.
	 * @param d The extension's dictionaries.
	 * @param locale The language wanted.
	 * @returns The translate function.
	 */
	static translator(d: ExtensionDicts, locale: string): ExtensionTranslate {
		const own = d[locale] ?? {};
		const base = d[DEFAULT_LOCALE] ?? {};
		return function t(key, params) {
			return fill(own[key] ?? base[key] ?? key, params);
		};
	}

	/**
	 * The dictionary a browser script gets (`api.t`).
	 * It is English with the locale's texts over it.
	 * @param d The extension's dictionaries.
	 * @param locale The language wanted.
	 * @returns key → text.
	 */
	static strings(d: ExtensionDicts, locale: string): Record<string, string> {
		return { ...(d[DEFAULT_LOCALE] ?? {}), ...(d[locale] ?? {}) };
	}

	/**
	 * Read every dictionary file of one `i18n` folder.
	 * Only the text values of a dictionary are kept.
	 * @param root The `i18n` folder (absolute).
	 * @returns locale → dictionary. `{}` when the folder does not exist.
	 */
	static async #readDicts(root: string): Promise<ExtensionDicts> {
		const out: ExtensionDicts = {};
		let names: string[] = [];
		try {
			names = await Array.fromAsync(
				new Bun.Glob("*.{ts,js,mjs}").scan({ cwd: root }),
			);
		} catch {
			return out;
		}
		for (const name of names.sort()) {
			const locale = name.replace(/\.(ts|js|mjs)$/, "");
			try {
				const m = await import(`${root}/${name}`);
				const d = m.default ?? m;
				if (d && typeof d === "object")
					out[locale] = Object.fromEntries(
						Object.entries(d).filter(([, v]) => typeof v === "string") as [
							string,
							string,
						][],
					);
			} catch (e) {
				console.warn(
					`[extensions] ${root}/${name}: ${e instanceof Error ? e.message : e}`,
				);
			}
		}
		return out;
	}
}
