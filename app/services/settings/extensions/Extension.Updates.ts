import { app } from "@config/app";
import { Service } from "@xcore/di";
import { Outbound } from "@xcore/http/Outbound";
import { t } from "@xcore/i18n/I18n";
import { messageOf } from "@helpers/error";
import {
	EXTENSION_UPDATE_MAX_BYTES,
	EXTENSION_UPDATE_TIMEOUT_MS,
} from "@constants/Extension.Constant";
import { ExtensionUpdateInfo } from "@validators/Extension.Validator";
import type { Errors } from "@validators/validate";
import { ExtensionCatalog, type Installed } from "./Extension.Catalog";
import type { ExtensionInfo, ExtensionUpdate } from "./types/Extension.Types";

/**
 * Finds and installs newer versions of uploaded extensions.
 * Only an extension whose manifest has `update_url` takes part.
 * Its author keeps a JSON file there (`ExtensionUpdateInfo`).
 * A job asks every 6 hours and once on boot. The answers are kept
 * in memory only, like the app's own release check.
 * Built-in extensions ship with the app and are never asked.
 */
@Service()
export class ExtensionUpdates {
	/** The newest version each extension's `update_url` named, by key. */
	latest = new Map<string, ExtensionUpdateInfo>();

	/**
	 * @param catalog The platform's extensions.
	 */
	constructor(private catalog: ExtensionCatalog) {}

	/**
	 * Ask every uploaded extension's `update_url` (the background job).
	 * A failure keeps what was known for that one and never throws.
	 * `UPDATE_CHECK=0` turns it off: the server then calls nobody.
	 */
	async run() {
		if (!app.updateCheck) return;
		for (const ext of await this.catalog.uploaded()) await this.#check(ext);
	}

	/**
	 * Ask one extension's `update_url` now, after an upload.
	 * So its badge shows at once, not at the next run of the job.
	 * Never awaited by the upload, never throws.
	 * @param key The extension key.
	 */
	checkSoon(key: string) {
		if (!app.updateCheck) return;
		this.#checkKey(key).catch(function ignore() {});
	}

	/**
	 * Ask one uploaded extension's `update_url`, found by its key.
	 * @param key The extension key.
	 */
	async #checkKey(key: string) {
		for (const ext of await this.catalog.uploaded())
			if (ext.key === key) await this.#check(ext);
	}

	/**
	 * The newer version of one extension, when there is one.
	 * @param ext The extension as installed.
	 * @returns The update, or null when it is the newest (or not known).
	 */
	update(ext: ExtensionInfo): ExtensionUpdate | null {
		const info = this.latest.get(ext.key);
		if (!info || !ext.update_url || !this.#newer(info.version, ext.version))
			return null;
		return { version: info.version, notes: info.notes };
	}

	/**
	 * Install the newer version of an uploaded extension.
	 * The `update_url` is asked again, so the admin gets what is out now.
	 * The zip goes through every check of an upload (`app_version`
	 * included), and must have the same key and the version it named.
	 * Settings and switches stay, like any re-upload.
	 * The link must still name the version the admin approved.
	 * A newer one is refused, and the badge then shows it.
	 * @param key The extension key.
	 * @param version The version the admin saw and approved.
	 * @returns `{key}` when updated, else `{errors}` under `update`.
	 */
	async install(key: string, version: string): Promise<Installed> {
		let ext: ExtensionInfo | undefined;
		for (const e of await this.catalog.uploaded()) if (e.key === key) ext = e;
		if (!ext?.update_url)
			return { errors: { update: t("server.ext_update_none") } };
		const asked = await this.#ask(ext.update_url);
		if ("error" in asked) return { errors: { update: asked.error } };
		this.latest.set(key, asked.info);
		if (!this.#newer(asked.info.version, ext.version))
			return { errors: { update: t("server.ext_update_none") } };
		if (asked.info.version !== version)
			return {
				errors: {
					update: t("server.ext_update_changed", {
						version: asked.info.version,
					}),
				},
			};
		const r = await this.catalog.fromUrl(asked.info.url, {
			key,
			version: asked.info.version,
		});
		if (r.errors) return { errors: this.#underUpdate(r.errors) };
		return r;
	}

	/**
	 * Ask one uploaded extension's `update_url` and remember the answer.
	 * No `update_url` forgets what was known.
	 * A failure is a warning and keeps what was known.
	 * @param ext The extension as installed.
	 */
	async #check(ext: ExtensionInfo) {
		if (!ext.update_url) {
			this.latest.delete(ext.key);
			return;
		}
		const info = await this.#ask(ext.update_url);
		if ("info" in info) this.latest.set(ext.key, info.info);
		else console.warn(`[extensions] ${ext.key} update check: ${info.error}`);
	}

	/**
	 * Read one `update_url`: a public https link, capped in size and time.
	 * @param url The link from the manifest.
	 * @returns The newest version it names, or why it could not be read.
	 */
	async #ask(
		url: string,
	): Promise<{ info: ExtensionUpdateInfo } | { error: string }> {
		try {
			const got = await Outbound.fetch(
				url,
				{
					signal: AbortSignal.timeout(EXTENSION_UPDATE_TIMEOUT_MS),
					headers: { accept: "application/json" },
				},
				EXTENSION_UPDATE_MAX_BYTES,
			);
			if (!got)
				return {
					error: t("server.ext_download_failed", { reason: "blocked" }),
				};
			if (!got.res.ok)
				return { error: t("server.ext_url_http", { status: got.res.status }) };
			const parsed = ExtensionUpdateInfo.safeParse(
				JSON.parse(new TextDecoder().decode(got.bytes)),
			);
			if (!parsed.success) return { error: t("server.ext_update_bad_answer") };
			return { info: parsed.data };
		} catch (error) {
			return {
				error: t("server.ext_download_failed", { reason: messageOf(error) }),
			};
		}
	}

	/**
	 * Is one version higher than another?
	 * @param next The version the `update_url` named, like `1.2.0`.
	 * @param installed The installed version (free text in a manifest).
	 * @returns True when `next` is higher. False when either is no version.
	 */
	#newer(next: string, installed: string): boolean {
		try {
			return Bun.semver.order(next, installed) > 0;
		} catch {
			return false;
		}
	}

	/**
	 * An install's refusal, moved to the field the page shows for an update.
	 * @param errors The refusal of `fromUrl` (under `url`).
	 * @returns The same message under `update`.
	 */
	#underUpdate(errors: Errors): Errors {
		return { update: errors.url ?? Object.values(errors)[0] ?? "" };
	}
}
