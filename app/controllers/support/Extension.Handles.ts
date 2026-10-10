import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { ProductRepository } from "@repositories/Product.Repository";
import type {
	ExtensionCustomers,
	ExtensionOwnHandles,
} from "@services/settings/extensions/types/Extension.Types";
import { OrderService } from "@services/sales/Order.Service";
import { CustomerService } from "@services/sales/Customer.Service";
import { PaymentMethodService } from "@services/settings/PaymentMethod.Service";
import { SalesStaffService } from "@services/settings/SalesStaff.Service";
import { CustomerInput } from "@validators/Customer.Validator";
import { validate, type Errors } from "@validators/validate";

/**
 * The few functions an extension gets that are not API routes.
 * They join the API's own functions under the same area names
 * (`ExtensionService.handle`): `products.idBySku`, `orders.openFor`,
 * `orders.payOptions`, and `customers`.
 * Everything else an extension can do is an API route
 * (`ApiCall.functions`), never written here.
 */
@Service()
export class ExtensionHandles {
	constructor(
		private productRows: ProductRepository,
		private orders: OrderService,
		private customers: CustomerService,
		private methods: PaymentMethodService,
		private salesStaff: SalesStaffService,
	) {}

	/**
	 * The functions with no API route, for one shop.
	 * `orders.move` and `orders.join` are for staff routes only:
	 * the signed-in staff member moves or joins the bills.
	 * @param shopId The shop of the request.
	 * @param userId The signed-in staff member, on a staff route.
	 * @returns The functions, by area.
	 */
	for(shopId: number, userId?: number): ExtensionOwnHandles {
		return {
			products: { idBySku: (sku) => this.productRows.idBySku(shopId, sku) },
			orders: {
				openFor: (customerId) => this.orders.openFor(shopId, customerId),
				payOptions: () => this.#payOptions(shopId),
				...(userId != null && {
					move: (orderId, customerId) =>
						this.#move(shopId, orderId, customerId),
					join: (fromId, intoId) => this.#join(shopId, userId, fromId, intoId),
				}),
			},
			customers: this.customersOf(shopId),
		};
	}

	/**
	 * The `customers` handle: the shop's customers through
	 * CustomerService.
	 * `create` and `update` run the customer form's own rules.
	 * A phone number is one customer's only.
	 * @param shopId The shop of the request.
	 * @returns The handle.
	 */
	customersOf(shopId: number): ExtensionCustomers {
		return {
			create: (input) => this.#createCustomer(shopId, input),
			update: (id, input) => this.#updateCustomer(shopId, id, input),
			get: (id) => this.customers.find(id, shopId),
			addresses: (id) => this.customers.addresses(id, shopId),
			search: (q) => this.customers.search(shopId, String(q)),
		};
	}

	/**
	 * Throw the first message of a refusal, so the extension can show it.
	 * @param errors The `{ field: message }` errors, if any.
	 */
	#refuse(errors: Errors | undefined) {
		if (errors)
			throw new Error(Object.values(errors)[0] ?? t("server.forbidden"));
	}

	/**
	 * Check a customer's fields with the customer form's own rules.
	 * @param shopId The shop of the request.
	 * @param input The fields the extension sent.
	 * @param id The customer being changed, when it is a change.
	 * @returns The checked fields. It throws the first refusal.
	 */
	async #checked(shopId: number, input: unknown, id?: number) {
		const v = validate(CustomerInput, input);
		this.#refuse(v.errors);
		this.#refuse(
			(await this.customers.phoneErrors(shopId, v.data!, id)) ?? undefined,
		);
		return v.data!;
	}

	/**
	 * Add a customer for an extension.
	 * @param shopId The shop of the request.
	 * @param input The fields the extension sent.
	 * @returns The new customer.
	 */
	async #createCustomer(shopId: number, input: unknown) {
		const data = await this.#checked(shopId, input);
		return this.customers.create(shopId, data);
	}

	/**
	 * Change a customer for an extension.
	 * @param shopId The shop of the request.
	 * @param id The customer.
	 * @param input The fields the extension sent.
	 * @returns The customer. It throws when there is no such customer.
	 */
	async #updateCustomer(shopId: number, id: number, input: unknown) {
		const data = await this.#checked(shopId, input, id);
		const customer = await this.customers.update(id, shopId, data);
		if (!customer) throw new Error(t("server.not_found"));
		return customer;
	}

	/**
	 * What a pay dialog offers, like the Sell screen's.
	 * @param shopId The shop of the request.
	 * @returns The payment methods switched on and the active sales staff.
	 */
	async #payOptions(shopId: number) {
		return {
			methods: await this.methods.listEnabled(shopId),
			sales_staff: await this.salesStaff.options(shopId, true),
		};
	}

	/**
	 * Give an open order to another customer.
	 * @param shopId The shop of the request.
	 * @param orderId The open order.
	 * @param customerId The customer who gets it.
	 * @returns The order. It throws the first refusal.
	 */
	async #move(shopId: number, orderId: number, customerId: number) {
		const r = await this.orders.moveTo(orderId, shopId, customerId);
		this.#refuse(r.errors);
		return r.order!;
	}

	/**
	 * Join one open order into another.
	 * @param shopId The shop of the request.
	 * @param userId The staff member who joins them.
	 * @param fromId The order that goes away.
	 * @param intoId The order that keeps the lines.
	 * @returns The joined order. It throws the first refusal.
	 */
	async #join(shopId: number, userId: number, fromId: number, intoId: number) {
		const r = await this.orders.join(fromId, intoId, shopId, userId);
		this.#refuse(r.errors);
		return r.order!;
	}
}
