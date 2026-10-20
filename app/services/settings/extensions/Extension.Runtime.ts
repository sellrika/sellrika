import { Service } from "@xcore/di";
import { ApiCall } from "@xcore/api/ApiCall";
import {
	ExtensionLoader,
	type ExtensionModule,
} from "@xcore/extensions/ExtensionLoader";
import { StoreView } from "@xcore/view/StoreView";
import {
	type DataList,
	ExtensionRepository,
} from "@repositories/Extension.Repository";
import { UserRepository } from "@repositories/User.Repository";
import type { Shop } from "@models/Shop";
import type { User } from "@models/User";
import type {
	ExtensionManifest,
	ExtensionTool,
} from "@validators/Extension.Validator";
import { messageOf } from "@helpers/error";
import { oneAtATime } from "@helpers/lock";
import { Paginate } from "@xcore/http/Paginate";
import { MAX_PER_PAGE, PER_PAGE } from "@constants/Pagination.Constant";
import {
	EXTENSION_ASSETS_DIR,
	EXTENSION_CONFIG_SLOT,
	EXTENSION_STORE_SLOT,
} from "@constants/Extension.Constant";
import { STORE_THEME_PREFIX } from "@constants/Store.Constant";
import { ExtensionCatalog } from "./Extension.Catalog";
import {
	decryptConfig,
	publicConfig,
	SECRETS_UNREADABLE,
} from "./Extension.Config";
import {
	assetUrl,
	byKey,
	localizedManifest,
	logoUrl,
	pageIcon,
	storeBase,
	stringsOf,
	translatorOf,
} from "./Extension.Manifest";
import type {
	Config,
	ExtensionInfo,
	ExtensionRouteExtra,
	ExtensionUi,
	RunningExtension,
	StoreScript,
} from "./types/Extension.Types";
import type {
	HostedPayment,
	RunningPayment,
	TokenizePayment,
} from "./types/Extension.Payments.Types";
import type {
	StoreTheme,
	StoreThemeChoice,
} from "./types/Extension.Themes.Types";

/**
 * What runs right now: the extensions switched on for a shop.
 * One runs only when it is in the catalog, enabled for all shops,
 * installed, enabled by the shop, and has every required field filled.
 * Every runtime lookup starts here.
 */
@Service()
export class ExtensionRuntime {
	constructor(
		private rows: ExtensionRepository,
		private users: UserRepository,
		private catalog: ExtensionCatalog,
	) {}

	/**
	 * One extension as it runs for a shop.
	 * It must be installed, enabled and have every required field filled.
	 * Its settings come back decrypted.
	 * @param shop The shop, or its id.
	 * @param key The extension key.
	 * @returns The extension and its settings, or null when it does not
	 * run right now.
	 */
	async active(
		shop: number | Shop,
		key: string,
	): Promise<RunningExtension | null> {
		const row = await this.rows.find(this.#idOf(shop), key);
		if (!row?.enabled) return null;
		const ext = byKey(await this.catalog.available(shop), key);
		return ext ? this.#settingsOf(ext, row.config) : null;
	}

	/**
	 * Every extension running for a shop, in install order.
	 * This is the list every runtime lookup walks.
	 * @param shop The shop, or its id.
	 * @returns One entry per running extension.
	 */
	async allActive(shop: number | Shop): Promise<RunningExtension[]> {
		const available = await this.catalog.available(shop);
		const running: RunningExtension[] = [];
		for (const row of await this.rows.allForShop(this.#idOf(shop))) {
			if (!row.enabled) continue;
			const ext = byKey(available, row.key);
			const active = ext && this.#settingsOf(ext, row.config);
			if (active) running.push(active);
		}
		return running;
	}

	/**
	 * An extension's entry module, loaded.
	 * A broken one is a warning, never thrown at whoever asked.
	 * @param ext The extension.
	 * @returns The module, or null when it can't be loaded.
	 */
	async moduleOf(ext: ExtensionInfo): Promise<ExtensionModule | null> {
		try {
			return await ExtensionLoader.load(ext.dir, ext.main);
		} catch (error) {
			console.warn(`[extensions] ${ext.key}: ${messageOf(error)}`);
			return null;
		}
	}

	/**
	 * The payment gateways running for a shop.
	 * Installed, switched on, fully configured, module loaded.
	 * A broken one is skipped with a warning, never thrown at the buyer.
	 * @param shopId The shop.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns One row per gateway, in install order.
	 */
	async payments(
		shopId: number,
		running?: RunningExtension[],
	): Promise<RunningPayment[]> {
		const gateways: RunningPayment[] = [];
		for (const active of running ?? (await this.allActive(shopId))) {
			if (!active.ext.payment) continue;
			const payment = (await this.moduleOf(active.ext))?.payment as
				| HostedPayment
				| TokenizePayment
				| null
				| undefined;
			if (payment)
				gateways.push({
					...active,
					payment,
					t: translatorOf(active.ext),
				});
		}
		return gateways;
	}

	/**
	 * The one gateway that takes money online for a shop
	 * (hosted or tokenize).
	 * @param shopId The shop.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns That gateway, or null when none is switched on.
	 */
	async onlinePayment(
		shopId: number,
		running?: RunningExtension[],
	): Promise<RunningPayment | null> {
		return (await this.payments(shopId, running))[0] ?? null;
	}

	/**
	 * The themes the shop may dress its online store in.
	 * One per running theme extension.
	 * @param shopId The shop.
	 * @returns One choice per theme, in install order.
	 */
	async themes(shopId: number): Promise<StoreThemeChoice[]> {
		const choices: StoreThemeChoice[] = [];
		for (const active of await this.allActive(shopId)) {
			const theme = localizedManifest(active.ext).theme;
			if (theme)
				choices.push({
					key: STORE_THEME_PREFIX + active.ext.key,
					label: theme.label,
					description: theme.description,
				});
		}
		return choices;
	}

	/**
	 * The theme a storefront runs, when its template is an extension's
	 * (`ext:<key>`).
	 * Its Edge templates are registered as `ext/<key>/<file>` first.
	 * A theme whose extension was switched off or removed is null here,
	 * and Classic on the page. So is one whose templates can't be read.
	 * @param shop The shop being rendered.
	 * @returns The theme, or null when the shop uses a built-in template.
	 */
	async storeTheme(shop: Shop): Promise<StoreTheme | null> {
		if (!shop.online_template.startsWith(STORE_THEME_PREFIX)) return null;
		const key = shop.online_template.slice(STORE_THEME_PREFIX.length);
		const active = await this.active(shop, key);
		const theme = active?.ext.theme;
		if (!active || !theme) return null;
		const base = storeBase(shop.slug);
		try {
			const views = await StoreView.useExtensionTheme(
				key,
				`${active.ext.dir}/${theme.views}`,
			);
			return {
				name: shop.online_template,
				views,
				layout: `${views}/layout`,
				css: theme.css ? assetUrl(active.ext, theme.css, base) : null,
				script: theme.script ? assetUrl(active.ext, theme.script, base) : null,
				assets: `${base}/ext/${key}/${EXTENSION_ASSETS_DIR}`,
				config: publicConfig(active.ext, active.config),
				scheme: theme.scheme,
				featured: theme.featured,
				strings: stringsOf(active.ext),
			};
		} catch (error) {
			console.warn(`[extensions] ${key} theme: ${messageOf(error)}`);
			return null;
		}
	}

	/**
	 * Where the storefront loads a tokenize gateway's checkout script.
	 * @param ext The gateway extension (its manifest names the script).
	 * @param slug The shop's storefront slug.
	 * @returns The script URL, cache-busted by version.
	 */
	paymentScript(ext: ExtensionInfo, slug: string): string {
		return assetUrl(ext, ext.payment!.script!, storeBase(slug));
	}

	/**
	 * The scripts the running extensions put on every page
	 * of a shop's online store (slot `store.page`).
	 * `window.Store` loads each one and calls its default export.
	 * @param shop The shop whose store is showing.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns Per extension: its key, the script URL, its public mount
	 * and its dictionary in the page's language.
	 */
	async storeScripts(
		shop: Shop,
		running?: RunningExtension[],
	): Promise<StoreScript[]> {
		const base = storeBase(shop.slug);
		const scripts: StoreScript[] = [];
		for (const { ext } of running ?? (await this.allActive(shop))) {
			const slot = ext.slots.find((one) => one.name === EXTENSION_STORE_SLOT);
			if (!slot) continue;
			scripts.push({
				key: ext.key,
				script: assetUrl(ext, slot.script, base),
				base: `${base}/ext/${ext.key}`,
				strings: stringsOf(ext),
				wait: slot.wait,
			});
		}
		return scripts;
	}

	/**
	 * The user guide topics of the shop's running extensions
	 * (manifest `guide`).
	 * A guide that can't be read is left out.
	 * @param shopId The shop.
	 * @returns Per extension: its key as the topic, and the guide's Markdown.
	 */
	async guides(shopId: number): Promise<{ topic: string; text: string }[]> {
		const guides: { topic: string; text: string }[] = [];
		for (const { ext } of await this.allActive(shopId)) {
			if (!ext.guide) continue;
			const file = Bun.file(`${ext.dir}/${ext.guide}`);
			if (await file.exists())
				guides.push({ topic: ext.key, text: await file.text() });
		}
		return guides;
	}

	/**
	 * The MCP tools of the shop's running extensions (manifest `tools`).
	 * @param shopId The shop.
	 * @returns Per tool: the extension's key and the tool, texts in English.
	 */
	async tools(shopId: number): Promise<{ key: string; tool: ExtensionTool }[]> {
		const tools: { key: string; tool: ExtensionTool }[] = [];
		for (const { ext } of await this.allActive(shopId))
			for (const tool of ext.tools) tools.push({ key: ext.key, tool });
		return tools;
	}

	/**
	 * The running extensions' UI for the sidebar and the slots
	 * (shared with every page of the app).
	 * @param shopId The active shop.
	 * @param role The signed-in user's role.
	 * Admin-only pages are left out for cashiers.
	 * @returns One entry per running extension that has pages or slots.
	 */
	async ui(shopId: number, role: User["role"]): Promise<ExtensionUi[]> {
		const mounted: ExtensionUi[] = [];
		for (const { ext, config } of await this.allActive(shopId)) {
			const manifest = localizedManifest(ext);
			const pages = manifest.pages
				.filter((page) => !page.admin || role === "admin")
				.map((page) => this.#pageLink(ext, page));
			// the storefront slot is not a place in the staff app,
			// and the settings form is drawn by the Configure dialog
			const slots = ext.slots.filter(
				(slot) =>
					slot.name !== EXTENSION_STORE_SLOT &&
					slot.name !== EXTENSION_CONFIG_SLOT,
			);
			const strings = stringsOf(ext);
			// `app.<key>` texts reword the app's own
			// (`appWords` in resources/js/lib/i18n.ts)
			const words = Object.keys(strings).some((k) => k.startsWith("app."));
			const app = this.#appSettings(ext, config);
			if (
				!pages.length &&
				!slots.length &&
				!words &&
				!Object.keys(app).length &&
				!ext.hide_nav.length
			)
				continue;
			mounted.push({
				key: ext.key,
				name: manifest.name,
				version: ext.version,
				icon: logoUrl(ext),
				pages,
				slots: Object.fromEntries(
					slots.map((slot) => [slot.name, assetUrl(ext, slot.script)]),
				) as ExtensionUi["slots"],
				strings,
				app,
				hide_nav: ext.hide_nav,
				payment_confirm: !!ext.payment_method?.confirm,
			});
		}
		return mounted;
	}

	/**
	 * One of an extension's pages, for `/extensions/:key/:path`.
	 * @param shopId The active shop.
	 * @param key The extension key.
	 * @param path The page path.
	 * @param role The signed-in user's role.
	 * @returns The page and the script URL to mount.
	 * `"forbidden"` for a cashier on an admin page, else null.
	 */
	async page(shopId: number, key: string, path: string, role: User["role"]) {
		const active = await this.active(shopId, key);
		const manifest = active && localizedManifest(active.ext);
		const page = manifest?.pages.find((one) => one.path === path);
		if (!active || !manifest || !page) return null;
		if (page.admin && role !== "admin") return "forbidden" as const;
		return {
			extension: {
				key: active.ext.key,
				name: manifest.name,
				version: active.ext.version,
				icon: logoUrl(active.ext),
			},
			page: {
				path: page.path,
				title: page.title,
				icon: pageIcon(active.ext, page),
				fullscreen: page.fullscreen,
				breadcrumb: page.breadcrumb,
				fill: page.fill,
				centered: page.centered,
			},
			script: assetUrl(active.ext, page.script),
			strings: stringsOf(active.ext),
		};
	}

	/**
	 * The small data an extension keeps for one shop (`ctx.data`).
	 * Its own, never another extension's.
	 * @param shopId The shop.
	 * @param key The extension key.
	 * @returns `get`, `set` and `delete` by name, `collection` for a list
	 * that grows, and `lock` to run one job at a time.
	 */
	dataOf(shopId: number, key: string) {
		const rows = this.rows;
		return {
			get: (name: string) => rows.getData(shopId, key, String(name)),
			set: (name: string, value: unknown) =>
				rows.setData(shopId, key, String(name), value),
			delete: (name: string) => rows.deleteData(shopId, key, String(name)),
			collection: (name: string) =>
				this.#collectionOf({ shopId, key, name: String(name) }),
			lock: <T>(name: string, job: () => Promise<T>) =>
				oneAtATime(`ext:${shopId}:${key}:${name}`, job),
		};
	}

	/**
	 * One list an extension keeps for one shop (`ctx.data.collection`).
	 * Every call stays inside that shop, that extension and that list.
	 * @param list The shop, the extension and its list.
	 * @returns `add`, `get`, `list`, `update`, `delete` and `clear`.
	 */
	#collectionOf(list: DataList) {
		const rows = this.rows;
		return {
			add: (value: unknown, ref = "") => rows.addRow(list, value, String(ref)),
			get: (id: number) => rows.getRow(list, Number(id)),
			list: (query: { ref?: string; page?: number; per_page?: number } = {}) =>
				rows.listRows(
					list,
					query.ref === undefined ? undefined : String(query.ref),
					Paginate.number(String(query.page)),
					Math.min(
						MAX_PER_PAGE,
						Paginate.number(String(query.per_page ?? PER_PAGE)),
					),
				),
			update: (id: number, value: unknown) =>
				rows.updateRow(list, Number(id), value),
			delete: (id: number) => rows.deleteRow(list, Number(id)),
			clear: (ref: string) => rows.clearRows(list, String(ref)),
		};
	}

	/**
	 * Every API route as a function, for one extension's code.
	 * They run as the signed-in staff member, else as whoever the route names,
	 * else as the shop's owner.
	 * A listener names nobody, so it runs as the owner:
	 * nobody is signed in when an event fires.
	 * @param shop The shop.
	 * @param extra Who is calling, when a route knows.
	 * @returns The functions, grouped by area.
	 */
	functionsFor(shop: Shop, extra: ExtensionRouteExtra = {}) {
		const ownerOf = this.#ownerOf.bind(this);
		/**
		 * Who the functions are called as, asked on each call.
		 * @returns The shop and the user.
		 */
		async function caller() {
			return {
				shop,
				user: extra.user ?? (await extra.actor?.()) ?? (await ownerOf(shop)),
			};
		}
		return ApiCall.functions(caller);
	}

	/**
	 * The id of a shop given as the row or as its id.
	 * @param shop The shop, or its id.
	 * @returns The id.
	 */
	#idOf(shop: number | Shop): number {
		return typeof shop === "object" ? shop.id : shop;
	}

	/**
	 * An installed extension's settings, decrypted.
	 * This is the last check before the extension may run.
	 * @param ext The extension.
	 * @param stored The row's config, secrets encrypted.
	 * @returns The extension with its settings.
	 * Null when a required field is missing, or a secret can't be read.
	 */
	#settingsOf(ext: ExtensionInfo, stored: Config): RunningExtension | null {
		try {
			const config = decryptConfig(ext, stored);
			return config && { ext, config };
		} catch {
			console.warn(`[extensions] ${ext.key}: ${SECRETS_UNREADABLE}`);
			return null;
		}
	}

	/**
	 * The user an extension's functions run as
	 * when nobody is signed in and the route names nobody.
	 * That is the shop's owner, an admin of the shop.
	 * @param shop The shop.
	 * @returns The owner.
	 * @throws When the owner's account is gone.
	 */
	async #ownerOf(shop: Shop): Promise<User> {
		const owner = await this.users.find(shop.owner_id);
		if (!owner) throw new Error(`Shop #${shop.id} has no owner`);
		return owner;
	}

	/**
	 * One page of an extension as the sidebar links to it.
	 * @param ext The extension.
	 * @param page The page, in the request's language.
	 * @returns The link, its icon and the sidebar section it joins.
	 */
	#pageLink(
		ext: ExtensionInfo,
		page: ExtensionManifest["pages"][number],
	): ExtensionUi["pages"][number] {
		return {
			path: page.path,
			title: page.title,
			href: `/extensions/${ext.key}/${page.path}`,
			// its own icon, else the extension's
			icon: pageIcon(ext, page),
			group: page.group,
			before: page.group_before ?? null,
		};
	}

	/**
	 * The app settings an extension sets.
	 * First the ones it sets outright (`app`).
	 * Then the ones its fields set (`fields[].app`).
	 * A select left blank counts as its first option: the extension's default.
	 * @param ext The extension.
	 * @param config Its decrypted settings.
	 * @returns The app settings, by name.
	 */
	#appSettings(ext: ExtensionInfo, config: Config) {
		return {
			...ext.app,
			...Object.fromEntries(
				ext.fields
					.filter((field) => field.app)
					.map((field) => [
						field.app,
						config[field.name] || field.options?.[0]?.value,
					]),
			),
		};
	}
}
