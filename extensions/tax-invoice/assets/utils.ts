/**
 * What the server half and the browser half share:
 * the shapes, the rules and the sums of a tax invoice.
 * No app module is imported here, so both halves can bundle it.
 */
import type { CustomerAddress, OrderDetail } from "../../types";

/**
 * The prefix of an invoice number when the settings hold none.
 */
export const DEFAULT_PREFIX = "INV-";

/**
 * The longest text one box of the buyer form takes.
 */
export const TEXT_MAX = 300;

/**
 * The seller or the buyer on an invoice.
 * `tax_id` and `branch` are "" when none was typed: the invoice then
 * leaves that line out.
 */
export type Party = {
	name: string;
	address: string;
	tax_id: string;
	branch: string;
};

/**
 * One issued invoice, as the extension keeps it per order.
 */
export type Invoice = {
	/**
	 * The invoice number, like "INV-9JDW-QTGP-FR7U".
	 */
	number: string;
	/**
	 * When it was issued, as UTC ISO text.
	 */
	issued_at: string;
	buyer: Party;
};

/**
 * One saved address of the order's customer, for the buyer form's list.
 */
export type SavedAddress = {
	/**
	 * What the list shows: the address's label, or its first line.
	 */
	label: string;
	/**
	 * The whole address as the invoice prints it, one part per line.
	 */
	text: string;
	/**
	 * The tax ID kept with the address, "" for none.
	 */
	tax_id: string;
};

/**
 * What both routes answer.
 * `invoice` is null while the order has none yet.
 * `customer` is the name of the order's customer, to start the buyer form
 * with. null = no customer on the order.
 * `addresses` are that customer's saved addresses, oldest first, each
 * with its tax ID.
 */
export type Answer = {
	seller: Party;
	invoice: Invoice | null;
	customer?: Pick<Party, "name"> | null;
	addresses?: SavedAddress[];
};

/**
 * Turn a customer's address into what the buyer form offers.
 * Empty parts are left out.
 * @param a The address.
 * @returns Its label, its text and its tax ID.
 */
export function savedAddress(
	a: Pick<
		CustomerAddress,
		| "label"
		| "address_1"
		| "address_2"
		| "city"
		| "state"
		| "postal_code"
		| "country"
		| "tax_id"
	>,
): SavedAddress {
	const place = [a.city, a.state, a.postal_code].filter(Boolean).join(", ");
	return {
		label: a.label || a.address_1,
		text: [a.address_1, a.address_2, place, a.country]
			.filter(Boolean)
			.join("\n"),
		tax_id: a.tax_id,
	};
}

/**
 * The part of an order the rules and the sums need.
 */
type OrderMoney = Pick<
	OrderDetail,
	"status" | "payment_status" | "tax" | "total" | "delivery_fee"
>;

/**
 * Build the invoice number of an order: the prefix, then the order's
 * public code. An older order with no code uses its id.
 * @param prefix The text in front, like "INV-".
 * @param order The order.
 * @returns The invoice number, like "INV-9JDW-QTGP-FR7U".
 */
export function invoiceNumber(
	prefix: string,
	order: Pick<OrderDetail, "id" | "reference">,
) {
	return `${prefix}${order.reference ?? order.id}`;
}

/**
 * Say why an order can't get a tax invoice.
 * @param order The order.
 * @returns A dictionary key, or null when it can get one.
 */
export function refusal(order: OrderMoney) {
	if (order.status === "voided" || order.status === "refunded")
		return "refuse.cancelled";
	if (order.payment_status !== "paid") return "refuse.unpaid";
	if (order.tax <= 0) return "refuse.no_tax";
	return null;
}

/**
 * Work out the sums at the bottom of an invoice, in cents.
 * The delivery fee is never taxed, so it is not part of the value.
 * @param order The order.
 * @returns `value` = the goods before tax, then the tax, the delivery
 * fee and the total the buyer paid.
 */
export function sums(order: OrderMoney) {
	return {
		value: order.total - order.tax - order.delivery_fee,
		tax: order.tax,
		delivery: order.delivery_fee,
		total: order.total,
	};
}

/**
 * Cents as money with two decimals, as an invoice shows it.
 * @param cents The amount in cents.
 * @param currency The shop's currency.
 * @param locale The page's language.
 * @returns The money text.
 */
export function money(cents: number, currency: string, locale: string) {
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
		cents / 100,
	);
}
