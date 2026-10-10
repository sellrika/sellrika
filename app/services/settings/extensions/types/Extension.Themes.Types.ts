import type { Config } from "./Extension.Types";

/**
 * A theme extension in the /online-store template picker.
 * The key the shop saves, and what the row reads.
 */
export type StoreThemeChoice = {
	/**
	 * `ext:<extension key>`.
	 */
	key: string;
	label: string;
	description: string;
};

/**
 * The running theme of a storefront.
 * The same shape as a built-in theme (`ActiveTheme` in
 * app/services/sales/StoreView.Service.ts), so the page renders either.
 */
export type StoreTheme = {
	/**
	 * `ext:<extension key>`, what the shop saved.
	 */
	name: string;
	/**
	 * Where its templates are registered: `ext/<key>`.
	 */
	views: string;
	/**
	 * The layout template, `ext/<key>/layout`.
	 */
	layout: string;
	/**
	 * The theme's stylesheet and browser script URLs, or null.
	 * Served from `/store/<slug>/ext/<key>/assets/…`, with `?v=<version>`.
	 */
	css: string | null;
	script: string | null;
	/**
	 * Where the theme's own files live.
	 * `/store/<slug>/ext/<key>/assets` — `asset(path)` builds on it.
	 */
	assets: string;
	/**
	 * The shop's settings for this theme.
	 * Secrets are left out: this goes to every visitor.
	 */
	config: Config;
	/**
	 * The colour scheme the page pins (`auto` follows the device).
	 */
	scheme: "light" | "dark" | "auto";
	/**
	 * How many featured products the home page gets. 0 means none.
	 */
	featured: number;
	/**
	 * The extension's dictionary in the page language.
	 * It wins over the app's words in `t()` and `Store.t()`.
	 */
	strings: Record<string, string>;
};
