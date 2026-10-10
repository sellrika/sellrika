import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { Paginate } from "@xcore/http/Paginate";
import type {
	Coupon,
	CouponRedemptionRow,
	CouponSummary,
	CouponWithStats,
} from "@models/Coupon";
import type { CouponInput } from "@validators/Coupon.Validator";
import { parseJson } from "@helpers/json";
import { sqlStamp } from "@helpers/time";
import { COUPON_HOLD_MS, type CouponSort } from "@constants/Coupon.Constant";

/**
 * A `coupons` row as the driver returns it.
 * The lists are JSON text on SQLite. `active` is 0/1.
 */
type CouponRow = Omit<
	Coupon,
	"active" | "product_ids" | "category_ids" | "emails"
> & {
	active: unknown;
	product_ids: string | number[];
	category_ids: string | number[];
	emails: string | string[];
};
/** A coupon row with the `stats` counts (strings or bigints on Postgres). */
type CouponStatsRow = CouponRow & { used_count: unknown; saved_total: unknown };
/** A history row before its money columns are turned into numbers. */
type RedemptionRow = Omit<CouponRedemptionRow, "amount" | "order_total"> & {
	amount: unknown;
	order_total: unknown;
};

/** How often coupon `c` was used and what it gave, as two columns. */
const stats = sql`(select count(*) from coupon_redemptions r where r.coupon_id = c.id) as used_count, (select coalesce(sum(r.amount), 0) from coupon_redemptions r where r.coupon_id = c.id) as saved_total`;

/**
 * Discount codes, per shop. A code is unique per shop.
 * Usage is counted from `coupon_redemptions`.
 */
@Service()
export class CouponRepository {
	/**
	 * One page of a shop's codes, newest first; `q` matches the code or the description.
	 * @param shopId Owning shop.
	 * @param q Search text ("" = all).
	 * @param sort "used" = most used first, else newest first.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of coupons with their usage.
	 */
	async pageForShop(
		shopId: number,
		q: string,
		sort: CouponSort,
		page: number,
		perPage: number,
	) {
		const like = `%${q.toLowerCase()}%`;
		const where = sql`where c.shop_id = ${shopId} and (${q} = '' or lower(c.code) like ${like} or lower(c.description) like ${like})`;
		const [{ n }] = await sql`select count(*) as n from coupons c ${where}`;
		const rows: CouponStatsRow[] =
			await sql`select c.*, ${stats} from coupons c ${where} order by ${sort === "used" ? sql`used_count desc,` : sql``} c.id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<CouponWithStats>(
			rows.map((r) => this.#withStats(r)),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * Totals over every code of a shop — the cards on top of /coupons.
	 * A voided order's use was deleted, so it doesn't count.
	 * @param shopId Owning shop.
	 * @returns Times used, the discount given and the order totals (cents).
	 */
	async summary(shopId: number): Promise<CouponSummary> {
		const [r] =
			await sql`select count(*) as uses, coalesce(sum(r.amount), 0) as saved, coalesce(sum(o.total), 0) as sales
      from coupon_redemptions r left join orders o on o.id = r.order_id where r.shop_id = ${shopId}`;
		return {
			uses: Number(r.uses),
			saved: Number(r.saved),
			sales: Number(r.sales),
		};
	}

	/**
	 * One coupon of this shop.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 * @returns The coupon, or null.
	 */
	async find(id: number, shopId: number): Promise<Coupon | null> {
		return Db.one(
			sql`select * from coupons where id = ${id} and shop_id = ${shopId}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * One coupon with its usage — the history page's header.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 * @returns The coupon with `used_count` / `saved_total`, or null.
	 */
	async findWithStats(
		id: number,
		shopId: number,
	): Promise<CouponWithStats | null> {
		return Db.one(
			sql`select c.*, ${stats} from coupons c where c.id = ${id} and c.shop_id = ${shopId}`,
			(r) => this.#withStats(r),
		);
	}

	/**
	 * One page of the orders that used a coupon, newest first.
	 * Each row has the order's code, total, status and customer.
	 * @param couponId Coupon id.
	 * @param shopId Owning shop.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of history rows.
	 */
	async history(
		couponId: number,
		shopId: number,
		page: number,
		perPage: number,
	) {
		const [{ n }] =
			await sql`select count(*) as n from coupon_redemptions where coupon_id = ${couponId} and shop_id = ${shopId}`;
		const rows: RedemptionRow[] =
			await sql`select r.*, o.reference, o.total as order_total, o.status as order_status, c.name as customer_name
      from coupon_redemptions r left join orders o on o.id = r.order_id left join customers c on c.id = o.customer_id
      where r.coupon_id = ${couponId} and r.shop_id = ${shopId} order by r.id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<CouponRedemptionRow>(
			rows.map((r) => this.#redemption(r)),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * The coupon a buyer typed (codes are stored upper-case; normalise before calling).
	 * @param shopId The shop whose checkout it is.
	 * @param code The normalised code.
	 * @returns The coupon, active or not, or null.
	 */
	async findByCode(shopId: number, code: string): Promise<Coupon | null> {
		return Db.one(
			sql`select * from coupons where shop_id = ${shopId} and code = ${code}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * How many codes of a shop can still be used.
	 * A code that reached its usage limit does not count.
	 * @param shopId Owning shop.
	 * @returns The count.
	 */
	async countUsable(shopId: number) {
		const [{ n }] = await sql`select count(*) as n from coupons c
      where c.shop_id = ${shopId} and (c.usage_limit is null
        or (select count(*) from coupon_redemptions r where r.coupon_id = c.id) < c.usage_limit)`;
		return Number(n);
	}

	/**
	 * Whether another coupon of this shop already uses the code.
	 * @param shopId Owning shop.
	 * @param code The normalised code.
	 * @param exceptId Coupon allowed to keep it (the one being edited).
	 * @returns True when taken.
	 */
	async codeTaken(shopId: number, code: string, exceptId = 0) {
		return Db.exists(
			sql`select 1 from coupons where shop_id = ${shopId} and code = ${code} and id <> ${exceptId}`,
		);
	}

	/**
	 * Create a coupon.
	 * @param shopId Owning shop.
	 * @param d Validated input.
	 * @returns The created coupon.
	 */
	async create(shopId: number, d: CouponInput): Promise<Coupon> {
		return this.#row(
			(
				await sql`insert into coupons (shop_id, code, description, type, value, min_subtotal, max_discount, starts_at, ends_at, usage_limit, per_customer_limit, product_ids, category_ids, emails, active)
      values (${shopId}, ${d.code}, ${d.description}, ${d.type}, ${d.value}, ${d.min_subtotal}, ${d.max_discount}, ${d.starts_at}, ${d.ends_at}, ${d.usage_limit}, ${d.per_customer_limit}, ${JSON.stringify(d.product_ids)}, ${JSON.stringify(d.category_ids)}, ${JSON.stringify(d.emails)}, ${d.active}) returning *`
			)[0],
		);
	}

	/**
	 * Edit a coupon of this shop.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated input.
	 * @returns The updated coupon, or null when it isn't this shop's.
	 */
	async update(
		id: number,
		shopId: number,
		d: CouponInput,
	): Promise<Coupon | null> {
		return Db.one(
			sql`update coupons set code = ${d.code}, description = ${d.description}, type = ${d.type}, value = ${d.value}, min_subtotal = ${d.min_subtotal}, max_discount = ${d.max_discount},
      starts_at = ${d.starts_at}, ends_at = ${d.ends_at}, usage_limit = ${d.usage_limit}, per_customer_limit = ${d.per_customer_limit}, product_ids = ${JSON.stringify(d.product_ids)}, category_ids = ${JSON.stringify(d.category_ids)},
      emails = ${JSON.stringify(d.emails)}, active = ${d.active}, updated_at = current_timestamp where id = ${id} and shop_id = ${shopId} returning *`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Delete a coupon and its usage rows; orders keep the code as text.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 */
	delete(id: number, shopId: number) {
		return sql.begin((tx) => this.#drop(tx, id, shopId));
	}

	/**
	 * How often a coupon has been used — in total and by one buyer.
	 * Online checkouts that hold the code count too:
	 * no order yet, and younger than COUPON_HOLD_MS.
	 * @param couponId Coupon id.
	 * @param email The buyer's email (lower-cased; "" counts nobody).
	 * @param customerId The proven customer, or 0 for a guest.
	 *   A proven customer's own uses are the orders written to their
	 *   record, and their own open checkouts.
	 *   So a guest who types their email can not use up or hold their limit.
	 * @returns Both counts.
	 */
	async usage(
		couponId: number,
		email: string,
		customerId = 0,
	): Promise<{ total: number; mine: number }> {
		const since = sqlStamp(new Date(Date.now() - COUPON_HOLD_MS));
		const held = sql`from store_carts where coupon_id = ${couponId} and (order_id is null or order_id = 0) and created_at > ${since}`;
		const [r] = await sql`select
			(select count(*) from coupon_redemptions where coupon_id = ${couponId})
			+ (select count(*) ${held}) as total,
			(select count(*) from coupon_redemptions r where r.coupon_id = ${couponId} and (
				(${customerId} > 0 and exists (select 1 from orders o where o.id = r.order_id and o.customer_id = ${customerId}))
				or (${customerId} = 0 and ${email} <> '' and r.email = ${email})))
			+ (select count(*) ${held} and (
				(${customerId} > 0 and coupon_customer_id = ${customerId})
				or (${customerId} = 0 and ${email} <> '' and coupon_email = ${email}))) as mine`;
		return { total: Number(r.total), mine: Number(r.mine) };
	}

	/**
	 * Record that an order used a coupon.
	 * @param couponId Coupon id.
	 * @param shopId Owning shop.
	 * @param orderId The order that used it.
	 * @param email The buyer's email (lower-cased) — what the per-customer limit counts.
	 * @param amount What the code took off that order (cents, delivery included).
	 */
	redeem(
		couponId: number,
		shopId: number,
		orderId: number,
		email: string,
		amount: number,
	) {
		return sql`insert into coupon_redemptions (coupon_id, shop_id, order_id, email, amount) values (${couponId}, ${shopId}, ${orderId}, ${email}, ${amount})`;
	}

	/**
	 * Give a use back — the order was voided.
	 * @param orderId The voided order.
	 */
	release(orderId: number) {
		return sql`delete from coupon_redemptions where order_id = ${orderId}`;
	}

	/**
	 * Which categories each product is in — for the product/category scope check.
	 * @param productIds Products in the cart.
	 * @returns Product id → its category ids.
	 */
	async categoriesOf(productIds: number[]): Promise<Record<number, number[]>> {
		const out: Record<number, number[]> = {};
		if (!productIds.length) return out;
		for (const r of await sql`select product_id, category_id from product_categories where product_id in ${sql(productIds)}`)
			(out[r.product_id] ??= []).push(r.category_id);
		return out;
	}
	/**
	 * Turn a database row into a `Coupon`.
	 * @param r The raw row.
	 * @returns The coupon with a real boolean and parsed lists.
	 */
	#row(r: CouponRow): Coupon {
		return {
			...r,
			active: !!r.active,
			product_ids: parseJson<number[]>(r.product_ids, []),
			category_ids: parseJson<number[]>(r.category_ids, []),
			emails: parseJson<string[]>(r.emails, []),
		};
	}

	/**
	 * Turn a database row with the `stats` columns into a `CouponWithStats`.
	 * @param r The raw row.
	 * @returns The coupon with its usage as numbers.
	 */
	#withStats(r: CouponStatsRow): CouponWithStats {
		return {
			...this.#row(r),
			used_count: Number(r.used_count),
			saved_total: Number(r.saved_total),
		};
	}

	/**
	 * One row of a coupon's history with its money as numbers.
	 * @param r The raw row.
	 * @returns The history row.
	 */
	#redemption(r: RedemptionRow): CouponRedemptionRow {
		return {
			...r,
			amount: Number(r.amount),
			order_total: r.order_total == null ? null : Number(r.order_total),
		};
	}

	/**
	 * The writes of `delete`, inside its transaction.
	 * @param tx The open transaction.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 */
	async #drop(tx: SQL, id: number, shopId: number) {
		await tx`delete from coupon_redemptions where coupon_id = ${id} and shop_id = ${shopId}`;
		await tx`delete from coupons where id = ${id} and shop_id = ${shopId}`;
	}
}
