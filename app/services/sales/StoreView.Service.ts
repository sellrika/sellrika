import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { Url } from "@xcore/http/Url";
import { app } from "@config/app";
import { Service } from "@xcore/di";
import { I18n } from "@xcore/i18n/I18n";
import { inertia } from "@xcore/view/Inertia";
import { StoreView } from "@xcore/view/StoreView";
import { Vite } from "@xcore/view/Vite";
import { en } from "@i18n/en";
import { fill, type Key, type Locale, type Params, translate } from "@i18n";
import {
	convertCents,
	type DisplayCurrency,
	formatMoney,
} from "@helpers/currency";
import { HEX_COLOR, onColor } from "@helpers/color";
import { dbDate } from "@helpers/time";
import {
	STORE_ISLAND_ENTRY,
	STORE_WAIT_STYLE,
	STORE_ISLAND_PAGES,
	STORE_JS_ENTRY,
	STORE_FONTS,
	STORE_TEMPLATE_INFO,
	STORE_TEMPLATES,
	STORE_THEME_PREFIX,
	type StoreTemplate,
	type ThemeLook,
} from "@constants/Store.Constant";
import { DEFAULT_FAVICON } from "@constants/Inertia.Constant";
import { StoreService, type StoreProduct } from "@services/sales/Store.Service";
import { StoreAuthService } from "@services/sales/StoreAuth.Service";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import type { RunningExtension } from "@services/settings/extensions/types/Extension.Types";
import { StorePageRepository } from "@repositories/StorePage.Repository";
import type { Shop } from "@models/Shop";
import type { OrderFull } from "@models/Order";
import type { Customer, CustomerAddress } from "@models/Customer";

/**
 * Which store page is showing.
 * Mirror of `StorePageName` in resources/js/store/types.ts.
 */
export type StorePageName =
	| "home"
	| "product"
	| "page"
	| "track"
	| "account"
	| "order"
	| "unsubscribe"
	| "not-found"
	| "checkout"
	| "done";

/**
 * The look a storefront renders with.
 * Built-in themes and extension themes give the same shape.
 */
export type ActiveTheme = {
	/**
	 * `classic`…, or `ext:<key>` for an extension theme.
	 */
	name: string;
	/**
	 * Where its page templates are registered: `themes/<name>` or `ext/<key>`.
	 */
	views: string;
	/**
	 * The layout template, `<views>/layout`.
	 */
	layout: string;
	/**
	 * The theme's stylesheet and script URLs, or null when it has none.
	 */
	css: string | null;
	script: string | null;
	/**
	 * The base URL of the theme's own files ("" for built-in themes).
	 */
	assets: string;
	/**
	 * The shop's settings for an extension theme ({} for built-in ones).
	 */
	config: Record<string, unknown>;
	scheme: "light" | "dark" | "auto";
	/**
	 * How many featured products the home page gets.
	 */
	featured: number;
	/**
	 * The theme's own words; they win over the app's in `t()`.
	 */
	strings: Record<string, string>;
	/**
	 * The shop's own colours and font for a built-in theme.
	 * `style` = the CSS printed after the theme's stylesheet,
	 * `classes` = what `<html>` gets (`theme-primary`, `theme-secondary`,
	 * `theme-background`, `theme-footer`, `theme-footer-text`,
	 * `theme-surface`, `theme-surface-text`),
	 * `font` = the URL of the picked font's stylesheet, or null.
	 * Left out = the theme's own look.
	 */
	look?: { style: string; classes: string; font: string | null };
};

/**
 * The shop a public request belongs to.
 * Plus its link prefix, absolute URL, signed-in customer, theme and currencies.
 */
export type Storefront = {
	shop: Shop;
	/**
	 * Link prefix: always "" (every store is at the root of its own host).
	 */
	base: string;
	/**
	 * The absolute URL of the store's home.
	 */
	url: string;
	customer: Customer | null;
	theme: ActiveTheme;
	/**
	 * The currencies the store offers (the shop's own first), `[]` when only its own.
	 */
	currencies: DisplayCurrency[];
	/**
	 * The one the visitor picked (`currency` cookie), null = the shop's own.
	 */
	display: DisplayCurrency | null;
};

/**
 * The head of a store page, printed by store/partials/head.edge.
 */
export type StoreSeo = {
	title: string;
	description: string;
	/**
	 * The canonical URL.
	 */
	url: string;
	type: "website" | "product";
	/**
	 * An absolute image URL for link previews, or null.
	 */
	image: string | null;
	noindex: boolean;
	/**
	 * `google-site-verification`, or null.
	 */
	verification: string | null;
	/**
	 * Extra `<meta property>` tags (the product price).
	 */
	meta: { property: string; content: string }[];
	/**
	 * The JSON-LD object, or null.
	 */
	ld: object | null;
	/**
	 * The GA4 id and the Meta Pixel id, or null.
	 */
	ga: string | null;
	pixel: string | null;
	/**
	 * The tab icon: the shop logo, else the POS mark.
	 */
	icon: string;
};

export type PubOrder = ReturnType<typeof StoreViewService.pubOrder>;

/**
 * The catalog filters a link or form may carry (`url.catalog(...)`).
 */
type CatalogParams = {
	q?: string | null;
	category?: number | string | null;
	sort?: string | null;
	stock?: boolean | string | null;
	page?: number | null;
};

/**
 * Every key the browser needs: `store.*`, `store_ui.*` and
 * `customer_auth.*` (the sign-in errors `window.Store.auth` shows),
 * `common.*` and `shared.*` (the checkout island's buttons and lists),
 * `products.or_joiner` (package contents: "Red or Blue").
 */
const STORE_KEYS = (Object.keys(en) as Key[]).filter(function storeKey(k) {
	return (
		k.startsWith("store.") ||
		k.startsWith("store_ui.") ||
		k.startsWith("customer_auth.") ||
		k.startsWith("common.") ||
		k.startsWith("shared.") ||
		k === "products.or_joiner"
	);
});

/**
 * Those texts per language, built once.
 */
const storeStrings = new Map<Locale, Record<string, string>>();

/**
 * Builds and renders the public store pages (Edge themes).
 * The controller finds the shop and the data; this turns them into HTML.
 * See docs/features/store-themes.md for every variable a template gets.
 */
@Service()
export class StoreViewService {
	constructor(
		private store: StoreService,
		private pages: StorePageRepository,
		private auth: StoreAuthService,
		private extensions: ExtensionService,
		private limits: PlanLimitService,
	) {}

	/**
	 * The CSS of a shop's own colours and font.
	 * The values are checked again here, because they go into a `<style>`:
	 * a colour must be `#rrggbb` and a font a key of `STORE_FONTS`.
	 * The text colour on each one is black or white, whichever reads best.
	 * In a theme that follows the device (`auto`), the page's and the cards'
	 * background and the page's text are for the light look only:
	 * the dark look keeps its own.
	 * @param look The stored look.
	 * @param scheme The theme's colour scheme.
	 * @returns The style, the `<html>` classes and the hosted font's key,
	 *   or null when nothing is picked.
	 */
	static lookStyle(
		look?: ThemeLook,
		scheme: "light" | "dark" | "auto" = "light",
	): { style: string; classes: string; font: string | null } | null {
		const vars: string[] = [];
		const classes: string[] = [];
		const primary = String(look?.primary ?? "");
		const secondary = String(look?.secondary ?? "");
		const background = String(look?.background ?? "");
		const footer = String(look?.footer ?? "");
		const text = String(look?.text ?? "");
		const muted = String(look?.muted ?? "");
		const footerText = String(look?.footer_text ?? "");
		const surface = String(look?.surface ?? "");
		const surfaceText = String(look?.surface_text ?? "");
		const key = String(look?.font ?? "");
		if (HEX_COLOR.test(primary)) {
			vars.push(
				`--store-accent:${primary}`,
				`--store-on-accent:${onColor(primary)}`,
			);
			classes.push("theme-primary");
		}
		if (HEX_COLOR.test(secondary)) {
			vars.push(
				`--theme-secondary:${secondary}`,
				`--theme-on-secondary:${onColor(secondary)}`,
			);
			classes.push("theme-secondary");
		}
		if (HEX_COLOR.test(footer)) {
			vars.push(`--theme-footer:${footer}`);
			classes.push("theme-footer");
		}
		// the footer's text: the shop's own, else what reads best on its colour
		const onFooter = HEX_COLOR.test(footerText)
			? footerText
			: HEX_COLOR.test(footer)
				? onColor(footer)
				: "";
		if (onFooter) {
			vars.push(`--theme-on-footer:${onFooter}`);
			classes.push("theme-footer-text");
		}
		const page: string[] = [];
		if (HEX_COLOR.test(background)) {
			page.push(`--store-bg:${background}`);
			classes.push("theme-background");
		}
		if (HEX_COLOR.test(text)) page.push(`--store-fg:${text}`);
		// the small text: the shop's own, else a softer shade of its text colour
		if (HEX_COLOR.test(muted)) page.push(`--store-muted:${muted}`);
		else if (HEX_COLOR.test(text))
			page.push(`--store-muted:color-mix(in srgb,${text} 65%,transparent)`);
		if (HEX_COLOR.test(surface)) {
			page.push(`--store-surface:${surface}`);
			classes.push("theme-surface");
		}
		// the text on cards: the shop's own, else what reads best on their colour
		const onSurface = HEX_COLOR.test(surfaceText)
			? surfaceText
			: HEX_COLOR.test(surface)
				? onColor(surface)
				: "";
		if (onSurface) {
			vars.push(`--theme-on-surface:${onSurface}`);
			classes.push("theme-surface-text");
		}
		const rules: string[] = [];
		if (page.length)
			rules.push(
				`${scheme === "auto" ? ":root:not(.dark)" : ":root"}{${page.join(";")}}`,
			);
		const font = Object.hasOwn(STORE_FONTS, key)
			? STORE_FONTS[key as keyof typeof STORE_FONTS]
			: null;
		if (font)
			vars.push(
				`--store-font:${font.family},ui-sans-serif,system-ui,sans-serif`,
				"--store-font-heading:var(--store-font)",
			);
		if (vars.length) rules.unshift(`:root{${vars.join(";")}}`);
		if (!rules.length) return null;
		return {
			style: rules.join(""),
			classes: classes.join(" "),
			font: font?.hosted ? key : null,
		};
	}

	/**
	 * The look a shop's store renders with.
	 * An extension theme (`ext:<key>`) that is not running is Classic.
	 * @param shop The shop.
	 * @returns The theme.
	 */
	async theme(shop: Shop): Promise<ActiveTheme> {
		if (shop.online_template.startsWith(STORE_THEME_PREFIX)) {
			const ext = await this.extensions.storeTheme(shop);
			if (ext) return ext;
		}
		const name = (STORE_TEMPLATES as readonly string[]).includes(
			shop.online_template,
		)
			? (shop.online_template as StoreTemplate)
			: "classic";
		return this.builtin(name, shop.theme_config[name]);
	}

	/**
	 * One of the built-in themes (`resources/views/themes/<name>/`).
	 * @param name The theme.
	 * @param look The shop's own colours and font for it, when it has any.
	 * @returns The theme.
	 */
	async builtin(name: StoreTemplate, look?: ThemeLook): Promise<ActiveTheme> {
		const info = STORE_TEMPLATE_INFO[name];
		const dir = `resources/views/themes/${name}`;
		const url = await Vite.resolver();
		const own = StoreViewService.lookStyle(look, info.scheme);
		return {
			...(own && {
				look: {
					style: own.style,
					classes: own.classes,
					font: own.font
						? await this.#builtFile(
								`resources/css/store-fonts/${own.font}.css`,
								url,
							)
						: null,
				},
			}),
			name,
			views: `themes/${name}`,
			layout: `themes/${name}/layout`,
			css: await this.#builtFile(`${dir}/style.css`, url),
			script: await this.#builtFile(`${dir}/script.js`, url),
			assets: "",
			config: {},
			scheme: info.scheme,
			featured: info.featured,
			strings: {},
		};
	}

	/**
	 * Public shop info + the footer page links every store page carries.
	 * The lookups do not depend on each other, so they run together.
	 * @param s The resolved storefront.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns The `store` variable of every template.
	 */
	async storeInfo(s: Storefront, running?: RunningExtension[]) {
		const [label, own, links, payments, addresses, free] = await Promise.all([
			this.store.paymentLabel(s.shop, running),
			this.pages.links(s.shop.id),
			this.extensions.storeLinks(s.shop, running),
			this.store.paymentOptions(s.shop, running),
			s.customer ? this.auth.addresses(s.customer) : [],
			this.limits.isFree(s.shop.owner_id),
		]);
		return {
			...StoreViewService.pubShop(s.shop, label, s.base),
			/**
			 * Where the "Powered by Sellrika" line leads.
			 * Only a shop whose account `PlanLimitService.isFree` names shows it, else it is "".
			 */
			powered: free ? Url.appOrigin() : "",
			/**
			 * The currency switcher (display only: the checkout charges the shop's own).
			 */
			currencies: s.currencies,
			display: s.display,
			/**
			 * The shop's own pages, then the links its extensions add.
			 * A link's `slug` is a path (`/blog`): `url.page()` knows both.
			 */
			pages: [...own, ...links],
			payments,
			/**
			 * How customers may sign in (null = accounts off), and who is signed in.
			 */
			login: this.auth.logins(s.shop),
			customer: StoreViewService.pubCustomer(s.customer, addresses),
		};
	}

	/**
	 * The variables every template sees, the theme layout too.
	 * @param s The resolved storefront.
	 * @param page Which page is showing.
	 * @param running The shop's running extensions, when already loaded.
	 * @returns The shared context (see docs/features/store-themes.md › Variables).
	 */
	async context(
		s: Storefront,
		page: StorePageName,
		running?: RunningExtension[],
	) {
		const locale = I18n.current();
		const { shop, theme, display, base } = s;
		const home = base || "/";
		const resolve = await Vite.resolver();
		const dates = new Intl.DateTimeFormat(locale, {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: shop.timezone || undefined,
		});
		/**
		 * A word in the visitor's language; the theme's own dictionary wins.
		 * @param key The dictionary key.
		 * @param params Values for its `{placeholders}`.
		 * @returns The text.
		 */
		function word(key: string, params?: Params) {
			const own = theme.strings[key];
			return own !== undefined
				? fill(own, params)
				: translate(locale, key as Key, params);
		}
		return {
			store: await this.storeInfo(s, running),
			theme: {
				name: theme.name,
				layout: theme.layout,
				assets: theme.assets,
				config: theme.config,
				scheme: theme.scheme,
				featured: theme.featured,
				classes: theme.look?.classes ?? "",
			},
			pageName: page,
			locale,
			t: word,
			price: function price(cents: number) {
				return display
					? formatMoney(convertCents(cents, display.rate), display.code, locale)
					: formatMoney(cents, shop.currency, locale);
			},
			money: function money(cents: number, code?: string) {
				return formatMoney(cents, code || shop.currency, locale);
			},
			/**
			 * The name of an order status or delivery step (the account's order badges).
			 * @param key `completed`, `voided`… or one of the shop's delivery steps.
			 * @returns The shop's own step name, else the built-in one.
			 */
			orderStatus: function orderStatus(key: string) {
				const step = shop.fulfillment_steps.find((f) => f.key === key);
				if (step?.label) return step.label;
				if (key === "partially_refunded") return word("orders.partly_refunded");
				return word(`orders.${key}`);
			},
			url: {
				home,
				product: function product(p: { slug: string } | string) {
					return `${base}/p/${typeof p === "string" ? p : p.slug}`;
				},
				page: function page(slug: string) {
					// a link an extension added is a path of the store itself
					if (slug.startsWith("/")) return `${base}${slug}`;
					return `${base}/pages/${slug}`;
				},
				checkout: `${base}/checkout`,
				track: `${base}/track`,
				account: `${base}/account`,
				order: function order(ref: string) {
					return `${base}/account/orders/${encodeURIComponent(ref)}`;
				},
				catalog: function catalog(p: CatalogParams = {}) {
					return StoreViewService.catalogUrl(home, p);
				},
			},
			asset: function asset(path: string) {
				return theme.assets
					? `${theme.assets}/${path}`
					: (resolve(`resources/views/${theme.views}/${path}`) ?? "");
			},
			discountPct: StoreViewService.discountPct,
			date: function date(iso: string) {
				return dates.format(dbDate(iso));
			},
		};
	}

	/**
	 * Render one store page inside the shop's theme.
	 * When an extension theme throws, the page is logged
	 * and drawn again with Classic.
	 * @param s The resolved storefront.
	 * @param page Which page: a theme page, or the shared `checkout` / `done`.
	 * @param props The page's own variables.
	 * @param seo The head.
	 * @param status The HTTP status.
	 * @returns The HTML response.
	 */
	async render(
		s: Storefront,
		page: StorePageName,
		props: Record<string, unknown>,
		seo: StoreSeo,
		status = 200,
	): Promise<Response> {
		if (!s.theme.name.startsWith(STORE_THEME_PREFIX))
			return this.#draw(s, page, props, seo, status);
		try {
			return await this.#draw(s, page, props, seo, status);
		} catch (error) {
			// a broken extension theme never takes the store down
			console.warn(`[store] theme ${s.theme.name} (${page}): ${error}`);
			const classic = { ...s, theme: await this.builtin("classic") };
			return this.#draw(classic, page, props, seo, status);
		}
	}

	/**
	 * The "not found" page.
	 * Inside the shop's theme when a shop resolved, else the app's own page.
	 * @param req The current request.
	 * @param s The resolved storefront, or null.
	 * @returns A 404 response.
	 */
	notFound(req: Request, s: Storefront | null): Promise<Response> {
		if (!s) return inertia(req, "Errors/NotFound", {}, 404);
		return this.render(
			s,
			"not-found",
			{},
			StoreViewService.storeSeo(s.shop, {
				url: s.url,
				title: s.shop.name,
				desc: s.shop.name,
				noindex: true,
			}),
			404,
		);
	}

	/**
	 * Only what the public pages need to know about a shop.
	 * @param s The shop.
	 * @param paymentLabel "Secure payment by …".
	 * @param base Link prefix: always "" (every store is at the root of its own host).
	 * @returns The public shop shape.
	 */
	static pubShop(s: Shop, paymentLabel: string, base = "") {
		return {
			name: s.name,
			slug: s.slug,
			logo: s.logo,
			currency: s.currency,
			base,
			payment_label: paymentLabel,
			country: s.country,
			pickup: s.pickup,
			guided_address: s.guided_address,
			/**
			 * The checkout prices delivery and tax itself
			 * (deliveryFee(), app/helpers/tax.ts).
			 */
			delivery_zones: s.delivery_zones,
			tax_rate: s.tax_rate,
			tax_label: s.tax_label,
			tax_included: s.tax_included,
			/**
			 * The announcement line and the footer contact block (all optional).
			 */
			banner: s.banner,
			banner_type: s.banner_type,
			phone: s.phone,
			address: s.address,
			hours: s.hours,
			facebook: s.facebook,
			instagram: s.instagram,
			viber: s.viber,
			whatsapp: s.whatsapp,
			/**
			 * The footer language switcher offers only these.
			 */
			languages: s.languages,
			/**
			 * The delivery step keys of an online order, in order (named by `orderStatus()`).
			 */
			fulfillment_steps: s.fulfillment_steps.map(function key(f) {
				return f.key;
			}),
		};
	}

	/**
	 * Public order summary for the thank-you, track and account pages.
	 * No costs, no internal ids beyond the order number.
	 * @param o The order with its lines.
	 * @returns The public order shape.
	 */
	static pubOrder(o: OrderFull) {
		return {
			id: o.id,
			/**
			 * The code the buyer quotes.
			 * Rows older than migration 0036 fall back to the number.
			 */
			reference: o.reference ?? `#${o.id}`,
			created_at: o.created_at,
			status: o.status,
			payment_status: o.payment_status,
			paid: o.paid,
			payment_method: o.payment_method,
			fulfillment: o.fulfillment,
			tracking: o.tracking,
			subtotal: o.subtotal,
			discount: o.discount,
			coupon_code: o.coupon_code,
			delivery_fee: o.delivery_fee,
			tax: o.tax,
			tax_rate: o.tax_rate,
			tax_label: o.tax_label,
			tax_included: o.tax_included,
			total: o.total,
			note: o.note,
			items: o.items.map(function item(i) {
				return {
					name: i.name,
					qty: i.qty,
					price: i.price,
					image: i.image && Url.upload(i.image),
					note: i.note,
				};
			}),
		};
	}

	/**
	 * One saved delivery address as the storefront sees it.
	 * Its id stays: the account edits and removes it by that.
	 * @param a The address row.
	 * @returns The public address shape.
	 */
	static pubAddress(a: CustomerAddress) {
		return {
			id: a.id,
			label: a.label,
			phone: a.phone,
			address_1: a.address_1,
			address_2: a.address_2,
			city: a.city,
			state: a.state,
			country: a.country,
			postal_code: a.postal_code,
		};
	}

	/**
	 * The signed-in customer as the storefront sees them. No ids, no notes.
	 * @param c The customer, or null for a guest.
	 * @param addresses Their saved addresses.
	 * @returns The public customer shape, or null.
	 */
	static pubCustomer(c: Customer | null, addresses: CustomerAddress[]) {
		return c
			? {
					name: c.name,
					email: c.email ?? "",
					phone: c.phone ?? "",
					addresses: addresses.map(StoreViewService.pubAddress),
				}
			: null;
	}

	/**
	 * Whole % off when a product carries an original price above its price.
	 * @param p The product (or variant).
	 * @returns The percentage, or null.
	 */
	static discountPct(p: {
		price: number;
		original_price?: number | null;
	}): number | null {
		return p.original_price && p.original_price > p.price
			? Math.round((1 - p.price / p.original_price) * 100)
			: null;
	}

	/**
	 * Build a store page's head data.
	 * Upload URLs are site-relative, so images are made absolute
	 * against the store URL's origin.
	 * @param shop The shop the page belongs to.
	 * @param o The canonical url, title, description, and the optional
	 *   image / og:type / extra meta tags / JSON-LD / `noindex`.
	 * @returns The head data for store/partials/head.edge.
	 */
	static storeSeo(
		shop: Shop,
		o: {
			url: string;
			title: string;
			desc: string;
			image?: string | null;
			type?: "website" | "product";
			meta?: StoreSeo["meta"];
			ld?: object;
			noindex?: boolean;
		},
	): StoreSeo {
		const origin = new URL(o.url).origin;
		const image = o.image ?? shop.logo;
		return {
			title: o.title,
			description: o.desc,
			url: o.url,
			type: o.type ?? "website",
			image: image ? (image.startsWith("http") ? image : origin + image) : null,
			noindex: !!o.noindex,
			verification: shop.google_site_verification || null,
			meta: o.meta ?? [],
			ld: o.ld ?? null,
			ga: shop.ga_id || null,
			pixel: shop.meta_pixel_id || null,
			icon: shop.logo || DEFAULT_FAVICON,
		};
	}

	/**
	 * A catalog link with only the filters that differ from the defaults.
	 * @param home The store's home path.
	 * @param p The filters and the page.
	 * @returns For example `/?q=tea&page=2`, or `home` when nothing is set.
	 */
	static catalogUrl(home: string, p: CatalogParams): string {
		const sp = new URLSearchParams();
		if (p.q) sp.set("q", String(p.q));
		if (p.category) sp.set("category", String(p.category));
		if (p.sort && p.sort !== "featured") sp.set("sort", String(p.sort));
		if (p.stock === true || p.stock === "1") sp.set("stock", "1");
		if (p.page && p.page > 1) sp.set("page", String(p.page));
		const qs = sp.toString();
		return qs ? `${home}?${qs}` : home;
	}

	/**
	 * Render one store page in the storefront's theme, no fallback.
	 * @param s The resolved storefront.
	 * @param page Which page.
	 * @param props The page's own variables.
	 * @param seo The head.
	 * @param status The HTTP status.
	 * @returns The HTML response.
	 */
	async #draw(
		s: Storefront,
		page: StorePageName,
		props: Record<string, unknown>,
		seo: StoreSeo,
		status: number,
	): Promise<Response> {
		// asked once per page: the payment lines and the scripts share it
		const running = await this.extensions.allActive(s.shop);
		const context = await this.context(s, page, running);
		const island = (STORE_ISLAND_PAGES as readonly string[]).includes(page);
		const vite = await Vite.tags([
			STORE_JS_ENTRY,
			...(island ? [STORE_ISLAND_ENTRY] : []),
		]);
		const { css, script, strings, views, look } = s.theme;
		// the running extensions' own scripts for the store pages (slot `store.page`)
		const extensions = await this.extensions.storeScripts(s.shop, running);
		const shared = page === "checkout" || page === "done";
		return StoreView.render(
			shared ? `store/${page}` : `${views}/${page}`,
			context,
			{
				...props,
				seo,
				assets: {
					css: [
						css && `<link rel="stylesheet" href="${this.#esc(css)}">`,
						// the shop's own font and colours, after the theme's so they win
						look?.font &&
							`<link rel="stylesheet" href="${this.#esc(look.font)}">`,
						look && `<style>${look.style}</style>`,
						vite.css,
						extensions.some((e) => e.wait) && STORE_WAIT_STYLE,
					]
						.filter(Boolean)
						.join("\n"),
					js: [
						vite.js,
						script &&
							`<script type="module" src="${this.#esc(script)}"></script>`,
					]
						.filter(Boolean)
						.join("\n"),
				},
				island: {
					store: context.store,
					locale: context.locale,
					strings: { ...this.#stringsFor(context.locale), ...strings },
					products: this.#pageProducts(props),
					page,
					...(props.restore ? { restore: props.restore } : {}),
					extensions,
				},
			},
			status,
		);
	}

	/**
	 * Every storefront text in one language, for the data island.
	 * @param locale The page language.
	 * @returns key → text.
	 */
	#stringsFor(locale: Locale): Record<string, string> {
		let hit = storeStrings.get(locale);
		if (!hit) {
			hit = {};
			for (const k of STORE_KEYS) hit[k] = translate(locale, k);
			storeStrings.set(locale, hit);
		}
		return hit;
	}

	/**
	 * The products shown on a page, for the data island (picker, cart re-sync).
	 * @param props The page's variables.
	 * @returns The catalog page + featured, or the product + related, each once.
	 */
	#pageProducts(props: Record<string, unknown>): StoreProduct[] {
		const list = [
			...((props.catalog as { data?: StoreProduct[] } | undefined)?.data ?? []),
			...((props.featured as StoreProduct[] | undefined) ?? []),
			...(props.product ? [props.product as StoreProduct] : []),
			...((props.related as StoreProduct[] | undefined) ?? []),
		];
		const seen = new Map<number, StoreProduct>();
		for (const p of list) seen.set(p.id, p);
		return [...seen.values()];
	}

	/**
	 * The URL of a built theme file, when it exists.
	 * In dev the Vite server answers any path, so the disk is checked first.
	 * @param entry The source path.
	 * @param url The Vite resolver.
	 * @returns The URL, or null.
	 */
	async #builtFile(
		entry: string,
		url: (entry: string) => string | null,
	): Promise<string | null> {
		if (!app.isProd && !(await Bun.file(entry).exists())) return null;
		return url(entry);
	}

	/**
	 * Escape a URL for an HTML attribute.
	 * @param s The text.
	 * @returns The escaped text.
	 */
	#esc(s: string): string {
		return s
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/</g, "&lt;");
	}
}
