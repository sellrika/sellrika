import { Service } from "@xcore/di";
import { type Fragment, sql } from "@xcore/database/Database";
import { sqlStamp } from "@helpers/time";

/** A period as UTC instants. The end is exclusive. */
export type Range = { start: Date; end: Date };

/**
 * Raw per-order / per-refund rows for a period.
 * Bucketing by shop-local time happens in ReportService.
 */
@Service()
export class ReportRepository {
	/**
	 * Non-voided orders in the range with their cost of goods.
	 * Lines without a purchase price count as 0 and are counted in `no_cost`.
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @returns One row per order.
	 */
	orders(
		shopId: number,
		r: Range,
	): Promise<
		{
			id: number;
			created_at: string | Date;
			subtotal: number;
			discount: number;
			tax: number;
			total: number;
			items: number;
			cogs: number;
			no_cost: number;
		}[]
	> {
		// one pass over the lines: an order with no lines still gives a row
		return sql`select o.id, o.created_at, o.subtotal, o.discount, o.tax, o.total,
        coalesce(sum(i.qty), 0) as items,
        coalesce(sum(case when i.cost is not null then i.cost * i.qty else 0 end), 0) as cogs,
        coalesce(sum(case when i.id is not null and i.cost is null then 1 else 0 end), 0) as no_cost
      from orders o left join order_items i on i.order_id = o.id
      where ${this.#sold(shopId, r)}
      group by o.id, o.created_at, o.subtotal, o.discount, o.tax, o.total order by o.id`;
	}

	/**
	 * The sums of a period, with no row per order.
	 * For the period before the report's own, where only totals are shown.
	 * The numbers are the same ones the `orders` and `refunds` rows add up to.
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @returns Order count, units, money sums, refunds, cost of goods
	 *   (less the cost of restocked units) and lines with no cost.
	 */
	async totals(shopId: number, r: Range) {
		const [o] =
			await sql`select count(*) as orders, coalesce(sum(o.subtotal), 0) as gross, coalesce(sum(o.discount), 0) as discounts,
        coalesce(sum(o.total), 0) as sales, coalesce(sum(o.tax), 0) as tax
      from orders o where ${this.#sold(shopId, r)}`;
		const [i] = await sql`select coalesce(sum(i.qty), 0) as items,
        coalesce(sum(case when i.cost is not null then i.cost * i.qty else 0 end), 0) as cogs,
        coalesce(sum(case when i.cost is null then 1 else 0 end), 0) as no_cost
      from order_items i join orders o on o.id = i.order_id where ${this.#sold(shopId, r)}`;
		const [f] = await sql`select coalesce(sum(r.amount), 0) as refunds,
        coalesce(sum(case when r.restock then (select coalesce(sum(i.cost * ri.qty), 0) from refund_items ri join order_items i on i.id = ri.order_item_id where ri.refund_id = r.id and i.cost is not null) else 0 end), 0) as cogs_back
      from refunds r where r.shop_id = ${shopId} and r.created_at >= ${sqlStamp(r.start)} and r.created_at < ${sqlStamp(r.end)}`;
		return {
			orders: Number(o.orders),
			items: Number(i.items),
			gross: Number(o.gross),
			discounts: Number(o.discounts),
			sales: Number(o.sales),
			tax: Number(o.tax),
			refunds: Number(f.refunds),
			cogs: Number(i.cogs) - Number(f.cogs_back),
			no_cost_lines: Number(i.no_cost),
		};
	}

	/**
	 * Refunds in the range.
	 * `cogs_back` = cost of units that went back into stock (reverses COGS).
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @returns One row per refund.
	 */
	refunds(
		shopId: number,
		r: Range,
	): Promise<
		{
			id: number;
			created_at: string | Date;
			amount: number;
			cogs_back: number;
		}[]
	> {
		return sql`select r.id, r.created_at, r.amount,
        case when r.restock then (select coalesce(sum(i.cost * ri.qty), 0) from refund_items ri join order_items i on i.id = ri.order_item_id where ri.refund_id = r.id and i.cost is not null) else 0 end as cogs_back
      from refunds r where r.shop_id = ${shopId} and r.created_at >= ${sqlStamp(r.start)} and r.created_at < ${sqlStamp(r.end)} order by r.id`;
	}

	/**
	 * Best sellers of the period: most units sold first, then by revenue.
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @param limit How many rows to return.
	 * @returns One row per sold unit (product or variant),
	 *   with the picture of one of its order lines.
	 */
	topProducts(
		shopId: number,
		r: Range,
		limit = 10,
	): Promise<
		{
			product_id: number | null;
			variant_id: number | null;
			name: string;
			image: string | null;
			qty: number;
			refunded_qty: number;
			revenue: number;
		}[]
	> {
		return sql`select i.product_id, i.variant_id, i.name, max(i.image) as image, sum(i.qty) as qty, sum(i.refunded_qty) as refunded_qty, sum(i.price * i.qty) as revenue
      from order_items i join orders o on o.id = i.order_id
      where ${this.#sold(shopId, r)}
      group by i.product_id, i.variant_id, i.name order by qty desc, revenue desc limit ${limit}`;
	}

	/**
	 * Best customers of the period: most money spent first, then most orders.
	 * Sales with no customer attached are left out.
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @param limit How many rows to return.
	 * @returns One row per customer.
	 */
	topCustomers(
		shopId: number,
		r: Range,
		limit = 10,
	): Promise<
		{ customer_id: number; name: string; orders: number; sales: number }[]
	> {
		return sql`select c.id as customer_id, c.name, count(*) as orders, sum(o.total) as sales
      from orders o join customers c on c.id = o.customer_id
      where ${this.#sold(shopId, r)}
      group by c.id, c.name order by sales desc, orders desc limit ${limit}`;
	}

	/**
	 * Sales split by payment method name.
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @returns One row per method.
	 */
	byMethod(
		shopId: number,
		r: Range,
	): Promise<{ method: string; orders: number; sales: number }[]> {
		return sql`select o.payment_method as method, count(*) as orders, sum(o.total) as sales from orders o
      where ${this.#sold(shopId, r)}
      group by o.payment_method order by sales desc`;
	}

	/**
	 * Sales split by the staff member who rang them up.
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @returns One row per cashier.
	 */
	byCashier(
		shopId: number,
		r: Range,
	): Promise<
		{ user_id: number; name: string | null; orders: number; sales: number }[]
	> {
		return sql`select o.user_id, u.name, count(*) as orders, sum(o.total) as sales from orders o left join users u on u.id = o.user_id
      where ${this.#sold(shopId, r)}
      group by o.user_id, u.name order by sales desc`;
	}

	/**
	 * Sales split by category.
	 * A product in several categories counts in each.
	 * The null row is "Uncategorised".
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @returns One row per category.
	 */
	byCategory(
		shopId: number,
		r: Range,
	): Promise<
		{
			id: number | null;
			name: string | null;
			color: string | null;
			qty: number;
			revenue: number;
		}[]
	> {
		return sql`select c.id, c.name, c.color, sum(i.qty) as qty, sum(i.price * i.qty) as revenue
      from order_items i join orders o on o.id = i.order_id
      left join product_categories pc on pc.product_id = i.product_id left join categories c on c.id = pc.category_id
      where ${this.#sold(shopId, r)}
      group by c.id, c.name, c.color order by revenue desc`;
	}
	/**
	 * The filter every sales query shares, over `orders o`.
	 * The shop's orders made in the range that were not voided.
	 * @param shopId Owning shop.
	 * @param r UTC range, end exclusive.
	 * @returns The conditions, without the `where` word.
	 */
	#sold(shopId: number, r: Range): Fragment {
		return sql`o.shop_id = ${shopId} and o.status <> 'voided' and o.created_at >= ${sqlStamp(r.start)} and o.created_at < ${sqlStamp(r.end)}`;
	}
}
