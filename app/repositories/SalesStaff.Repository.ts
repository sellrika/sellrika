import { Service } from "@xcore/di";
import type { SQL } from "bun";
import { Db, sql } from "@xcore/database/Database";
import { sqlStamp } from "@helpers/time";
import type {
	SalesCommission,
	SalesStaff,
	SalesStaffRow,
} from "@models/SalesStaff";
import type { SalesStaffInput } from "@validators/SalesStaff.Validator";

/** When `s` was last paid: their newest payment in the history, null = never. */
const lastPaid = sql`(select max(c.created_at) from sales_commissions c where c.sales_staff_id = s.id)`;
/**
 * The sales of `s` that are not paid yet: after the last payment, and not voided.
 * ponytail: timestamps have one-second steps.
 * So a sale in the very second of a payment is left out.
 * Mark orders by payment id if that ever matters.
 */
const unpaid = sql`from orders o where o.sales_staff_id = s.id and o.status <> 'voided' and (${lastPaid} is null or o.created_at > ${lastPaid})`;
/**
 * The columns of a `SalesStaffRow`.
 * The row, its sales count, the last payment,
 * and the count and cents of the unpaid sales.
 */
const columns = sql`s.*, (select count(*) from orders o where o.sales_staff_id = s.id) as orders, ${lastPaid} as last_paid_at,
  (select count(*) ${unpaid}) as unpaid_orders, (select coalesce(sum(o.total - o.refunded), 0) ${unpaid}) as unpaid_sales`;

/**
 * A `sales_staff` row with the `columns` counts, as the driver returns it.
 * SQLite returns booleans as 0/1 and Postgres a count or a sum as text.
 */
type RawStaff = Omit<SalesStaff, "active"> & {
	active: unknown;
	orders: unknown;
	last_paid_at: string | null;
	unpaid_orders: unknown;
	unpaid_sales: unknown;
};

/** Sales staff: people named on a sale who have no login. */
@Service()
export class SalesStaffRepository {
	/**
	 * Every sales person of one shop.
	 * Each with their sales count and what is not paid yet.
	 * @param shopId Owning shop.
	 * @returns The sales staff, A–Z.
	 */
	async all(shopId: number): Promise<SalesStaffRow[]> {
		return (
			await sql`select ${columns} from sales_staff s where s.shop_id = ${shopId} order by s.name, s.id`
		).map((r: RawStaff) => this.#row(r));
	}

	/**
	 * One sales person of a shop.
	 * @param id Their id.
	 * @param shopId The shop they must belong to.
	 * @returns The sales person, or null.
	 */
	async find(id: number, shopId: number): Promise<SalesStaffRow | null> {
		return Db.one(
			sql`select ${columns} from sales_staff s where s.id = ${id} and s.shop_id = ${shopId}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * What a sales person sold in a period.
	 * Voided orders are left out and refunds are taken off.
	 * @param id Their id.
	 * @param range The period, as UTC instants (end exclusive).
	 * @returns Order count and cents sold.
	 */
	async totals(id: number, range: { start: Date; end: Date }) {
		const [r] =
			await sql`select count(*) as n, coalesce(sum(o.total - o.refunded), 0) as sold from orders o
      where o.sales_staff_id = ${id} and o.status <> 'voided' and o.created_at >= ${sqlStamp(range.start)} and o.created_at < ${sqlStamp(range.end)}`;
		return { orders: Number(r.n), sold: Number(r.sold) };
	}

	/**
	 * Add a sales person.
	 * @param shopId Owning shop.
	 * @param d Validated name, commission and active switch.
	 * @returns The new row's id.
	 */
	async create(shopId: number, d: SalesStaffInput): Promise<number> {
		const [r] =
			await sql`insert into sales_staff (shop_id, name, commission, active) values (${shopId}, ${d.name}, ${d.commission}, ${d.active}) returning id`;
		return Number(r.id);
	}

	/**
	 * Change a sales person.
	 * @param id Their id.
	 * @param d Validated name, commission and active switch.
	 */
	update(id: number, d: SalesStaffInput) {
		return sql`update sales_staff set name = ${d.name}, commission = ${d.commission}, active = ${d.active} where id = ${id}`;
	}

	/**
	 * Record that a sales person's commission is paid, now: one row in the history.
	 * Their next commission counts the sales after this moment.
	 * @param s The sales person, with what is due to them.
	 */
	pay(s: SalesStaffRow) {
		return sql`insert into sales_commissions (shop_id, sales_staff_id, amount, sales, orders, commission)
      values (${s.shop_id}, ${s.id}, ${s.due}, ${s.unpaid_sales}, ${s.unpaid_orders}, ${s.commission})`;
	}

	/**
	 * The commission payments of a shop, newest first.
	 * @param shopId Owning shop.
	 * @returns The history rows.
	 */
	async payments(shopId: number): Promise<SalesCommission[]> {
		// ponytail: the newest 500 of the shop in one go.
		// Page it per person when a shop outgrows that.
		const rows: SalesCommission[] =
			await sql`select * from sales_commissions where shop_id = ${shopId} order by id desc limit 500`;
		return rows.map((r) => this.#payment(r));
	}

	/**
	 * Delete a sales person, with their payment history.
	 * Their sales stay, with nobody named on them any more.
	 * @param id Their id.
	 */
	delete(id: number) {
		return sql.begin((tx) => this.#drop(tx, id));
	}
	/**
	 * A database row as a `SalesStaffRow`.
	 * The commission due is worked out here,
	 * from the unpaid sales and today's rate.
	 * @param r The raw row.
	 * @returns The typed row.
	 */
	#row(r: RawStaff): SalesStaffRow {
		const unpaid_sales = Number(r.unpaid_sales);
		return {
			...r,
			active: !!r.active,
			orders: Number(r.orders),
			unpaid_orders: Number(r.unpaid_orders),
			unpaid_sales,
			due: Math.round((unpaid_sales * r.commission) / 10000),
		};
	}

	/**
	 * One commission payment with its numbers as numbers.
	 * Postgres returns a sum as text.
	 * @param r The raw row.
	 * @returns The typed row.
	 */
	#payment(r: SalesCommission): SalesCommission {
		return {
			...r,
			id: Number(r.id),
			amount: Number(r.amount),
			sales: Number(r.sales),
		};
	}

	/**
	 * The writes of `delete`, inside its transaction.
	 * @param tx The open transaction.
	 * @param id Their id.
	 */
	async #drop(tx: SQL, id: number) {
		await tx`update orders set sales_staff_id = null where sales_staff_id = ${id}`;
		await tx`delete from sales_commissions where sales_staff_id = ${id}`;
		await tx`delete from sales_staff where id = ${id}`;
	}
}
