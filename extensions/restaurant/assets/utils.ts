/**
 * The shapes the server routes and the browser scripts share.
 */

/**
 * A table's QR code as kept in `ctx.data` (`qr:<table name>`).
 */
export type TableQr = {
	/**
	 * The random token the code's link carries.
	 */
	token: string;
	/**
	 * When staff made it (ISO time).
	 */
	made_at: string;
};

/**
 * One table on the Tables page.
 */
export type TableRow = {
	/**
	 * The table name, as typed in the settings.
	 */
	name: string;
	/**
	 * The customer the table is, or null before the settings were saved.
	 */
	customer_id: number | null;
	/**
	 * Its current QR code: the link it holds and when it was made.
	 * Null when there is none (never made, or the bill was paid).
	 */
	qr: { url: string; made_at: string } | null;
	/**
	 * The table's open bill, or null when nobody ordered. Money is in cents.
	 * `count` = how many units, `opened_at` = when the bill started (ISO time).
	 * `due` = the total less what was paid already.
	 * `discount` = the cents taken off: `discount_type` + `discount_value`
	 * (whole percent, or cents) or the code `coupon_code`.
	 */
	order: {
		id: number;
		reference: string;
		subtotal: number;
		total: number;
		due: number;
		/**
		 * The sales person (waiter) named on the bill, or null.
		 */
		sales_staff_id: number | null;
		discount: number;
		discount_type: "percent" | "fixed" | null;
		discount_value: number;
		coupon_code: string | null;
		tax: number;
		tax_label: string;
		tax_included: boolean;
		count: number;
		opened_at: string;
		items: {
			id: number;
			name: string;
			qty: number;
			amount: number;
			note: string;
		}[];
	} | null;
};

/**
 * What `GET /tables` answers.
 */
export type TablesAnswer = {
	tables: TableRow[];
	/**
	 * The shop's payment methods that are switched on, for the Pay dialog.
	 * `tendered` = it asks for the cash handed over and shows the change.
	 */
	methods: {
		id: number;
		name: string;
		tendered: boolean;
		icon: string;
		image: string | null;
		extension: string | null;
	}[];
	/**
	 * The shop's active sales staff: the waiters the Pay dialog offers.
	 */
	sales_staff: { id: number; name: string }[];
	/**
	 * The shop's currency code, to print the totals.
	 */
	currency: string;
	/**
	 * False while the online store is switched off.
	 */
	store_on: boolean;
	/**
	 * True for managers and admins: they may add and remove tables.
	 */
	can_manage: boolean;
};

/**
 * The kitchen's steps for one order line, in order.
 */
export const KITCHEN_STEPS = ["todo", "preparing", "done"] as const;
export type KitchenStep = (typeof KITCHEN_STEPS)[number];

/**
 * One order line on the Kitchen page.
 */
export type KitchenItem = {
	order_id: number;
	item_id: number;
	table: string;
	name: string;
	qty: number;
	/**
	 * The guest's request for this line ("no onions"), "" = none.
	 */
	note: string;
	/**
	 * The dish's picture (the order line's own copy), or null when it has none.
	 */
	image: string | null;
	step: KitchenStep;
	/**
	 * When the line reached the kitchen (ISO time).
	 */
	at: string;
};

/**
 * A dish taken off a bill after it reached the kitchen (a waiter removed it,
 * or the order was voided). It stays on the Kitchen page until a cook taps Got it.
 */
export type KitchenCancelled = {
	/**
	 * Its own id, for Got it.
	 */
	id: string;
	order_id: number;
	table: string;
	name: string;
	/**
	 * How many were cancelled (a line can lose only some of its units).
	 */
	qty: number;
	note: string;
	/**
	 * The dish's picture; missing on dishes cancelled before pictures were kept.
	 */
	image?: string | null;
	/**
	 * The step it was at: To do = do not start, Preparing = stop cooking.
	 */
	step: KitchenStep;
	/**
	 * When it was cancelled (ISO time).
	 */
	at: string;
	/**
	 * When its round reached the kitchen: the ticket it shows in.
	 */
	round: string;
};

/**
 * What `GET /kitchen` answers: every line of the tables' open bills, oldest
 * first, and the dishes cancelled since.
 */
export type KitchenAnswer = {
	items: KitchenItem[];
	cancelled: KitchenCancelled[];
};

/**
 * A table's open bill as the guest sees it. Money is in cents.
 * `order` is null when nothing was ordered yet.
 */
export type Bill = {
	table: string;
	order: {
		reference: string;
		items: { name: string; qty: number; price: number; note: string }[];
		subtotal: number;
		tax: number;
		tax_included: boolean;
		total: number;
	} | null;
};
