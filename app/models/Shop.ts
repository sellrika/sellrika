import type { Locale } from "@i18n";
import type {
	CustomerLogin,
	FirebaseConfig,
	StoreBannerType,
	StoreTemplate,
	ThemeLook,
} from "@constants/Store.Constant";
import type { DeliveryZone } from "@validators/StoreCustomer.Validator";
import type { StoreCurrency } from "@helpers/currency";
import type { FulfillmentStep } from "@constants/Order.Constant";
import type { DomainStatus } from "@constants/Domain.Constant";
import type { ReportChannel } from "@constants/Report.Constant";

/** One shop: the tenant every product, order and customer belongs to. */
export type Shop = {
	id: number;
	/**
	 * The user who owns it.
	 * Only they and their staff see it (migration 0052).
	 */
	owner_id: number;
	name: string;
	currency: string;
	logo: string | null;
	timezone: string;
	/**
	 * Where customers write about an order.
	 * Shown on order emails; set on /online-store › Banner & contact.
	 * null = the owner's account email.
	 */
	support_email: string | null;
	/**
	 * Where the shop is — the country NAME (Country.Constant).
	 * It is the checkout's default country.
	 * Its postal codes are offered first.
	 */
	country: string | null;
	/**
	 * The buyer may collect in store (fee 0, no address asked).
	 * Migration 0043.
	 */
	pickup: boolean;
	/**
	 * State → City lists at the checkout,
	 * when the country's postal codes are downloaded.
	 * false = plain text boxes (migration 0045).
	 */
	guided_address: boolean;
	/**
	 * Shipping zones (JSON in the column, migration 0045).
	 * Priced by deliveryFee().
	 */
	delivery_zones: DeliveryZone[];
	/**
	 * Hundredths of a percent (700 = 7%).
	 * 0 = no tax line (app/helpers/tax.ts).
	 */
	tax_rate: number;
	/** What the line is called on receipts ("VAT", "GST"…). */
	tax_label: string;
	/**
	 * true = prices already include the tax (the line is informational).
	 * false = the tax is added on top of the total.
	 */
	tax_included: boolean;
	/**
	 * Public store address: <slug>.<STORE_DOMAIN>.
	 * So never a RESERVED_SLUGS name.
	 * Backfilled by migration 0018, always set for new shops.
	 */
	slug: string | null;
	/** Custom storefront domain (Host match → store served at "/"). */
	domain: string | null;
	/**
	 * pending = waiting for DNS, live = routed with SSL.
	 * Migration 0067, DomainService.
	 */
	domain_status: DomainStatus;
	/**
	 * Search Console meta-tag token, printed on every store page.
	 * The owner verifies the site themselves.
	 */
	google_site_verification: string | null;
	online_enabled: boolean;
	/** Key from app/validators/storeTemplates.ts. */
	online_template: string;
	/**
	 * Manual options switched on (cod, bank_transfer).
	 * `shops.manual_gateways` is a comma list.
	 * The online gateway is an extension.
	 */
	manual_gateways: string[];
	/**
	 * How customers may sign in to the store (email, google, microsoft).
	 * A comma list in the column. [] = accounts off.
	 */
	customer_logins: CustomerLogin[];
	/**
	 * The shop's Firebase web app (public values, JSON in the column).
	 * null = never set (migration 0046).
	 */
	firebase_config: FirebaseConfig | null;
	/**
	 * What the online store offers.
	 * A comma list in the column, the first is the default (never empty).
	 */
	languages: Locale[];
	/**
	 * Extra currencies the store shows prices in.
	 * JSON in the column, migration 0063. Display only.
	 */
	currencies: StoreCurrency[];
	/**
	 * The shop's own colours and font, per built-in theme.
	 * JSON in the column, migration 0085; a theme left out keeps its own look.
	 */
	theme_config: Partial<Record<StoreTemplate, ThemeLook>>;
	/**
	 * The delivery steps of its online orders, in order.
	 * JSON in the column, migration 0064; '' = the built-in list.
	 */
	fulfillment_steps: FulfillmentStep[];
	/** New-order alerts are emailed here; null = off. */
	alert_email: string | null;
	/**
	 * New-order alerts by Telegram.
	 * It goes with the encrypted `shops.telegram_bot_token`,
	 * which is never on the model. null = off.
	 */
	telegram_chat_id: string | null;
	/**
	 * Google Analytics 4 measurement id ("G-…").
	 * Loaded on every store page.
	 */
	ga_id: string | null;
	/** Meta Pixel id, loaded on every store page. */
	meta_pixel_id: string | null;
	/** Announcement line over the storefront header; null = none. */
	banner: string | null;
	/** Its tone (info | success | warning | danger). */
	banner_type: StoreBannerType;
	/** Contact block in every storefront footer (all optional). */
	phone: string | null;
	address: string | null;
	/** Opening hours, free text (may hold several lines). */
	hours: string | null;
	/** Page URL. */
	facebook: string | null;
	/** Profile URL. */
	instagram: string | null;
	/** Phone digits with country code → viber://chat?number=+… */
	viber: string | null;
	/** Phone digits with country code → https://wa.me/… */
	whatsapp: string | null;
	/**
	 * The daily sales report (set on /reports, migration 0084).
	 * true = it is posted every day at `report_time`.
	 */
	report_enabled: boolean;
	/** When it goes out, `HH:MM` on the shop's clock. */
	report_time: string;
	/**
	 * The Chat alerts channels it goes to.
	 * A comma list in the column.
	 */
	report_channels: ReportChannel[];
	/** The shop's day (`YYYY-MM-DD`) of the last report; "" = never. */
	report_sent_on: string;
	created_at: string;
};
