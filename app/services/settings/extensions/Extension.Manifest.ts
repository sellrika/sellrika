import type { ExtensionDir } from "@xcore/extensions/ExtensionFiles";
import {
	ExtensionI18n,
	type ExtensionTranslate,
} from "@xcore/extensions/ExtensionI18n";
import type { ExtensionModule } from "@xcore/extensions/ExtensionLoader";
import { I18n } from "@xcore/i18n/I18n";
import { EXTENSION_MANIFEST } from "@constants/Extension.Constant";
import { STORE_THEME_PAGES } from "@constants/Store.Constant";
import {
	ExtensionManifest,
	type ExtensionField,
} from "@validators/Extension.Validator";
import type { ExtensionInfo } from "./types/Extension.Types";

/**
 * The functions a payment extension's module must export.
 * One list per payment mode.
 */
const PAYMENT_EXPORTS = {
	hosted: ["createCheckout", "getPayment"],
	tokenize: ["amount", "charge", "getPayment"],
} as const;

/**
 * The manifest with every text passed through `t`.
 * A value that is a dictionary key becomes the text it stands for.
 * Anything else stays as written.
 * So a manifest with no dictionary reads as it always did.
 * @param manifest The manifest as written.
 * @param t The extension's translator for one language.
 * @returns A copy in that language.
 */
export function localizeManifest(
	manifest: ExtensionManifest,
	t: ExtensionTranslate,
): ExtensionManifest {
	function localizeField<F extends ExtensionField>(field: F): F {
		return {
			...field,
			label: t(field.label),
			placeholder: field.placeholder && t(field.placeholder),
			hint: field.hint && t(field.hint),
			options: field.options?.map(function localizeOption(option) {
				return { ...option, label: t(option.label) };
			}),
			add_label: field.add_label && t(field.add_label),
			fields: field.fields?.map(localizeField),
		};
	}
	return {
		...manifest,
		name: t(manifest.name),
		description: t(manifest.description),
		fields: manifest.fields.map(localizeField),
		pages: manifest.pages.map(function localizePage(page) {
			// an app section's name ("Sales") is no key of the extension
			// so it stays as it is
			return { ...page, title: t(page.title), group: t(page.group) };
		}),
		tools: manifest.tools.map(function localizeTool(tool) {
			return {
				...tool,
				summary: t(tool.summary),
				description: t(tool.description),
			};
		}),
		payment_method: manifest.payment_method && {
			...manifest.payment_method,
			name: t(manifest.payment_method.name),
		},
		theme: manifest.theme && {
			...manifest.theme,
			label: t(manifest.theme.label),
			description: t(manifest.theme.description),
		},
	};
}

/**
 * A scanned folder read as an extension.
 * Its manifest is checked and its dictionaries are loaded.
 * A broken manifest is a warning, not an extension.
 * @param found The folder and its manifest as parsed JSON.
 * @returns The extension, with every text resolved to English.
 * Null when the manifest is invalid.
 */
export async function parseExtension(
	found: ExtensionDir,
): Promise<ExtensionInfo | null> {
	const parsed = ExtensionManifest.safeParse(found.manifest);
	if (!parsed.success) {
		console.warn(
			`[extensions] ${found.dir}/${EXTENSION_MANIFEST}: ${parsed.error.issues[0]?.message}`,
		);
		return null;
	}
	const missing = await missingFiles(found.dir, parsed.data);
	if (missing) {
		console.warn(
			`[extensions] ${found.dir}/${EXTENSION_MANIFEST}: ${missing} is missing`,
		);
		return null;
	}
	const i18n = await ExtensionI18n.load(found.dir);
	return {
		...localizeManifest(parsed.data, ExtensionI18n.translator(i18n, "en")),
		raw: parsed.data,
		dir: found.dir,
		i18n,
	};
}

/**
 * Every file the manifest points at.
 * All of them must be in the uploaded zip.
 * @param manifest The manifest.
 * @returns The entry module, the page and slot scripts, the guide,
 * and a theme's pages (one `.edge` per STORE_THEME_PAGES), CSS and script.
 */
export function manifestFiles(manifest: ExtensionManifest): string[] {
	const theme = manifest.theme;
	return [
		manifest.main,
		...manifest.pages.map((page) => page.script),
		...manifest.slots.map((slot) => slot.script),
		...(manifest.guide ? [manifest.guide] : []),
		...(theme
			? [
					...STORE_THEME_PAGES.map((page) => `${theme.views}/${page}.edge`),
					...(theme.css ? [theme.css] : []),
					...(theme.script ? [theme.script] : []),
				]
			: []),
	];
}

/**
 * The first theme file the manifest names that is not in the folder.
 * An upload is checked against the zip instead (`upload()`).
 * This catches a built-in folder with a page missing.
 * @param dir The extension folder.
 * @param manifest Its manifest.
 * @returns The missing file, or null when every one is there.
 */
async function missingFiles(
	dir: string,
	manifest: ExtensionManifest,
): Promise<string | null> {
	if (!manifest.theme) return null;
	for (const file of manifestFiles(manifest))
		if (!(await Bun.file(`${dir}/${file}`).exists())) return file;
	return null;
}

/**
 * Which payment functions a gateway extension forgot to export.
 * Checked at upload, not when a buyer tries to pay.
 * @param manifest The manifest. Its `payment.mode` says what is needed.
 * @param mod The entry module as it was loaded.
 * @returns The missing export names.
 * Empty for an extension that is not a gateway.
 */
export function missingPaymentExports(
	manifest: ExtensionManifest,
	mod: ExtensionModule,
): string[] {
	if (!manifest.payment) return [];
	const payment = mod.payment as Record<string, unknown> | null;
	return PAYMENT_EXPORTS[manifest.payment.mode].filter(
		(name) => typeof payment?.[name] !== "function",
	);
}

/**
 * Which tool routes the manifest names that the module does not have.
 * Checked at upload, not when an assistant calls the tool.
 * @param manifest The manifest.
 * @param mod The entry module as it was loaded.
 * @returns The missing route keys.
 */
export function missingToolRoutes(
	manifest: ExtensionManifest,
	mod: ExtensionModule,
): string[] {
	return manifest.tools
		.map(function routeOf(tool) {
			return tool.route;
		})
		.filter(function missing(route) {
			return typeof mod.routes[route] !== "function";
		});
}

/**
 * Where the browser loads an extension's file.
 * The staff mount, or the store's when `base` is given.
 * @param ext The extension.
 * @param file The file below its `assets/` folder.
 * @param base A prefix like `/store/<slug>`, for the public mount.
 * @returns The URL, cache-busted by the extension's version.
 */
export function assetUrl(ext: ExtensionInfo, file: string, base = ""): string {
	return `${base}/ext/${ext.key}/${file}?v=${encodeURIComponent(ext.version)}`;
}

/**
 * The extension's logo as a URL.
 * @param ext The extension.
 * @returns The URL, or null when the manifest names no icon.
 */
export function logoUrl(ext: ExtensionInfo): string | null {
	return ext.icon ? assetUrl(ext, ext.icon) : null;
}

/**
 * The logo of one of an extension's pages.
 * Its own icon, else the extension's.
 * @param ext The extension.
 * @param page The page, as the manifest declares it.
 * @returns The URL, or null when neither names an icon.
 */
export function pageIcon(
	ext: ExtensionInfo,
	page: ExtensionManifest["pages"][number],
): string | null {
	return page.icon ? assetUrl(ext, page.icon) : logoUrl(ext);
}

/**
 * The public mount of a shop's online store.
 * Always the slug path.
 * The public mount only exists under `/store/:slug/ext/…`, on every host.
 * @param slug The shop's storefront slug.
 * @returns `/store/<slug>`.
 */
export function storeBase(slug: string | null): string {
	return `/store/${slug}`;
}

/**
 * One extension of a list, by its key.
 * @param list The extensions to look in.
 * @param key The extension key.
 * @returns The extension, or undefined when it is not in the list.
 */
export function byKey(
	list: ExtensionInfo[],
	key: string,
): ExtensionInfo | undefined {
	return list.find((one) => one.key === key);
}

/**
 * The extension's translator in the language of the current request
 * (`i18n/<locale>.ts`, English as fallback).
 * @param ext The extension.
 * @returns Its `t()`.
 */
export function translatorOf(ext: ExtensionInfo): ExtensionTranslate {
	return ExtensionI18n.translator(ext.i18n, I18n.current());
}

/**
 * The extension's dictionary for its browser scripts,
 * in the language of the current request.
 * @param ext The extension.
 * @returns key → text (English filled in under the locale's texts).
 */
export function stringsOf(ext: ExtensionInfo): Record<string, string> {
	return ExtensionI18n.strings(ext.i18n, I18n.current());
}

/**
 * The manifest in the language of the current request.
 * This is what pages show. The `ExtensionInfo` itself stays English.
 * @param ext The extension.
 * @returns The manifest's texts translated.
 */
export function localizedManifest(ext: ExtensionInfo): ExtensionManifest {
	return localizeManifest(ext.raw, translatorOf(ext));
}
