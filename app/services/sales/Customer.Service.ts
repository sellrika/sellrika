import { t } from "@xcore/i18n/I18n";
import type { CustomerSort } from "@constants/Customer.Constant";
import { Service } from "@xcore/di";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { CustomerRepository } from "@repositories/Customer.Repository";
import { CustomerAddressRepository } from "@repositories/CustomerAddress.Repository";
import { ACCOUNT_ADDRESSES_MAX } from "@constants/Store.Constant";
import type {
	CustomerAddressInput,
	CustomerInput,
} from "@validators/Customer.Validator";

/**
 * Customers, per shop.
 * One rule: a phone number belongs to at most one of them.
 */
@Service()
export class CustomerService {
	constructor(
		private customers: CustomerRepository,
		private addressRepo: CustomerAddressRepository,
		private extensions: ExtensionService,
	) {}

	/**
	 * One page of customers.
	 * @param shopId Owning shop.
	 * @param q Search text ("" = everyone).
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @param sort The order of the list, or null for the default.
	 * @returns A page of customers with their purchase stats.
	 */
	page(
		shopId: number,
		q: string,
		page: number,
		perPage: number,
		sort: CustomerSort | null = null,
	) {
		return this.customers.pageForShop(shopId, q, page, perPage, sort);
	}

	/**
	 * Type-ahead lookup for the checkout picker.
	 * @param shopId Owning shop.
	 * @param q Search text.
	 * @returns A handful of matching customers.
	 */
	search(shopId: number, q: string) {
		return this.customers.search(shopId, q);
	}

	/**
	 * One customer with their purchase stats.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @returns The customer, or null.
	 */
	find(id: number, shopId: number) {
		return this.customers.find(id, shopId);
	}

	/**
	 * A customer's addresses, oldest first.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @returns The addresses. None for another shop's customer.
	 */
	addresses(id: number, shopId: number) {
		return this.addressRepo.list(id, shopId);
	}

	/**
	 * Add an address to a customer.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated address.
	 * @returns `{ errors }` when the list is full, `{}` when saved,
	 * or null when the customer is not this shop's.
	 */
	async addAddress(id: number, shopId: number, d: CustomerAddressInput) {
		if (!(await this.customers.find(id, shopId))) return null;
		if ((await this.addresses(id, shopId)).length >= ACCOUNT_ADDRESSES_MAX)
			return {
				errors: {
					address_1: t("server.account_address_limit", {
						max: ACCOUNT_ADDRESSES_MAX,
					}),
				},
			};
		await this.addressRepo.create(id, shopId, d);
		return {};
	}

	/**
	 * Change one address of a customer.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @param addressId The address.
	 * @param d Validated address.
	 * @returns The address, or null when it is not this customer's.
	 */
	async updateAddress(
		id: number,
		shopId: number,
		addressId: number,
		d: CustomerAddressInput,
	) {
		if (!(await this.customers.find(id, shopId))) return null;
		return this.addressRepo.update(addressId, id, d);
	}

	/**
	 * Remove one address of a customer.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @param addressId The address.
	 */
	async removeAddress(id: number, shopId: number, addressId: number) {
		if (await this.customers.find(id, shopId))
			await this.addressRepo.delete(addressId, id);
	}

	/**
	 * Check the phone number isn't already someone else's in this shop.
	 * @param shopId Owning shop.
	 * @param d Validated customer input.
	 * @param exceptId Customer allowed to keep the number (the one being edited).
	 * @returns Inertia errors (duplicate phone), or null.
	 */
	async phoneErrors(shopId: number, d: CustomerInput, exceptId = 0) {
		if (!d.phone) return null;
		const owner = await this.customers.phoneOwner(shopId, d.phone, exceptId);
		return owner
			? { phone: t("server.customer_phone_taken", { name: owner.name }) }
			: null;
	}

	/**
	 * Create a customer.
	 * @param shopId Owning shop.
	 * @param d Validated customer input.
	 * @returns The created customer.
	 */
	async create(shopId: number, d: CustomerInput) {
		const customer = await this.customers.create(shopId, d);
		void this.extensions.emit("customer.created", shopId, { customer });
		return customer;
	}

	/**
	 * Edit a customer.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated customer input.
	 * @returns The updated customer, or null.
	 */
	async update(id: number, shopId: number, d: CustomerInput) {
		const customer = await this.customers.update(id, shopId, d);
		if (customer)
			void this.extensions.emit("customer.updated", shopId, { customer });
		return customer;
	}

	/**
	 * Delete a customer.
	 * Their orders survive with `customer_id` nulled.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 */
	async remove(id: number, shopId: number) {
		const customer = await this.customers.find(id, shopId);
		await this.customers.delete(id, shopId);
		if (customer)
			void this.extensions.emit("customer.deleted", shopId, { customer });
	}
}
