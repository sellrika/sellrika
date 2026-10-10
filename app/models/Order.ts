import type {
	FulfillmentStatus,
	PaymentStatus,
} from "@constants/Order.Constant";

/** Where an order stands. Voided orders are left out of every report. */
export type OrderStatus =
	| "completed"
	| "partially_refunded"
	| "refunded"
	| "voided";
/** How a discount was typed: a percent of the subtotal, or fixed cents. */
export type DiscountType = "percent" | "fixed";

/** One sale, as the `orders` table keeps it. Money is cents. */
export type Order = {
	id: number;
	/**
	 * Public code (P8J4-MJSQ-4Z8T) the buyer sees and tracks by.
	 * null only on rows older than migration 0036 that it couldn't reach.
	 */
	reference: string | null;
	shop_id: number;
	user_id: number;
	customer_id: number | null;
	status: OrderStatus;
	/** Sum of item price × qty (cents). */
	subtotal: number;
	discount_type: DiscountType | null;
	/** Percent (0..100) or cents, depending on discount_type. */
	discount_value: number;
	/** Cents taken off the subtotal. */
	discount: number;
	/** Cents, online-store delivery charge (0 at the POS). */
	delivery_fee: number;
	/**
	 * Cents of tax on the goods after the discount.
	 * See app/helpers/tax.ts.
	 */
	tax: number;
	/** The shop's rate at sale time, hundredths of a percent. */
	tax_rate: number;
	/**
	 * The shop's label at sale time ("VAT").
	 * It survives a rename, like payment_method.
	 */
	tax_label: string;
	/** true = `tax` sits inside the prices (not added to the total). */
	tax_included: boolean;
	/** subtotal - discount + (tax when not included) + delivery_fee. */
	total: number;
	/**
	 * Cents received.
	 * POS: what was handed over, incl. change.
	 * Manual online orders: recorded so far.
	 */
	paid: number;
	change: number;
	/** Cents refunded so far (sum of refunds.amount). */
	refunded: number;
	payment_method: string;
	/**
	 * paid | partial | unpaid.
	 * A POS sale starts paid.
	 * Manual online orders, direct store orders
	 * and orders an extension opens start unpaid.
	 */
	payment_status: PaymentStatus;
	/**
	 * Online orders: a key of the shop's `fulfillment_steps`.
	 * "" = POS sale.
	 */
	fulfillment: FulfillmentStatus | "";
	/** Courier tracking number / link, free text. */
	tracking: string;
	/**
	 * Free text.
	 * The online store puts the delivery details here.
	 */
	note: string;
	/**
	 * The discount code used at the online checkout, as text.
	 * It survives a deleted coupon.
	 */
	coupon_code: string | null;
	/**
	 * The sales person named at the POS (migration 0072).
	 * null = nobody.
	 */
	sales_staff_id: number | null;
	voided_at: string | null;
	voided_by: number | null;
	void_reason: string | null;
	created_at: string;
};
/**
 * What one sold package took off the shelves.
 * `qty` is per ONE package, so multiply by the line qty.
 */
export type OrderItemComponent = {
	product_id: number;
	variant_id: number | null;
	qty: number;
};
/** One line of an order, as the `order_items` table keeps it. */
export type OrderItem = {
	id: number;
	order_id: number;
	product_id: number | null;
	variant_id: number | null;
	name: string;
	price: number;
	/** Purchase price per unit at sale time. */
	cost: number | null;
	qty: number;
	refunded_qty: number;
	/** Package snapshot (JSON column), null for a plain line. */
	components: OrderItemComponent[] | null;
	/**
	 * The order's own shrunk copy `/uploads/order-…`
	 * (migrations 0058, 0059). null = none.
	 */
	image: string | null;
	/**
	 * The buyer's custom request for this line (migration 0070).
	 * "" = none.
	 */
	note: string;
};
/** Money given back on an order. */
export type Refund = {
	id: number;
	order_id: number;
	shop_id: number;
	user_id: number;
	amount: number;
	reason: string;
	restock: boolean;
	created_at: string;
};
/** Units of one order line that came back with a refund. */
export type RefundItem = {
	id: number;
	refund_id: number;
	order_item_id: number;
	qty: number;
};
/** A refund with who did it and the units that came back. */
export type RefundFull = Refund & {
	by: string | null;
	items: (RefundItem & { name: string })[];
};
/** Order with lines (+ who rang it up / who the customer is, when joined). */
export type OrderFull = Order & {
	items: OrderItem[];
	cashier?: string | null;
	sales_staff?: string | null;
	customer?: { id: number; name: string; phone: string | null } | null;
};
/** The lines and the money of an order at one moment (cents). */
export type OrderSnapshot = {
	items: { name: string; qty: number; price: number }[];
	subtotal: number;
	discount: number;
	tax: number;
	total: number;
};
/**
 * One change made to an order after it was created (migration 0074).
 * Today: items added to, or removed from, an order that is not paid yet.
 */
export type OrderHistory = {
	id: number;
	order_id: number;
	shop_id: number;
	user_id: number | null;
	type: "items_added" | "items_removed";
	/**
	 * `changed` = the lines that were added, or the units that were removed.
	 * `before` / `after` = the whole order before the change and after it.
	 */
	data: {
		changed: OrderSnapshot["items"];
		before: OrderSnapshot;
		after: OrderSnapshot;
	};
	created_at: string;
	/** Who did it, by name. */
	by: string | null;
};
/** Everything the order page shows: refunds, history and void info too. */
export type OrderDetail = OrderFull & {
	refunds: RefundFull[];
	history: OrderHistory[];
	voided_by_name: string | null;
};
