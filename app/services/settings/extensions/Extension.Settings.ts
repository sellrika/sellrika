import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { ExtensionRepository } from "@repositories/Extension.Repository";
import { PaymentMethodRepository } from "@repositories/PaymentMethod.Repository";
import type { ShopExtension } from "@models/Extension";
import type {
	ExtensionField,
	ExtensionInput,
} from "@validators/Extension.Validator";
import { encrypt } from "@helpers/crypto";
import { EXTENSION_CONFIG_SLOT } from "@constants/Extension.Constant";
import { messageOf } from "@helpers/error";
import { ExtensionCatalog } from "./Extension.Catalog";
import { configState } from "./Extension.Config";
import { isFilled, parseSetting } from "./Extension.Field";
import {
	assetUrl,
	byKey,
	localizedManifest,
	logoUrl,
	stringsOf,
} from "./Extension.Manifest";
import type {
	Config,
	Errors,
	ExtensionInfo,
	ExtensionRow,
} from "./types/Extension.Types";

/**
 * What each shop does with the catalog (Settings › Extensions).
 * A shop enables an extension and configures it for itself.
 */
@Service()
export class ExtensionSettings {
	constructor(
		private rows: ExtensionRepository,
		private methods: PaymentMethodRepository,
		private catalog: ExtensionCatalog,
	) {}

	/**
	 * Every extension the platform switched on, with the shop's state on it,
	 * for Settings › Extensions, in the request's language.
	 * @param shopId The active shop.
	 * @returns One row per available extension.
	 */
	async list(shopId: number): Promise<ExtensionRow[]> {
		const installed = new Map(
			(await this.rows.allForShop(shopId)).map((row) => [row.key, row]),
		);
		return (await this.catalog.available(shopId)).map((ext) =>
			this.#shopRow(ext, installed.get(ext.key)),
		);
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
	async save(
		shopId: number,
		key: string,
		input: ExtensionInput,
	): Promise<{ errors?: Errors }> {
		const ext = byKey(await this.catalog.available(shopId), key);
		if (!ext) return { errors: { key: t("server.ext_unknown") } };
		const stored = (await this.rows.find(shopId, key))?.config ?? {};
		for (const field of localizedManifest(ext).fields) {
			if (input.config) {
				const errors = this.#applySetting(
					field,
					input.config[field.name] ?? "",
					stored,
				);
				if (errors) return { errors };
			}
			// a half-filled extension may be saved while it is off
			// the one that runs must be complete
			if (
				input.enabled &&
				field.required &&
				!isFilled(field, stored[field.name])
			)
				return {
					errors: {
						[`config.${field.name}`]: t("server.ext_field_required", {
							label: field.label,
						}),
					},
				};
		}
		await this.rows.upsert(shopId, key, input.enabled, stored);
		// its own payment method follows the switch
		// it is named in the language of the person who switched it on
		const method = localizedManifest(ext).payment_method;
		if (method)
			await this.methods.syncExtension(shopId, key, input.enabled, method);
		if (input.enabled && ext.payment)
			await this.#switchOffOtherGateways(shopId, key);
		return {};
	}

	/**
	 * One row of Settings › Extensions.
	 * @param ext The extension.
	 * @param row The shop's saved state of it, when it was ever installed.
	 * @returns The row, in the request's language. Never a secret value.
	 */
	#shopRow(ext: ExtensionInfo, row: ShopExtension | undefined): ExtensionRow {
		const { main: _main, help_url, ...manifest } = localizedManifest(ext);
		const form = ext.slots.find((slot) => slot.name === EXTENSION_CONFIG_SLOT);
		return {
			...manifest,
			...configState(manifest.fields, row?.config),
			payment: manifest.payment ?? null,
			icon: logoUrl(ext),
			config_script: form ? assetUrl(ext, form.script) : null,
			// only its own form reads them
			strings: form ? stringsOf(ext) : {},
			help_url: help_url ?? null,
			installed: !!row,
			enabled: row?.enabled ?? false,
		};
	}

	/**
	 * One shop takes money through one gateway:
	 * switching this one on switches the others off (their keys stay).
	 * @param shopId The active shop.
	 * @param keep The gateway that was just switched on.
	 */
	async #switchOffOtherGateways(shopId: number, keep: string) {
		const gateways = new Set(
			(await this.catalog.available(shopId))
				.filter((ext) => ext.payment)
				.map((ext) => ext.key),
		);
		for (const row of await this.rows.allForShop(shopId))
			if (row.enabled && row.key !== keep && gateways.has(row.key))
				await this.rows.upsert(shopId, row.key, false, row.config);
	}

	/**
	 * One setting from the form written into the settings to store.
	 * It is read by its type, and encrypted when it is a secret.
	 * @param field The field.
	 * @param sent What the form sent for it.
	 * @param into The settings being built, which are the stored ones.
	 * A blank secret keeps what is already there.
	 * @returns The errors to show the admin, or null when the value was stored.
	 */
	#applySetting(
		field: ExtensionField,
		sent: Config[string],
		into: Config,
	): Errors | null {
		const parsed = parseSetting(field, sent);
		if (parsed.error !== undefined)
			return {
				[`config.${field.name}${parsed.at ? `.${parsed.at}` : ""}`]:
					parsed.error,
			};
		if (!field.secret) {
			into[field.name] = parsed.value!;
			return null;
		}
		// blank = keep the stored one
		if (!parsed.value) return null;
		try {
			into[field.name] = encrypt(parsed.value as string);
		} catch (error) {
			return {
				[`config.${field.name}`]: messageOf(
					error,
					t("server.ext_encrypt_failed"),
				),
			};
		}
		return null;
	}
}
