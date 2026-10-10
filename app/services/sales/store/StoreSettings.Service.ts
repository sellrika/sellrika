import { Service } from "@xcore/di";
import { DAY_MS } from "@constants/Time.Constant";
import {
	SLUG_CHANGES_PER_WEEK,
	SLUG_RENAMES_KEY,
} from "@constants/Store.Constant";
import { SettingRepository } from "@repositories/Setting.Repository";
import { app } from "@config/app";
import { Url } from "@xcore/http/Url";
import { t } from "@xcore/i18n/I18n";
import type { Shop } from "@models/Shop";
import { GatewayRegistry } from "@gateways/Gateway.Registry";
import { ShopRepository } from "@repositories/Shop.Repository";
import { StorePageRepository } from "@repositories/StorePage.Repository";
import { encrypt } from "@helpers/crypto";
import { messageOf } from "@helpers/error";
import { sanitizeHtml } from "@helpers/html";
import { maskFields } from "@helpers/secretFields";
import type {
	OnlineStoreInput,
	StoreDeliveryInput,
	StoreLanguagesInput,
	StoreThemeInput,
	StoreCurrenciesInput,
	StorePageInput,
} from "@validators/Store.Validator";
import { ExchangeRateService } from "@services/settings/ExchangeRate.Service";
import { DomainService } from "@services/sales/Domain.Service";
import {
	FIREBASE_FIELDS,
	type FirebaseConfig,
} from "@constants/Store.Constant";
import { type StoredCreds, StorePaymentService } from "./StorePayment.Service";

type Errors = Record<string, string>;

/**
 * The storefront content fields (banner + contact block).
 * Saved as-is, blank = null.
 */
const CONTENT = [
	"banner",
	"phone",
	"address",
	"hours",
	"facebook",
	"instagram",
	"viber",
	"whatsapp",
] as const;

/**
 * Settings a caller may leave out. They default to "off".
 * Older tests and the reconcile fixtures send only the store's own fields.
 */
const OPTIONAL = [
	"manual_gateways",
	"alert_email",
	"telegram_bot_token",
	"telegram_chat_id",
	"ga_id",
	"meta_pixel_id",
	"banner_type",
	"support_email",
	"customer_logins",
	"firebase",
	...CONTENT,
] as const;

/**
 * What `updateSettings` takes.
 * The validated online-store form, with the optional parts optional.
 */
export type StoreSettingsArgs = Omit<
	OnlineStoreInput,
	(typeof OPTIONAL)[number]
> &
	Partial<Pick<OnlineStoreInput, (typeof OPTIONAL)[number]>>;

/**
 * The settings of a shop's online store.
 * The /online-store admin page and the custom store pages.
 */
@Service()
export class StoreSettingsService {
	constructor(
		private shops: ShopRepository,
		private pages: StorePageRepository,
		private gateways: GatewayRegistry,
		private exchange: ExchangeRateService,
		private domains: DomainService,
		private settingRows: SettingRepository,
	) {}

	/**
	 * When an account changed a store address in the last week.
	 * Kept in `settings`, so a restart does not forget it.
	 * @param ownerId The account's owner.
	 * @returns The times (ms), oldest first.
	 */
	async #renames(ownerId: number): Promise<number[]> {
		const raw = await this.settingRows.get(`${SLUG_RENAMES_KEY}:${ownerId}`);
		const times: number[] = raw ? JSON.parse(raw) : [];
		return times.filter((at) => at > Date.now() - 7 * DAY_MS);
	}

	/**
	 * Settings for the admin page.
	 * The manual options' stored fields come back, so the page can render
	 * one card each.
	 * Secret values never do. Only whether each is stored.
	 * The online gateway is an extension (/extensions).
	 * @param shopId Owning shop.
	 * @returns Storefront settings, the manual options switched on, their
	 *   fields and a `secret_set` map.
	 */
	async settings(shopId: number) {
		const shop = (await this.shops.find(shopId))!;
		const all = StorePaymentService.storedCreds(
			await this.shops.credentials(shopId),
		);
		const credentials: Record<string, Record<string, string>> = {};
		const secret_set: Record<string, Record<string, boolean>> = {};
		for (const gw of this.gateways.all()) {
			const masked = maskFields(gw.fields, all[gw.key] ?? {});
			credentials[gw.key] = masked.credentials;
			secret_set[gw.key] = masked.secret_set;
		}
		return {
			enabled: shop.online_enabled,
			slug: shop.slug ?? "",
			domain: shop.domain ?? "",
			// The free address with `{slug}` in place of the slug.
			// So the page previews it while the slug is typed.
			subdomain_url: Url.storeOrigin({ domain: null, slug: "{slug}" }),
			// The DNS records to add and where the domain stands.
			// null = the merchant sets up DNS + SSL alone.
			domain_setup: await this.domains.info(
				shop.id,
				shop.domain,
				shop.domain_status,
			),
			google_site_verification: shop.google_site_verification ?? "",
			template: shop.online_template,
			manual_gateways: shop.manual_gateways,
			credentials,
			secret_set,
			alert_email: shop.alert_email ?? "",
			telegram_chat_id: shop.telegram_chat_id ?? "",
			telegram_token_set: !!(await this.shops.alertToken(shopId)),
			ga_id: shop.ga_id ?? "",
			meta_pixel_id: shop.meta_pixel_id ?? "",
			banner: shop.banner ?? "",
			banner_type: shop.banner_type,
			phone: shop.phone ?? "",
			address: shop.address ?? "",
			hours: shop.hours ?? "",
			facebook: shop.facebook ?? "",
			instagram: shop.instagram ?? "",
			viber: shop.viber ?? "",
			whatsapp: shop.whatsapp ?? "",
			support_email: shop.support_email ?? "",
			// the Delivery section (its own form → updateDelivery)
			country: shop.country ?? "",
			pickup: shop.pickup,
			guided_address: shop.guided_address,
			delivery_zones: shop.delivery_zones,
			// The Languages section (its own form → updateLanguages).
			// The default comes first.
			languages: shop.languages,
			// The shop's own colours and font per built-in theme
			// (its own form → updateTheme).
			theme_config: shop.theme_config,
			// The Currencies section (its own form → updateCurrencies).
			// Plus the automatic rates from the shop's currency.
			currencies: shop.currencies,
			exchange: await this.exchange.forCurrency(shop.currency),
			// Customer accounts: the providers switched on and the Firebase
			// web config. Its values are public, so they come back as saved.
			customer_logins: shop.customer_logins,
			firebase: {
				api_key: "",
				auth_domain: "",
				project_id: "",
				app_id: "",
				...(shop.firebase_config ?? {}),
			} as FirebaseConfig,
		};
	}

	/**
	 * Save the Delivery section of /online-store.
	 * Where the shop is, the shipping zones, whether the buyer may
	 * collect in store and whether the checkout's address uses lists.
	 * @param shopId Owning shop.
	 * @param d Validated delivery settings.
	 * @returns When it is saved.
	 */
	updateDelivery(shopId: number, d: StoreDeliveryInput) {
		return this.shops.updateDelivery(shopId, d);
	}

	/**
	 * Save the Languages section of /online-store.
	 * These are the languages the store offers.
	 * @param shopId Owning shop.
	 * @param d Validated locales, the default first.
	 * @returns When it is saved.
	 */
	updateLanguages(shopId: number, d: StoreLanguagesInput) {
		return this.shops.updateLanguages(shopId, d.languages);
	}

	/**
	 * Save the shop's own colours and font for one built-in theme.
	 * A look with nothing picked is taken out, so the theme is its own again.
	 * @param shopId Owning shop.
	 * @param d The theme and its checked look.
	 * @returns When it is saved.
	 */
	async updateTheme(shopId: number, d: StoreThemeInput) {
		const shop = await this.shops.find(shopId);
		if (!shop) return;
		const { template, ...look } = d;
		const config = { ...shop.theme_config };
		if (Object.values(look).some(Boolean)) config[template] = look;
		else delete config[template];
		await this.shops.updateThemeConfig(shopId, config);
	}

	/**
	 * Save the Currencies section of /online-store.
	 * These are the extra currencies the store shows prices in.
	 * The shop's own currency is never one of them.
	 * @param shop The shop.
	 * @param d Validated currencies, each with its manual rate or null.
	 * @returns When it is saved.
	 */
	updateCurrencies(shop: Shop, d: StoreCurrenciesInput) {
		return this.shops.updateCurrencies(
			shop.id,
			d.currencies.filter((c) => c.code !== shop.currency),
		);
	}

	/**
	 * Save the online-store settings.
	 * That includes the manual payment options and their fields.
	 * `manual_gateways` are the cash-on-delivery / bank-transfer options
	 * switched on. Only those have to be complete.
	 * A blank secret keeps the stored one.
	 * The online gateway is switched on as an extension, not here.
	 * @param shopId Owning shop.
	 * @param d Validated slug, domain, Search Console token, enabled flag,
	 *   template, manual options and their fields.
	 *   Also the new-order alert channels (a blank bot token keeps the
	 *   stored one), the analytics ids, the banner, the contact block and
	 *   the support email.
	 * @returns `{errors}` when something is wrong, `{}` when saved.
	 */
	async updateSettings(
		shopId: number,
		d: StoreSettingsArgs,
	): Promise<{ errors?: Errors }> {
		const manual = [...new Set(d.manual_gateways ?? [])];
		if (manual.some((k) => !this.gateways.get(k)))
			return { errors: { gateway: t("store_server.unknown_payment_option") } };
		if (await this.shops.slugTaken(d.slug, shopId))
			return { errors: { slug: t("store_server.slug_taken") } };
		const before = await this.shops.find(shopId);
		// with one wildcard certificate a rename needs no new certificate
		const renames =
			before?.slug && before.slug !== d.slug && !app.domains.wildcardResolver
				? await this.#renames(before.owner_id)
				: null;
		if (renames && renames.length >= SLUG_CHANGES_PER_WEEK)
			return { errors: { slug: t("store_server.slug_too_many") } };
		// When we manage domains, only a live one is taken.
		// A shop that saved a domain it can't prove (no TXT record)
		// must not block the real owner, who takes it over here.
		const managed = this.domains.managed();
		if (d.domain && (await this.shops.domainTaken(d.domain, shopId, managed)))
			return {
				errors: { domain: t("store_server.domain_taken") },
			};
		if (d.domain && managed) await this.shops.releaseDomain(d.domain, shopId);
		const all = StorePaymentService.storedCreds(
			await this.shops.credentials(shopId),
		);
		const wrong = this.#mergeCredentials(all, d.credentials, manual);
		if (wrong) return { errors: wrong };
		// Telegram: the bot token is a secret.
		// A blank one keeps what is stored.
		// A chat id without any token can't work.
		let token = await this.shops.alertToken(shopId);
		if (d.telegram_bot_token) {
			try {
				token = encrypt(d.telegram_bot_token);
			} catch (e) {
				return {
					errors: {
						telegram_bot_token: messageOf(
							e,
							t("store_server.encrypt_token_failed"),
						),
					},
				};
			}
		}
		if (d.telegram_chat_id && !token)
			return {
				errors: { telegram_bot_token: t("store_server.bot_token_required") },
			};
		// Customer accounts: the Firebase web config may sit half-filled
		// while every provider is off.
		// Once one is on, it must be whole.
		const logins = [...new Set(d.customer_logins ?? [])];
		const firebase = d.firebase ?? {
			api_key: "",
			auth_domain: "",
			project_id: "",
			app_id: "",
		};
		if (logins.length)
			for (const f of FIREBASE_FIELDS)
				if (!firebase[f.name])
					return {
						errors: {
							[`firebase.${f.name}`]: t("store_server.field_required", {
								field: t(f.label),
							}),
						},
					};
		// A new domain waits for its DNS.
		// The check right after the save makes it live
		// when it already points here.
		const old = (await this.shops.find(shopId))!;
		const domainChanged = d.domain !== old.domain;
		// the address changes: count it for the account
		if (renames && before)
			await this.settingRows.set(
				`${SLUG_RENAMES_KEY}:${before.owner_id}`,
				JSON.stringify([...renames, Date.now()]),
			);
		await this.shops.updateOnline(shopId, {
			slug: d.slug,
			domain: d.domain,
			domain_status: !d.domain
				? ""
				: domainChanged
					? "pending"
					: old.domain_status,
			google_site_verification: d.google_site_verification,
			enabled: d.enabled,
			template: d.template,
			manual_gateways: manual,
			credentials: JSON.stringify(all),
			alert_email: d.alert_email ?? null,
			telegram_bot_token: token,
			telegram_chat_id: d.telegram_chat_id ?? null,
			ga_id: d.ga_id ?? null,
			meta_pixel_id: d.meta_pixel_id ?? null,
			banner: d.banner ?? null,
			banner_type: d.banner_type ?? "info",
			phone: d.phone ?? null,
			address: d.address ?? null,
			hours: d.hours ?? null,
			facebook: d.facebook ?? null,
			instagram: d.instagram ?? null,
			viber: d.viber ?? null,
			whatsapp: d.whatsapp ?? null,
			support_email: d.support_email ?? null,
			customer_logins: logins,
			firebase_config: FIREBASE_FIELDS.some((f) => firebase[f.name])
				? firebase
				: null,
		});
		// The Traefik file follows the domain.
		// The free subdomain follows the slug and the switch.
		if (
			domainChanged ||
			d.slug !== old.slug ||
			d.enabled !== old.online_enabled
		)
			await this.domains.run();
		return {};
	}

	/**
	 * Create or update a custom store page.
	 * The HTML body is sanitised before it's stored.
	 * @param shopId Owning shop.
	 * @param id Page to overwrite, or null to create one.
	 * @param d Validated title, slug, body and CSS.
	 * @returns `{errors}` when the slug clashes or the page is gone,
	 *   `{}` when saved.
	 */
	async savePage(
		shopId: number,
		id: number | null,
		d: StorePageInput,
	): Promise<{ errors?: Errors }> {
		if (await this.pages.slugTaken(shopId, d.slug, id ?? 0))
			return {
				errors: { slug: t("store_server.page_slug_taken") },
			};
		const page = {
			title: d.title,
			slug: d.slug,
			body: await sanitizeHtml(d.body),
			css: d.css,
		};
		if (id === null) await this.pages.create(shopId, page);
		else {
			if (!(await this.pages.find(id, shopId)))
				return { errors: { title: t("store_server.page_not_found") } };
			await this.pages.update(id, shopId, page);
		}
		return {};
	}

	/**
	 * Put the posted fields of the manual options into the stored ones.
	 * A posted secret is encrypted. A blank secret keeps the stored one.
	 * A half-filled option is fine while it is off.
	 * The ones the buyer can pick must be complete.
	 * @param all The stored fields by option key. Changed in place.
	 * @param posted The posted fields by option key.
	 * @param manual The options switched on.
	 * @returns The first error, on its own field, or null when all is well.
	 */
	#mergeCredentials(
		all: StoredCreds,
		posted: StoreSettingsArgs["credentials"],
		manual: string[],
	): Errors | null {
		for (const gw of this.gateways.all()) {
			const sent = posted[gw.key];
			const mine = all[gw.key] ?? {};
			for (const f of gw.fields) {
				const v = (sent?.[f.name] ?? "").trim();
				if (sent && f.secret) {
					// blank = keep the stored one
					if (v) {
						try {
							mine[f.name] = encrypt(v);
						} catch (e) {
							return {
								[`credentials.${gw.key}.${f.name}`]: messageOf(
									e,
									t("store_server.encrypt_key_failed"),
								),
							};
						}
					}
				} else if (sent) mine[f.name] = v;
				if (manual.includes(gw.key) && !mine[f.name])
					return {
						[`credentials.${gw.key}.${f.name}`]: t(
							"store_server.field_required",
							{ field: f.label },
						),
					};
			}
			all[gw.key] = mine;
		}
		return null;
	}
}
