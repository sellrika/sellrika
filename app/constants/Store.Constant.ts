import type { Key } from "@i18n";
import { DAY_MS } from "@constants/Time.Constant";

/**
 * The built-in store themes.
 * Each key is a folder `resources/views/themes/<key>/`
 * (its .edge pages, `style.css`, `script.js`, and an `index.ts`
 * that imports the .edge files). See docs/features/store-themes.md.
 */
export const STORE_TEMPLATES = [
	"classic",
	"minimal",
	"soft",
	"boutique",
	"noir",
	"lumen",
] as const;

/** One of `STORE_TEMPLATES`. */
export type StoreTemplate = (typeof STORE_TEMPLATES)[number];

/**
 * A theme an extension brings is picked as `ext:<extension key>`
 * in `shops.online_template`.
 * When the extension is removed or switched off,
 * the storefront falls back to Classic.
 */
export const STORE_THEME_PREFIX = "ext:";

/**
 * The pages every theme draws itself: one `<page>.edge` each.
 * `layout` is the header and footer around all of them.
 * An extension theme must ship every one in its `views` folder.
 * Checkout and done are shared (`resources/views/store/`),
 * so they are not here.
 */
export const STORE_THEME_PAGES = [
	"layout",
	"home",
	"product",
	"page",
	"track",
	"account",
	"order",
	"unsubscribe",
	"not-found",
] as const;

/** One of `STORE_THEME_PAGES`. */
export type StoreThemePage = (typeof STORE_THEME_PAGES)[number];

/** The colours a shop may change on a built-in theme, as `#rrggbb`. */
export type ThemeColors = {
	primary: string;
	secondary: string;
	background: string;
	footer: string;
	/** The page's text. */
	text: string;
	/** The small grey text: hints and labels. */
	muted: string;
	/** The footer's text. */
	footer_text: string;
	/** Cards, boxes and panels. */
	surface: string;
	/** The text on them. */
	surface_text: string;
};

/**
 * What the /online-store picker shows for each built-in theme.
 * `label` = the theme's own name (a brand, never translated).
 * `description` = a dictionary key.
 * `scheme` = the colour scheme the page pins: `light`/`dark` themes
 * hard-code their palette, `auto` ones follow the visitor's device.
 * `featured` = how many of the shop's featured products the home page gets.
 * `colors` = the theme's own colours as `#rrggbb`, shown in the Customize
 * dialog while the shop has picked none. Copied by hand from the theme's
 * `style.css` (an `oklch()` value turned into hex): change both together.
 */
export const STORE_TEMPLATE_INFO: Record<
	StoreTemplate,
	{
		label: string;
		description: Key;
		scheme: "light" | "dark" | "auto";
		featured: number;
		colors: ThemeColors;
	}
> = {
	classic: {
		label: "Editorial",
		description: "store_ui.template_classic",
		scheme: "light",
		featured: 0,
		colors: {
			primary: "#8a3b2a",
			secondary: "#16130f",
			background: "#f7f5f0",
			footer: "#16130f",
			text: "#16130f",
			muted: "#6b655c",
			footer_text: "#f0ece4",
			surface: "#efece6",
			surface_text: "#16130f",
		},
	},
	minimal: {
		label: "Minimal",
		description: "store_ui.template_minimal",
		scheme: "auto",
		featured: 0,
		colors: {
			primary: "#c8ff3d",
			secondary: "#0a0a0a",
			background: "#ffffff",
			footer: "#ffffff",
			text: "#0a0a0a",
			muted: "#737373",
			footer_text: "#737373",
			surface: "#ffffff",
			surface_text: "#0a0a0a",
		},
	},
	soft: {
		label: "Soft",
		description: "store_ui.template_soft",
		scheme: "light",
		featured: 0,
		colors: {
			primary: "#1c1b19",
			secondary: "#34563b",
			background: "#fbfaf8",
			footer: "#1c1b19",
			text: "#1c1b19",
			muted: "#8a857c",
			footer_text: "#a5a09a",
			surface: "#ffffff",
			surface_text: "#1c1b19",
		},
	},
	boutique: {
		label: "Sunday",
		description: "store_ui.template_boutique",
		scheme: "light",
		featured: 0,
		colors: {
			primary: "#2b1f16",
			secondary: "#ffa05b",
			background: "#fffaf4",
			footer: "#ffd1a0",
			text: "#2b1f16",
			muted: "#7d6553",
			footer_text: "#4d3520",
			surface: "#ffffff",
			surface_text: "#2b1f16",
		},
	},
	noir: {
		label: "Noir",
		description: "store_ui.template_noir",
		scheme: "dark",
		featured: 0,
		colors: {
			primary: "#c6e101",
			secondary: "#f2f2f4",
			background: "#0b0b0d",
			footer: "#0b0b0d",
			text: "#f2f2f4",
			muted: "#a1a1aa",
			footer_text: "#a1a1aa",
			surface: "#121217",
			surface_text: "#f2f2f4",
		},
	},
	lumen: {
		label: "Lumen",
		description: "store_ui.template_lumen",
		scheme: "light",
		featured: 0,
		colors: {
			primary: "#7358ce",
			secondary: "#5e3d9e",
			background: "#f2f1f7",
			footer: "#f2f1f7",
			text: "#1b1a24",
			muted: "#6f6d82",
			footer_text: "#58566b",
			surface: "#fbfbfe",
			surface_text: "#1b1a24",
		},
	},
};

/**
 * The fonts a shop may pick for a built-in theme.
 * `label` = the font's own name (a brand, never translated).
 * `family` = what goes into the CSS `font-family`.
 * `hosted` = it has a file `resources/css/store-fonts/<key>.css`
 * (self-hosted through @fontsource); the others are on every device.
 * A new font = its @fontsource package, that file, and a line here.
 */
export const STORE_FONTS = {
	archivo: { label: "Archivo", family: '"Archivo"', hosted: true },
	"dm-sans": { label: "DM Sans", family: '"DM Sans"', hosted: true },
	geist: { label: "Geist", family: '"Geist Sans"', hosted: true },
	figtree: { label: "Figtree", family: '"Figtree Variable"', hosted: true },
	bricolage: {
		label: "Bricolage Grotesque",
		family: '"Bricolage Grotesque Variable"',
		hosted: true,
	},
	"instrument-serif": {
		label: "Instrument Serif",
		family: '"Instrument Serif"',
		hosted: true,
	},
	"plex-mono": {
		label: "IBM Plex Mono",
		family: '"IBM Plex Mono"',
		hosted: true,
	},
	system: { label: "System UI", family: "system-ui", hosted: false },
	georgia: { label: "Georgia", family: "Georgia, ui-serif", hosted: false },
} as const satisfies Record<
	string,
	{ label: string; family: string; hosted: boolean }
>;

/** A key of `STORE_FONTS`. */
export type StoreFont = keyof typeof STORE_FONTS;

/**
 * The shop's own look for one built-in theme.
 * The colours are `#rrggbb`, `font` = a key of `STORE_FONTS`.
 * "" = the theme's own. A look saved before a field existed has none.
 */
export type ThemeLook = {
	primary: string;
	secondary: string;
	/** The page behind everything. */
	background?: string;
	/** The footer block. */
	footer?: string;
	/** The page's text. */
	text?: string;
	/** The small text: hints and labels; empty = a softer shade of the text. */
	muted?: string;
	/** The footer's text; empty = black or white, whichever reads best. */
	footer_text?: string;
	/** Cards, boxes and panels. */
	surface?: string;
	/** The text on them; empty = black or white, whichever reads best. */
	surface_text?: string;
	font: string;
};

/**
 * The browser entry of every store page: `window.Store`
 * (a Vite source path).
 */
export const STORE_JS_ENTRY = "resources/js/store/index.ts";

/**
 * The browser entry of the checkout island (a Vite source path).
 * Loaded only where a form needs it.
 */
export const STORE_ISLAND_ENTRY = "resources/js/store/checkout.ts";

/**
 * Printed in the head while a running extension's store script
 * asks the page to wait (slot `wait`).
 * The page is hidden until `window.Store` has run that script
 * and takes this style out.
 * If the script never runs (no JavaScript, a network fault),
 * the page shows itself after 4 seconds.
 */
export const STORE_WAIT_STYLE =
	"<style data-store-wait>html{visibility:hidden;animation:store-wait 0s 4s forwards}@keyframes store-wait{to{visibility:visible}}</style>";

/**
 * The store pages that load the checkout island
 * (the checkout, the thank-you page and the account's address form).
 */
export const STORE_ISLAND_PAGES = ["checkout", "done", "account"] as const;

/**
 * Catalog orders the storefront offers (`?sort=`).
 * `featured` = the repository's default:
 * featured first, then most recently updated.
 * `newest` = highest id first.
 * The price ones sort by the shown (cheapest) price.
 */
export const STORE_SORTS = [
	"featured",
	"newest",
	"price_asc",
	"price_desc",
] as const;

/** One of `STORE_SORTS`. */
export type StoreSort = (typeof STORE_SORTS)[number];

/** How many "Related products" a product page shows under the product. */
export const STORE_RELATED = 4;

/**
 * How long a shop's public catalog stays in memory.
 * A change to its products or stock drops it at once.
 * The time only caps how long a missed change could show.
 */
export const STORE_CATALOG_TTL_MS = 30_000;

/**
 * Tones of the announcement strip (`shops.banner_type`).
 * `info` = the template's own colours.
 * The rest are a fixed colour each.
 */
export const STORE_BANNER_TYPES = [
	"info",
	"success",
	"warning",
	"danger",
] as const;

/** One of `STORE_BANNER_TYPES`. */
export type StoreBannerType = (typeof STORE_BANNER_TYPES)[number];

/**
 * The email of the hidden, deactivated user that signs online orders.
 * So reports attribute them without a real cashier.
 */
export const STORE_SYSTEM_EMAIL = "online-store@pos.local";

/**
 * `store_carts.payload.gateway` of an order sent straight from the cart,
 * in a store with no payment option switched on. Never a gateway key.
 */
export const STORE_DIRECT = "direct";

/**
 * A cart snapshot that never became an order is dropped after this long.
 * A week, so the abandoned-cart email (up to 24 h late) still has a cart
 * to restore when the buyer clicks it a few days later.
 */
export const STORE_CART_TTL_MS = 7 * DAY_MS;

/**
 * The gateways are only asked about checkouts younger than this.
 * Carts now live a week for the abandoned-cart email,
 * but a payment that has not shown up after a day never will.
 */
export const STORE_RECONCILE_WINDOW_MS = DAY_MS;

/**
 * How often an account may change a store address in a week,
 * all its shops together.
 * Each new address needs a new SSL certificate, and the certificate
 * service gives the whole platform only so many a week.
 */
export const SLUG_CHANGES_PER_WEEK = 3;

/** The `settings` key with an account's renames: `slug_renames:<owner id>`. */
export const SLUG_RENAMES_KEY = "slug_renames";

/**
 * Cron schedule for re-asking the gateways about checkouts
 * whose buyer never came back to /done.
 */
export const STORE_RECONCILE_CRON = "* * * * *";

/**
 * Per cart the wait doubles after each "still pending" answer
 * (2, 4, 8… min).
 * It is never longer than this.
 */
export const STORE_RECONCILE_MAX_WAIT_MS = 3_600_000;

/**
 * How many checkouts one sweep asks the gateways about at the same time.
 * One slow gateway then holds up one worker, not the whole sweep.
 */
export const STORE_RECONCILE_WORKERS = 5;

/**
 * Telegram Bot API host.
 * New-order alerts are one `sendMessage` call
 * (app/services/sales/OrderAlert.Service.ts).
 */
export const TELEGRAM_API = "https://api.telegram.org";

/**
 * Ways a customer may sign in to the online store
 * (`shops.customer_logins`, comma list).
 * All through the shop's own Firebase project:
 * email + password, Google, Microsoft.
 * Each one is a switch on /online-store › Authentication.
 */
export const CUSTOMER_LOGINS = ["email", "google", "microsoft"] as const;

/** One of `CUSTOMER_LOGINS`. */
export type CustomerLogin = (typeof CUSTOMER_LOGINS)[number];

/**
 * The Firebase web-app config the storefront needs to open the sign-in
 * (`shops.firebase_config`, JSON).
 * Every value is public by design: Firebase prints them in the browser.
 * So nothing here is encrypted.
 * `label` is a dictionary key.
 * The /online-store page and the server messages translate it.
 */
export const FIREBASE_FIELDS = [
	{
		name: "api_key",
		label: "online_store.firebase_api_key",
		placeholder: "AIza…",
	},
	{
		name: "auth_domain",
		label: "online_store.firebase_auth_domain",
		placeholder: "my-shop.firebaseapp.com",
	},
	{
		name: "project_id",
		label: "online_store.firebase_project_id",
		placeholder: "my-shop",
	},
	{
		name: "app_id",
		label: "online_store.firebase_app_id",
		placeholder: "1:123456789:web:abc123",
	},
] as const satisfies readonly {
	name: string;
	label: Key;
	placeholder: string;
}[];

/**
 * How long a sign-in waits for Firebase to check a token.
 * Past it the buyer is told the sign-in could not be verified.
 */
export const FIREBASE_TIMEOUT_MS = 10_000;

/** The name of one `FIREBASE_FIELDS` entry. */
export type FirebaseField = (typeof FIREBASE_FIELDS)[number]["name"];

/** A shop's Firebase config: a value per field. */
export type FirebaseConfig = Record<FirebaseField, string>;

/**
 * The Firebase JS SDK files the storefront loads
 * on the first "Sign in" click.
 * The compat build = the `firebase` global.
 */
export const FIREBASE_SDK_VERSION = "10.14.1";

/**
 * Customer sessions last this long (days).
 * The same as staff sessions.
 */
export const CUSTOMER_SESSION_TTL_DAYS = 30;

/** How many orders one page of /account lists. */
export const ACCOUNT_ORDERS_PER_PAGE = 10;

/** How many delivery addresses a customer may keep on their account. */
export const ACCOUNT_ADDRESSES_MAX = 10;

/**
 * Slugs no shop may take.
 * Each slug is a subdomain (`<slug>.shop.sellrika.com`).
 * So names that look like a service of ours or a mail server
 * are kept free.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	"www",
	"pos",
	"app",
	"api",
	"admin",
	"administrator",
	"root",
	"system",
	"mail",
	"email",
	"webmail",
	"smtp",
	"imap",
	"pop",
	"pop3",
	"mx",
	"ns",
	"ns1",
	"ns2",
	"dns",
	"ftp",
	"sftp",
	"ssh",
	"vpn",
	"git",
	"autoconfig",
	"autodiscover",
	"localhost",
	"shop",
	"shops",
	"store",
	"stores",
	"sellrika",
	"static",
	"cdn",
	"assets",
	"img",
	"images",
	"media",
	"files",
	"uploads",
	"dev",
	"staging",
	"test",
	"beta",
	"demo",
	"help",
	"support",
	"docs",
	"developer",
	"developers",
	"status",
	"blog",
	"billing",
	"pay",
	"payment",
	"payments",
	"checkout",
	"account",
	"accounts",
	"login",
	"signin",
	"signup",
	"register",
	"auth",
	"sso",
	"oauth",
	"dashboard",
	"console",
	"portal",
	"cpanel",
	"whm",
	"secure",
	"security",
	"m",
	"mobile",
]);
