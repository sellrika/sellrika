import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { Paginate } from "@xcore/http/Paginate";
import { STORE_SYSTEM_EMAIL } from "@constants/Store.Constant";
import type { Role } from "@constants/User.Constant";

/** A shop owner on the platform admin's list, with how big their account is. */
export type OwnerRow = {
	id: number;
	name: string;
	email: string;
	active: boolean;
	created_at: string;
	shops: number;
	staff: number;
	/**
	 * An invitation link is still open.
	 * They never set a password.
	 */
	invited: boolean;
	last_order_at: string | null;
};

/**
 * One shop of an owner, with its all-time totals.
 * `sales` is in the shop's own currency.
 */
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

/** A shop's all-time counts, for the platform admin's shop page. */
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

/**
 * The per-owner numbers.
 * Shops, staff, an open invitation,
 * and the newest order in any of their shops.
 */
const ownerStats = sql`
  (select count(*) from shops s where s.owner_id = u.id) as shops,
  (select count(*) from users x where x.owner_id = u.id) as staff,
  (select count(*) from user_invites i where i.user_id = u.id) as invited,
  (select max(o.created_at) from orders o join shops s on s.id = o.shop_id where s.owner_id = u.id) as last_order_at`;

/** The columns of an `OwnerRow`, over `users u`. */
const ownerColumns = sql`u.id, u.name, u.email, u.active, u.created_at, ${ownerStats}`;

/**
 * Is `users u` a shop owner?
 * An owner works for nobody.
 * The online store's system user is never one.
 */
const isOwner = sql`u.owner_id is null and u.email <> ${STORE_SYSTEM_EMAIL}`;

/**
 * A shop's own numbers.
 * Voided orders never count, like every report.
 */
const shopStats = sql`
  (select count(*) from products p where p.shop_id = s.id) as products,
  (select count(*) from orders o where o.shop_id = s.id and o.status <> 'voided') as orders,
  (select coalesce(sum(o.total), 0) from orders o where o.shop_id = s.id and o.status <> 'voided') as sales,
  (select max(o.created_at) from orders o where o.shop_id = s.id) as last_order_at`;

/**
 * A raw row.
 * Every column is read through `Number` / `String` / `dateText` before use.
 */
type RawRow = Record<string, unknown>;

/** An owner's shop row before its columns are turned into real types. */
type RawShopRow = Pick<
	OwnerShopRow,
	"id" | "name" | "logo" | "currency" | "timezone" | "slug"
> &
	Record<
		| "online_enabled"
		| "created_at"
		| "products"
		| "orders"
		| "sales"
		| "last_order_at",
		unknown
	>;

/**
 * What the platform admin sees of the shop owners.
 * Read-only, across every account.
 */
@Service()
export class OwnerRepository {
	/**
	 * The shop owners, newest first, searched by name or email.
	 * The online store's system user is never on it.
	 * @param q Search text ("" = everyone).
	 * @param page Page number, from 1.
	 * @param perPage Rows per page.
	 * @returns One page of owners.
	 */
	async page(q: string, page: number, perPage: number) {
		const like = `%${q.toLowerCase()}%`;
		const where = sql`where ${isOwner}
      and (${q} = '' or lower(u.name) like ${like} or lower(u.email) like ${like})`;
		const [{ n }] = await sql`select count(*) as n from users u ${where}`;
		const rows: RawRow[] = await sql`select ${ownerColumns}
        from users u ${where} order by u.id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<OwnerRow>(
			rows.map((r) => this.#owner(r)),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * One shop owner.
	 * @param id The user id.
	 * @returns The owner, or null when missing or not an owner.
	 */
	async find(id: number): Promise<OwnerRow | null> {
		return Db.one(
			sql`select ${ownerColumns}
        from users u where u.id = ${id} and ${isOwner}`,
			(r) => this.#owner(r),
		);
	}

	/**
	 * The monthly campaign email limit set on an owner.
	 * @param id The owner's user id.
	 * @returns The limit, or null = the default.
	 */
	async campaignLimit(id: number): Promise<number | null> {
		const r = (
			await sql`select campaign_email_limit as n from users where id = ${id}`
		)[0];
		return r?.n == null ? null : Number(r.n);
	}

	/**
	 * Set an owner's monthly campaign email limit.
	 * @param id The owner's user id.
	 * @param limit The limit, or null = the default.
	 * @returns False when there is no such owner.
	 */
	async setCampaignLimit(id: number, limit: number | null) {
		return Db.exists(
			Db.update(
				sql,
				"users",
				sql`campaign_email_limit = ${limit}`,
				sql`id = ${id} and owner_id is null and email <> ${STORE_SYSTEM_EMAIL}`,
			),
		);
	}

	/**
	 * The shops of one owner, with their totals.
	 * @param ownerId The owner.
	 * @returns Their shops, by name.
	 */
	async shops(ownerId: number): Promise<OwnerShopRow[]> {
		const rows: RawShopRow[] =
			await sql`select s.id, s.name, s.logo, s.currency, s.timezone, s.slug, s.online_enabled, s.created_at, ${shopStats}
        from shops s where s.owner_id = ${ownerId} order by s.name`;
		return rows.map((r) => this.#ownerShop(r));
	}

	/**
	 * The staff of one owner.
	 * @param ownerId The owner.
	 * @returns Their staff, oldest first.
	 */
	async staff(ownerId: number) {
		const rows: RawRow[] =
			await sql`select id, name, email, role, active, created_at from users where owner_id = ${ownerId} order by id`;
		return rows.map((r) => this.#staffMember(r));
	}

	/**
	 * A shop's all-time counts.
	 * @param shopId The shop.
	 * @returns Products, categories, customers, orders, sales and refunds (cents).
	 */
	async totals(shopId: number): Promise<ShopTotals> {
		const [r] = await sql`select
      (select count(*) from products where shop_id = ${shopId}) as products,
      (select count(*) from products where shop_id = ${shopId} and active = ${true}) as active_products,
      (select count(*) from categories where shop_id = ${shopId}) as categories,
      (select count(*) from customers where shop_id = ${shopId}) as customers,
      (select count(*) from orders where shop_id = ${shopId} and status <> 'voided') as orders,
      (select count(*) from orders where shop_id = ${shopId} and status <> 'voided' and fulfillment <> '') as online_orders,
      (select coalesce(sum(total), 0) from orders where shop_id = ${shopId} and status <> 'voided') as sales,
      (select coalesce(sum(amount), 0) from refunds where shop_id = ${shopId}) as refunds,
      (select min(created_at) from orders where shop_id = ${shopId}) as first_order_at,
      (select max(created_at) from orders where shop_id = ${shopId}) as last_order_at`;
		return {
			products: Number(r.products),
			active_products: Number(r.active_products),
			categories: Number(r.categories),
			customers: Number(r.customers),
			orders: Number(r.orders),
			online_orders: Number(r.online_orders),
			sales: Number(r.sales),
			refunds: Number(r.refunds),
			first_order_at: this.#dateText(r.first_order_at),
			last_order_at: this.#dateText(r.last_order_at),
		};
	}
	/**
	 * A row's date column as text.
	 * SQLite gives a string, Postgres a Date.
	 * @param v The value.
	 * @returns The date as a string, or null.
	 */
	#dateText(v: unknown): string | null {
		if (v == null) return null;
		return v instanceof Date ? v.toISOString() : String(v);
	}

	/**
	 * One owner row with its counts as numbers.
	 * @param r The raw row.
	 * @returns The owner.
	 */
	#owner(r: RawRow): OwnerRow {
		return {
			id: Number(r.id),
			name: String(r.name),
			email: String(r.email),
			active: !!r.active,
			created_at: this.#dateText(r.created_at)!,
			shops: Number(r.shops),
			staff: Number(r.staff),
			invited: Number(r.invited) > 0,
			last_order_at: this.#dateText(r.last_order_at),
		};
	}

	/**
	 * One shop of an owner with its counts as numbers.
	 * @param r The raw row.
	 * @returns The shop.
	 */
	#ownerShop(r: RawShopRow): OwnerShopRow {
		return {
			...r,
			online_enabled: !!r.online_enabled,
			created_at: this.#dateText(r.created_at)!,
			products: Number(r.products),
			orders: Number(r.orders),
			sales: Number(r.sales),
			last_order_at: this.#dateText(r.last_order_at),
		};
	}

	/**
	 * One staff member of an owner.
	 * @param r The raw row.
	 * @returns Their id, name, email, role, active switch and creation date.
	 */
	#staffMember(r: RawRow) {
		return {
			id: Number(r.id),
			name: String(r.name),
			email: String(r.email),
			role: r.role as Role,
			active: !!r.active,
			created_at: this.#dateText(r.created_at)!,
		};
	}
}
