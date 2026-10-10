/**
 * One address of a customer (migration 0046, `customer_addresses`).
 * A signed-in store customer keeps them on their account,
 * and staff add them on the customer's page.
 * The checkout's own fields plus a label ("Home", "Office"…)
 * and the phone to reach whoever receives it.
 * Picked at the checkout with one tap.
 */
export type CustomerAddress = {
	id: number;
	customer_id: number;
	shop_id: number;
	label: string;
	phone: string;
	address_1: string;
	address_2: string;
	city: string;
	state: string;
	country: string;
	postal_code: string;
	/**
	 * The tax or VAT number that goes with this address, as typed
	 * (any country, migration 0079). "" = none. Only staff set it.
	 */
	tax_id: string;
	created_at: string;
};
/**
 * What an address is made of (a row without its ids).
 * The tax ID may be left out: a new address then has none,
 * a changed one keeps what it had (the store account never sends it).
 */
export type CustomerAddressInput = Omit<
	CustomerAddress,
	"id" | "customer_id" | "shop_id" | "created_at" | "tax_id"
> & { tax_id?: string };
/** One customer of a shop, as the `customers` table keeps it. */
export type Customer = {
	id: number;
	shop_id: number;
	name: string;
	phone: string | null;
	email: string | null;
	note: string;
	/**
	 * The Firebase user behind this record,
	 * once they signed in to the store. null = never.
	 */
	firebase_uid: string | null;
	created_at: string;
	updated_at: string;
};
/** List/detail row: purchase totals from orders (voided excluded). */
export type CustomerWithStats = Customer & {
	orders_count: number;
	total_spent: number;
	last_order_at: string | null;
	/** The customer said "no more emails" to this shop (`email_unsubscribes`). */
	unsubscribed: boolean;
};
