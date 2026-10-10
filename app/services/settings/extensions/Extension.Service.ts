import { Service } from "@xcore/di";
import type { ExtensionTranslate } from "@xcore/extensions/ExtensionI18n";
import type { Shop } from "@models/Shop";
import type { User } from "@models/User";
import type {
	ExtensionInput,
	ExtensionManifest,
	ExtensionTool,
} from "@validators/Extension.Validator";
import type { ExtensionEvent } from "@constants/Extension.Constant";
import { ExtensionCatalog, type Installed } from "./Extension.Catalog";
import { ExtensionEvents } from "./Extension.Events";
import {
	localizedManifest,
	stringsOf,
	translatorOf,
} from "./Extension.Manifest";
import { ExtensionRoutes } from "./Extension.Routes";
import { ExtensionRuntime } from "./Extension.Runtime";
import { ExtensionSettings } from "./Extension.Settings";
import type {
	Errors,
	ExtensionInfo,
	ExtensionRow,
	ExtensionUi,
	PlatformExtensionRow,
	ExtensionRouteExtra,
	RunningExtension,
	StoreScript,
} from "./types/Extension.Types";
import type {
	ExtensionEvents as EventData,
	ExtensionListener,
} from "./types/Extension.Events.Types";
import type { RunningPayment } from "./types/Extension.Payments.Types";
import type {
	StoreTheme,
	StoreThemeChoice,
} from "./types/Extension.Themes.Types";

/**
 * Extensions: one catalog of code for the whole platform.
 * Built in (the repo's `extensions/`) or uploaded by the platform admin.
 * The platform admin switches each one on for all shops
 * (Admin › Global Extensions).
 * Each shop then enables and configures it for itself
 * (Settings › Extensions).
 * They are handed the events they listen for.
 * They are mounted where they add routes, pages and UI.
 *
 * This class is the one door the rest of the app uses.
 * The work is done by five classes behind it:
 * `ExtensionCatalog` (the platform's code),
 * `ExtensionSettings` (each shop's switch and settings),
 * `ExtensionRuntime` (what runs right now),
 * `ExtensionRoutes` (requests below an extension's mount),
 * `ExtensionEvents` (the events they listen for).
 */
@Service()
export class ExtensionService {
	constructor(
		private catalogue: ExtensionCatalog,
		private settings: ExtensionSettings,
		private runtime: ExtensionRuntime,
		private routes: ExtensionRoutes,
		private events: ExtensionEvents,
	) {}

	// ── The platform catalog ──

	/**
	 * The extensions that ship with the app (`EXTENSION_BUILTIN_DIR`).
	 * A folder with a broken manifest is skipped with a warning.
	 * @returns The built-in extensions, by folder name.
	 */
	builtins(): Promise<ExtensionInfo[]> {
		return this.catalogue.builtins();
	}

	/**
	 * Every extension of the platform, on or off.
	 * A built-in wins over an upload with the same key.
	 * @returns The built-ins, then the uploads.
	 */
	catalog(): Promise<ExtensionInfo[]> {
		return this.catalogue.catalog();
	}

	/**
	 * The extensions a shop may use: the catalog, only the ones the platform
	 * admin switched on, and of those only the ones open to the shop's owner
	 * (an extension with a user list is for those users only).
	 * @param shopId The shop.
	 * Left out = every switched-on extension, for any owner.
	 * @returns The extensions, in catalog order.
	 */
	available(shopId?: number): Promise<ExtensionInfo[]> {
		return this.catalogue.available(shopId);
	}

	/**
	 * Every extension of the platform with its global switch, for Admin ›
	 * Global Extensions, in the request's language.
	 * @returns One row per extension.
	 */
	platformList(): Promise<PlatformExtensionRow[]> {
		return this.catalogue.platformList();
	}

	/**
	 * Switch an extension on or off for all shops.
	 * Off, it runs in no shop and no shop lists it; each shop's settings stay.
	 * @param key The extension key.
	 * @param enabled On or off.
	 * @returns `{errors}` for an unknown key, `{}` when saved.
	 */
	setGlobal(key: string, enabled: boolean): Promise<{ errors?: Errors }> {
		return this.catalogue.setGlobal(key, enabled);
	}

	/**
	 * Open an extension to some users only, or to everyone again.
	 * Their shops list it and run it; other users' shops don't.
	 * @param key The extension key.
	 * @param emails The users' emails (owners only); [] = every user.
	 * @returns `{errors}` (`users`) for an unknown key or email.
	 * `{}` when saved.
	 */
	setUsers(key: string, emails: string[]): Promise<{ errors?: Errors }> {
		return this.catalogue.setUsers(key, emails);
	}

	/**
	 * Users the platform admin may pick for "Available to".
	 * Owners by name or email.
	 * @param q What was typed.
	 * @returns Their emails (the picker's chips) and whether more match.
	 */
	userChoices(q: string): Promise<{ places: string[]; more: boolean }> {
		return this.catalogue.userChoices(q);
	}

	/**
	 * Delete an uploaded extension: its code and its global switch.
	 * The shops' settings stay, so uploading it again brings them back.
	 * A built-in one can't be deleted.
	 * @param key The extension key.
	 * @returns `{errors}` when it is built in or unknown, `{}` when deleted.
	 */
	remove(key: string): Promise<{ errors?: Errors }> {
		return this.catalogue.remove(key);
	}

	/**
	 * Move the zips shops uploaded before the catalog was one for the platform
	 * into the platform folder, on boot.
	 * A second boot moves nothing.
	 * @returns A promise that settles once the move is done.
	 */
	adoptShopUploads(): Promise<void> {
		return this.catalogue.adoptShopUploads();
	}

	/**
	 * Upload a zip to the platform catalog (the platform admin).
	 * Its manifest and entry module are checked, older versions dropped.
	 * A key that is built in is refused: its updates ship with the app.
	 * @param file The zip as uploaded.
	 * @returns `{errors}` (`file`) when it can't be added, else `{key}`.
	 */
	upload(file: File): Promise<Installed> {
		return this.catalogue.upload(file);
	}

	/**
	 * Install from a link.
	 * The zip is downloaded, https only and capped in size and time,
	 * then handed to `upload`.
	 * @param url Where the zip is.
	 * @returns `{errors}` under `url` when it can't be downloaded.
	 * Otherwise `upload`'s answer, its refusals moved under `url` too.
	 */
	fromUrl(url: string): Promise<Installed> {
		return this.catalogue.fromUrl(url);
	}

	// ── The request's language ──

	/**
	 * The extension's translator in the language of the current request
	 * (`i18n/<locale>.ts`, English as fallback).
	 * @param ext The extension.
	 * @returns Its `t()`.
	 */
	translator(ext: ExtensionInfo): ExtensionTranslate {
		return translatorOf(ext);
	}

	/**
	 * The extension's dictionary for its browser scripts,
	 * in the language of the current request.
	 * @param ext The extension.
	 * @returns key → text (English filled in under the locale's texts).
	 */
	strings(ext: ExtensionInfo): Record<string, string> {
		return stringsOf(ext);
	}

	/**
	 * The manifest in the language of the current request.
	 * This is what pages show. The `ExtensionInfo` itself stays English.
	 * @param ext The extension.
	 * @returns The manifest's texts translated.
	 */
	localized(ext: ExtensionInfo): ExtensionManifest {
		return localizedManifest(ext);
	}

	// ── Installing and configuring ──

	/**
	 * Every extension the platform switched on, with the shop's state on it,
	 * for Settings › Extensions, in the request's language.
	 * @param shopId The active shop.
	 * @returns One row per available extension.
	 */
	list(shopId: number): Promise<ExtensionRow[]> {
		return this.settings.list(shopId);
	}

	/**
	 * Install, reconfigure or switch one extension.
	 * The first save creates the row; `config` left out keeps the
	 * stored settings; a blank secret keeps the stored one.
	 * Switching on needs every required field.
	 * @param shopId The active shop.
	 * @param key The extension key.
	 * @param input Validated switch + settings.
	 * @returns `{errors}` when something is wrong, `{}` when saved.
	 */
	save(
		shopId: number,
		key: string,
		input: ExtensionInput,
	): Promise<{ errors?: Errors }> {
		return this.settings.save(shopId, key, input);
	}

	// ── What runs right now ──

	/**
	 * One extension as it runs for a shop.
	 * It must be installed, enabled and have every required field filled.
	 * Its settings come back decrypted.
	 * @param shopId The shop.
	 * @param key The extension key.
	 * @returns The extension and its settings, or null when it does not
	 * run right now.
	 */
	active(shopId: number, key: string): Promise<RunningExtension | null> {
		return this.runtime.active(shopId, key);
	}

	/**
	 * Every extension running for a shop, in install order.
	 * A store page asks once and hands the list to the lookups below.
	 * @param shop The shop, or its id.
	 * @returns One entry per running extension.
	 */
	allActive(shop: number | Shop): Promise<RunningExtension[]> {
		return this.runtime.allActive(shop);
	}

	/**
	 * The payment gateways running for a shop.
	 * A broken one is skipped with a warning, never thrown at the buyer.
	 * @param shopId The shop.
	 * @returns One row per gateway, in install order.
	 */
	payments(shopId: number): Promise<RunningPayment[]> {
		return this.runtime.payments(shopId);
	}

	/**
	 * The one gateway that takes money online for a shop
	 * (hosted or tokenize).
	 * @param shopId The shop.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns That gateway, or null when none is switched on.
	 */
	onlinePayment(
		shopId: number,
		running?: RunningExtension[],
	): Promise<RunningPayment | null> {
		return this.runtime.onlinePayment(shopId, running);
	}

	// ── The storefront look ──

	/**
	 * The themes the shop may dress its online store in.
	 * One per running theme extension.
	 * @param shopId The shop.
	 * @returns One choice per theme, in install order.
	 */
	themes(shopId: number): Promise<StoreThemeChoice[]> {
		return this.runtime.themes(shopId);
	}

	/**
	 * The theme a storefront runs, when its template is an extension's
	 * (`ext:<key>`).
	 * A theme that stopped running or can't be read is null here,
	 * and Classic on the page.
	 * @param shop The shop being rendered.
	 * @returns The theme, or null when the shop uses a built-in template.
	 */
	storeTheme(shop: Shop): Promise<StoreTheme | null> {
		return this.runtime.storeTheme(shop);
	}

	/**
	 * Where the storefront loads a tokenize gateway's checkout script.
	 * @param ext The gateway extension (its manifest names the script).
	 * @param slug The shop's storefront slug.
	 * @returns The script URL, cache-busted by version.
	 */
	paymentScript(ext: ExtensionInfo, slug: string): string {
		return this.runtime.paymentScript(ext, slug);
	}

	/**
	 * The scripts the running extensions put on every page
	 * of a shop's online store (slot `store.page`).
	 * @param shop The shop whose store is showing.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns Per extension: its key, the script URL, its public mount
	 * and its dictionary in the page's language.
	 */
	storeScripts(
		shop: Shop,
		running?: RunningExtension[],
	): Promise<StoreScript[]> {
		return this.runtime.storeScripts(shop, running);
	}

	// ── The assistant's side: guides and tools ──

	/**
	 * The user guide topics of the shop's running extensions
	 * (manifest `guide`).
	 * @param shopId The shop.
	 * @returns Per extension: its key as the topic, and the guide's Markdown.
	 */
	guides(shopId: number): Promise<{ topic: string; text: string }[]> {
		return this.runtime.guides(shopId);
	}

	/**
	 * The MCP tools of the shop's running extensions (manifest `tools`).
	 * @param shopId The shop.
	 * @returns Per tool: the extension's key and the tool, texts in English.
	 */
	tools(shopId: number): Promise<{ key: string; tool: ExtensionTool }[]> {
		return this.runtime.tools(shopId);
	}

	// ── Pages, scripts and routes ──

	/**
	 * The running extensions' UI for the sidebar and the slots
	 * (shared with every page of the app).
	 * @param shopId The active shop.
	 * @param role The signed-in user's role.
	 * Admin-only pages are left out for cashiers.
	 * @returns One entry per running extension that has pages or slots.
	 */
	ui(shopId: number, role: User["role"]): Promise<ExtensionUi[]> {
		return this.runtime.ui(shopId, role);
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
	page(shopId: number, key: string, path: string, role: User["role"]) {
		return this.runtime.page(shopId, key, path, role);
	}

	/**
	 * Serve a request below an extension's mount.
	 * Its `assets/…` files first, else the matching route handler.
	 * @param kind Which table: staff routes or public storefront routes.
	 * @param shop The shop the request is for.
	 * @param key The extension key.
	 * @param req The request.
	 * @param subpath The path below the mount (`/items/7`).
	 * @param extra Who is calling: the signed-in `user` on staff routes,
	 * the `actor` on public ones, and the functions with no API route.
	 * @returns The extension's response.
	 * 404 when nothing runs or matches, 500 when the handler threw.
	 */
	handle(
		kind: "routes" | "publicRoutes",
		shop: Shop,
		key: string,
		req: Request,
		subpath: string,
		extra: ExtensionRouteExtra = {},
	): Promise<Response> {
		return this.routes.handle(kind, shop, key, req, subpath, extra);
	}

	// ── Events ──

	/**
	 * The shop's listeners that run right now for an event.
	 * @param shopId The shop.
	 * @param event The event.
	 * @returns Each listener with its extension key and decrypted settings.
	 */
	running<E extends ExtensionEvent>(
		shopId: number,
		event: E,
	): Promise<ExtensionListener<E>[]> {
		return this.events.running(shopId, event);
	}

	/**
	 * Hand an event to every running extension of the shop.
	 * Best effort: it never throws, and callers never await it.
	 * A slow receiver must not hold up a checkout.
	 * @param event The event.
	 * @param shop The shop it happened in (the row, or its id).
	 * @param data The event's data.
	 * @returns A promise that settles once every listener has run.
	 */
	emit<E extends ExtensionEvent>(
		event: E,
		shop: Shop | number,
		data: EventData[E],
	): Promise<void> {
		return this.events.emit(event, shop, data);
	}

	/**
	 * An account-wide event (staff): every shop of that account hears it.
	 * @param ownerId The account's owner.
	 * @param event The event.
	 * @param data The event's data.
	 * @returns A promise that settles once every shop was told.
	 */
	emitAll<E extends ExtensionEvent>(
		ownerId: number,
		event: E,
		data: EventData[E],
	): Promise<void> {
		return this.events.emitAll(ownerId, event, data);
	}

	/**
	 * Resolves once every emit started so far has finished.
	 * For tests: they can't await the `void` calls in the services.
	 * @returns A promise that settles when nothing is in flight.
	 */
	idle(): Promise<void> {
		return this.events.idle();
	}

	/**
	 * Where the shop's stock ledger ends right now.
	 * Take it before a write that moves stock.
	 * @param shopId The shop.
	 * @returns The mark for `stockMoved()`.
	 */
	stockMark(shopId: number) {
		return this.events.stockMark(shopId);
	}

	/**
	 * `stock.updated` for every ledger row a write added after the mark.
	 * One event per row, each with its unit as it stands now.
	 * @param shopId The shop.
	 * @param mark From `stockMark()`, taken before the write.
	 * @param of The order, or the unit, the write was about.
	 * It keeps a concurrent sale's rows out.
	 * @returns A promise that settles once every event was handed out.
	 */
	stockMoved(
		shopId: number,
		mark: number,
		of: { orderId?: number; productId?: number; variantId?: number | null },
	): Promise<void> {
		return this.events.stockMoved(shopId, mark, of);
	}
}
