import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import type { CustomerAddress, CustomerAddressInput } from "@models/Customer";
import { ACCOUNT_ADDRESSES_MAX } from "@constants/Store.Constant";

/**
 * The addresses of a customer (migration 0046): the ones a store customer
 * keeps on their account and the ones staff add on the customer's page.
 * Oldest first, so the first one is the default the checkout starts with.
 * Every query is scoped to the customer.
 * So nobody reaches another account's rows.
 */
@Service()
export class CustomerAddressRepository {
	/**
	 * A customer's saved addresses, oldest first.
	 * @param customerId The customer.
	 * @param shopId The shop the customer belongs to.
	 * @returns The addresses.
	 */
	async list(customerId: number, shopId: number): Promise<CustomerAddress[]> {
		return sql`select * from customer_addresses where customer_id = ${customerId} and shop_id = ${shopId} order by id`;
	}

	/**
	 * Add an address.
	 * @param customerId The customer.
	 * @param shopId The shop the customer belongs to.
	 * @param d The address.
	 * @returns The created row.
	 */
	async create(
		customerId: number,
		shopId: number,
		d: CustomerAddressInput,
	): Promise<CustomerAddress> {
		return (
			await sql`insert into customer_addresses (customer_id, shop_id, label, phone, address_1, address_2, city, state, country, postal_code, tax_id)
      values (${customerId}, ${shopId}, ${d.label}, ${d.phone}, ${d.address_1}, ${d.address_2}, ${d.city}, ${d.state}, ${d.country}, ${d.postal_code}, ${d.tax_id ?? ""}) returning *`
		)[0];
	}

	/**
	 * Change one of the customer's addresses.
	 * A change that leaves the tax ID out keeps the one it had.
	 * @param id The address.
	 * @param customerId The customer it must belong to.
	 * @param d The new values.
	 * @returns The updated row, or null when it isn't theirs.
	 */
	async update(
		id: number,
		customerId: number,
		d: CustomerAddressInput,
	): Promise<CustomerAddress | null> {
		return Db.one(
			sql`update customer_addresses set label = ${d.label}, phone = ${d.phone}, address_1 = ${d.address_1}, address_2 = ${d.address_2}, city = ${d.city}, state = ${d.state}, country = ${d.country}, postal_code = ${d.postal_code}, tax_id = coalesce(${d.tax_id ?? null}, tax_id)
      where id = ${id} and customer_id = ${customerId} returning *`,
		);
	}

	/**
	 * Remove one of the customer's addresses.
	 * Someone else's is left alone.
	 * @param id The address.
	 * @param customerId The customer it must belong to.
	 */
	delete(id: number, customerId: number) {
		return sql`delete from customer_addresses where id = ${id} and customer_id = ${customerId}`;
	}

	/**
	 * Keep the address an order was delivered to.
	 * Nothing is kept when the account already holds it
	 * (same street, city, country and postal code, however it was typed),
	 * or when the list is full.
	 * So a customer's addresses grow from what they use.
	 * @param customerId The customer.
	 * @param shopId The shop the customer belongs to.
	 * @param d The address as typed at the checkout.
	 *   The phone goes with it.
	 */
	async remember(customerId: number, shopId: number, d: CustomerAddressInput) {
		const saved = await this.list(customerId, shopId);
		if (
			saved.length >= ACCOUNT_ADDRESSES_MAX ||
			saved.some((a) => this.#key(a) === this.#key(d))
		)
			return;
		await this.create(customerId, shopId, d);
	}
	/**
	 * What makes two addresses the same one, however they were typed.
	 * @param a The address.
	 * @returns Street, city, country and postal code, trimmed and lower-cased.
	 */
	#key(a: CustomerAddressInput): string {
		return [a.address_1, a.city, a.country, a.postal_code]
			.map((v) => v.trim().toLowerCase())
			.join("|");
	}
}
