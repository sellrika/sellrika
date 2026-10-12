import type { Locale } from "@i18n";
import type { DisplayCurrency, StoreCurrency } from "@helpers/currency";
export type { DisplayCurrency, StoreCurrency };

export type Role = "admin" | "manager" | "cashier";
/** The signed-in user. `platform` = the ADMIN_EMAIL user, who alone sees the platform settings. */
export type User = {
	id: number;
	name: string;
	email: string;
	role: Role;
	platform: boolean;
};
/** One of the user's own passkeys on /settings: never the key itself. */
export type PasskeyInfo = {
	id: number;
	/** What the user called it; '' = no name. */
	name: string;
	last_used_at: string | null;
	created_at: string;
};
/** Staff row on /users (no password hash; `activity` = orders/refunds/stock movements signed by them). */
export type StaffUser = {
	id: number;
	name: string;
	email: string;
	role: Role;
	active: boolean;
	owner_id: number | null; // null = the account's owner (can't be demoted or deleted)
	created_at: string;
	activity: number;
};
/**
 * A sales person of the active shop: no login.
 * `commission` is in hundredths of a percent.
 * `due` = the commission on `unpaid_sales` (cents sold since `last_paid_at`) at today's rate.
 */
export type SalesStaff = {
	id: number;
	name: string;
	commission: number;
	active: boolean;
	last_paid_at: string | null;
	created_at: string;
	orders: number;
	unpaid_orders: number;
	unpaid_sales: number;
	due: number;
};
/** One commission payment of a sales person: the history on /users. */
export type SalesCommission = {
	id: number;
	sales_staff_id: number;
	amount: number; // cents paid
	sales: number; // cents sold in the paid period
	orders: number; // how many sales that was
	commission: number; // the rate it was paid at, hundredths of a percent
	created_at: string; // when it was paid
};
/** One shipping zone (`shops.delivery_zones`): countries ([] = rest of world), optional state / city lists ([] = the whole country), the price and a free-delivery threshold; priced by `deliveryFee()` in app/validators/StoreCustomer.Validator.ts. */
export type DeliveryZone = {
	name: string;
	countries: string[];
	states: string[];
	cities: string[];
	fee: number;
	free_delivery_min: number | null;
};
export type Shop = {
	id: number;
	owner_id: number;
	name: string;
	currency: string;
	logo: string | null;
	timezone: string;
	support_email: string | null;
	country: string | null;
	pickup: boolean;
	guided_address: boolean;
	delivery_zones: DeliveryZone[];
	tax_rate: number;
	tax_label: string;
	tax_included: boolean;
	slug: string | null;
	domain: string | null; // the store's own domain; null = its subdomain <slug>.<STORE_DOMAIN>
	online_enabled: boolean;
	online_template: string;
	fulfillment_steps: FulfillmentStep[]; // the delivery steps of its online orders, in order
	created_at: string;
};
export type Category = {
	id: number;
	shop_id: number;
	name: string;
	position: number;
	color: string | null;
	image: string | null; // an /uploads/… picture, null = none
	product_count?: number;
};
export type ProductKind = "item" | "bundle";
/** One allowed way to fill a package slot. `stock` null = that component isn't tracked. `name` = variant name, or the component product's name when variant_id is null. */
export type BundleOption = {
	variant_id: number | null;
	name: string;
	price: number;
	stock: number | null;
};
/** One slot of a package: `qty` × the component product, filled by exactly one of `options` (1 option = fixed, 2+ = the customer chooses). */
export type BundleItem = {
	id: number;
	product_id: number;
	qty: number;
	name: string;
	/** The component's own on/off switch — a package with a switched-off component is not sold. */
	active: boolean;
	options: BundleOption[];
};
export type ProductVariant = {
	id: number;
	product_id: number;
	name: string;
	price: number;
	purchase_price: number | null;
	position: number;
	attributes: Record<string, string> | null;
	sku: string | null;
	barcode: string | null;
	images: string[];
	stock: number;
};
/**
 * A plain item as the package editor gets it.
 * Only what the editor shows, not the whole product.
 */
export type PackageComponent = {
	id: number;
	name: string;
	price: number; // cents
	images: string[];
	active: boolean;
	variants: { id: number; name: string; price: number }[];
};

export type Product = {
	id: number;
	shop_id: number;
	name: string;
	slug: string; // storefront URL, derived from the name
	description: string;
	price: number; // cents
	purchase_price: number | null; // cents, optional
	original_price: number | null; // cents, optional "was" price shown struck through in the online store
	images: string[]; // ["/uploads/<file>", "https://…", …]
	sku: string | null; // optional merchant SKU (per variant when the product has variants)
	barcode: string | null;
	unit: string | null; // sale unit ("pcs", "kg", "m", …)
	amount: number | null; // how much one unit holds — 50 for "50 g" (the unit is `unit`)
	extra: ProductExtra[]; // "Additional data" rows (any title, any value), in the order typed
	track_stock: boolean; // inventory on/off (product-level stock when no variants, else per variant)
	stock: number;
	low_stock_at: number; // alert when stock <= this
	featured: boolean; // shown first in every product list
	custom_request: boolean; // on = the online store asks the buyer for a note (like the name to engrave)
	custom_request_label: string; // the question over that box, "" = the default words
	active: boolean; // false = hidden from the POS and the online store
	sold?: number; // units sold on orders that were not voided — only on the admin product list
	created_at: string;
	updated_at: string;
	kind: ProductKind; // "bundle" = a package of other products (no variants, no stock of its own)
	categories: Category[];
	variants: ProductVariant[];
	/** Package recipe — [] for kind "item". For a bundle the server computes `track_stock`/`stock` from these. */
	bundle_items: BundleItem[];
};
/** An API key of the active shop (Settings › MCP & API keys). The key itself is never sent back, only its last 4 characters. */
export type ApiKey = {
	id: number;
	shop_id: number;
	user_id: number;
	name: string;
	role: Role;
	last4: string;
	last_used_at: string | null;
	created_at: string;
	created_by: string | null;
};
/** What the payment method buttons need of a method (an extension may hand over less than the whole row). */
export type PickerMethod = Pick<PaymentMethod, "id" | "name"> &
	Partial<Pick<PaymentMethod, "icon" | "image" | "extension">>;
export type PaymentMethod = {
	id: number;
	shop_id: number;
	name: string;
	icon: string;
	color: string | null;
	/** a picture for the customer's screen (a QR code to pay), an `/uploads/…` path */
	image: string | null;
	/** the key of the extension that added it (manifest `payment_method`), null = the shop's own */
	extension: string | null;
	tendered: boolean;
	enabled: boolean;
	position: number;
};

export type Customer = {
	id: number;
	shop_id: number;
	name: string;
	phone: string | null;
	email: string | null;
	note: string;
	created_at: string;
	updated_at: string;
};
export type CustomerWithStats = Customer & {
	/** The customer said "no more emails" to this shop. */
	unsubscribed: boolean;
	orders_count: number;
	total_spent: number;
	last_order_at: string | null;
};

export type OrderStatus =
	| "completed"
	| "partially_refunded"
	| "refunded"
	| "voided";
export type PaymentStatus = "unpaid" | "partial" | "paid";
/** A delivery step key of an online order — a built-in one or the shop's own; "" on POS sales (nothing to deliver). */
export type FulfillmentStatus = string;
/** One delivery step of a shop (`shops.fulfillment_steps`); `label` "" = the translated built-in name, `color` null = the built-in colour. */
export type FulfillmentStep = {
	key: string;
	label: string;
	color?: string | null;
};
export type DiscountType = "percent" | "fixed";
/** `components` = package contents snapshotted at sale time (qty per ONE package); null on ordinary lines. */
export type OrderItem = {
	id: number;
	order_id: number;
	product_id: number | null;
	variant_id: number | null;
	name: string;
	price: number;
	cost: number | null;
	qty: number;
	refunded_qty: number;
	components:
		| { product_id: number; variant_id: number | null; qty: number }[]
		| null;
	image: string | null; // `/uploads/…` picture at sale time, null = none
	note: string; // the buyer's custom request for this line, "" = none
};
export type Order = {
	id: number;
	reference: string | null; // public code the buyer sees (P8J4-MJSQ-4Z8T)
	shop_id: number;
	user_id: number;
	customer_id: number | null;
	status: OrderStatus;
	subtotal: number;
	discount_type: DiscountType | null;
	discount_value: number; // percent (0..100) or cents
	discount: number; // cents
	delivery_fee: number; // cents (online store only, 0 at the POS)
	tax: number; // cents on the goods after the discount; `tax_included` = it sits inside the prices (not added to the total)
	tax_rate: number; // hundredths of a percent, frozen at sale time
	tax_label: string;
	tax_included: boolean;
	total: number; // subtotal − discount + (tax when not included) + delivery_fee
	paid: number;
	change: number;
	refunded: number;
	payment_method: string;
	payment_status: PaymentStatus; // manual online orders (cash on delivery, bank transfer) start unpaid
	fulfillment: FulfillmentStatus | "";
	tracking: string;
	note: string; // free text (the online store's delivery details)
	coupon_code: string | null; // the discount code used at the online checkout (text — survives a deleted coupon)
	voided_at: string | null;
	voided_by: number | null;
	void_reason: string | null;
	created_at: string;
	cashier?: string | null;
	sales_staff_id: number | null; // the sales person named at the POS, null = nobody
	sales_staff?: string | null;
	customer?: { id: number; name: string; phone: string | null } | null;
	items: OrderItem[];
};
export type RefundItem = {
	id: number;
	refund_id: number;
	order_item_id: number;
	qty: number;
	name: string;
};
export type Refund = {
	id: number;
	order_id: number;
	shop_id: number;
	user_id: number;
	amount: number;
	reason: string;
	restock: boolean;
	created_at: string;
	by: string | null;
	items: RefundItem[];
};
/** The lines and the money of an order at one moment (cents). */
export type OrderSnapshot = {
	items: { name: string; qty: number; price: number }[];
	subtotal: number;
	discount: number;
	tax: number;
	total: number;
};
/** One change made to an order after it was created: the order before and after. */
export type OrderHistory = {
	id: number;
	type: "items_added" | "items_removed";
	/** `changed` = the lines added, or the units removed; then the whole order before and after. */
	data: {
		changed: OrderSnapshot["items"];
		before: OrderSnapshot;
		after: OrderSnapshot;
	};
	created_at: string;
	by: string | null;
};
export type OrderDetail = Order & {
	refunds: Refund[];
	history: OrderHistory[];
	voided_by_name: string | null;
};

export type StockItem = {
	product_id: number;
	variant_id: number | null;
	name: string;
	variant_name: string | null;
	image: string | null;
	barcode: string | null;
	stock: number;
	low_stock_at: number;
};
export type StockMovement = {
	id: number;
	shop_id: number;
	product_id: number;
	variant_id: number | null;
	type: "sale" | "refund" | "void" | "adjustment";
	qty: number;
	reason: string;
	order_id: number | null;
	user_id: number | null;
	created_at: string;
	by: string | null;
};

// Public online storefront (see app/services/StoreService.ts / app/controllers/StoreController.ts)
export type StorePageLink = { slug: string; title: string };
/** `base` prefixes every storefront link: always "" (every store is at the root of its own host). */
/** One way to pay at the checkout: the online provider, or a manual option (cash on delivery, bank transfer) with what the buyer is told. */
export type StorePayment = {
	key: string;
	label: string;
	manual: boolean;
	instructions: string;
};
/** Tone of the announcement strip (app/constants/Store.Constant.ts › STORE_BANNER_TYPES). */
export type StoreBannerType = "info" | "success" | "warning" | "danger";
/** The announcement line (`banner` + `banner_type`) and the footer contact block — every field optional (null = not shown). `viber`/`whatsapp` are phone digits with the country code. */
export type StoreContact = {
	banner: string | null;
	banner_type: StoreBannerType;
	phone: string | null;
	address: string | null;
	hours: string | null;
	facebook: string | null;
	instagram: string | null;
	viber: string | null;
	whatsapp: string | null;
};
/** One address of a customer, kept on their store account or added by staff on their page (app/models/Customer.ts › CustomerAddress) — the checkout's own fields + a label and the phone to reach the receiver. */
export type CustomerAddress = {
	id: number;
	label: string;
	phone: string;
	address_1: string;
	address_2: string;
	city: string;
	state: string;
	country: string;
	postal_code: string;
	/** The tax or VAT number that goes with this address. "" = none. Not on the storefront's copy. */
	tax_id?: string;
};
/** The signed-in store customer as the storefront sees them (`store.customer`): what /account edits and the checkout prefills. */
export type StoreCustomerAccount = {
	name: string;
	email: string;
	phone: string;
	addresses: CustomerAddress[];
};
/** How customers may sign in (`store.login`, null = accounts off): the providers the shop switched on and its Firebase web config (public values). */
export type CustomerLogin = "email" | "google" | "microsoft";
export type FirebaseConfig = {
	api_key: string;
	auth_domain: string;
	project_id: string;
	app_id: string;
};
export type StoreLogin = {
	providers: CustomerLogin[];
	firebase: FirebaseConfig;
};
/** The shop's own look for one built-in template: `#rrggbb` colours and a font key, "" = the template's own. */
export type ThemeLook = {
	primary: string;
	secondary: string;
	background?: string;
	footer?: string;
	text?: string;
	muted?: string;
	footer_text?: string;
	surface?: string;
	surface_text?: string;
	font: string;
};
/** A built-in template's own four colours, `#rrggbb` (STORE_TEMPLATE_INFO › colors). */
export type ThemeColors = {
	primary: string;
	secondary: string;
	background: string;
	footer: string;
	text: string;
	muted: string;
	footer_text: string;
	surface: string;
	surface_text: string;
};
/** One choice in the /online-store template picker that an extension brings (ExtensionService.themes). */
export type StoreThemeChoice = {
	key: string;
	label: string;
	description: string;
};
export type StoreInfo = StoreContact & {
	name: string;
	slug: string;
	base: string;
	logo: string | null;
	currency: string;
	payment_label: string;
	country: string | null;
	pickup: boolean;
	guided_address: boolean;
	delivery_zones: DeliveryZone[];
	tax_rate: number;
	tax_label: string;
	tax_included: boolean;
	/** The languages the store offers, the default first (the footer switcher shows them). */
	languages: Locale[];
	/** The currencies prices may be shown in, the shop's own first; `[]` = only its own (no switcher). */
	currencies: DisplayCurrency[];
	/** The visitor's pick (`currency` cookie), null = the shop's own — display only, the checkout charges `currency`. */
	display: DisplayCurrency | null;
	pages?: StorePageLink[];
	payments?: StorePayment[];
	login?: StoreLogin | null;
	customer?: StoreCustomerAccount | null;
};
/** Catalog order (`?sort=`, app/constants/Store.Constant.ts › STORE_SORTS); `featured` = the default. */
export type StoreSort = "featured" | "newest" | "price_asc" | "price_desc";
export type StoreVariant = {
	id: number;
	name: string;
	price: number;
	images: string[];
	attributes: Record<string, string> | null;
	stock: number | null;
	sold_out: boolean;
};
/** One "Additional data" row of a product — any title, any text value. */
export type ProductExtra = { title: string; value: string };
export type StoreProduct = {
	id: number;
	name: string;
	slug: string;
	description: string;
	amount: number | null;
	extra: ProductExtra[];
	unit: string | null;
	price: number;
	original_price: number | null;
	images: string[];
	category_ids: number[];
	stock: number | null;
	sold_out: boolean;
	variants: StoreVariant[];
	kind: ProductKind;
	bundle_items: BundleItem[];
	/** The question over the buyer's note box ("" = the default words), or null when the product asks for none. */
	custom_request: string | null;
};
/** Public order summary (thank-you + track pages): no costs, no internal ids. */
export type StoreOrder = {
	id: number;
	reference: string;
	created_at: string;
	status: OrderStatus;
	payment_status: PaymentStatus;
	paid: number;
	payment_method: string;
	fulfillment: FulfillmentStatus | "";
	tracking: string;
	subtotal: number;
	discount: number;
	coupon_code: string | null;
	delivery_fee: number;
	tax: number;
	tax_rate: number;
	tax_label: string;
	tax_included: boolean;
	total: number;
	note: string;
	items: {
		name: string;
		qty: number;
		price: number;
		image: string | null;
		/** The buyer's custom request for this line ("" = none). */
		note: string;
	}[];
};
/** What "Apply" on the checkout page gets back for a discount code: the discount and the delivery fee after it (0 = waived). */
export type StoreCouponQuote = {
	code: string;
	type: CouponType;
	value: number;
	description: string;
	discount: number;
	delivery_fee: number;
};
/** What "Apply code" in the POS cart gets back (`POST /pos/coupon`): no delivery at the till, so the type is never free_delivery. */
export type PosCouponQuote = {
	code: string;
	type: "percent" | "fixed";
	value: number;
	description: string;
	discount: number;
};

// Coupons / discount codes (app/models/Coupon.ts; /coupons, admin). Money is cents, dates YYYY-MM-DD in the shop's time zone.
export type CouponType = "percent" | "fixed" | "free_delivery";
export type Coupon = {
	id: number;
	shop_id: number;
	code: string;
	description: string;
	type: CouponType;
	value: number; // percent (1..100) or cents; 0 for free_delivery
	min_subtotal: number;
	max_discount: number | null;
	starts_at: string | null;
	ends_at: string | null;
	usage_limit: number | null;
	per_customer_limit: number | null;
	product_ids: number[];
	category_ids: number[];
	emails: string[];
	active: boolean;
	created_at: string;
	updated_at: string;
};
export type CouponWithStats = Coupon & {
	used_count: number;
	saved_total: number;
};
/** Totals over every code of a shop (cents): times used, discount given, the totals of those orders. */
export type CouponSummary = { uses: number; saved: number; sales: number };
/** One order that used a code (/coupons/:id); the order fields are null when the order is gone. */
export type CouponRedemption = {
	id: number;
	coupon_id: number;
	order_id: number;
	email: string;
	amount: number;
	created_at: string;
	reference: string | null;
	order_total: number | null;
	order_status: OrderStatus | null;
	customer_name: string | null;
};
/** A manual payment option (cash on delivery, bank transfer) — drives the inputs on /online-store › Payments.
 * Real providers are extensions instead. */
export type GatewayField = {
	name: string;
	label: string;
	secret: boolean;
	placeholder?: string;
	starts_with?: string;
	options?: { value: string; label: string }[];
	multiline?: boolean;
};
export type GatewayInfo = {
	key: string;
	label: string;
	help_url: string;
	fields: GatewayField[];
};
/** A custom domain on a server that routes it and gets its SSL (`DomainService.info`). */
export type DomainSetup = {
	status: "" | "pending" | "live";
	cname: string; // a subdomain's CNAME points here
	ips: string[]; // a root domain's A record points here
	found: string[]; // what the domain points at now
	txt: { name: string; value: string }; // the TXT record that proves the shop owns the domain
};
/** /online-store settings (admin). `manual_gateways` = the manual options switched on; the online provider is a
 * payment extension. Secret values are never sent back — only whether each is stored. */
export type OnlineStoreSettings = {
	enabled: boolean;
	slug: string;
	domain: string;
	/** The free address with `{slug}` in place of the slug, like `https://{slug}.shop.sellrika.com`. */
	subdomain_url: string;
	/** The DNS records to add and where the domain stands; null = the merchant sets up DNS + SSL alone. */
	domain_setup: DomainSetup | null;
	google_site_verification: string;
	template: string;
	manual_gateways: string[];
	credentials: Record<string, Record<string, string>>;
	secret_set: Record<string, Record<string, boolean>>;
	alert_email: string;
	telegram_chat_id: string;
	telegram_token_set: boolean; // the bot token itself is never sent back
	ga_id: string;
	meta_pixel_id: string;
	support_email: string; // printed on order emails; "" = the owner's account email
	// the Delivery section (its own form → PUT /online-store/delivery); `country` "" = not set
	country: string;
	pickup: boolean;
	guided_address: boolean;
	delivery_zones: DeliveryZone[];
	theme_config: Record<string, ThemeLook | undefined>; // per built-in template (the Customize dialog → PUT /online-store/theme)
	languages: Locale[]; // the Languages section (its own form → PUT /online-store/languages), the default first
	currencies: StoreCurrency[]; // the Currencies section (its own form → PUT /online-store/currencies); rate null = automatic
	exchange: { rates: Record<string, number>; fetched_at: string | null }; // automatic rates per 1 of the shop's currency
	banner: string;
	banner_type: StoreBannerType;
	phone: string;
	address: string;
	hours: string;
	facebook: string;
	instagram: string;
	viber: string;
	whatsapp: string;
	// customer accounts: the sign-in providers switched on and the Firebase web config (public values, echoed back as saved)
	customer_logins: CustomerLogin[];
	firebase: FirebaseConfig;
};
/** Email provider definition (app/mail) — drives the credential inputs on /settings (admin only). */
export type MailField = {
	name: string;
	label: string;
	secret: boolean;
	required: boolean;
	placeholder?: string;
};
export type MailerInfo = {
	key: string;
	label: string;
	help_url: string | null;
	note: string | null;
	fields: MailField[];
};
/** Account-wide outgoing email. Secret values are never sent back — only whether each is stored. */
/** `driver` = the provider that delivers ("" = none); every provider's credentials stay saved. */
/**
 * One mail setup (`GET /email` = the platform's, `GET /shop-email` = the active shop's own).
 * Every email through the setup goes out from `from_email`.
 */
export type MailSettings = {
	driver: string;
	from_email: string;
	credentials: Record<string, Record<string, string>>;
	secret_set: Record<string, Record<string, boolean>>;
	configured: boolean;
};

/** One extension the shop uploaded, with the shop's state on it
 * (`GET /extensions`, mirror of ExtensionService.ExtensionRow). `config` = non-secret values as saved (secrets ""),
 * `secret_set` = whether each secret is stored, `ready` = every required field filled, `problem` = why it can't run (stored secrets the server's APP_KEY can't read). */
export type ExtensionFieldType =
	| "text"
	| "url"
	| "number"
	| "select"
	| "multiselect"
	| "switch"
	| "checkbox"
	| "list";
export type ExtensionConfigPrimitive = string | number | boolean | string[];
/** A `list` field holds rows keyed by its sub-field names. */
export type ExtensionConfigValue =
	| ExtensionConfigPrimitive
	| Record<string, ExtensionConfigPrimitive>[];
export type ExtensionField = {
	name: string;
	label: string;
	type: ExtensionFieldType;
	secret: boolean;
	required: boolean;
	multiline: boolean;
	grid: number;
	placeholder?: string;
	hint?: string;
	options?: { value: string; label: string }[];
	min?: number;
	max?: number;
	step?: number;
	fields?: ExtensionField[];
	add_label?: string;
};
/** The manifest's `payment` block when the extension is a payment gateway (null when it is not):
 * `mode` = how the buyer pays, `public_field` = the field the browser may see, `script` = the tokenize form's browser script. */
export type ExtensionPayment = {
	mode: "hosted" | "tokenize";
	public_field?: string;
	script?: string;
	instructions?: string;
};
/** One extension of the platform on Admin › Global Extensions (mirror of `PlatformExtensionRow` on the server). */
export type PlatformExtensionRow = {
	key: string;
	name: string;
	version: string;
	description: string;
	icon: string | null;
	builtin: boolean;
	enabled: boolean;
	users: string[]; // the emails of the users it is for; [] = every user
};

export type ExtensionRow = {
	key: string;
	name: string;
	version: string;
	description: string;
	help_url: string | null;
	icon: string | null;
	fields: ExtensionField[];
	pages: { path: string; title: string; script: string; admin: boolean }[];
	slots: { name: string; script: string }[];
	payment: ExtensionPayment | null;
	/** The script of its own settings form (slot `extension.config`), or null = the dialog draws `fields`. */
	config_script: string | null;
	/** Its dictionary in the page's language, for that script. */
	strings: Record<string, string>;
	installed: boolean;
	enabled: boolean;
	ready: boolean;
	problem: string | null;
	config: Record<string, ExtensionConfigValue>;
	secret_set: Record<string, boolean>;
};
/** A running extension's UI (shared prop `extension_ui`, mirror of ExtensionService.ExtensionUi): its sidebar pages (`group` = the sidebar section they join) and, per slot name, the script URL to mount. */
export type ExtensionUi = {
	key: string;
	name: string;
	version: string;
	icon: string | null;
	pages: {
		path: string;
		title: string;
		href: string;
		group: string;
		before: string | null; // the app section its own section sits above, null = at the end
		icon: string | null; // the page's own icon, else the extension's logo
	}[];
	slots: Record<string, string>;
	/** the extension's own dictionary in the page's language (`api.t` in its scripts) */
	strings: Record<string, string>;
	/** app settings it sets, by name (`pos.primary` = the checkout's main button, `orders.delivery` = `hide` takes the delivery steps off the Orders list) */
	app: { "pos.primary"?: unknown; "orders.delivery"?: unknown };
	/** the app's sidebar links it hides, by path (the pages stay reachable) */
	hide_nav: string[];
	/** its payment method must be approved by the extension before a pay dialog can be confirmed (manifest `payment_method.confirm`) */
	payment_confirm: boolean;
};

/** A custom store page (GrapesJS-built; body/css only travel to the editor and the public page). */
export type StorePage = {
	id: number;
	slug: string;
	title: string;
	body: string;
	css: string;
};

/** Server-side page (see app/xcore/http/Paginate.ts). */
export type Paged<T> = {
	data: T[];
	total: number;
	page: number;
	per_page: number;
	last_page: number;
};

/** One hit of the ⌘K global search (`GET /search`, app/repositories/Search.Repository.ts); `amount` = cents to format. */
export type SearchHit = {
	id: number;
	title: string;
	subtitle: string;
	href: string;
	amount?: number;
};
/** Hits per record type — types with nothing found are left out (mirror of SearchService.SearchResults). */
export type SearchResults = Partial<
	Record<
		| "orders"
		| "customers"
		| "products"
		| "coupons"
		| "categories"
		| "staff"
		| "shops",
		SearchHit[]
	>
>;

/** The GeoNames cities / postal codes download (`GET /postal-codes/status`, mirror of PostalCodeService.PostalStatus):
 * `downloading` / `importing` are live (`done`/`total` = bytes, then characters of the file); `ready` / `failed` = the last run's outcome. */
export type PostalStatus = {
	status: "none" | "downloading" | "importing" | "ready" | "failed";
	scope: "country" | "all" | null;
	country: string | null;
	code: string | null;
	rows: number;
	done: number;
	total: number;
	updated_at: string | null;
	error: string | null;
	countries: {
		code: string;
		name: string;
		rows: number;
		updated_at: string | null;
	}[]; // what is in the table, A–Z
};

/** Props shared with every page (see app/xcore/view/Inertia.ts, the shared props). */
export type SharedProps = {
	/** the language every text is rendered in (`lang` cookie, else Accept-Language) */
	locale: Locale;
	auth: { user: User | null };
	shop: Shop | null;
	/** the active shop's online store address: its own domain, else `https://<slug>.<STORE_DOMAIN>` */
	store_url: string | null;
	shops: Shop[];
	/** units low or out of stock (admin only, 0 otherwise) — Stock sidebar badge */
	low_stock: number;
	/** the running extensions' pages and slot scripts for the active shop ([] when signed out) */
	extension_ui: ExtensionUi[];
	/** what an add-on says about the account's plan; null = nothing */
	plan: PlanNotice | null;
	errors: Record<string, string>;
};

/** Mirror of `PlanNotice` (app/xcore/hooks/Hooks.ts): what an add-on says about the account's plan. */
export type PlanNotice = {
	/** a line over every page, null = none */
	banner: string | null;
	/** the plan's own page, null when this user may not open it */
	href: string | null;
	/** the words of the link next to the banner */
	cta: string;
	/** the words of the link in the user menu */
	menu: string;
};

/** A shop owner on the platform admin's `/owners` list (mirror of `OwnerRow`, app/repositories/Owner.Repository.ts). */
export type OwnerRow = {
	id: number;
	name: string;
	email: string;
	active: boolean;
	created_at: string;
	shops: number;
	staff: number;
	invited: boolean; // the invitation is still open: they never set a password
	last_order_at: string | null;
};
/** One shop of an owner with its all-time totals; `sales` is in the shop's own currency. */
export type OwnerShopRow = {
	id: number;
	name: string;
	logo: string | null;
	currency: string;
	timezone: string;
	slug: string | null;
	online_enabled: boolean;
	created_at: string;
	products: number;
	orders: number;
	sales: number;
	last_order_at: string | null;
};
/** A staff member of an owner, on `/owners/:id`. */
export type OwnerStaff = {
	id: number;
	name: string;
	email: string;
	role: Role;
	active: boolean;
	created_at: string;
};
/** A shop's all-time counts on `/owners/:id/shops/:shop` (cents for money). */
export type ShopTotals = {
	products: number;
	active_products: number;
	categories: number;
	customers: number;
	orders: number;
	online_orders: number;
	sales: number;
	refunds: number;
	first_order_at: string | null;
	last_order_at: string | null;
};
/** The daily report's settings on /reports (`DailyReportService.settings`); `available` = the channels filled in Chat alerts. */
export type ReportSchedule = {
	enabled: boolean;
	time: string;
	channels: ("slack" | "discord" | "line")[];
	available: ("slack" | "discord" | "line")[];
};
/** The headline numbers of one period (mirror of `Summary` in app/services/sales/Report.Service.ts). */
export type ReportSummary = {
	orders: number;
	items: number;
	gross: number;
	discounts: number;
	sales: number;
	tax: number;
	refunds: number;
	revenue: number;
	cogs: number;
	profit: number;
	margin: number | null;
	avg_order: number;
	no_cost_lines: number;
};
/** The part of a shop's report the platform admin sees on `/owners/:id/shops/:shop`. */
export type OwnerShopReport = {
	query: { preset: string; from: string; to: string; by: string };
	summary: ReportSummary;
	previous: ReportSummary;
	series: {
		key: string;
		orders: number;
		sales: number;
		refunds: number;
		profit: number;
	}[];
	top_products: {
		product_id: number | null;
		variant_id: number | null;
		name: string;
		image: string | null;
		qty: number;
		refunded_qty: number;
		revenue: number;
	}[];
	by_method: { method: string; orders: number; sales: number }[];
};

/** The life of an email campaign (app/constants/Marketing.Constant.ts). */
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent";

/** One email campaign of the shop (/marketing). */
export type Campaign = {
	id: number;
	subject: string;
	body: string;
	product_ids: number[];
	customer_ids: number[];
	status: CampaignStatus;
	/** When it goes out (UTC); null = a draft. */
	send_at: string | null;
	sent: number;
	failed: number;
	created_at: string;
	updated_at: string;
};

/** One recipient of a campaign that went out. */
export type CampaignSend = {
	id: number;
	customer_id: number;
	email: string;
	name: string | null;
	sent_at: string | null;
	error: string | null;
};

/** A customer in the campaign's recipient picker. */
export type MarketingCustomer = {
	id: number;
	name: string;
	email: string;
	unsubscribed: boolean;
};

/** One line the "Complete your order" link puts back into the store cart. */
export type RestoredLine = {
	product_id: number;
	variant_id: number | null;
	name: string;
	image: string | null;
	price: number;
	qty: number;
	/** The buyer's custom request ("" = none). */
	note?: string;
};

/** How often the platform fetches exchange rates (app/constants/Currency.Constant.ts › RATE_SCHEDULES). */
export type RateSchedule = "off" | "30m" | "1h" | "6h" | "12h" | "1d";
/** The platform's table of exchange rates (/exchange-rates): units per 1 of `base`. */
export type ExchangeRates = {
	base: string;
	rates: Record<string, number>;
	fetched_at: string | null;
	tried_at: string | null;
	error: string | null;
};
