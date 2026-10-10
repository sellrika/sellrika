import { ExtensionFiles } from "@xcore/extensions/ExtensionFiles";
import { ExtensionLoader } from "@xcore/extensions/ExtensionLoader";
import { Outbound } from "@xcore/http/Outbound";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import {
	ExtensionRepository,
	type GlobalRule,
} from "@repositories/Extension.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { UserRepository } from "@repositories/User.Repository";
import { OwnerRepository } from "@repositories/Owner.Repository";
import { ExtensionManifest } from "@validators/Extension.Validator";
import type { Shop } from "@models/Shop";
import { messageOf } from "@helpers/error";
import {
	EXTENSION_BUILTIN_DIRS,
	EXTENSION_BUILTIN_LIVE,
	EXTENSION_FETCH_TIMEOUT_MS,
	EXTENSION_USER_CHOICES,
	EXTENSION_MANIFEST,
	EXTENSION_PLATFORM_DIR,
	EXTENSION_UPLOAD_DIR,
	MAX_EXTENSION_ZIP_BYTES,
} from "@constants/Extension.Constant";
import {
	localizedManifest,
	logoUrl,
	manifestFiles,
	missingPaymentExports,
	missingToolRoutes,
	parseExtension,
} from "./Extension.Manifest";
import type {
	Errors,
	ExtensionInfo,
	PlatformExtensionRow,
} from "./types/Extension.Types";

/**
 * What `upload` and `fromUrl` answer.
 * The key of the installed extension, or what to show the admin.
 */
export type Installed =
	| { key: string; errors?: never }
	| { errors: Errors; key?: never };

/**
 * What `download` answers.
 * The zip's bytes, or the message for the admin.
 */
type Downloaded =
	| { ok: true; bytes: Uint8Array }
	| { ok: false; error: string };

/**
 * A safe extension key, so it can name a folder.
 * The manifest checks the same.
 */
const KEY = /^[a-z0-9][a-z0-9-]{1,49}$/;

/**
 * The platform catalog: one catalog of extension code for every shop.
 * Built in (the repo's `extensions/`) or uploaded by the platform admin.
 * The platform admin switches each one on for all shops
 * (Admin › Global Extensions).
 */
@Service()
export class ExtensionCatalog {
	/**
	 * The uploads folder is read once.
	 * An upload or a delete refreshes it.
	 */
	private uploadedCache: ExtensionInfo[] | null = null;
	/**
	 * The built-in folder is read once in production.
	 * In development it is read live.
	 */
	private builtinCache: ExtensionInfo[] | null = null;

	constructor(
		private rows: ExtensionRepository,
		private shops: ShopRepository,
		private users: UserRepository,
		private owners: OwnerRepository,
	) {}

	/**
	 * The extensions that ship with the app (`EXTENSION_BUILTIN_DIRS`).
	 * A folder with a broken manifest is skipped with a warning.
	 * @returns The built-in extensions, by folder name.
	 */
	async builtins(): Promise<ExtensionInfo[]> {
		if (this.builtinCache) return this.builtinCache;
		// ponytail: in development the workspace is re-read on every call
		// so an edited manifest shows on the next request, with no restart
		const list: ExtensionInfo[] = [];
		for (const dir of EXTENSION_BUILTIN_DIRS)
			for (const found of await ExtensionFiles.scan(dir)) {
				const ext = await parseExtension(found);
				if (ext) list.push(ext);
			}
		if (!EXTENSION_BUILTIN_LIVE) this.builtinCache = list;
		return list;
	}

	/**
	 * Every extension of the platform, on or off.
	 * A built-in wins over an upload with the same key.
	 * @returns The built-ins, then the uploads.
	 */
	async catalog(): Promise<ExtensionInfo[]> {
		const builtins = await this.builtins();
		const keys = new Set(builtins.map((ext) => ext.key));
		return [
			...builtins,
			...(await this.#uploaded()).filter((ext) => !keys.has(ext.key)),
		];
	}

	/**
	 * The extensions a shop may use: the catalog, only the ones the platform
	 * admin switched on, and of those only the ones open to the shop's owner
	 * (an extension with a user list is for those users only).
	 * @param shop The shop, or its id.
	 * Pass the loaded shop when there is one: it saves a query.
	 * Left out = every switched-on extension, for any owner.
	 * @returns The extensions, in catalog order.
	 */
	async available(shop?: number | Shop): Promise<ExtensionInfo[]> {
		const rules = await this.rows.globalRules();
		const owner =
			shop === undefined
				? null
				: typeof shop === "object"
					? shop.owner_id
					: ((await this.shops.find(shop))?.owner_id ?? -1);
		return (await this.catalog()).filter(function allowed(ext) {
			const rule = rules.get(ext.key);
			if (!rule?.enabled) return false;
			return owner === null || !rule.users.length || rule.users.includes(owner);
		});
	}

	/**
	 * Every extension of the platform with its global switch, for Admin ›
	 * Global Extensions, in the request's language.
	 * @returns One row per extension.
	 */
	async platformList(): Promise<PlatformExtensionRow[]> {
		const rules = await this.rows.globalRules();
		const builtin = new Set((await this.builtins()).map((ext) => ext.key));
		const emails = await this.users.emailsById([
			...new Set([...rules.values()].flatMap((rule) => rule.users)),
		]);
		return (await this.catalog()).map((ext) =>
			this.#platformRow(ext, rules.get(ext.key), builtin, emails),
		);
	}

	/**
	 * Switch an extension on or off for all shops.
	 * Off, it runs in no shop and no shop lists it; each shop's settings stay.
	 * @param key The extension key.
	 * @param enabled On or off.
	 * @returns `{errors}` for an unknown key, `{}` when saved.
	 */
	async setGlobal(key: string, enabled: boolean): Promise<{ errors?: Errors }> {
		const errors = await this.#unknownKey(key);
		if (errors) return { errors };
		await this.rows.setGlobal(key, enabled);
		return {};
	}

	/**
	 * Open an extension to some users only, or to everyone again.
	 * Their shops list it and run it; other users' shops don't.
	 * @param key The extension key.
	 * @param emails The users' emails (owners only); [] = every user.
	 * @returns `{errors}` (`users`) for an unknown key or email.
	 * `{}` when saved.
	 */
	async setUsers(key: string, emails: string[]): Promise<{ errors?: Errors }> {
		const errors = await this.#unknownKey(key);
		if (errors) return { errors };
		const ids = await this.users.ownerIdsByEmail(emails);
		const unknown = emails.find((email) => !ids.has(email));
		if (unknown)
			return {
				errors: { users: t("server.ext_user_unknown", { email: unknown }) },
			};
		await this.rows.setUsers(key, [...new Set(ids.values())]);
		return {};
	}

	/**
	 * Users the platform admin may pick for "Available to".
	 * Owners by name or email.
	 * @param q What was typed.
	 * @returns Their emails (the picker's chips) and whether more match.
	 */
	async userChoices(q: string): Promise<{ places: string[]; more: boolean }> {
		const page = await this.owners.page(q, 1, EXTENSION_USER_CHOICES);
		return {
			places: page.data.map((owner) => owner.email),
			more: page.total > page.data.length,
		};
	}

	/**
	 * Delete an uploaded extension: its code and its global switch.
	 * The shops' settings stay, so uploading it again brings them back.
	 * A built-in one can't be deleted.
	 * @param key The extension key.
	 * @returns `{errors}` when it is built in or unknown, `{}` when deleted.
	 */
	async remove(key: string): Promise<{ errors?: Errors }> {
		if (this.#hasKey(await this.builtins(), key))
			return { errors: { key: t("server.ext_builtin_delete") } };
		if (!this.#hasKey(await this.#uploaded(), key))
			return { errors: { key: t("server.ext_unknown") } };
		await ExtensionFiles.remove(`${this.#platformDir()}/${key}`);
		await this.rows.forgetGlobal(key);
		this.uploadedCache = null;
		return {};
	}

	/**
	 * Move the zips shops uploaded before the catalog was one for the platform
	 * (`<shop>/<key>/<stamp>/`) into the platform folder, on boot.
	 * The newest version of each key wins, whichever shop it came from.
	 * A key that is built in, or already in the catalog, is left alone.
	 * So a second boot moves nothing.
	 * ponytail: the versions left behind stay on disk (nothing is deleted);
	 * an admin may remove `<EXTENSION_UPLOAD_DIR>/<shop>/` folders by hand.
	 */
	async adoptShopUploads(): Promise<void> {
		const found = await ExtensionFiles.scan(
			EXTENSION_UPLOAD_DIR,
			`[0-9]*/*/*/${EXTENSION_MANIFEST}`,
		);
		if (!found.length) return;
		const taken = new Set((await this.catalog()).map((ext) => ext.key));
		// newest first
		found.sort((a, b) => this.#stampOf(b.dir) - this.#stampOf(a.dir));
		for (const { dir, manifest } of found) {
			const key = (manifest as { key?: unknown } | null)?.key;
			if (typeof key !== "string" || !KEY.test(key) || taken.has(key)) continue;
			taken.add(key);
			await ExtensionFiles.move(
				dir,
				`${this.#platformDir()}/${key}/${this.#stampOf(dir)}`,
			);
			this.uploadedCache = null;
		}
	}

	/**
	 * Upload a zip to the platform catalog (the platform admin).
	 * It is unpacked into a fresh versioned folder.
	 * Its manifest and entry module are checked, older versions dropped.
	 * A new key starts off for all shops; a re-upload keeps its switch.
	 * A key that is built in is refused: its updates ship with the app.
	 * @param file The zip as uploaded.
	 * @returns `{errors}` (`file`) when it can't be added, else `{key}`.
	 */
	async upload(file: File): Promise<Installed> {
		if (file.size > MAX_EXTENSION_ZIP_BYTES)
			return { errors: { file: t("server.ext_zip_too_large") } };
		let files: Record<string, Uint8Array>;
		let manifest: ExtensionManifest;
		try {
			files = ExtensionFiles.unpack(new Uint8Array(await file.arrayBuffer()));
			const parsed = ExtensionManifest.safeParse(
				JSON.parse(new TextDecoder().decode(files[EXTENSION_MANIFEST])),
			);
			if (!parsed.success)
				return {
					errors: {
						file: `${EXTENSION_MANIFEST}: ${parsed.error.issues[0]?.message}`,
					},
				};
			manifest = parsed.data;
		} catch (error) {
			return { errors: { file: this.#zipProblem(error) } };
		}
		for (const needed of manifestFiles(manifest))
			if (!files[needed])
				return {
					errors: {
						file: `${EXTENSION_MANIFEST} points at ${needed}, which is not in the zip`,
					},
				};
		if (this.#hasKey(await this.builtins(), manifest.key))
			return {
				errors: { file: t("server.ext_builtin", { key: manifest.key }) },
			};
		const home = `${this.#platformDir()}/${manifest.key}`;
		const dir = `${home}/${Date.now()}`;
		await ExtensionFiles.write(dir, files);
		const broken = await this.#checkEntryModule(dir, manifest);
		if (broken) {
			await ExtensionFiles.remove(dir);
			return { errors: { file: broken } };
		}
		for (const old of await ExtensionFiles.scan(
			home,
			`*/${EXTENSION_MANIFEST}`,
		))
			if (!old.dir.endsWith(dir)) await ExtensionFiles.remove(old.dir);
		this.uploadedCache = null;
		return { key: manifest.key };
	}

	/**
	 * Install from a link.
	 * The zip is downloaded, https only and capped in size and time,
	 * then handed to `upload`.
	 * Admin-only and https-only, so the server can't be made to fetch
	 * arbitrary internal addresses.
	 * @param url Where the zip is.
	 * @returns `{errors}` under `url` when it can't be downloaded.
	 * Otherwise `upload`'s answer, its refusals moved under `url` too.
	 */
	async fromUrl(url: string): Promise<Installed> {
		let source: URL;
		try {
			source = new URL(url.trim());
		} catch {
			return { errors: { url: t("server.ext_url_invalid") } };
		}
		if (source.protocol !== "https:")
			return { errors: { url: t("server.ext_url_invalid") } };
		const zip = await this.#download(source);
		if (!zip.ok) return { errors: { url: zip.error } };
		const installed = await this.upload(
			new File(
				[zip.bytes.buffer as ArrayBuffer],
				source.pathname.split("/").pop() || "extension.zip",
				{ type: "application/zip" },
			),
		);
		return installed.errors
			? {
					errors: {
						url: installed.errors.file ?? Object.values(installed.errors)[0]!,
					},
				}
			: installed;
	}

	/**
	 * The zips the platform admin uploaded: `platform/<key>/<stamp>/`,
	 * newest stamp of each key wins. Read once and remembered.
	 * @returns The uploaded extensions, in upload order.
	 */
	async #uploaded(): Promise<ExtensionInfo[]> {
		if (this.uploadedCache) return this.uploadedCache;
		const newest: ExtensionInfo[] = [];
		const seen = new Set<string>();
		// the scan is sorted, so reading it backwards
		// hands the newest stamp of a key first
		for (const found of (
			await ExtensionFiles.scan(
				this.#platformDir(),
				`*/*/${EXTENSION_MANIFEST}`,
			)
		).reverse()) {
			const ext = await parseExtension(found);
			if (ext && !seen.has(ext.key)) {
				seen.add(ext.key);
				newest.push(ext);
			}
		}
		this.uploadedCache = newest.reverse();
		return this.uploadedCache;
	}

	/**
	 * One row of Admin › Global Extensions.
	 * @param ext The extension.
	 * @param rule Its global switch and user list, when it has one.
	 * @param builtin The keys of the built-in extensions.
	 * @param emails The email of every user some rule names, by id.
	 * @returns The row, in the request's language.
	 */
	#platformRow(
		ext: ExtensionInfo,
		rule: GlobalRule | undefined,
		builtin: Set<string>,
		emails: Map<number, string>,
	): PlatformExtensionRow {
		const manifest = localizedManifest(ext);
		return {
			key: ext.key,
			name: manifest.name,
			version: ext.version,
			description: manifest.description,
			icon: logoUrl(ext),
			builtin: builtin.has(ext.key),
			enabled: rule?.enabled ?? false,
			// a user deleted since drops off the list
			users: (rule?.users ?? []).flatMap((id) => emails.get(id) ?? []),
		};
	}

	/**
	 * The refusal for a key the catalog does not have.
	 * @param key The extension key.
	 * @returns The errors to show, or null when the key is known.
	 */
	async #unknownKey(key: string): Promise<Errors | null> {
		if (this.#hasKey(await this.catalog(), key)) return null;
		return { key: t("server.ext_unknown") };
	}

	/**
	 * Import the entry module now.
	 * A module that can't even load is refused at upload.
	 * So is a gateway that can't take money, or a tool with no route.
	 * The alternative is a failure when the first order or buyer arrives.
	 * @param dir Where the zip was unpacked.
	 * @param manifest Its manifest.
	 * @returns What to show the admin, or null when the module is fine.
	 */
	async #checkEntryModule(
		dir: string,
		manifest: ExtensionManifest,
	): Promise<string | null> {
		try {
			const mod = await ExtensionLoader.load(dir, manifest.main);
			const missing = missingPaymentExports(manifest, mod);
			if (missing.length)
				throw new Error(
					`a ${manifest.payment!.mode} payment must \`export const payment\` with ${missing.join(", ")}`,
				);
			const routes = missingToolRoutes(manifest, mod);
			if (routes.length)
				throw new Error(`tools: \`routes\` has no "${routes[0]}"`);
			return null;
		} catch (error) {
			return `${manifest.main}: ${messageOf(error)}`;
		}
	}

	/**
	 * Fetch a zip over https, giving up on size or time.
	 * @param source The link.
	 * @returns The bytes, or the message for the admin.
	 */
	async #download(source: URL): Promise<Downloaded> {
		try {
			const got = await Outbound.fetch(
				source,
				{
					signal: AbortSignal.timeout(EXTENSION_FETCH_TIMEOUT_MS),
					headers: { accept: "application/zip, application/octet-stream" },
				},
				MAX_EXTENSION_ZIP_BYTES,
			);
			if (!got)
				return {
					ok: false,
					error: t("server.ext_download_failed", { reason: "blocked" }),
				};
			if (!got.res.ok)
				return {
					ok: false,
					error: t("server.ext_url_http", { status: got.res.status }),
				};
			return { ok: true, bytes: got.bytes };
		} catch (error) {
			if (error instanceof Error && error.name === "TooLarge")
				return { ok: false, error: t("server.ext_zip_too_large") };
			return {
				ok: false,
				error: t("server.ext_download_failed", {
					reason:
						error instanceof Error && error.name === "TimeoutError"
							? t("server.ext_download_timeout")
							: messageOf(error),
				}),
			};
		}
	}

	/**
	 * Why a zip could not be opened.
	 * @param error What unpacking or parsing threw.
	 * @returns The message for the admin.
	 */
	#zipProblem(error: unknown): string {
		if (error instanceof SyntaxError)
			return `${EXTENSION_MANIFEST} is not valid JSON`;
		return messageOf(error, t("server.ext_zip_unreadable"));
	}

	/**
	 * Where the platform's uploaded zips are unpacked.
	 * @returns `<EXTENSION_UPLOAD_DIR>/platform`.
	 */
	#platformDir(): string {
		return `${EXTENSION_UPLOAD_DIR}/${EXTENSION_PLATFORM_DIR}`;
	}

	/**
	 * The upload stamp of a version folder (`…/<key>/<stamp>`).
	 * @param dir The folder.
	 * @returns The stamp (the upload time in ms), 0 when it is not a number.
	 */
	#stampOf(dir: string): number {
		return Number(dir.split("/").at(-1)) || 0;
	}

	/**
	 * Is an extension with this key in the list?
	 * @param list The extensions to look in.
	 * @param key The extension key.
	 * @returns True when one has it.
	 */
	#hasKey(list: ExtensionInfo[], key: string): boolean {
		return list.some((ext) => ext.key === key);
	}
}
