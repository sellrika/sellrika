import { Service } from "@xcore/di";
import { I18n } from "@xcore/i18n/I18n";
import type { Shop } from "@models/Shop";
import { messageOf } from "@helpers/error";
import {
	EXTENSION_STORE_LINK_TITLE_MAX,
	EXTENSION_STORE_LINKS_MAX,
	EXTENSION_STORE_PATHS_MAX,
} from "@constants/Extension.Constant";
import { translatorOf } from "./Extension.Manifest";
import { ExtensionRuntime } from "./Extension.Runtime";
import type { RunningExtension } from "./types/Extension.Types";

/** One link an extension adds to the store's menu. */
export type StoreLink = { slug: string; title: string };

/**
 * The pages an extension brings to a shop's online store
 * (manifest `storefront`).
 * Which extension owns an address, the links it adds to the store's
 * menu and the addresses it adds to the sitemap
 * (`export const storefront` of its module).
 * An extension that fails is logged and left out: a store page
 * and the sitemap never break because of one.
 */
@Service()
export class ExtensionStorefront {
	constructor(private runtime: ExtensionRuntime) {}

	/**
	 * The running extension that owns a store address.
	 * @param shop The shop of the store.
	 * @param segment The first part of the path (`blog` for `/blog/a`).
	 * @returns The extension's key, or null when none owns it.
	 */
	async owner(shop: Shop, segment: string): Promise<string | null> {
		if (!segment) return null;
		for (const { ext } of await this.runtime.allActive(shop))
			if (ext.storefront?.path === segment) return ext.key;
		return null;
	}

	/**
	 * The links the shop's extensions add to the store's menu.
	 * A link must lead below the extension's own path.
	 * @param shop The shop of the store.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns The links: `slug` is the path, like `/blog`.
	 */
	async links(shop: Shop, running?: RunningExtension[]): Promise<StoreLink[]> {
		const links: StoreLink[] = [];
		for (const active of running ?? (await this.runtime.allActive(shop))) {
			const found = await this.#ask(shop, active, "links");
			for (const link of found.slice(0, EXTENSION_STORE_LINKS_MAX)) {
				const { title, path } = (link ?? {}) as Record<string, unknown>;
				if (typeof title !== "string" || !title.trim()) continue;
				if (!this.#own(active, path)) continue;
				links.push({
					slug: path,
					title: title.trim().slice(0, EXTENSION_STORE_LINK_TITLE_MAX),
				});
			}
		}
		return links;
	}

	/**
	 * The addresses the shop's extensions add to the store's sitemap.
	 * An address must be below the extension's own path.
	 * @param shop The shop of the store.
	 * @returns The paths, like `/blog/my-post`.
	 */
	async paths(shop: Shop): Promise<string[]> {
		const paths: string[] = [];
		for (const active of await this.runtime.allActive(shop)) {
			const found = await this.#ask(shop, active, "sitemap");
			for (const path of found.slice(0, EXTENSION_STORE_PATHS_MAX))
				if (this.#own(active, path)) paths.push(path);
		}
		return paths;
	}

	/**
	 * Is this a path below the extension's own store path?
	 * @param active The running extension.
	 * @param path What it answered.
	 * @returns True for `/blog` and `/blog/…` when its path is `blog`.
	 */
	#own(active: RunningExtension, path: unknown): path is string {
		const root = `/${active.ext.storefront?.path}`;
		return (
			typeof path === "string" &&
			(path === root || path.startsWith(`${root}/`)) &&
			!/[\s<>"]/.test(path)
		);
	}

	/**
	 * Call one function of an extension's `storefront` export.
	 * @param shop The shop of the store.
	 * @param active The running extension.
	 * @param name The function: `links` or `sitemap`.
	 * @returns What it answered, or [] when it has no store pages,
	 *   no such function, or it failed.
	 */
	async #ask(
		shop: Shop,
		active: RunningExtension,
		name: "links" | "sitemap",
	): Promise<unknown[]> {
		const { ext, config } = active;
		if (!ext.storefront) return [];
		const fn = (await this.runtime.moduleOf(ext))?.storefront[name];
		if (typeof fn !== "function") return [];
		try {
			const found = await fn({
				shop,
				config,
				t: translatorOf(ext),
				locale: I18n.current(),
				data: this.runtime.dataOf(shop.id, ext.key),
			});
			return Array.isArray(found) ? found : [];
		} catch (error) {
			console.warn(
				`[extensions] ${ext.key} storefront.${name} for shop #${shop.id}:`,
				messageOf(error),
			);
			return [];
		}
	}
}
