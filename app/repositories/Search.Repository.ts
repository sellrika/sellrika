import { sql } from "@xcore/database/Database";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { orderLookup } from "@helpers/crypto";
import type { Product } from "@models/Product";
import type { Order } from "@models/Order";
import type { Customer } from "@models/Customer";
import type { Coupon } from "@models/Coupon";
import type { Category } from "@models/Category";
import type { User } from "@models/User";
import type { Shop } from "@models/Shop";

/**
 * One row of the ⌘K palette as the server sees it.
 * What to show and where it leads.
 * `amount` = cents the page formats.
 */
export type SearchHit = {
	id: number;
	title: string;
	subtitle: string;
	href: string;
	amount?: number;
};

/** The product columns a hit is built from. */
type ProductRow = Pick<Product, "id" | "name" | "sku" | "price" | "kind">;
/** The order columns a hit is built from, with the customer's name. */
type OrderRow = Pick<
	Order,
	"id" | "reference" | "total" | "status" | "payment_status" | "created_at"
> & { customer: string | null };
/** The customer columns a hit is built from. */
type CustomerRow = Pick<Customer, "id" | "name" | "phone" | "email">;
/** The coupon columns a hit is built from. `active` is 0/1 on SQLite. */
type CouponRow = Pick<Coupon, "id" | "code" | "description"> & {
	active: unknown;
};
/** The user columns a hit is built from. `active` is 0/1 on SQLite. */
type StaffRow = Pick<User, "id" | "name" | "email" | "role"> & {
	active: unknown;
};

/**
 * The quick lookups behind the global search.
 * A handful of rows per table, cheapest match first.
 */
@Service()
export class SearchRepository {
	/**
	 * Products of a shop by name, SKU or barcode (own or a variant's).
	 * @param shopId Owning shop.
	 * @param q Lower-cased substring.
	 * @param limit Rows at most.
	 * @returns The hits, names that start with `q` first.
	 */
	async products(
		shopId: number,
		q: string,
		limit: number,
	): Promise<SearchHit[]> {
		const like = `%${q}%`;
		const rows: ProductRow[] =
			await sql`select id, name, sku, price, kind from products p where shop_id = ${shopId}
      and (lower(name) like ${like} or lower(coalesce(sku, '')) like ${like} or lower(coalesce(barcode, '')) like ${like}
        or exists (select 1 from product_variants v where v.product_id = p.id and (lower(coalesce(v.barcode, '')) like ${like} or lower(coalesce(v.sku, '')) like ${like})))
      order by case when lower(name) like ${`${q}%`} then 0 else 1 end, name limit ${limit}`;
		return rows.map((r) => this.#productHit(r));
	}

	/**
	 * Orders of a shop by number (`#12` / `12`),
	 * public code (`P8J4-MJSQ-4Z8T`, any case) or customer name.
	 * @param shopId Owning shop.
	 * @param q Lower-cased substring.
	 * @param limit Rows at most.
	 * @returns The hits, newest first.
	 */
	async orders(shopId: number, q: string, limit: number): Promise<SearchHit[]> {
		const { id, code } = orderLookup(q);
		const like = `%${q}%`;
		const rows: OrderRow[] =
			await sql`select o.id, o.reference, o.total, o.status, o.payment_status, o.created_at, c.name as customer from orders o
      left join customers c on c.id = o.customer_id
      where o.shop_id = ${shopId} and (o.id = ${id} or o.reference = ${code} or lower(coalesce(c.name, '')) like ${like})
      order by o.id desc limit ${limit}`;
		return rows.map((r) => this.#orderHit(r));
	}

	/**
	 * Customers of a shop by name, phone or email.
	 * @param shopId Owning shop.
	 * @param q Lower-cased substring.
	 * @param limit Rows at most.
	 * @returns The hits, names that start with `q` first.
	 */
	async customers(
		shopId: number,
		q: string,
		limit: number,
	): Promise<SearchHit[]> {
		const like = `%${q}%`;
		const rows: CustomerRow[] =
			await sql`select id, name, phone, email from customers where shop_id = ${shopId}
      and (lower(name) like ${like} or lower(coalesce(phone, '')) like ${like} or lower(coalesce(email, '')) like ${like})
      order by case when lower(name) like ${`${q}%`} then 0 else 1 end, name limit ${limit}`;
		return rows.map((r) => this.#customerHit(r));
	}

	/**
	 * Discount codes of a shop by code or description.
	 * @param shopId Owning shop.
	 * @param q Lower-cased substring.
	 * @param limit Rows at most.
	 * @returns The hits, by code.
	 */
	async coupons(
		shopId: number,
		q: string,
		limit: number,
	): Promise<SearchHit[]> {
		const like = `%${q}%`;
		const rows: CouponRow[] =
			await sql`select id, code, description, active from coupons where shop_id = ${shopId}
      and (lower(code) like ${like} or lower(description) like ${like}) order by code limit ${limit}`;
		return rows.map((r) => this.#couponHit(r));
	}

	/**
	 * Categories of a shop by name.
	 * @param shopId Owning shop.
	 * @param q Lower-cased substring.
	 * @param limit Rows at most.
	 * @returns The hits, by name.
	 */
	async categories(
		shopId: number,
		q: string,
		limit: number,
	): Promise<SearchHit[]> {
		const rows: Pick<Category, "id" | "name">[] =
			await sql`select id, name from categories where shop_id = ${shopId} and lower(name) like ${`%${q}%`} order by name limit ${limit}`;
		return rows.map((r) => this.#categoryHit(r));
	}

	/**
	 * Staff (global, not per shop) by name or email.
	 * @param ownerId The account: its owner and their staff.
	 * @param q Lower-cased substring.
	 * @param limit Rows at most.
	 * @returns The hits, by name.
	 */
	async staff(ownerId: number, q: string, limit: number): Promise<SearchHit[]> {
		const like = `%${q}%`;
		const rows: StaffRow[] =
			await sql`select id, name, email, role, active from users where (id = ${ownerId} or owner_id = ${ownerId})
        and (lower(name) like ${like} or lower(email) like ${like}) order by name limit ${limit}`;
		return rows.map((r) => this.#staffHit(r));
	}

	/**
	 * Shops (global) by name.
	 * Picking one switches to it, so the href is the switch route.
	 * @param ownerId The account whose shops are searched.
	 * @param q Lower-cased substring.
	 * @param limit Rows at most.
	 * @returns The hits, by name.
	 */
	async shops(ownerId: number, q: string, limit: number): Promise<SearchHit[]> {
		const rows: Pick<Shop, "id" | "name" | "currency">[] =
			await sql`select id, name, currency from shops where owner_id = ${ownerId} and lower(name) like ${`%${q}%`} order by name limit ${limit}`;
		return rows.map((r) => this.#shopHit(r));
	}
	/**
	 * What an order's own status reads as in a hit's subtitle.
	 * @param s The order status.
	 * @returns The words, or "" for a completed order.
	 */
	#status(s: string): string {
		if (s === "partially_refunded")
			return t("server.search_status_partially_refunded");
		if (s === "refunded") return t("server.search_status_refunded");
		return s === "voided" ? t("server.search_status_voided") : "";
	}

	/**
	 * What a not-fully-paid order reads as in a hit's subtitle.
	 * @param s The payment status.
	 * @returns The words, or "" for a paid order.
	 */
	#payment(s: string): string {
		if (s === "unpaid") return t("server.search_payment_unpaid");
		return s === "partial" ? t("server.search_payment_partial") : "";
	}

	/**
	 * The parts of a subtitle, joined with a dot. Empty parts are left out.
	 * @param parts The parts, in order.
	 * @returns The subtitle.
	 */
	#subtitle(parts: (string | null | undefined)[]): string {
		return parts.filter(Boolean).join(" · ");
	}

	/**
	 * A product as a search hit.
	 * @param r The product row.
	 * @returns The hit, leading to the product form.
	 */
	#productHit(r: ProductRow): SearchHit {
		return {
			id: r.id,
			title: r.name,
			subtitle: this.#subtitle([
				r.kind === "bundle" ? t("server.search_package") : "",
				r.sku,
			]),
			href: `/products/${r.id}/edit`,
			amount: r.price,
		};
	}

	/**
	 * An order as a search hit.
	 * The subtitle says what is special about it: not paid, refunded, voided.
	 * @param r The order row.
	 * @returns The hit, leading to the order page.
	 */
	#orderHit(r: OrderRow): SearchHit {
		const paid =
			r.payment_status === "paid" ? "" : this.#payment(r.payment_status);
		return {
			id: r.id,
			title: t("server.search_order", { code: r.reference ?? `#${r.id}` }),
			subtitle: this.#subtitle([
				`#${r.id}`,
				r.customer,
				r.status === "completed" ? paid : this.#status(r.status),
			]),
			href: `/orders/${r.id}`,
			amount: r.total,
		};
	}

	/**
	 * A customer as a search hit.
	 * @param r The customer row.
	 * @returns The hit, leading to the customer page.
	 */
	#customerHit(r: CustomerRow): SearchHit {
		return {
			id: r.id,
			title: r.name,
			subtitle: this.#subtitle([r.phone, r.email]),
			href: `/customers/${r.id}`,
		};
	}

	/**
	 * A discount code as a search hit.
	 * @param r The coupon row.
	 * @returns The hit, leading to the code's history page.
	 */
	#couponHit(r: CouponRow): SearchHit {
		return {
			id: r.id,
			title: r.code,
			subtitle: this.#subtitle([
				r.description,
				r.active ? "" : t("server.search_inactive"),
			]),
			href: `/coupons/${r.id}`,
		};
	}

	/**
	 * A category as a search hit.
	 * @param r The category row.
	 * @returns The hit, leading to the Categories page.
	 */
	#categoryHit(r: Pick<Category, "id" | "name">): SearchHit {
		return {
			id: r.id,
			title: r.name,
			subtitle: "",
			href: "/categories",
		};
	}

	/**
	 * A staff member as a search hit.
	 * @param r The user row.
	 * @returns The hit, leading to the Users page.
	 */
	#staffHit(r: StaffRow): SearchHit {
		return {
			id: r.id,
			title: r.name,
			subtitle: this.#subtitle([
				r.email,
				r.role,
				r.active ? "" : t("server.search_inactive"),
			]),
			href: "/users",
		};
	}

	/**
	 * A shop as a search hit.
	 * Picking one switches to it, so the href is the switch route.
	 * @param r The shop row.
	 * @returns The hit.
	 */
	#shopHit(r: Pick<Shop, "id" | "name" | "currency">): SearchHit {
		return {
			id: r.id,
			title: r.name,
			subtitle: t("server.search_switch_shop", { currency: r.currency }),
			href: `/shops/${r.id}/switch`,
		};
	}
}
