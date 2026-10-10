import { Db, sql } from "@xcore/database/Database";
import { Paginate } from "@xcore/http/Paginate";
import { t } from "@xcore/i18n/I18n";
import { OrderImages } from "@xcore/storage/OrderImages";
import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { parseJson } from "@helpers/json";
import type {
	Order,
	OrderDetail,
	OrderFull,
	OrderHistory,
	OrderItem,
	OrderItemComponent,
	OrderSnapshot,
	OrderStatus,
	Refund,
	RefundFull,
} from "@models/Order";
import type {
	FulfillmentStatus,
	PaymentStatus,
} from "@constants/Order.Constant";
import type { LineComponent } from "./Product.Repository";
import { sqlStamp, startOfToday } from "@helpers/time";
import { orderLookup, orderReference } from "@helpers/crypto";
import { STORE_SYSTEM_EMAIL } from "@constants/Store.Constant";
import { StockRepository } from "./Stock.Repository";
import { TtlCache } from "@helpers/TtlCache";
import {
	ORDER_FILTERS_CACHE_MS,
	ORDER_TOTALS_CACHE_MS,
} from "@constants/Order.Constant";

/** The header of an order about to be written, already priced by the caller. */
export type NewOrder = Pick<
	Order,
	| "shop_id"
	| "user_id"
	| "customer_id"
	| "subtotal"
	| "discount_type"
	| "discount_value"
	| "discount"
	| "delivery_fee"
	| "tax"
	| "tax_rate"
	| "tax_label"
	| "tax_included"
	| "total"
	| "paid"
	| "change"
	| "payment_method"
	| "payment_status"
	| "fulfillment"
	| "note"
> & {
	coupon_code?: string | null;
	sales_staff_id?: number | null;
};
/**
 * One line of an order about to be written.
 * `components` (packages only) replaces the line's own stock move.
 * Each slot leaves the shelf instead.
 */
export type NewItem = {
	product_id: number;
	variant_id: number | null;
	name: string;
	price: number;
	cost: number | null;
	qty: number;
	track_stock: boolean;
	components?: LineComponent[] | null;
	/**
	 * The line's picture.
	 * While pricing it is the product's picture, the copy's source.
	 * `OrderImages.copyAll` swaps it for the order's own copy.
	 * Only an order copy (`/uploads/order-…`) is ever stored.
	 */
	image?: string | null;
	/**
	 * The buyer's custom request for this line.
	 * Online store only; "" or absent = none.
	 */
	note?: string;
};
/**
 * The filters of the order list.
 * `status` "unpaid" = not fully paid yet (unpaid + partial).
 * `source` = where the sale was made.
 * `fulfillment` narrows online orders.
 */
export type OrderFilters = {
	q: string;
	method: string;
	status: "all" | OrderStatus | "refunded_any" | "unpaid";
	customerId: number | null;
	/**
	 * The staff member who made the sale (`orders.user_id`).
	 * null = anyone.
	 */
	cashierId?: number | null;
	/**
	 * The sales person named on the sale (`orders.sales_staff_id`).
	 * null = anyone.
	 */
	salesStaffId?: number | null;
	source: "all" | "pos" | "online";
	fulfillment: "all" | FulfillmentStatus;
};

/**
 * Thrown inside the checkout transaction
 * when a tracked item doesn't have enough stock.
 * It rolls everything back.
 */
export class OutOfStockError extends Error {
	/**
	 * @param item The name of the unit that ran out.
	 * @param available How many are left.
	 */
	constructor(
		public item: string,
		public available: number,
	) {
		super(t("server.stock_not_enough", { item }));
	}
}

/** The name of the sales person on `orders o`, as a column. */
const salesStaffOf = sql`(select s.name from sales_staff s where s.id = o.sales_staff_id) as sales_staff`;
/** The name and phone of the customer on `orders o`, as two columns. */
const customerOf = sql`(select c.name from customers c where c.id = o.customer_id) as customer_name, (select c.phone from customers c where c.id = o.customer_id) as customer_phone`;
/**
 * An order that can still change: not refunded, not voided,
 * and not paid in full. A condition over `orders`.
 */
const open = sql`status = 'completed' and payment_status <> 'paid'`;
/**
 * An `orders` row with the cashier and `customerOf` columns.
 * `tax_included` is still 0/1 on SQLite.
 */
type OrderRow = Omit<Order, "tax_included"> & {
	tax_included: unknown;
	cashier?: string | null;
	sales_staff?: string | null;
	customer_name: string;
	customer_phone: string | null;
};

/** An `order_items` row: `components` is JSON text on SQLite. */
type ItemRow = Omit<OrderItem, "components"> & {
	components: string | OrderItemComponent[] | null;
};

/** An `order_history` row: `data` is JSON text on SQLite. */
type HistoryRow = Omit<OrderHistory, "data"> & {
	data: string | OrderHistory["data"];
};

/** One unit that leaves or comes back to the shelf, for `move`. */
type StockUnit = { productId: number; variantId: number | null; qty: number };

/**
 * Thrown inside a transaction to roll it back
 * when the order changed since it was read.
 */
class StaleOrder extends Error {}

/** An order's money after its lines changed. */
export type OrderTotals = Pick<
	Order,
	"subtotal" | "discount" | "tax" | "total" | "payment_status"
>;

/** Units that leave one order line, as the caller asked. */
type Removal = { order_item_id: number; qty: number };

/** What a refund is made of. */
type RefundInput = {
	amount: number;
	reason: string;
	restock: boolean;
	items: Removal[];
};

/**
 * Sales, their lines, refunds and voids.
 * Everything the Orders screen and the reports read.
 */
@Service()
export class OrderRepository {
	/**
	 * @param stock The stock ledger every line's units move through.
	 */
	constructor(private stock: StockRepository) {}

	/**
	 * The Orders screen's cashier list, kept per shop for a few minutes.
	 */
	#cashiers = new TtlCache<number, { id: number; name: string }[]>(
		ORDER_FILTERS_CACHE_MS,
	);

	/**
	 * The Orders screen's payment names, kept per shop for a few minutes.
	 */
	#methodNames = new TtlCache<number, string[]>(ORDER_FILTERS_CACHE_MS);

	/**
	 * A shop's all-time order count and sales, kept for a short time.
	 */
	#totals = new TtlCache<number, { n: number; revenue: number }>(
		ORDER_TOTALS_CACHE_MS,
	);

	/**
	 * How many orders an account's shops made since a moment.
	 * Every order counts, the voided ones and the online store's too.
	 * @param ownerId The account's owner.
	 * @param since The first moment that counts.
	 * @returns The count.
	 */
	async countSince(ownerId: number, since: Date) {
		const [{ n }] =
			await sql`select count(*) as n from orders o join shops s on s.id = o.shop_id
      where s.owner_id = ${ownerId} and o.created_at >= ${sqlStamp(since)}`;
		return Number(n);
	}

	/**
	 * The payment state `received` cents leave an order in.
	 * @param received Cents received so far.
	 *   POS: what was handed over, incl. change.
	 * @param total The order total.
	 * @returns paid | partial | unpaid.
	 */
	static paymentStatus(received: number, total: number): PaymentStatus {
		if (received >= total) return "paid";
		return received > 0 ? "partial" : "unpaid";
	}

	/**
	 * Insert the order + lines and take tracked stock, all in one transaction.
	 * @param o The order header, already priced by the caller.
	 * @param items The lines, already priced from the DB.
	 * @returns The created order with its lines.
	 * @throws OutOfStockError when a tracked unit ran out mid-transaction
	 *   (everything is rolled back).
	 */
	async create(o: NewOrder, items: NewItem[]): Promise<OrderFull> {
		const order: OrderFull = await sql.begin((tx) =>
			this.#insertOrder(tx, o, items),
		);
		this.#forget(o.shop_id);
		return order;
	}

	/**
	 * Add lines to an order that is not paid yet, in one transaction:
	 * the new totals, the lines, their stock, and one `order_history` row.
	 * @param order The order with its lines, as the caller read it.
	 * @param userId Who is adding (the stock moves and the history row name them).
	 * @param items The new lines, already priced from the DB.
	 * @param totals The order's money after the lines join it.
	 * @returns The inserted lines, or null when the order changed since it was read
	 *   (paid, voided, or other lines changed) — nothing is written then.
	 * @throws OutOfStockError when a tracked unit ran out
	 *   (everything is rolled back).
	 */
	addItems(
		order: OrderFull,
		userId: number,
		items: NewItem[],
		totals: OrderTotals,
	) {
		const run = sql.begin((tx) =>
			this.#addLines(tx, order, userId, items, totals),
		);
		return run.catch((x) => this.#staleToNull(x));
	}

	/**
	 * Take units off an order that is not paid yet, in one transaction:
	 * the new totals, the smaller (or deleted) lines, the stock back on the shelf,
	 * and one `order_history` row.
	 * @param order The order with its lines, as the caller read it.
	 * @param userId Who is removing (the stock moves and the history row name them).
	 * @param removals How many units leave each line (checked by the caller).
	 * @param totals The order's money after they left.
	 * @returns The lines that stay, or null when the order changed
	 *   since it was read — nothing is written then.
	 */
	removeItems(
		order: OrderFull,
		userId: number,
		removals: Removal[],
		totals: OrderTotals,
	) {
		const run = sql.begin((tx) =>
			this.#takeLines(tx, order, userId, removals, totals),
		);
		return run.catch((x) => this.#staleToNull(x));
	}

	/**
	 * Give an order that is not paid in full to another customer.
	 * A restaurant bill moving to another table.
	 * @param order The order, as the caller read it.
	 * @param customerId The new customer.
	 * @returns False when the order closed since it was read.
	 *   Nothing is written then.
	 */
	async moveTo(order: Order, customerId: number) {
		return Db.exists(
			sql`update orders set customer_id = ${customerId} where id = ${order.id} and ${open} returning id`,
		);
	}

	/**
	 * Join two open orders into one, in one transaction.
	 * Every line of `from` moves to `into` with its stock records and its history.
	 * `into` gets the new totals and one `order_history` row.
	 * `from` is deleted.
	 * No stock moves: the lines were sold already, they only change bills.
	 * @param from The order that goes, with its lines.
	 *   No money received, no discount: the caller checked.
	 * @param into The order that stays, with its lines.
	 * @param userId Who joins them.
	 * @param totals `into`'s money after the join.
	 * @returns False when either order changed since it was read.
	 *   Nothing is written then.
	 */
	join(from: OrderFull, into: OrderFull, userId: number, totals: OrderTotals) {
		const run = sql.begin((tx) => this.#merge(tx, from, into, userId, totals));
		return run.catch((x) => this.#staleToFalse(x));
	}

	/**
	 * The order a customer can still add items to.
	 * Their newest one that is not paid in full, not refunded and not voided.
	 * @param shopId Owning shop.
	 * @param customerId The customer.
	 * @returns The order id, or null when they have none.
	 */
	async openFor(shopId: number, customerId: number): Promise<number | null> {
		const [r] =
			await sql`select id from orders where shop_id = ${shopId} and customer_id = ${customerId} and ${open} order by id desc limit 1`;
		return r ? Number(r.id) : null;
	}

	/**
	 * One page of orders, newest first.
	 * @param shopId Owning shop.
	 * @param f Filters.
	 *   Payment method name ("all" = any).
	 *   Status: "all" | completed | voided
	 *   | refunded_any = partially or fully refunded
	 *   | unpaid = not fully paid.
	 *   Customer id.
	 *   Source: pos | online.
	 *   Online orders are the ones with a fulfillment status.
	 *   Fulfillment stage.
	 *   `q` = order id, the public order code,
	 *   or an item-name / customer-name substring.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of orders with their lines.
	 */
	async pageForShop(
		shopId: number,
		f: OrderFilters,
		page: number,
		perPage: number,
	) {
		const where = this.#where(shopId, f);
		const [{ n }] = await sql`select count(*) as n from orders o ${where}`;
		const orders: OrderRow[] =
			await sql`select o.*, u.name as cashier, ${salesStaffOf}, ${customerOf} from orders o left join users u on u.id = o.user_id ${where}
      order by o.id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<OrderFull>(
			await this.#withItems(orders.map((x) => this.#shape(x))),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * The staff who made sales in this shop.
	 * For the Orders screen's cashier filter.
	 * The online store's own system user is left out.
	 * The source filter covers online orders.
	 * @param shopId Owning shop.
	 * @returns Id and name, A–Z.
	 */
	cashiers(shopId: number): Promise<{ id: number; name: string }[]> {
		return this.#cashiers.get(shopId, () => this.#readCashiers(shopId));
	}

	/**
	 * Every payment name that appears on the shop's orders.
	 * POS methods (current or deleted) and the online gateway labels
	 * ("Stripe", "Cash on delivery"…).
	 * So the Orders filter can offer all of them.
	 * Kept in memory per shop: reading it goes through every order.
	 * @param shopId Owning shop.
	 * @returns Distinct names, A–Z.
	 */
	methodNames(shopId: number): Promise<string[]> {
		return this.#methodNames.get(shopId, () => this.#readMethodNames(shopId));
	}

	/**
	 * Full detail for /orders/:id.
	 * Lines, refunds (with returned units and who did them),
	 * the history of later changes, customer, cashier and void info.
	 * @param id Order id.
	 * @param shopId Shop it must belong to.
	 * @returns The order, or null.
	 */
	async find(id: number, shopId: number): Promise<OrderDetail | null> {
		const [o] =
			await sql`select o.*, u.name as cashier, ${salesStaffOf}, (select name from users where id = o.voided_by) as voided_by_name, ${customerOf}
      from orders o left join users u on u.id = o.user_id where o.id = ${id} and o.shop_id = ${shopId}`;
		if (!o) return null;
		const { voided_by_name, ...rest } = o;
		const [order] = await this.#withItems([this.#shape(rest)]);
		const refunds: (Refund & { by: string | null })[] =
			await sql`select r.*, u.name as by from refunds r left join users u on u.id = r.user_id where r.order_id = ${id} order by r.id`;
		const refundItems = refunds.length
			? await sql`select ri.*, i.name from refund_items ri join order_items i on i.id = ri.order_item_id where ri.refund_id in ${sql(refunds.map((r) => r.id))} order by ri.id`
			: [];
		const full: RefundFull[] = refunds.map((r) =>
			this.#refundWithItems(r, refundItems),
		);
		const history: OrderHistory[] = (
			await sql`select h.*, u.name as by from order_history h left join users u on u.id = h.user_id where h.order_id = ${id} order by h.id`
		).map((x: HistoryRow) => this.#shapeHistory(x));
		return {
			...order!,
			refunds: full,
			history,
			voided_by_name: voided_by_name ?? null,
		};
	}

	/**
	 * Lines of an order (for refund validation).
	 * @param orderId Order id.
	 * @returns Its lines, oldest first.
	 */
	async items(orderId: number): Promise<OrderItem[]> {
		return (
			await sql`select * from order_items where order_id = ${orderId} order by id`
		).map((x: ItemRow) => this.#shapeItem(x));
	}

	/**
	 * Record a refund.
	 * Money back, optionally returned units per line,
	 * optionally back into stock.
	 * Updates the cached refunded totals/qty and the order status.
	 * Amounts and quantities are the caller's responsibility
	 * (OrderService validates them).
	 * @param order The order being refunded.
	 * @param userId Who is doing it.
	 * @param d Amount in cents, reason, restock flag and the returned units.
	 * @param lines The order's lines.
	 * @returns The created refund, or null when the order changed under us
	 *   (voided, or the money or units are no longer there).
	 *   Nothing is written then.
	 */
	refund(order: Order, userId: number, d: RefundInput, lines: OrderItem[]) {
		const run = sql.begin((tx) =>
			this.#writeRefund(tx, order, userId, d, lines),
		);
		return run.catch((x) => this.#staleToNull(x));
	}

	/**
	 * Void a completed order.
	 * Status → voided, every tracked line goes back into stock.
	 * @param order The order being voided.
	 * @param userId Who is doing it.
	 * @param reason Free-text reason shown on the order.
	 * @param lines The order's lines.
	 * @returns False when the order was no longer "completed"
	 *   (voided or refunded meanwhile). Nothing is written then.
	 */
	async void(order: Order, userId: number, reason: string, lines: OrderItem[]) {
		const done: boolean = await sql.begin((tx) =>
			this.#writeVoid(tx, order, userId, reason, lines),
		);
		this.#forget(order.shop_id);
		return done;
	}

	/**
	 * The first delivery step, of those given, that open orders still sit on.
	 * Voided orders do not count: they never move again.
	 * @param shopId Owning shop.
	 * @param keys The step keys to look for.
	 * @returns That key, or null when no open order uses any of them.
	 */
	async fulfillmentInUse(shopId: number, keys: string[]) {
		if (!keys.length) return null;
		const [r] = await sql`select fulfillment from orders
      where shop_id = ${shopId} and status <> 'voided' and fulfillment in ${sql(keys)} limit 1`;
		return (r?.fulfillment as string | undefined) ?? null;
	}

	/**
	 * Move an online order along its shop's delivery steps and keep its tracking number.
	 * @param id Order id.
	 * @param fulfillment The new stage.
	 * @param tracking Courier tracking number / link ("" = none).
	 */
	setFulfillment(id: number, fulfillment: FulfillmentStatus, tracking: string) {
		return sql`update orders set fulfillment = ${fulfillment}, tracking = ${tracking} where id = ${id}`;
	}

	/**
	 * Write an open order's new discount and the money that follows from it.
	 * @param order The order, as the caller read it.
	 * @param to The discount fields, the tax, the total,
	 *   the payment status and the code.
	 * @returns False when the order changed since it was read
	 *   (paid, voided, other lines). Nothing is written then.
	 */
	async setDiscount(
		order: Order,
		to: Pick<
			Order,
			| "discount_type"
			| "discount_value"
			| "discount"
			| "tax"
			| "total"
			| "payment_status"
			| "coupon_code"
		>,
	) {
		const hit =
			await sql`update orders set discount_type = ${to.discount_type}, discount_value = ${to.discount_value}, discount = ${to.discount}, tax = ${to.tax}, total = ${to.total}, payment_status = ${to.payment_status}, coupon_code = ${to.coupon_code}
        where id = ${order.id} and ${open} and subtotal = ${order.subtotal} returning id`;
		return hit.length > 0;
	}

	/**
	 * Record money received for an unpaid / partly paid order.
	 * `paid` grows and the payment status follows it.
	 * The caller (OrderService) checks the amount against what is still due.
	 * @param order The order being paid.
	 * @param amount Cents received now.
	 * @param more The change given back on top
	 *   (the buyer handed over `amount + change`).
	 *   And, when given, the payment method's name
	 *   and the sales person to keep on the order.
	 * The sums are done by the database in one statement, on the row
	 * as it is now. So two payments at once can never both pass,
	 * and none is lost.
	 * @returns The new paid total and payment status.
	 *   Null when the order no longer takes this much: it was paid
	 *   (or voided) in the meantime.
	 */
	async addPayment(
		order: Order,
		amount: number,
		more: {
			change?: number;
			payment_method?: string;
			sales_staff_id?: number | null;
		} = {},
	) {
		const change = more.change ?? 0;
		const method = more.payment_method ?? order.payment_method;
		const seller =
			more.sales_staff_id === undefined
				? order.sales_staff_id
				: more.sales_staff_id;
		const [row] = await sql`update orders set
        paid = paid + ${amount + change}, change = change + ${change},
        payment_status = case when paid - change + ${amount} >= total then 'paid' else 'partial' end,
        payment_method = ${method}, sales_staff_id = ${seller}
      where id = ${order.id} and status <> 'voided' and paid - change + ${amount} <= total
      returning paid, payment_status`;
		if (!row) return null;
		this.#forget(order.shop_id);
		return {
			paid: Number(row.paid),
			payment_status: row.payment_status as PaymentStatus,
		};
	}

	/**
	 * "Track my order": the order by its public code.
	 * Only when the given contact is the buyer's:
	 * their email (case-insensitive) or phone (digits compared),
	 * as stored on the attached customer.
	 * @param reference The public order code the buyer typed (already normalised).
	 * @param shopId The shop whose store the lookup runs on.
	 * @param contact The email address or phone number they typed.
	 * @returns The order with its lines, or null
	 *   (unknown code, wrong contact, or no customer attached).
	 */
	async findForBuyer(
		reference: string,
		shopId: number,
		contact: string,
	): Promise<OrderFull | null> {
		const [o] =
			await sql`select o.*, ${customerOf}, (select c.email from customers c where c.id = o.customer_id) as customer_email
      from orders o where o.reference = ${reference} and o.shop_id = ${shopId}`;
		if (!o?.customer_id) return null;
		// ponytail: the digit-only phone compare happens here, not in SQL.
		// It is one row, and there is no portable regexp_replace.
		const email = contact.trim().toLowerCase();
		const digits = contact.replace(/\D/g, "");
		const byEmail =
			!!o.customer_email && String(o.customer_email).toLowerCase() === email;
		const byPhone =
			digits.length >= 6 &&
			!!o.customer_phone &&
			String(o.customer_phone).replace(/\D/g, "") === digits;
		if (!byEmail && !byPhone) return null;
		const { customer_email, ...rest } = o;
		return this.#fullOrder(rest);
	}

	/**
	 * An order by its public code.
	 * For a signed-in customer's /account pages.
	 * The caller checks it is theirs.
	 * @param reference The public order code (normalised).
	 * @param shopId Owning shop.
	 * @returns The order with its lines, or null.
	 */
	async byReference(
		reference: string,
		shopId: number,
	): Promise<OrderFull | null> {
		const [o] =
			await sql`select o.*, ${customerOf} from orders o where o.reference = ${reference} and o.shop_id = ${shopId}`;
		return this.#fullOrder(o);
	}

	/**
	 * Headline numbers for the Orders screen; voided orders are excluded.
	 * @param shopId Owning shop.
	 * @param tz The shop's timezone — it decides where "today" starts.
	 * Today's numbers read today's orders only.
	 * The all-time ones are kept in memory for a short time.
	 * @returns Today's order count, today's net sales, and the all-time average order.
	 */
	async stats(shopId: number, tz: string) {
		const since = sqlStamp(startOfToday(tz));
		const [r] =
			await sql`select count(*) as today_orders, coalesce(sum(total), 0) as today_sales
      from orders where shop_id = ${shopId} and created_at >= ${since} and status <> 'voided'`;
		const [rf] =
			await sql`select coalesce(sum(amount), 0) as refunds from refunds where shop_id = ${shopId} and created_at >= ${since}`;
		const { n, revenue } = await this.#totals.get(shopId, () =>
			this.#readTotals(shopId),
		);
		return {
			today_orders: Number(r.today_orders),
			today_revenue: Number(r.today_sales) - Number(rf.refunds),
			avg_order: n ? Math.round(revenue / n) : 0,
		};
	}

	/**
	 * Orders of one customer, newest first, for the customer detail page.
	 * @param customerId Customer id.
	 * @param shopId Owning shop.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of that customer's orders.
	 */
	async forCustomer(
		customerId: number,
		shopId: number,
		page: number,
		perPage: number,
	) {
		const [{ n }] =
			await sql`select count(*) as n from orders o where o.shop_id = ${shopId} and o.customer_id = ${customerId}`;
		const orders: OrderRow[] =
			await sql`select o.*, u.name as cashier, ${customerOf} from orders o left join users u on u.id = o.user_id
      where o.shop_id = ${shopId} and o.customer_id = ${customerId} order by o.id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<OrderFull>(
			await this.#withItems(orders.map((x) => this.#shape(x))),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * Turn a database row into an order with no lines yet.
	 * The customer columns become the `customer` object.
	 * @param o The raw row.
	 * @returns The order.
	 */
	#shape(o: OrderRow): OrderFull {
		const { customer_name, customer_phone, ...rest } = o;
		return {
			...rest,
			tax_included: !!o.tax_included,
			items: [],
			customer: o.customer_id
				? { id: o.customer_id, name: customer_name, phone: customer_phone }
				: null,
		};
	}

	/**
	 * Turn an `order_items` row into an `OrderItem`.
	 * `components` is a JSON snapshot of what a sold package took off the shelves.
	 * @param r The raw row.
	 * @returns The line with its parsed components.
	 */
	#shapeItem(r: ItemRow): OrderItem {
		return {
			...r,
			components: parseJson<OrderItemComponent[] | null>(r.components, null),
		};
	}

	/**
	 * One order line as `order_history` keeps it.
	 * @param i The line.
	 * @returns Its name, quantity and unit price.
	 */
	#lineOf(i: Pick<OrderItem, "name" | "qty" | "price">) {
		return { name: i.name, qty: i.qty, price: i.price };
	}

	/**
	 * The lines and the money of an order at one moment, for `order_history`.
	 * @param money The order's subtotal, discount, tax and total.
	 * @param items Its lines.
	 * @returns The snapshot.
	 */
	#orderSnapshot(
		money: Pick<Order, "subtotal" | "discount" | "tax" | "total">,
		items: OrderItem[],
	): OrderSnapshot {
		return {
			items: items.map((x) => this.#lineOf(x)),
			subtotal: money.subtotal,
			discount: money.discount,
			tax: money.tax,
			total: money.total,
		};
	}

	/**
	 * Turn an `order_history` row into an `OrderHistory`.
	 * `data` is JSON text on SQLite, already parsed on Postgres.
	 * @param r The raw row.
	 * @returns The row with its parsed data, `changed` always there.
	 */
	#shapeHistory(r: HistoryRow): OrderHistory {
		const data = parseJson<Partial<OrderHistory["data"]> | null>(r.data, null);
		return {
			...r,
			data: { changed: [], ...data } as OrderHistory["data"],
		};
	}

	/**
	 * The picture a line may store: only the order's own copy.
	 * A product path never reaches `order_items.image`.
	 * The product may delete that file.
	 * @param image The line's picture.
	 * @returns The order copy, or null.
	 */
	#ownImage(image: string | null | undefined): string | null {
		return image && OrderImages.is(image) ? image : null;
	}

	/**
	 * One resolved package slot as the order line keeps it.
	 * @param c The slot as checkout resolved it.
	 * @returns The unit and how many of it one package takes.
	 */
	#componentOf(c: LineComponent): OrderItemComponent {
		return {
			product_id: c.product_id,
			variant_id: c.variant_id,
			qty: c.qty,
		};
	}

	/**
	 * The `components` column of a line being written.
	 * @param cs The resolved slots of a package line, or none.
	 * @returns The slots as JSON text, or null.
	 */
	#snapshot(cs: LineComponent[] | null | undefined) {
		return cs ? JSON.stringify(cs.map((x) => this.#componentOf(x))) : null;
	}

	/**
	 * The tracked units a new line takes off the shelf.
	 * A package has no stock of its own: each tracked slot leaves instead.
	 * @param it The line.
	 * @returns The units with their names, [] when nothing is tracked.
	 */
	#unitsOf(it: NewItem): (StockUnit & { name: string })[] {
		if (it.components?.length) {
			const units: (StockUnit & { name: string })[] = [];
			for (const c of it.components) {
				if (!c.track_stock) continue;
				units.push({
					productId: c.product_id,
					variantId: c.variant_id,
					qty: c.qty * it.qty,
					name: c.name,
				});
			}
			return units;
		}
		if (!it.track_stock) return [];
		return [
			{
				productId: it.product_id,
				variantId: it.variant_id,
				qty: it.qty,
				name: it.name,
			},
		];
	}

	/**
	 * Load the lines of every order in the list and hang them off `items`.
	 * @param orders The orders, with empty `items`.
	 * @returns The same orders, lines filled in.
	 */
	async #withItems(orders: OrderFull[]) {
		const ids = orders.map((o) => o.id);
		const items: OrderItem[] = ids.length
			? (
					await sql`select * from order_items where order_id in ${sql(ids)} order by id`
				).map((x: ItemRow) => this.#shapeItem(x))
			: [];
		const byId = new Map(orders.map((o) => [o.id, o]));
		for (const it of items) byId.get(it.order_id)?.items.push(it);
		return orders;
	}

	/**
	 * The units that `qty` of this line put back on the shelf.
	 * The package's snapshotted components, or the line itself.
	 * @param line The order line.
	 * @param qty How many of the line come back.
	 * @returns The units, [] when the product is gone.
	 */
	#returned(line: OrderItem, qty: number): StockUnit[] {
		if (line.components?.length) {
			const units: StockUnit[] = [];
			for (const c of line.components)
				units.push({
					productId: c.product_id,
					variantId: c.variant_id,
					qty: c.qty * qty,
				});
			return units;
		}
		if (!line.product_id) return [];
		return [{ productId: line.product_id, variantId: line.variant_id, qty }];
	}

	/**
	 * The order with its lines, from one row of an order select.
	 * @param row The raw row, or nothing when the select found none.
	 * @returns The order, or null.
	 */
	async #fullOrder(row: OrderRow | undefined): Promise<OrderFull | null> {
		if (!row) return null;
		return (await this.#withItems([this.#shape(row)]))[0] ?? null;
	}

	/**
	 * One refund with its returned units and a real restock flag.
	 * @param r The refund row, with who did it.
	 * @param items The returned units of every refund of the order.
	 * @returns The refund with its own units.
	 */
	#refundWithItems(
		r: Refund & { by: string | null },
		items: RefundFull["items"],
	): RefundFull {
		return {
			...r,
			restock: !!r.restock,
			items: items.filter((ri) => ri.refund_id === r.id),
		};
	}

	/**
	 * Turn a rolled-back "the order changed" into null; any other error goes on.
	 * @param e What the transaction threw.
	 * @returns null for a stale order.
	 */
	#staleToNull(e: unknown) {
		if (e instanceof StaleOrder) return null;
		throw e;
	}

	/**
	 * Turn a rolled-back "the order changed" into false; any other error goes on.
	 * @param e What the transaction threw.
	 * @returns false for a stale order.
	 */
	#staleToFalse(e: unknown) {
		if (e instanceof StaleOrder) return false;
		throw e;
	}

	/**
	 * The writes of `create`, inside its transaction.
	 * ponytail: one random 60-bit code, no collision retry.
	 * The unique index would surface a clash (odds ~1e-18 per order).
	 * @param tx The open transaction.
	 * @param o The order header, already priced by the caller.
	 * @param items The lines, already priced from the DB.
	 * @returns The created order with its lines.
	 */
	async #insertOrder(
		tx: SQL,
		o: NewOrder,
		items: NewItem[],
	): Promise<OrderFull> {
		const [order] =
			await tx`insert into orders (reference, shop_id, user_id, customer_id, subtotal, discount_type, discount_value, discount, delivery_fee, tax, tax_rate, tax_label, tax_included, total, paid, change, payment_method, payment_status, fulfillment, note, coupon_code, sales_staff_id)
        values (${orderReference()}, ${o.shop_id}, ${o.user_id}, ${o.customer_id}, ${o.subtotal}, ${o.discount_type}, ${o.discount_value}, ${o.discount}, ${o.delivery_fee}, ${o.tax}, ${o.tax_rate}, ${o.tax_label}, ${o.tax_included}, ${o.total}, ${o.paid}, ${o.change}, ${o.payment_method}, ${o.payment_status}, ${o.fulfillment}, ${o.note}, ${o.coupon_code ?? null}, ${o.sales_staff_id ?? null}) returning *`;
		const rows = await this.#insertLines(tx, order, items);
		return {
			...order,
			tax_included: !!order.tax_included,
			items: rows,
			customer: null,
		};
	}

	/**
	 * Write order lines and take their tracked stock, inside the caller's transaction.
	 * A package has no stock of its own: each of its slots leaves the shelf instead.
	 * @param tx The open transaction.
	 * @param order The order the lines join, and who the stock moves are signed by.
	 * @param items The lines, already priced from the DB.
	 * @returns The inserted lines.
	 * @throws OutOfStockError when a tracked unit ran out.
	 */
	async #insertLines(
		tx: SQL,
		order: Pick<Order, "id" | "shop_id" | "user_id">,
		items: NewItem[],
	) {
		const rows: OrderItem[] = [];
		for (const it of items) {
			const [row] =
				await tx`insert into order_items (order_id, product_id, variant_id, name, price, cost, qty, components, image, note)
          values (${order.id}, ${it.product_id}, ${it.variant_id}, ${it.name}, ${it.price}, ${it.cost}, ${it.qty}, ${this.#snapshot(it.components)}, ${this.#ownImage(it.image)}, ${it.note ?? ""}) returning *`;
			rows.push(this.#shapeItem(row));
			for (const u of this.#unitsOf(it)) {
				const ok = await this.stock.move(tx, {
					shopId: order.shop_id,
					productId: u.productId,
					variantId: u.variantId,
					type: "sale",
					qty: -u.qty,
					orderId: order.id,
					userId: order.user_id,
				});
				if (!ok)
					throw new OutOfStockError(
						u.name,
						(await this.stock.level(
							tx,
							order.shop_id,
							u.productId,
							u.variantId,
						)) ?? 0,
					);
			}
		}
		return rows;
	}

	/**
	 * Save an open order's new totals and one `order_history` row,
	 * inside the caller's transaction.
	 * Only the order the caller priced against is touched.
	 * It must still be not paid in full, not refunded, not voided,
	 * and have the subtotal it was read with.
	 * So two changes at once can't both build on the same numbers.
	 * @param tx The open transaction.
	 * @param order The order with its lines, as the caller read it.
	 * @param userId Who is changing it.
	 * @param type What happened.
	 * @param totals The order's money after the change.
	 * @param items The order's lines after the change.
	 * @param changed The lines that were added, or the units that were removed.
	 * @throws StaleOrder when the order changed since it was read.
	 */
	async #retotal(
		tx: SQL,
		order: OrderFull,
		userId: number,
		type: OrderHistory["type"],
		totals: OrderTotals,
		items: OrderItem[],
		changed: OrderSnapshot["items"],
	) {
		const hit =
			await tx`update orders set subtotal = ${totals.subtotal}, discount = ${totals.discount}, tax = ${totals.tax}, total = ${totals.total}, payment_status = ${totals.payment_status}
        where id = ${order.id} and ${open} and subtotal = ${order.subtotal} returning id`;
		if (!hit.length) throw new StaleOrder();
		const data: OrderHistory["data"] = {
			changed,
			before: this.#orderSnapshot(order, order.items),
			after: this.#orderSnapshot(totals, items),
		};
		await tx`insert into order_history (order_id, shop_id, user_id, type, data) values (${order.id}, ${order.shop_id}, ${userId}, ${type}, ${JSON.stringify(data)})`;
	}

	/**
	 * Put units of one order line back on the shelf,
	 * inside the caller's transaction.
	 * A unit that is not tracked any more is skipped by `move`.
	 * @param tx The open transaction.
	 * @param order The order the line belongs to.
	 * @param userId Who is doing it.
	 * @param line The order line.
	 * @param qty How many of the line come back.
	 * @param type The kind of stock movement to write.
	 * @param reason The reason written on the movement.
	 */
	async #putBack(
		tx: SQL,
		order: Pick<Order, "id" | "shop_id">,
		userId: number,
		line: OrderItem,
		qty: number,
		type: "void" | "refund",
		reason: string,
	) {
		for (const u of this.#returned(line, qty))
			await this.stock.move(tx, {
				...u,
				shopId: order.shop_id,
				type,
				orderId: order.id,
				userId,
				reason,
			});
	}

	/**
	 * The writes of `addItems`, inside its transaction.
	 * @param tx The open transaction.
	 * @param order The order with its lines, as the caller read it.
	 * @param userId Who is adding.
	 * @param items The new lines, already priced from the DB.
	 * @param totals The order's money after the lines join it.
	 * @returns The inserted lines.
	 * @throws StaleOrder when the order changed since it was read.
	 */
	async #addLines(
		tx: SQL,
		order: OrderFull,
		userId: number,
		items: NewItem[],
		totals: OrderTotals,
	): Promise<OrderItem[]> {
		const rows = await this.#insertLines(
			tx,
			{ id: order.id, shop_id: order.shop_id, user_id: userId },
			items,
		);
		await this.#retotal(
			tx,
			order,
			userId,
			"items_added",
			totals,
			[...order.items, ...rows],
			rows.map((x) => this.#lineOf(x)),
		);
		return rows;
	}

	/**
	 * The writes of `removeItems`, inside its transaction.
	 * ponytail: a deleted line's picture copy stays in storage.
	 * Another line may share the file.
	 * @param tx The open transaction.
	 * @param order The order with its lines, as the caller read it.
	 * @param userId Who is removing.
	 * @param removals How many units leave each line.
	 * @param totals The order's money after they left.
	 * @returns The lines that stay.
	 * @throws StaleOrder when the order changed since it was read.
	 */
	async #takeLines(
		tx: SQL,
		order: OrderFull,
		userId: number,
		removals: Removal[],
		totals: OrderTotals,
	): Promise<OrderItem[]> {
		const left = new Map(order.items.map((l) => [l.id, l.qty]));
		const changed: OrderSnapshot["items"] = [];
		for (const r of removals) {
			const line = order.items.find((l) => l.id === r.order_item_id)!;
			const taken =
				await tx`update order_items set qty = qty - ${r.qty} where id = ${line.id} and order_id = ${order.id} and qty >= ${r.qty} returning qty`;
			if (!taken.length) throw new StaleOrder();
			left.set(line.id, Number(taken[0].qty));
			if (Number(taken[0].qty) === 0)
				await tx`delete from order_items where id = ${line.id}`;
			await this.#putBack(
				tx,
				order,
				userId,
				line,
				r.qty,
				"void",
				t("server.stock_reason_removed", { id: order.id }),
			);
			changed.push(this.#lineOf({ ...line, qty: r.qty }));
		}
		const rows: OrderItem[] = [];
		for (const l of order.items) {
			const qty = left.get(l.id)!;
			if (qty > 0) rows.push({ ...l, qty });
		}
		await this.#retotal(
			tx,
			order,
			userId,
			"items_removed",
			totals,
			rows,
			changed,
		);
		return rows;
	}

	/**
	 * The writes of `join`, inside its transaction.
	 * @param tx The open transaction.
	 * @param from The order that goes, with its lines.
	 * @param into The order that stays, with its lines.
	 * @param userId Who joins them.
	 * @param totals `into`'s money after the join.
	 * @returns True.
	 * @throws StaleOrder when either order changed since it was read.
	 */
	async #merge(
		tx: SQL,
		from: OrderFull,
		into: OrderFull,
		userId: number,
		totals: OrderTotals,
	) {
		await tx`update order_items set order_id = ${into.id} where order_id = ${from.id}`;
		await tx`update stock_movements set order_id = ${into.id} where order_id = ${from.id}`;
		await tx`update order_history set order_id = ${into.id} where order_id = ${from.id}`;
		await tx`update store_carts set order_id = ${into.id} where order_id = ${from.id}`;
		await this.#retotal(
			tx,
			into,
			userId,
			"items_added",
			totals,
			[...into.items, ...from.items],
			from.items.map((x) => this.#lineOf(x)),
		);
		const gone =
			await tx`delete from orders where id = ${from.id} and ${open} and paid = 0 and subtotal = ${from.subtotal} returning id`;
		if (!gone.length) throw new StaleOrder();
		return true;
	}

	/**
	 * The `where` of the order list, for one set of filters.
	 * @param shopId Owning shop.
	 * @param f The filters (see `pageForShop`).
	 * @returns The SQL fragment, over `orders o`.
	 */
	#where(shopId: number, f: OrderFilters) {
		// the buyer reads their code over the phone
		const { id, code } = orderLookup(f.q);
		const like = `%${f.q.toLowerCase()}%`;
		const customerId = f.customerId ?? 0;
		const cashierId = f.cashierId ?? 0;
		const salesStaffId = f.salesStaffId ?? 0;
		return sql`where o.shop_id = ${shopId} and (${f.method} = 'all' or o.payment_method = ${f.method})
      and (${f.status} = 'all' or o.status = ${f.status} or (${f.status} = 'refunded_any' and o.status in ('partially_refunded', 'refunded')) or (${f.status} = 'unpaid' and o.payment_status <> 'paid'))
      and (${f.source} = 'all' or (${f.source} = 'online') = (o.fulfillment <> '' or exists (select 1 from users su where su.id = o.user_id and su.email = ${STORE_SYSTEM_EMAIL})))
      and (${f.fulfillment} = 'all' or o.fulfillment = ${f.fulfillment})
      and (${customerId} = 0 or o.customer_id = ${customerId})
      and (${cashierId} = 0 or o.user_id = ${cashierId})
      and (${salesStaffId} = 0 or o.sales_staff_id = ${salesStaffId})
      and (${f.q} = '' or o.id = ${id} or o.reference = ${code} or exists (select 1 from order_items i where i.order_id = o.id and lower(i.name) like ${like})
        or exists (select 1 from customers c where c.id = o.customer_id and lower(c.name) like ${like}))`;
	}

	/**
	 * The writes of `refund`, inside its transaction.
	 * The cap is checked and the money added in one statement.
	 * So two refunds at once can't both pass the cap.
	 * Units are restocked only if the product still exists and is tracked
	 * (`move()` checks). An untracked item is simply skipped.
	 * @param tx The open transaction.
	 * @param order The order being refunded.
	 * @param userId Who is doing it.
	 * @param d Amount in cents, reason, restock flag and the returned units.
	 * @param lines The order's lines.
	 * @returns The created refund.
	 * @throws StaleOrder when the order changed since it was read.
	 */
	async #writeRefund(
		tx: SQL,
		order: Order,
		userId: number,
		d: RefundInput,
		lines: OrderItem[],
	): Promise<Refund> {
		const moved =
			await tx`update orders set refunded = refunded + ${d.amount}, status = case when refunded + ${d.amount} >= total then 'refunded' else 'partially_refunded' end where id = ${order.id} and status <> 'voided' and refunded + ${d.amount} <= paid - change returning id`;
		if (!moved.length) throw new StaleOrder();
		const [r] =
			await tx`insert into refunds (order_id, shop_id, user_id, amount, reason, restock) values (${order.id}, ${order.shop_id}, ${userId}, ${d.amount}, ${d.reason}, ${d.restock}) returning *`;
		for (const it of d.items) {
			const line = lines.find((l) => l.id === it.order_item_id)!;
			await tx`insert into refund_items (refund_id, order_item_id, qty) values (${r.id}, ${it.order_item_id}, ${it.qty})`;
			const taken =
				await tx`update order_items set refunded_qty = refunded_qty + ${it.qty} where id = ${it.order_item_id} and order_id = ${order.id} and refunded_qty + ${it.qty} <= qty returning id`;
			if (!taken.length) throw new StaleOrder();
			if (!d.restock) continue;
			await this.#putBack(
				tx,
				order,
				userId,
				line,
				it.qty,
				"refund",
				t("server.stock_reason_refund", { id: r.id }),
			);
		}
		return { ...r, restock: !!r.restock };
	}

	/**
	 * The writes of `void`, inside its transaction.
	 * Only a still-completed order is touched.
	 * So two voids at once can't put the stock back twice.
	 * @param tx The open transaction.
	 * @param order The order being voided.
	 * @param userId Who is doing it.
	 * @param reason Free-text reason shown on the order.
	 * @param lines The order's lines.
	 * @returns False when the order was no longer "completed".
	 */
	async #writeVoid(
		tx: SQL,
		order: Order,
		userId: number,
		reason: string,
		lines: OrderItem[],
	) {
		const hit =
			await tx`update orders set status = 'voided', voided_at = current_timestamp, voided_by = ${userId}, void_reason = ${reason} where id = ${order.id} and status = 'completed' returning id`;
		if (!hit.length) return false;
		for (const l of lines)
			await this.#putBack(
				tx,
				order,
				userId,
				l,
				l.qty,
				"void",
				t("server.stock_reason_void", { id: order.id }),
			);
		return true;
	}

	/**
	 * Read the cashier list from the orders (the slow part of `cashiers`).
	 * @param shopId Owning shop.
	 * @returns Id and name, A–Z.
	 */
	async #readCashiers(shopId: number): Promise<{ id: number; name: string }[]> {
		const rows: { id: number; name: string }[] =
			await sql`select distinct u.id, u.name from orders o join users u on u.id = o.user_id
        where o.shop_id = ${shopId} and u.email <> ${STORE_SYSTEM_EMAIL} order by u.name`;
		return rows.map((r) => ({ id: Number(r.id), name: r.name }));
	}

	/**
	 * Read the payment names from the orders
	 * (the slow part of `methodNames`).
	 * @param shopId Owning shop.
	 * @returns Distinct names, A–Z.
	 */
	async #readMethodNames(shopId: number): Promise<string[]> {
		const rows: { payment_method: string }[] =
			await sql`select distinct payment_method from orders where shop_id = ${shopId} order by payment_method`;
		return rows.map((r) => r.payment_method);
	}

	/**
	 * Read a shop's all-time order count and sales. Voided orders are left out.
	 * @param shopId Owning shop.
	 * @returns The count and the summed totals in cents.
	 */
	async #readTotals(shopId: number) {
		const [r] =
			await sql`select count(*) as n, coalesce(sum(total), 0) as revenue from orders where shop_id = ${shopId} and status <> 'voided'`;
		return { n: Number(r.n), revenue: Number(r.revenue) };
	}

	/**
	 * Forget what is kept in memory about a shop's orders.
	 * Call it after a write that can change a filter list or the totals.
	 * @param shopId Owning shop.
	 */
	#forget(shopId: number) {
		this.#cashiers.delete(shopId);
		this.#methodNames.delete(shopId);
		this.#totals.delete(shopId);
	}
}

export type { SQL };
