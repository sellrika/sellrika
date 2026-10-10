import { z } from "zod";
import { t } from "@xcore/i18n/I18n";
import { app } from "@config/app";
import { LOCALES, type Locale } from "@i18n";
import { COUPON_CODE_MAX } from "@constants/Coupon.Constant";
import {
	StoreCustomerInput,
	StorePickupCustomerInput,
} from "./StoreCustomer.Validator";
import { COUNTRY_NAMES } from "@constants/Country.Constant";
import { POSTAL_SCOPES } from "@constants/Postal.Constant";
import { PLATFORM_DOMAIN } from "@constants/Domain.Constant";
import {
	RATE_SCHEDULES,
	STORE_CURRENCIES_MAX,
	type RateSchedule,
} from "@constants/Currency.Constant";
import {
	CUSTOMER_LOGINS,
	FIREBASE_FIELDS,
	RESERVED_SLUGS,
	STORE_BANNER_TYPES,
	STORE_FONTS,
	STORE_TEMPLATES,
	STORE_THEME_PREFIX,
} from "@constants/Store.Constant";
import { PHONE_PATTERN, SLUG_PATTERN } from "@constants/Validation.Constant";
import { HEX_COLOR } from "@helpers/color";
import { normalizeReference } from "@helpers/crypto";
import {
	blankToNull,
	credentials,
	optionalEmail,
} from "@validators/Fields.Validator";
import { cartItem, cartItems } from "@validators/Order.Validator";

/**
 * An optional free-text setting: trimmed, blank becomes null.
 * It does not take null as input, only text.
 * @param max The most characters.
 * @returns The schema.
 */
function text(max: number) {
	return z.string().trim().max(max).transform(blankToNull).default("");
}

/** A social page link: the full https:// address, blank becomes null. */
const link = z
	.string()
	.trim()
	.max(200)
	.refine(
		(v) => !v || /^https:\/\/[^\s"'<>]+$/.test(v),
		"validation.paste_full_link",
	)
	.transform(blankToNull)
	.default("");

/**
 * A Viber / WhatsApp number, typed any way.
 * It is kept as digits with the country code: what their chat links want.
 * Blank becomes null.
 * The first check refuses letters, so they are not quietly dropped
 * into "blank" by the digit filter after it.
 */
const chatNumber = z
	.string()
	.trim()
	.max(30)
	.refine((v) => !v || PHONE_PATTERN.test(v), "validation.chat_number")
	.transform((v) => v.replace(/\D/g, ""))
	.refine((v) => !v || /^\d{6,20}$/.test(v), "validation.chat_number")
	.transform(blankToNull)
	.default("");

/**
 * Cut what a person pasted down to the bare hostname.
 * The scheme, every leading `www.`, the port and the path are dropped.
 * @param v The pasted text, already trimmed and lower-cased.
 * @returns The hostname, like `shop.example.com`.
 */
function bareHost(v: string) {
	return v
		.replace(/^https?:\/\//, "")
		.replace(/^(www\.)+/, "")
		.replace(/[:/].*$/, "");
}

/**
 * Is this hostname one of the app's own, or a name under one?
 * The app's host, the store domain, the docs host and the CNAME target.
 * A shop must never answer on those.
 * @param v The hostname.
 * @returns True when it is reserved.
 */
function isOwnHost(v: string) {
	const own = [
		app.url ? new URL(app.url).hostname : "",
		app.domains.store,
		app.domains.developer,
		app.domains.cname,
	];
	return (
		v.includes(PLATFORM_DOMAIN) ||
		own.some(
			(h) =>
				!!h && (v === h.toLowerCase() || v.endsWith(`.${h.toLowerCase()}`)),
		)
	);
}

/**
 * Is this a domain name, or blank?
 * @param v The hostname.
 * @returns True for blank, or labels joined by dots.
 */
function isDomainOrBlank(v: string) {
	return (
		!v ||
		/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
			v,
		)
	);
}

/**
 * Is this a store template the app knows?
 * @param v The template name.
 * @returns True for a built-in template, or `ext:<key>`:
 *   a theme an extension brings (ExtensionService.themes).
 */
function isTemplate(v: string) {
	return (
		(STORE_TEMPLATES as readonly string[]).includes(v) ||
		new RegExp(`^${STORE_THEME_PREFIX}[a-z0-9][a-z0-9-]{1,49}$`).test(v)
	);
}

/**
 * One field of the shop's Firebase web config, as a form field.
 * @param f The field: its name and the key of its label.
 * @returns The field's name and its schema.
 */
function firebaseField(f: (typeof FIREBASE_FIELDS)[number]) {
	return [
		f.name,
		z
			.string()
			.trim()
			.max(200, {
				error: function tooLong() {
					return t("validation.field_too_long", { label: t(f.label) });
				},
			})
			.default(""),
	];
}

/**
 * PUT /online-store: the admin's online-store settings for the active shop.
 * `credentials` carries every manual payment option's fields at once
 * (`credentials[key][field]`, blank secret = keep).
 * The online gateway is an extension, switched on from /extensions.
 */
export const OnlineStoreInput = z.object({
	/**
	 * True = the online store is open.
	 * Left out = closed.
	 */
	enabled: z.boolean().default(false),
	/**
	 * The store's name in its address: `<slug>.<store domain>`.
	 * 3 to 50 characters: lower-case letters, digits and dashes.
	 * A reserved word (www, pos, mail…) is refused.
	 */
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(3, "validation.at_least_3_chars")
		.max(50)
		.regex(SLUG_PATTERN, "validation.slug_charset")
		.refine((v) => !RESERVED_SLUGS.has(v), "validation.slug_reserved"),
	/**
	 * Custom storefront domain, e.g. "shop.example.com".
	 * The merchant points the DNS here themselves.
	 * Anything the user pastes (scheme, www., port, path)
	 * is trimmed down to the bare hostname.
	 * Blank = no custom domain (saved as null).
	 */
	domain: z
		.string()
		.trim()
		.toLowerCase()
		.transform(bareHost)
		.refine(isDomainOrBlank, "validation.enter_domain")
		.refine((v) => !isOwnHost(v), "validation.domain_reserved")
		.transform(blankToNull)
		.default(""),
	/**
	 * Google Search Console "HTML tag" verification.
	 * The owner may paste the whole
	 * <meta name="google-site-verification" content="…"> tag
	 * or just its content. We keep the content.
	 * Blank = none (saved as null).
	 */
	google_site_verification: z
		.string()
		.trim()
		.max(300)
		.transform((v) => /content=["']([^"']+)["']/.exec(v)?.[1] ?? v)
		.refine(
			(v) => !v || /^[A-Za-z0-9_-]{8,100}$/.test(v),
			"validation.paste_meta_tag",
		)
		.transform(blankToNull)
		.default(""),
	/**
	 * A built-in template, or `ext:<key>`:
	 * a theme an extension brings (ExtensionService.themes).
	 */
	template: z.string().refine(isTemplate, "validation.template_unknown"),
	/**
	 * Manual options switched on (cod, bank_transfer).
	 * Checked against the registry in StoreService.
	 * Left out = none.
	 */
	manual_gateways: z.array(z.string().trim().max(30)).max(10).default([]),
	/**
	 * Every manual payment option's fields:
	 * `credentials[key][field]`.
	 * A blank secret keeps the stored one.
	 */
	credentials,
	/**
	 * New-order alerts to the owner (migration 0037):
	 * the email address the alert goes to.
	 * Blank = no email alert (saved as null).
	 */
	alert_email: optionalEmail,
	/**
	 * New-order alerts: the Telegram bot's token.
	 * From @BotFather ("123456789:ABC…").
	 * Blank = keep the stored one (it is a secret, never echoed back).
	 */
	telegram_bot_token: z
		.string()
		.trim()
		.max(100)
		.refine(
			(v) => !v || /^\d+:[A-Za-z0-9_-]{20,}$/.test(v),
			"validation.paste_bot_token",
		)
		.default(""),
	/**
	 * New-order alerts: the Telegram chat the bot writes to.
	 * A whole number, it may start with `-`.
	 * Blank = no Telegram alert (saved as null).
	 */
	telegram_chat_id: z
		.string()
		.trim()
		.max(30)
		.refine((v) => !v || /^-?\d+$/.test(v), "validation.chat_id_number")
		.transform(blankToNull)
		.default(""),
	/**
	 * Analytics loaded on every store page:
	 * the GA4 measurement id, like `G-ABC123`.
	 * Kept in upper case. Blank = off (saved as null).
	 */
	ga_id: z
		.string()
		.trim()
		.toUpperCase()
		.max(30)
		.refine(
			(v) => !v || /^G-[A-Z0-9]{4,20}$/.test(v),
			"validation.ga_id_format",
		)
		.transform(blankToNull)
		.default(""),
	/**
	 * Analytics loaded on every store page:
	 * the Meta Pixel id, 5 to 30 digits.
	 * Blank = off (saved as null).
	 */
	meta_pixel_id: z
		.string()
		.trim()
		.max(30)
		.refine((v) => !v || /^\d{5,30}$/.test(v), "validation.pixel_id_number")
		.transform(blankToNull)
		.default(""),
	/**
	 * Storefront content (migration 0038):
	 * the announcement line over the header.
	 * At most 200 characters. Blank = not shown.
	 */
	banner: text(200),
	/**
	 * The banner's tone, which sets its colour:
	 * `info`, `success`, `warning` or `danger`.
	 * Left out = `info`.
	 */
	banner_type: z.enum(STORE_BANNER_TYPES).default("info"),
	/**
	 * The shop's phone in the footer contact block.
	 * At most 40 characters. Blank = not shown.
	 */
	phone: text(40),
	/**
	 * The shop's address in the footer contact block.
	 * At most 300 characters. Blank = not shown.
	 */
	address: text(300),
	/**
	 * The opening hours in the footer contact block.
	 * At most 300 characters. Blank = not shown.
	 */
	hours: text(300),
	/**
	 * Where customers write about an order.
	 * Printed on order emails (migration 0032).
	 * Blank = the owner's account email.
	 */
	support_email: optionalEmail,
	/**
	 * The shop's Facebook page: the full https:// link.
	 * Blank = not shown.
	 */
	facebook: link,
	/**
	 * The shop's Instagram page: the full https:// link.
	 * Blank = not shown.
	 */
	instagram: link,
	/**
	 * The shop's Viber number, kept as digits.
	 * Blank = not shown.
	 */
	viber: chatNumber,
	/**
	 * The shop's WhatsApp number, kept as digits.
	 * Blank = not shown.
	 */
	whatsapp: chatNumber,
	/**
	 * Customer accounts (migration 0046):
	 * the sign-in providers switched on.
	 * `email`, `google` and / or `microsoft`. [] = accounts are off.
	 */
	customer_logins: z
		.array(z.enum(CUSTOMER_LOGINS))
		.max(CUSTOMER_LOGINS.length)
		.default([]),
	/**
	 * Customer accounts: the shop's Firebase web config
	 * behind the sign-in providers.
	 * The shape is checked here.
	 * Completeness (every field once a provider is on)
	 * is checked in StoreService.updateSettings.
	 */
	firebase: z
		.object(
			Object.fromEntries(FIREBASE_FIELDS.map(firebaseField)) as Record<
				(typeof FIREBASE_FIELDS)[number]["name"],
				z.ZodDefault<z.ZodString>
			>,
		)
		.default({ api_key: "", auth_domain: "", project_id: "", app_id: "" }),
});
/** A checked `OnlineStoreInput`. */
export type OnlineStoreInput = z.infer<typeof OnlineStoreInput>;

/**
 * POST /account/login on a store's host.
 * The Firebase ID token the browser's sign-in produced.
 * The server verifies it (Firebase.Api.ts).
 */
export const StoreLoginInput = z.object({
	/** The Firebase ID token: 20 to 4096 characters. */
	token: z
		.string()
		.trim()
		.min(20, "validation.sign_in_again")
		.max(4096, "validation.sign_in_again"),
});
/** A checked `StoreLoginInput`. */
export type StoreLoginInput = z.infer<typeof StoreLoginInput>;

/**
 * POST /account on a store's host.
 * What a signed-in customer may change about themselves:
 * name and phone (the checkout's own rules).
 */
export const StoreProfileInput = StoreCustomerInput.pick({
	name: true,
	phone: true,
});
/** A checked `StoreProfileInput`. */
export type StoreProfileInput = z.infer<typeof StoreProfileInput>;

/**
 * One delivery address kept on the account.
 * POST /account/addresses and POST /account/addresses/:id
 * on a store's host.
 * The checkout's own address + phone rules
 * (so a pick at the checkout passes as it is)
 * and an optional label ("Home", "Office"…).
 */
export const StoreAddressInput = StoreCustomerInput.pick({
	phone: true,
	address_1: true,
	address_2: true,
	city: true,
	state: true,
	country: true,
	postal_code: true,
}).extend({
	/**
	 * A name for the address ("Home", "Office"…).
	 * At most 40 characters. Left out = "".
	 */
	label: z.string().trim().max(40, "validation.label_max_40").default(""),
});
/** A checked `StoreAddressInput`. */
export type StoreAddressInput = z.infer<typeof StoreAddressInput>;

/**
 * A custom storefront page written in the WYSIWYG editor.
 * POST /online-store/pages and PUT /online-store/pages/:id.
 * The HTML body is sanitised server-side (app/helpers/html.ts)
 * before it's stored.
 */
export const StorePageInput = z.object({
	/** The page's title. Needed, at most 100 characters. */
	title: z.string().trim().min(1, "validation.required_short").max(100),
	/**
	 * The page's name in its address.
	 * 1 to 60 characters: lower-case letters, digits and dashes.
	 */
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(1, "validation.required_short")
		.max(60)
		.regex(SLUG_PATTERN, "validation.slug_charset"),
	/** The page's text, as HTML. Left out = "". */
	body: z.string().max(200000, "validation.page_body_max").default(""),
	/** The page's own CSS. Left out = "". */
	css: z.string().max(100000, "validation.page_css_max").default(""),
});
/** A checked `StorePageInput`. */
export type StorePageInput = z.infer<typeof StorePageInput>;

/**
 * GET /address?country=&state=&q= on a store's host.
 * The checkout asking for a country's states, then a state's cities.
 * `q` = what the buyer typed in the City box.
 */
export const StoreAddressQuery = z.object({
	/** The country whose states are asked for. "" = none. */
	country: z.string().trim().max(100).default(""),
	/** The state whose cities are asked for. "" = none yet. */
	state: z.string().trim().max(100).default(""),
	/** What the buyer typed in the City box. "" = the first cities. */
	q: z.string().trim().max(100).default(""),
});
/** A checked `StoreAddressQuery`. */
export type StoreAddressQuery = z.infer<typeof StoreAddressQuery>;

/**
 * GET /online-store/delivery/places?countries=&countries=…&q=
 * City suggestions for a zone's Cities chips,
 * from the downloaded list of the zone's countries.
 * `countries` is a repeated param, because names carry commas.
 * None = every downloaded country.
 */
export const PlacesQuery = z.object({
	/**
	 * The zone's countries, by name, 250 at most.
	 * [] = every downloaded country.
	 */
	countries: z.array(z.string().trim().max(100)).max(250).default([]),
	/** What was typed in the box. "" = the first page. */
	q: z.string().trim().max(100).default(""),
	/**
	 * What to suggest: `cities` or `states`.
	 * Left out = `cities`.
	 */
	of: z.enum(["cities", "states"]).default("cities"),
});
/** A checked `PlacesQuery`. */
export type PlacesQuery = z.infer<typeof PlacesQuery>;

/**
 * POST /postal-codes: which GeoNames dump to download.
 * The shop's country or every country.
 */
export const PostalDownloadInput = z.object({
	/**
	 * `country` = one country's dump.
	 * `all` = every country.
	 */
	scope: z.enum(POSTAL_SCOPES, "validation.choose_download_scope"),
	/**
	 * For scope `country`: the country's name (or ISO code).
	 * Checked against the list in PostalCodeService.
	 */
	country: z.string().trim().max(100).default(""),
});
/** A checked `PostalDownloadInput`. */
export type PostalDownloadInput = z.infer<typeof PostalDownloadInput>;

/**
 * One shipping zone as the Delivery form sends it
 * (mirror of `DeliveryZone`).
 */
const DeliveryZoneInput = z.object({
	/**
	 * The zone's name, for the admin's list only.
	 * At most 60 characters. Left out = "".
	 */
	name: z.string().trim().max(60, "validation.zone_name_too_long").default(""),
	/**
	 * The countries the zone covers, by name, 250 at most.
	 * [] = rest of world.
	 */
	countries: z
		.array(
			z
				.string()
				.trim()
				.refine((s) => COUNTRY_NAMES.has(s), "validation.choose_countries"),
		)
		.max(250, "validation.too_many_countries")
		.default([]),
	/**
	 * Narrows the zone to these states, 100 at most.
	 * [] = the whole country.
	 */
	states: z
		.array(
			z
				.string()
				.trim()
				.min(1, "validation.enter_state_name")
				.max(100, "validation.state_name_too_long"),
		)
		.max(100, "validation.too_many_states")
		.default([]),
	/**
	 * Narrows the zone to these cities, 100 at most.
	 * [] = every city.
	 */
	cities: z
		.array(
			z
				.string()
				.trim()
				.min(1, "validation.enter_city_name")
				.max(100, "validation.city_name_too_long"),
		)
		.max(100, "validation.too_many_cities")
		.default([]),
	/** The delivery price in the zone, in cents. 0 = free. */
	fee: z.number().int().min(0, "validation.enter_delivery_price"),
	/**
	 * Goods worth this much (cents) or more ship free in the zone.
	 * null or "" = no threshold.
	 */
	free_delivery_min: z.preprocess(
		(v) => (v === "" ? null : v),
		z.number().int().min(0).nullable().default(null),
	),
});

/** A place a zone covers: its key for the "used twice" check, and its name. */
type ZonePlace = { key: string; label: string };

/**
 * The cities or states of a zone, once per country of the zone.
 * @param countries The zone's countries (`["*"]` = rest of world).
 * @param kind What the names are.
 * @param names The city or state names.
 * @returns One place per country and name.
 */
function namedPlaces(
	countries: string[],
	kind: "city" | "state",
	names: string[],
): ZonePlace[] {
	const places: ZonePlace[] = [];
	for (const c of countries)
		for (const name of names)
			places.push({ key: `${c}/${kind}:${name.toLowerCase()}`, label: name });
	return places;
}

/**
 * The places one zone covers.
 * Cities win over states, states over whole countries.
 * A zone with no country is the rest of the world.
 * @param zone The zone.
 * @returns Its places.
 */
function placesOf(zone: {
	countries: string[];
	states: string[];
	cities: string[];
}): ZonePlace[] {
	const cs = zone.countries.length ? zone.countries : ["*"];
	if (zone.cities.length) return namedPlaces(cs, "city", zone.cities);
	if (zone.states.length) return namedPlaces(cs, "state", zone.states);
	if (zone.countries.length)
		return zone.countries.map((c) => ({ key: c, label: c }));
	return [{ key: "*", label: "" }];
}

/**
 * A place belongs to one zone only.
 * One rest-of-world zone, a country in one whole-country zone,
 * a state or a city once per country.
 * The message is already the final text: it names a place,
 * so it is translated here and not by `validate()`.
 * @param zones The zones, as the form sent them.
 * @param ctx Where the problems are written.
 */
function onePlacePerZone(
	zones: { countries: string[]; states: string[]; cities: string[] }[],
	ctx: z.core.$RefinementCtx,
) {
	const seen = new Set<string>();
	zones.forEach(function check(zone, i) {
		for (const p of placesOf(zone)) {
			if (seen.has(p.key))
				ctx.addIssue({
					code: "custom",
					path: [i],
					message:
						p.key === "*"
							? t("validation.one_rest_of_world_zone")
							: t("validation.place_in_other_zone", { place: p.label }),
				});
			seen.add(p.key);
		}
	});
}

/**
 * PUT /online-store/delivery: how orders reach the buyer (migration 0045).
 * Where the shop is, the shipping zones (applied by `deliveryFee()`
 * at the checkout), pick-up in store,
 * and whether the checkout's address uses lists.
 */
export const StoreDeliveryInput = z.object({
	/**
	 * Where the shop is: a country name.
	 * It is the checkout's default country.
	 * Blank = not set (saved as null).
	 */
	country: z.preprocess(
		(v) => v || null,
		z
			.string()
			.trim()
			.refine((s) => COUNTRY_NAMES.has(s), "validation.choose_country")
			.nullable()
			.default(null),
	),
	/** The buyer may collect in store (fee 0, no address asked). */
	pickup: z.boolean().default(false),
	/**
	 * State → City lists at the checkout
	 * when the country's postal codes are downloaded.
	 * False = plain text boxes.
	 */
	guided_address: z.boolean().default(true),
	/**
	 * The shipping zones, 50 at most.
	 * A place belongs to one zone only.
	 * [] = nothing is delivered.
	 */
	delivery_zones: z
		.array(DeliveryZoneInput)
		.max(50, "validation.too_many_zones")
		.default([])
		.superRefine(onePlacePerZone),
});
/** A checked `StoreDeliveryInput`. */
export type StoreDeliveryInput = z.infer<typeof StoreDeliveryInput>;

/**
 * PUT /online-store/languages: the languages the store offers
 * (migration 0060), the default first.
 * Repeats are dropped.
 */
export const StoreLanguagesInput = z.object({
	/**
	 * The language codes the store offers, the default first.
	 * At least one. Repeats are dropped.
	 */
	languages: z
		.array(z.enum(LOCALES as [Locale, ...Locale[]]))
		.min(1, "validation.pick_a_language")
		.max(LOCALES.length)
		/**
		 * Drop the languages that repeat.
		 * @param list The codes, as sent.
		 * @returns Each code once, in the same order.
		 */
		.transform(function unique(list) {
			return [...new Set(list)];
		}),
});
/** A checked `StoreLanguagesInput`. */
export type StoreLanguagesInput = z.infer<typeof StoreLanguagesInput>;

/**
 * Is this one of the fonts a shop may pick, or blank?
 * @param v The font key.
 * @returns True for "" or a key of `STORE_FONTS`.
 */
function isFontOrBlank(v: string) {
	return v === "" || Object.hasOwn(STORE_FONTS, v);
}

/**
 * One colour of a theme: `#rrggbb`, or blank for the theme's own.
 * Only this shape is saved, because it is printed into the page's style.
 */
const themeColor = z
	.string()
	.trim()
	.toLowerCase()
	.refine((v) => v === "" || HEX_COLOR.test(v), "validation.pick_valid_color")
	.default("");

/**
 * PUT /online-store/theme: the shop's own colours and font
 * for one built-in theme (migration 0085).
 * Every blank value = the theme's own.
 */
export const StoreThemeInput = z.object({
	/**
	 * The built-in theme this look is for.
	 */
	template: z.enum(STORE_TEMPLATES, "validation.template_unknown"),
	/**
	 * The main buttons.
	 */
	primary: themeColor,
	/**
	 * The theme's second colour.
	 */
	secondary: themeColor,
	/**
	 * The page's main background.
	 */
	background: themeColor,
	/**
	 * The footer's background.
	 */
	footer: themeColor,
	/**
	 * The page's text.
	 */
	text: themeColor,
	/**
	 * The small text: hints and labels.
	 */
	muted: themeColor,
	/**
	 * The footer's text.
	 */
	footer_text: themeColor,
	/**
	 * Cards, boxes and panels.
	 */
	surface: themeColor,
	/**
	 * The text on them.
	 */
	surface_text: themeColor,
	/**
	 * A key of `STORE_FONTS`.
	 */
	font: z.string().refine(isFontOrBlank, "validation.invalid").default(""),
});
/** A checked `StoreThemeInput`. */
export type StoreThemeInput = z.infer<typeof StoreThemeInput>;

/**
 * ISO 4217 codes the runtime can format.
 * They are the only ones a store may offer.
 */
const CURRENCY_CODES = new Set(Intl.supportedValuesOf("currency"));

/**
 * PUT /online-store/currencies: the extra currencies the store shows
 * prices in (migration 0063).
 * Each has the shop's own rate (1 of the shop's currency = `rate` of it),
 * or null = automatic.
 * Repeats are dropped, the first one wins.
 */
export const StoreCurrenciesInput = z.object({
	/**
	 * The extra currencies, 20 at most.
	 * Repeats are dropped, the first one wins.
	 */
	currencies: z
		.array(
			z.object({
				/** The ISO 4217 code, like `EUR`. */
				code: z
					.string()
					.refine((c) => CURRENCY_CODES.has(c), "validation.currency_invalid"),
				/**
				 * The shop's own rate: 1 of the shop's currency = `rate` of it.
				 * null = the automatic rate.
				 */
				rate: z.coerce
					.number()
					.positive("validation.rate_positive")
					.max(1e9)
					.nullable(),
			}),
		)
		.max(STORE_CURRENCIES_MAX)
		/**
		 * Drop a currency whose code was already listed.
		 * @param list The currencies, as sent.
		 * @returns The list with each code once. The first one wins.
		 */
		.transform(function unique(list) {
			const seen = new Set<string>();
			return list.filter((c) => !seen.has(c.code) && !!seen.add(c.code));
		}),
});
/** A checked `StoreCurrenciesInput`. */
export type StoreCurrenciesInput = z.infer<typeof StoreCurrenciesInput>;

/** PUT /exchange-rates: how often the platform fetches exchange rates. */
export const RateScheduleInput = z.object({
	/** How often: `off`, `30m`, `1h`, `6h`, `12h` or `1d`. */
	schedule: z.enum(
		Object.keys(RATE_SCHEDULES) as [RateSchedule, ...RateSchedule[]],
	),
});
/** A checked `RateScheduleInput`. */
export type RateScheduleInput = z.infer<typeof RateScheduleInput>;

/**
 * POST /checkout on a store's host: the public cart.
 * Prices always come from the DB, never the client.
 */
export const StoreCheckoutInput = z.object({
	/**
	 * The cart lines. A line holds 999 units at most online.
	 * Nobody is signed in here, and each line costs a DB round trip.
	 */
	items: cartItems(cartItem(999), "validation.too_many_items"),
	/**
	 * Who is buying and where it goes.
	 * The shared schema the checkout page validates with too
	 * (`StoreCustomer.Validator.ts`).
	 */
	customer: StoreCustomerInput,
	/**
	 * Collect in store instead of delivery
	 * (only when the shop offers it).
	 * The fee is 0 and no address is needed.
	 * See `StorePickupCheckoutInput`.
	 */
	pickup: z.boolean().default(false),
	/**
	 * "" = the shop's online gateway.
	 * Else a manual option the shop switched on (cod, bank_transfer):
	 * the order is created unpaid.
	 */
	payment: z.string().trim().max(30).default(""),
	/**
	 * A discount code, any case. "" = none.
	 * Applied server-side (CouponService.resolve),
	 * never trusted from the page.
	 */
	coupon: z
		.string()
		.trim()
		.max(COUPON_CODE_MAX, "validation.code_not_valid")
		.default(""),
	/**
	 * A signed-in customer's "Save address for next order" box
	 * (on by default).
	 * False = don't keep this address on the account.
	 */
	save_address: z.boolean().default(true),
});
/** A checked `StoreCheckoutInput`. */
export type StoreCheckoutInput = z.infer<typeof StoreCheckoutInput>;

/**
 * The same checkout with `pickup: true`: the address lines are optional.
 * The controller picks this schema when the body says pickup.
 */
export const StorePickupCheckoutInput = StoreCheckoutInput.extend({
	/** The buyer. The address lines may stay blank. */
	customer: StorePickupCustomerInput,
});

/**
 * POST /checkout/send: the cart alone.
 * For a store with no payment option.
 * The order is written unpaid, nothing else is asked.
 */
export const StoreSendInput = z.object({
	/** The cart lines: 1 to 100, each 999 units at most. */
	items: StoreCheckoutInput.shape.items,
});
/** A checked `StoreSendInput`. */
export type StoreSendInput = z.infer<typeof StoreSendInput>;

/**
 * POST /checkout/coupon: "Apply" on the checkout page.
 * It carries the cart, the code and what's known about the buyer so far.
 * Their email decides customer-only codes and per-customer limits.
 * Country / city / pick-up decide the delivery fee.
 */
export const StoreCouponInput = z.object({
	/** The cart lines: 1 to 100, each 999 units at most. */
	items: StoreCheckoutInput.shape.items,
	/** The discount code, as typed. At most 30 characters. */
	coupon: z
		.string()
		.trim()
		.min(1, "validation.enter_a_code")
		.max(COUPON_CODE_MAX, "validation.code_not_valid"),
	/**
	 * The buyer's email, as typed so far.
	 * It decides customer-only codes and per-customer limits.
	 * "" = not typed yet.
	 */
	email: z.string().trim().max(200).default(""),
	/** The delivery country typed so far. "" = none yet. */
	country: z.string().trim().max(100).default(""),
	/** The delivery state typed so far. "" = none yet. */
	state: z.string().trim().max(100).default(""),
	/** The delivery city typed so far. "" = none yet. */
	city: z.string().trim().max(100).default(""),
	/** The postal code typed so far. "" = none yet. */
	postal_code: z.string().trim().max(20).default(""),
	/** True = the buyer collects in store, so no delivery fee. */
	pickup: z.boolean().default(false),
});
/** A checked `StoreCouponInput`. */
export type StoreCouponInput = z.infer<typeof StoreCouponInput>;

/**
 * POST /checkout/pay: the nonce the gateway's own card form
 * produced in the browser
 * (Omise: `tokn_…` card token or `src_…` source),
 * against the cart `ref` the checkout call handed out.
 * The amount is never taken from here.
 * It comes from the stored snapshot.
 */
export const StorePayInput = z.object({
	/** The cart reference the checkout call handed out. */
	ref: z
		.string()
		.trim()
		.regex(/^[a-z0-9_]{8,80}$/, "validation.unknown_checkout_session"),
	/**
	 * The provider's nonce: a `tokn_…` card token
	 * or a `src_…` source.
	 */
	token: z
		.string()
		.trim()
		.regex(/^(tokn|src)_[a-zA-Z0-9_]{8,80}$/, "validation.payment_not_read"),
});
/** A checked `StorePayInput`. */
export type StorePayInput = z.infer<typeof StorePayInput>;

/**
 * POST /track: "where is my order".
 * The public order code plus the buyer's email or phone
 * (proof it's theirs).
 */
export const TrackInput = z.object({
	/**
	 * The code from the confirmation email / thank-you page
	 * ("P8J4-MJSQ-4Z8T"), typed however: case and dash don't matter.
	 */
	code: z.preprocess(
		(v) => normalizeReference(String(v ?? "")),
		z.string("validation.enter_order_code"),
	),
	/**
	 * The buyer's email or phone: proof the order is theirs.
	 * 3 to 200 characters.
	 */
	contact: z.string().trim().min(3, "validation.enter_order_contact").max(200),
});
/** A checked `TrackInput`. */
export type TrackInput = z.infer<typeof TrackInput>;
