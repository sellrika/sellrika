/**
 * Extensions: add-ons for the whole platform.
 * Each is a manifest, an entry module and browser scripts.
 * See the extension guide.
 * The platform admin switches each one on for all shops.
 * Each shop then enables and configures it for itself.
 */

/**
 * Where the zips the platform admin uploaded are kept.
 * Each is unpacked into `<dir>/platform/<key>/<stamp>/`.
 * Tests override the env var.
 */
export const EXTENSION_UPLOAD_DIR =
	process.env.EXTENSION_UPLOAD_DIR ?? "storage/extensions";

/**
 * The folder under `EXTENSION_UPLOAD_DIR`
 * that holds the platform's uploads.
 */
export const EXTENSION_PLATFORM_DIR = "platform";

/**
 * Where the built-in extensions are read from: one folder per extension.
 * Local development reads the workspace `extensions/` as it is (live edits).
 * Production reads the copy `bun run build` bundles into `build/extensions/`.
 * `bun test` points the env var at a temp folder.
 */
export const EXTENSION_BUILTIN_DIR =
	process.env.EXTENSION_BUILTIN_DIR ??
	(process.env.NODE_ENV ? "build/extensions" : "extensions");

/**
 * Every folder the built-in extensions are read from.
 * Local development also reads an add-on's own extensions
 * (`cloud/extensions`, see `app/cloud.ts`): the folder may be missing.
 * Production has one folder: `bun run build` bundles both into it.
 */
export const EXTENSION_BUILTIN_DIRS =
	process.env.EXTENSION_BUILTIN_DIR || process.env.NODE_ENV
		? [EXTENSION_BUILTIN_DIR]
		: [EXTENSION_BUILTIN_DIR, "cloud/extensions"];

/**
 * When the built-in folder is read again.
 * True = on every call (development and tests).
 * False = once per process (production).
 */
export const EXTENSION_BUILTIN_LIVE = process.env.NODE_ENV !== "production";

/** The file every extension folder must carry. */
export const EXTENSION_MANIFEST = "extension.json";

/**
 * The folder an extension's browser code sits in
 * (page / slot scripts).
 */
export const EXTENSION_ASSETS_DIR = "assets";

/**
 * The folder an extension's dictionaries sit in.
 * `i18n/<locale>.ts` (or .js), one flat `{ key: text }` per language.
 * `en` is the fallback.
 */
export const EXTENSION_I18N_DIR = "i18n";

/** Largest zip a merchant may upload. */
export const MAX_EXTENSION_ZIP_BYTES = 5 * 1024 * 1024;

/** How much a zip may unpack to. */
export const MAX_EXTENSION_UNPACKED_BYTES = 20 * 1024 * 1024;

/** The most files one zip may hold. */
export const MAX_EXTENSION_FILES = 500;

/**
 * How many users the "Available to" picker offers at once.
 * Past that: keep typing.
 */
export const EXTENSION_USER_CHOICES = 20;

/**
 * The longest subject of a note an extension emails a customer
 * (`ctx.mail.customer`).
 */
export const EXTENSION_MAIL_SUBJECT_MAX = 200;

/** The longest text of such a note. */
export const EXTENSION_MAIL_TEXT_MAX = 5000;

/** How long a download of a zip by URL may take. */
export const EXTENSION_FETCH_TIMEOUT_MS = 15_000;

/**
 * Every event an extension may listen for.
 * They are the keys of its module's default export.
 * To add one: a key here,
 * its data in `ExtensionEvents` (Extension.Service.ts),
 * then `emit()` it where it happens.
 */
export const EXTENSION_EVENTS = [
	"order.created",
	"order.updated",
	"order.status_changed",
	"order.paid",
	"order.refunded",
	"order.voided",
	"product.created",
	"product.updated",
	"product.deleted",
	"customer.created",
	"customer.updated",
	"customer.deleted",
	"stock.updated",
	"staff.created",
	"staff.updated",
	"staff.deleted",
	"report.daily",
] as const;

/** One of `EXTENSION_EVENTS`. */
export type ExtensionEvent = (typeof EXTENSION_EVENTS)[number];

/**
 * How a payment extension collects money (manifest `payment.mode`).
 * `hosted` = the provider's page.
 * `tokenize` = the provider's script in the buyer's browser
 * plus a server-side charge.
 * The manual options (cash on delivery, bank transfer) are built in:
 * `app/gateways/manual/`.
 */
export const EXTENSION_PAYMENT_MODES = ["hosted", "tokenize"] as const;

/** One of `EXTENSION_PAYMENT_MODES`. */
export type ExtensionPaymentMode = (typeof EXTENSION_PAYMENT_MODES)[number];

/**
 * The kinds of setting an extension may ask the admin for
 * (manifest `fields[].type`).
 * `color` is a swatch (`#rrggbb`), `image` an upload.
 * Both are stored as the string the extension reads.
 */
export const EXTENSION_FIELD_TYPES = [
	"text",
	"url",
	"number",
	"select",
	"multiselect",
	"switch",
	"checkbox",
	"color",
	"image",
	"list",
] as const;

/** One of `EXTENSION_FIELD_TYPES`. */
export type ExtensionFieldType = (typeof EXTENSION_FIELD_TYPES)[number];

/**
 * Every place in the app an extension may put its own UI
 * (manifest `slots[].name`).
 * To add one: a name here,
 * then `<ExtensionSlot name="…" :context="…" />` where it should render.
 * Document the context in the extension guide.
 */
export const EXTENSION_SLOTS = [
	"product.form",
	"product.side",
	"pos.display",
	"order.show",
	"order.receipt",
	"pos.cart",
	"extension.config",
	"store.page",
] as const;

/**
 * The slot that is an extension's own settings form.
 * Its script is drawn in the Configure dialog, also while the
 * extension is still off, so it is not part of `extension_ui`.
 */
export const EXTENSION_CONFIG_SLOT =
	"extension.config" satisfies (typeof EXTENSION_SLOTS)[number];

/**
 * The slot that is not in the staff app.
 * Its script runs on every page of the shop's online store,
 * loaded by `window.Store` (resources/js/store/index.ts).
 * No `<ExtensionSlot>` renders it.
 */
export const EXTENSION_STORE_SLOT =
	"store.page" satisfies (typeof EXTENSION_SLOTS)[number];

/** One of `EXTENSION_SLOTS`. */
export type ExtensionSlot = (typeof EXTENSION_SLOTS)[number];

/**
 * App settings an extension may set.
 * From one of its fields (manifest `fields[].app`),
 * or outright (manifest `app`: `{ "orders.delivery": "hide" }`).
 * The app reads only these, from `extension_ui[].app`:
 *   pos.primary = the Sell screen checkout's main button:
 *     `pay_now` (the default) or `pay_later`
 *   orders.delivery = `hide` takes delivery off the order pages:
 *     the step tabs and the steps dialog of the list,
 *     the step badge, the order page's Delivery card
 */
export const EXTENSION_APP_SETTINGS = [
	"pos.primary",
	"orders.delivery",
] as const;

/** One of `EXTENSION_APP_SETTINGS`. */
export type ExtensionAppSetting = (typeof EXTENSION_APP_SETTINGS)[number];
