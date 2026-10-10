import { t } from "@xcore/i18n/I18n";
import { decrypt } from "@helpers/crypto";
import type {
	ExtensionField,
	ExtensionManifest,
} from "@validators/Extension.Validator";
import { blankValue, isFilled } from "./Extension.Field";
import type { Config, ConfigState } from "./types/Extension.Types";

/**
 * The log line when a saved secret can no longer be read.
 * It was encrypted with another APP_KEY than the one the server runs with.
 * The admin sees `server.ext_secrets_unreadable` on /extensions instead.
 */
export const SECRETS_UNREADABLE =
	"The saved keys can't be read — APP_KEY changed since they were entered. Open Configure and enter them again.";

/**
 * The settings an installed extension runs with.
 * Every field, with the secrets decrypted.
 * @param manifest The extension's manifest.
 * @param stored The row's config (secrets encrypted).
 * @returns The field map, or null while a required field is missing.
 * @throws When APP_KEY no longer decrypts the stored secrets.
 */
export function decryptConfig(
	manifest: ExtensionManifest,
	stored: Config,
): Config | null {
	const config: Config = {};
	for (const field of manifest.fields) {
		const value = stored[field.name];
		if (field.required && !isFilled(field, value)) return null;
		config[field.name] =
			field.secret && typeof value === "string" && value
				? decrypt(value)
				: (value ?? blankValue(field));
	}
	return config;
}

/**
 * A theme's settings as the public storefront may see them.
 * Every field the admin filled in, with the secrets left out.
 * @param manifest The theme extension's manifest.
 * @param config Its decrypted settings.
 * @returns The safe subset.
 */
export function publicConfig(
	manifest: ExtensionManifest,
	config: Config,
): Config {
	const safe: Config = {};
	for (const field of manifest.fields)
		if (!field.secret) safe[field.name] = config[field.name]!;
	return safe;
}

/**
 * The shop's state of one extension for the /extensions page.
 * The values to show, and which secrets are set.
 * Whether it can run, and why it can't although it is installed.
 * @param fields The settings the extension declares.
 * @param stored The row's config.
 * Undefined when the shop never installed the extension.
 * @returns What the page shows. Never a secret value.
 */
export function configState(
	fields: ExtensionField[],
	stored: Config | undefined,
): ConfigState {
	const config: Config = {};
	const secret_set: Record<string, boolean> = {};
	let problem: string | null = null;
	for (const field of fields) {
		const value = stored?.[field.name];
		config[field.name] = field.secret ? "" : (value ?? blankValue(field));
		if (!field.secret) continue;
		secret_set[field.name] = !!value;
		// a stored secret the running APP_KEY can't open
		// the extension looks set up but never runs, so say so here
		if (typeof value === "string" && value)
			try {
				decrypt(value);
			} catch {
				problem = t("server.ext_secrets_unreadable");
			}
	}
	return {
		config,
		secret_set,
		problem,
		ready:
			!problem &&
			fields.every(
				(field) => !field.required || isFilled(field, stored?.[field.name]),
			),
	};
}
