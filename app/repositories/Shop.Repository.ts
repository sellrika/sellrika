import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { Url } from "@xcore/http/Url";
import { app } from "@config/app";
import { parseJson } from "@helpers/json";
import type { Shop } from "@models/Shop";
import { shopLocales, type Locale } from "@i18n";
import {
	CUSTOMER_LOGINS,
	type CustomerLogin,
	type FirebaseConfig,
	type StoreBannerType,
} from "@constants/Store.Constant";
import type { ShopInput } from "@validators/Shop.Validator";
import type { StoreDeliveryInput } from "@validators/Store.Validator";
import type { DeliveryZone } from "@validators/StoreCustomer.Validator";
import type { StoreCurrency } from "@helpers/currency";
import { defaultSteps, type FulfillmentStep } from "@constants/Order.Constant";
import type { DomainStatus } from "@constants/Domain.Constant";
import {
	REPORT_CHANNELS,
	type ReportChannel,
} from "@constants/Report.Constant";
import type { ReportScheduleInput } from "@validators/Report.Validator";

/**
 * The explicit column list of a shop.
 * `payment_credentials` and `telegram_bot_token` stay out of it.
 * So they never reach a query that feeds shared props or pages.
 */
const COLS = sql`id, owner_id, name, currency, logo, timezone, support_email, country, pickup, guided_address, delivery_zones, tax_rate, tax_label, tax_included, slug, domain, domain_status, google_site_verification, online_enabled, online_template, manual_gateways, alert_email, telegram_chat_id, ga_id, meta_pixel_id, banner, banner_type, phone, address, hours, facebook, instagram, viber, whatsapp, customer_logins, firebase_config, languages, currencies, fulfillment_steps, report_enabled, report_time, report_channels, report_sent_on, theme_config, created_at`;
/**
 * A `shops` row as the driver returns it.
 * SQLite booleans are 0/1.
 * `manual_gateways` is a comma list in the column.
 * `delivery_zones` is JSON text.
 * Both are arrays on the model.
 */
type ShopRow = Omit<
	Shop,
	| "online_enabled"
	| "tax_included"
	| "pickup"
	| "guided_address"
	| "manual_gateways"
	| "customer_logins"
	| "firebase_config"
	| "languages"
	| "currencies"
	| "fulfillment_steps"
	| "delivery_zones"
	| "report_enabled"
	| "report_channels"
	| "theme_config"
> & {
	online_enabled: unknown;
	tax_included: unknown;
	pickup: unknown;
	guided_address: unknown;
	manual_gateways: string | null;
	customer_logins: string | null;
	firebase_config: string | null;
	languages: string | null;
	currencies: string | null;
	fulfillment_steps: string | null;
	delivery_zones: string | null;
	report_enabled: unknown;
	report_channels: string | null;
	theme_config: string | null;
};

/** A stored delivery zone. One saved before `states` existed has none. */
type StoredZone = Omit<DeliveryZone, "states"> & { states?: string[] };

/** Shops — the tenant boundary of the whole POS. */
@Service()
export class ShopRepository {
	/**
	 * Every shop of one owner, for the shop switcher.
	 * @param ownerId The owner (`Account.id()` of the signed-in user).
	 * @returns Their shops, ordered by name.
	 */
	async all(ownerId: number): Promise<Shop[]> {
		return (
			await sql`select ${COLS} from shops where owner_id = ${ownerId} order by name`
		).map((r: ShopRow) => this.#row(r));
	}

	/**
	 * Every shop of every owner.
	 * Only for work that is not done for one user (sending an event to all shops).
	 * @returns All shops, ordered by id.
	 */
	async everyShop(): Promise<Shop[]> {
		return (await sql`select ${COLS} from shops order by id`).map(
			(r: ShopRow) => this.#row(r),
		);
	}

	/**
	 * The owner's default shop: what a fresh session lands on.
	 * @param ownerId The owner.
	 * @returns Their oldest shop, or null when they have none.
	 */
	async first(ownerId: number): Promise<Shop | null> {
		return Db.one(
			sql`select ${COLS} from shops where owner_id = ${ownerId} order by id limit 1`,
			(r) => this.#row(r),
		);
	}

	/**
	 * One shop by id.
	 * @param id Shop id.
	 * @returns The shop, or null.
	 */
	async find(id: number): Promise<Shop | null> {
		return Db.one(sql`select ${COLS} from shops where id = ${id}`, (r) =>
			this.#row(r),
		);
	}

	/**
	 * One shop by id, only when this owner owns it.
	 * @param id Shop id.
	 * @param ownerId The owner.
	 * @returns The shop, or null when it is missing or someone else's.
	 */
	async findOwned(id: number, ownerId: number): Promise<Shop | null> {
		return Db.one(
			sql`select ${COLS} from shops where id = ${id} and owner_id = ${ownerId}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * One shop by its storefront slug (its subdomain `<slug>.<STORE_DOMAIN>`).
	 * @param slug Storefront slug.
	 * @returns The shop, or null.
	 */
	async findBySlug(slug: string): Promise<Shop | null> {
		return Db.one(sql`select ${COLS} from shops where slug = ${slug}`, (r) =>
			this.#row(r),
		);
	}

	/**
	 * Custom-domain lookup for a public request.
	 * A shop set to "example.com" also answers on www.example.com.
	 * The shop that saved the exact host comes first.
	 * While the app manages domains (`DOMAIN_CNAME`), only a live domain
	 * counts: one its shop proved. A pending one serves nothing.
	 * @param host Hostname of the request, lowercased and without the port.
	 * @returns The shop that claims that hostname, or null.
	 */
	async findByDomain(host: string): Promise<Shop | null> {
		const bare = host.replace(/^www\./, "");
		const anyStatus = !app.domains.cname;
		return Db.one(
			sql`select ${COLS} from shops
        where (domain = ${host} or domain = ${bare}) and (${anyStatus} or domain_status = 'live')
        order by case when domain = ${host} then 0 else 1 end limit 1`,
			(r) => this.#row(r),
		);
	}

	/**
	 * The shop a public request's host belongs to: its own domain first,
	 * else its free address `<slug>.<store domain>`.
	 * @param host Hostname of the request, lowercased and without the port.
	 * @returns The shop, or null when no shop answers on this host.
	 */
	async findByHost(host: string): Promise<Shop | null> {
		const slug = Url.slugOfHost(host);
		if (!slug) return this.findByDomain(host);
		const bare = host.replace(/^www\./, "");
		const anyStatus = !app.domains.cname;
		// one query for both: the shop that owns the domain sorts first
		return Db.one(
			sql`select ${COLS} from shops
        where ((domain = ${host} or domain = ${bare}) and (${anyStatus} or domain_status = 'live')) or slug = ${slug}
        order by case when domain = ${host} then 0 when domain = ${bare} then 1 else 2 end limit 1`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Is this custom domain already claimed by another shop?
	 * @param domain Hostname to check.
	 * @param exceptId Shop allowed to keep it.
	 * @param liveOnly Count only a domain that is live (its owner proved it).
	 * @returns True when taken.
	 */
	async domainTaken(domain: string, exceptId = 0, liveOnly = false) {
		return Db.exists(
			sql`select 1 from shops where domain = ${domain} and id <> ${exceptId} and (${!liveOnly} or domain_status = 'live')`,
		);
	}

	/**
	 * Take a custom domain away from every other shop that saved it.
	 * Called before a shop saves it, once we know no other shop has it live.
	 * @param domain The domain.
	 * @param exceptId The shop that saves it now.
	 */
	async releaseDomain(domain: string, exceptId: number) {
		await sql`update shops set domain = null, domain_status = '' where domain = ${domain} and id <> ${exceptId}`;
	}

	/**
	 * Every shop with a custom domain, for the DNS check.
	 * @returns Id, domain and status of each, ordered by id.
	 */
	async withDomain(): Promise<
		{ id: number; domain: string; domain_status: DomainStatus }[]
	> {
		return [
			...(await sql`select id, domain, domain_status from shops where domain is not null order by id`),
		];
	}

	/**
	 * Save where a shop's custom domain stands.
	 * @param id Shop id.
	 * @param status pending or live.
	 */
	setDomainStatus(id: number, status: DomainStatus) {
		return sql`update shops set domain_status = ${status} where id = ${id}`;
	}

	/**
	 * Shops with a public storefront (for the landing page at "/").
	 * @returns Online shops ordered by name.
	 */
	async online(): Promise<Shop[]> {
		return (
			await sql`select ${COLS} from shops where online_enabled = ${true} order by name`
		).map((r: ShopRow) => this.#row(r));
	}

	/**
	 * Is this storefront slug already used by another shop?
	 * @param slug Slug to check.
	 * @param exceptId Shop allowed to keep it.
	 * @returns True when taken.
	 */
	async slugTaken(slug: string, exceptId = 0) {
		return Db.exists(
			sql`select 1 from shops where slug = ${slug} and id <> ${exceptId}`,
		);
	}

	/**
	 * Create a shop.
	 * @param d Validated shop settings.
	 * @param slug A storefront slug already known to be free.
	 * @param ownerId The user who will own it.
	 * @returns The created shop.
	 */
	async create(d: ShopInput, slug: string, ownerId: number): Promise<Shop> {
		return this.#row(
			(
				await sql`insert into shops (name, currency, logo, timezone, tax_rate, tax_label, tax_included, slug, owner_id)
      values (${d.name}, ${d.currency}, ${d.logo}, ${d.timezone}, ${d.tax_rate}, ${d.tax_label}, ${d.tax_included}, ${slug}, ${ownerId}) returning ${COLS}`
			)[0],
		);
	}

	/**
	 * Edit a shop's general settings (not the online-store ones).
	 * @param id Shop id.
	 * @param d Validated shop settings.
	 * @returns The updated shop, or null when the id doesn't exist.
	 */
	async update(id: number, d: ShopInput): Promise<Shop | null> {
		return Db.one(
			sql`update shops set name = ${d.name}, currency = ${d.currency}, logo = ${d.logo}, timezone = ${d.timezone},
      tax_rate = ${d.tax_rate}, tax_label = ${d.tax_label}, tax_included = ${d.tax_included} where id = ${id} returning ${COLS}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Delivery settings (migration 0045).
	 * Where the shop is, the shipping zones, pick-up,
	 * and the address lists at the checkout.
	 * @param id Shop id.
	 * @param d Validated delivery settings (zones stored as JSON text).
	 */
	updateDelivery(id: number, d: StoreDeliveryInput) {
		return sql`update shops set country = ${d.country}, pickup = ${d.pickup}, guided_address = ${d.guided_address}, delivery_zones = ${JSON.stringify(d.delivery_zones)} where id = ${id}`;
	}

	/**
	 * The languages the online store offers (migration 0060).
	 * @param id Shop id.
	 * @param languages Valid locales, the default first.
	 */
	updateLanguages(id: number, languages: Locale[]) {
		return sql`update shops set languages = ${languages.join(",")} where id = ${id}`;
	}

	/**
	 * The shop's own colours and font per built-in theme (migration 0085).
	 * @param id Shop id.
	 * @param config Every theme's look, checked.
	 */
	updateThemeConfig(id: number, config: Shop["theme_config"]) {
		return sql`update shops set theme_config = ${JSON.stringify(config)} where id = ${id}`;
	}

	/**
	 * The extra currencies the online store shows prices in (migration 0063).
	 * @param id Shop id.
	 * @param currencies Valid codes, each with its manual rate or null.
	 */
	updateCurrencies(id: number, currencies: StoreCurrency[]) {
		return sql`update shops set currencies = ${JSON.stringify(currencies)} where id = ${id}`;
	}

	/**
	 * The delivery steps of the shop's online orders (migration 0064).
	 * @param id Shop id.
	 * @param list Valid steps, in order.
	 */
	updateFulfillmentSteps(id: number, list: FulfillmentStep[]) {
		return sql`update shops set fulfillment_steps = ${JSON.stringify(list)} where id = ${id}`;
	}

	/**
	 * The daily report's settings (migration 0084).
	 * @param id Shop id.
	 * @param d The switch, the time and the channels.
	 * @param sentOn The shop's day to mark as already reported,
	 *   or null to leave the mark as it is.
	 */
	updateReport(id: number, d: ReportScheduleInput, sentOn: string | null) {
		return sql`update shops set report_enabled = ${d.enabled}, report_time = ${d.time}, report_channels = ${d.channels.join(",")}, report_sent_on = coalesce(${sentOn}, report_sent_on) where id = ${id}`;
	}

	/**
	 * Every shop that wants a daily report.
	 * @returns The shops with the switch on.
	 */
	async withReport(): Promise<Shop[]> {
		return (
			await sql`select ${COLS} from shops where report_enabled = ${true} order by id`
		).map((r: ShopRow) => this.#row(r));
	}

	/**
	 * Take today's report of a shop, so it goes out once.
	 * One statement checks and marks, so two runs can't both take it.
	 * @param id Shop id.
	 * @param day The shop's day, `YYYY-MM-DD`.
	 * @returns True when this call took it.
	 */
	async claimReport(id: number, day: string) {
		const rows =
			await sql`update shops set report_sent_on = ${day} where id = ${id} and report_enabled = ${true} and report_sent_on <> ${day} returning id`;
		return rows.length > 0;
	}

	/**
	 * Online-store settings.
	 * @param id Shop id.
	 * @param d Slug, domain + its status, Search Console token, enabled flag,
	 *   template, and the manual payment options switched on.
	 *   Their fields as a JSON blob (secret fields already encrypted by the caller).
	 *   The new-order alert channels (bot token already encrypted).
	 *   The analytics ids and the announcement banner.
	 *   The footer contact block (phone, address, hours, social links).
	 *   The support email printed on order emails.
	 *   The customer sign-in providers + the Firebase web config behind them
	 *   (migration 0046).
	 */
	updateOnline(
		id: number,
		d: {
			slug: string;
			domain: string | null;
			domain_status: DomainStatus;
			google_site_verification: string | null;
			enabled: boolean;
			template: string;
			manual_gateways: string[];
			credentials: string | null;
			alert_email: string | null;
			telegram_bot_token: string | null;
			telegram_chat_id: string | null;
			ga_id: string | null;
			meta_pixel_id: string | null;
			banner: string | null;
			banner_type: StoreBannerType;
			phone: string | null;
			address: string | null;
			hours: string | null;
			facebook: string | null;
			instagram: string | null;
			viber: string | null;
			whatsapp: string | null;
			support_email: string | null;
			customer_logins: CustomerLogin[];
			firebase_config: FirebaseConfig | null;
		},
	) {
		return sql`update shops set slug = ${d.slug}, domain = ${d.domain}, domain_status = ${d.domain_status}, google_site_verification = ${d.google_site_verification}, online_enabled = ${d.enabled}, online_template = ${d.template}, manual_gateways = ${d.manual_gateways.join(",")}, payment_credentials = ${d.credentials},
      alert_email = ${d.alert_email}, telegram_bot_token = ${d.telegram_bot_token}, telegram_chat_id = ${d.telegram_chat_id}, ga_id = ${d.ga_id}, meta_pixel_id = ${d.meta_pixel_id},
      banner = ${d.banner}, banner_type = ${d.banner_type}, phone = ${d.phone}, address = ${d.address}, hours = ${d.hours}, facebook = ${d.facebook}, instagram = ${d.instagram}, viber = ${d.viber}, whatsapp = ${d.whatsapp}, support_email = ${d.support_email},
      customer_logins = ${d.customer_logins.join(",")}, firebase_config = ${d.firebase_config ? JSON.stringify(d.firebase_config) : null} where id = ${id}`;
	}

	/**
	 * The encrypted Telegram bot token for new-order alerts.
	 * Never send this to the client.
	 * @param id Shop id.
	 * @returns The ciphertext, or null when none was saved.
	 */
	async alertToken(id: number): Promise<string | null> {
		return (
			(await sql`select telegram_bot_token from shops where id = ${id}`)[0]
				?.telegram_bot_token ?? null
		);
	}

	/**
	 * Raw payment_credentials JSON (`{ [manual option]: { field: value } }`).
	 * Never send this to the client.
	 * @param id Shop id.
	 * @returns The JSON blob, or null when nothing was ever saved.
	 */
	async credentials(id: number): Promise<string | null> {
		return (
			(await sql`select payment_credentials from shops where id = ${id}`)[0]
				?.payment_credentials ?? null
		);
	}

	/**
	 * Delete a shop and everything hanging off it.
	 * Guarded by ShopService: no products, never the last shop.
	 * @param id Shop id.
	 * @returns A promise that ends when the shop is gone.
	 */
	delete(id: number) {
		return sql.begin((tx) => this.#drop(tx, id));
	}

	/**
	 * How many products a shop still holds — a shop with products can't be deleted.
	 * @param id Shop id.
	 * @returns The count.
	 */
	async countProducts(id: number) {
		return Number(
			(await sql`select count(*) as n from products where shop_id = ${id}`)[0]
				.n,
		);
	}

	/**
	 * How many shops an owner has.
	 * Their last one can't be deleted.
	 * @param ownerId The owner.
	 * @returns The count.
	 */
	async count(ownerId: number) {
		return Number(
			(
				await sql`select count(*) as n from shops where owner_id = ${ownerId}`
			)[0].n,
		);
	}
	/**
	 * Is this a sign-in provider the store knows?
	 * @param v One entry of the `customer_logins` comma list.
	 * @returns True for `email`, `google` or `microsoft`.
	 */
	#isCustomerLogin(v: string): v is CustomerLogin {
		return (CUSTOMER_LOGINS as readonly string[]).includes(v);
	}

	/**
	 * Is this a channel the daily report knows?
	 * @param v One entry of the `report_channels` comma list.
	 * @returns True for `slack`, `discord` or `line`.
	 */
	#isReportChannel(v: string): v is ReportChannel {
		return Object.hasOwn(REPORT_CHANNELS, v);
	}

	/**
	 * The delivery steps of a shop.
	 * @param json The `fulfillment_steps` column.
	 * @returns The saved list, or the built-in one when never saved.
	 */
	#steps(json: string | null): FulfillmentStep[] {
		return json ? JSON.parse(json) : defaultSteps();
	}

	/**
	 * A stored delivery zone as the model has it.
	 * ponytail: zones saved before `states` existed get an empty list.
	 * Drop this once every dev DB is re-saved.
	 * @param z The zone as stored.
	 * @returns The zone with a `states` list.
	 */
	#withStates(z: StoredZone): DeliveryZone {
		return { states: [], ...z };
	}

	/**
	 * Turn a database row into a `Shop`.
	 * @param r The raw row.
	 * @returns The shop with real booleans and parsed lists.
	 */
	#row(r: ShopRow): Shop {
		return {
			...r,
			online_enabled: !!r.online_enabled,
			tax_included: !!r.tax_included,
			pickup: !!r.pickup,
			guided_address: !!r.guided_address,
			manual_gateways: String(r.manual_gateways ?? "")
				.split(",")
				.filter(Boolean),
			customer_logins: String(r.customer_logins ?? "")
				.split(",")
				.filter((v): v is CustomerLogin => this.#isCustomerLogin(v)),
			firebase_config: parseJson<FirebaseConfig | null>(
				r.firebase_config,
				null,
			),
			languages: shopLocales(r.languages),
			currencies: parseJson<StoreCurrency[]>(r.currencies, []),
			fulfillment_steps: this.#steps(r.fulfillment_steps),
			report_enabled: !!r.report_enabled,
			report_channels: String(r.report_channels ?? "")
				.split(",")
				.filter((v): v is ReportChannel => this.#isReportChannel(v)),
			theme_config: parseJson<Shop["theme_config"]>(r.theme_config, {}),
			delivery_zones: parseJson<StoredZone[]>(r.delivery_zones, []).map((z) =>
				this.#withStates(z),
			),
		};
	}

	/**
	 * The writes of `delete`, inside its transaction.
	 * Every child row that points at the shop goes first.
	 * Postgres enforces those foreign keys.
	 * So a plain `delete from shops` fails with a 500
	 * for any shop that was ever used
	 * (payment methods are seeded on create).
	 * @param tx The open transaction.
	 * @param id Shop id.
	 */
	async #drop(tx: SQL, id: number) {
		await tx`delete from refund_items where refund_id in (select id from refunds where shop_id = ${id})`;
		await tx`delete from refunds where shop_id = ${id}`;
		await tx`delete from order_items where order_id in (select id from orders where shop_id = ${id})`;
		await tx`delete from stock_movements where shop_id = ${id}`;
		await tx`delete from coupon_redemptions where shop_id = ${id}`;
		await tx`delete from coupons where shop_id = ${id}`;
		await tx`delete from order_history where shop_id = ${id}`;
		await tx`delete from orders where shop_id = ${id}`;
		await tx`delete from customer_sessions where shop_id = ${id}`;
		await tx`delete from customer_addresses where shop_id = ${id}`;
		await tx`delete from customers where shop_id = ${id}`;
		await tx`delete from email_queue where kind = 'campaign' and group_id in (select id from campaigns where shop_id = ${id})`;
		await tx`delete from campaign_sends where campaign_id in (select id from campaigns where shop_id = ${id})`;
		await tx`delete from campaigns where shop_id = ${id}`;
		await tx`delete from email_unsubscribes where shop_id = ${id}`;
		await tx`delete from store_carts where shop_id = ${id}`;
		await tx`delete from store_pages where shop_id = ${id}`;
		await tx`delete from payment_methods where shop_id = ${id}`;
		await tx`delete from sales_staff where shop_id = ${id}`;
		await tx`delete from sales_commissions where shop_id = ${id}`;
		await tx`delete from api_keys where shop_id = ${id}`;
		await tx`delete from shop_extensions where shop_id = ${id}`;
		await tx`delete from extension_data where shop_id = ${id}`;
		await tx`delete from extension_rows where shop_id = ${id}`;
		await tx`delete from categories where shop_id = ${id}`;
		// whoever was selling here picks a shop again
		await tx`update sessions set shop_id = null where shop_id = ${id}`;
		await tx`delete from shops where id = ${id}`;
	}
}
