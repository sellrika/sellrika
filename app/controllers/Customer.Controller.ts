import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { back, inertia, redirect } from "@xcore/view/Inertia";
import { CustomerService } from "@services/sales/Customer.Service";
import { OrderService } from "@services/sales/Order.Service";
import { PaymentMethodService } from "@services/settings/PaymentMethod.Service";
import {
	CustomerAddressInput,
	CustomerInput,
} from "@validators/Customer.Validator";
import { validate, type Errors } from "@validators/validate";
import { CUSTOMER_SORTS } from "@constants/Customer.Constant";

/**
 * Customers of the active shop.
 * Also the quick-add and the picker the checkout sheet uses.
 */
@Service()
export class CustomerController {
	constructor(
		private customers: CustomerService,
		private orders: OrderService,
		private methods: PaymentMethodService,
	) {}

	/**
	 * GET /customers?q=&sort=&dir=&page= — the customer list.
	 * `sort` = one of CUSTOMER_SORTS, `dir` = asc | desc.
	 * @param req The current request.
	 * @returns The Customers/Index page.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		const filters = {
			q: new Query(req).text("q"),
			sort: Paginate.sort(req, CUSTOMER_SORTS),
		};
		const { page, perPage } = Paginate.params(req, "customers");
		return inertia(req, "Customers/Index", {
			customers: await this.customers.page(
				shop.id,
				filters.q,
				page,
				perPage,
				filters.sort,
			),
			filters,
		});
	}

	/**
	 * JSON API for the checkout picker: GET /customers/search?q=.
	 * @param req The current request.
	 * @returns `{ customers }` — a handful of matches.
	 */
	async search(req: Request) {
		const { shop } = ctx(req);
		const q = new Query(req).text("q");
		return json({ customers: await this.customers.search(shop.id, q) });
	}

	/**
	 * GET /customers/:id — one customer with their purchase history.
	 * @param req The current request.
	 * @returns The Customers/Show page, or 404.
	 */
	async show(req: BunRequest<"/customers/:id">) {
		const { shop } = ctx(req);
		const customer = await this.customers.find(HttpRequest.idOf(req), shop.id);
		if (!customer) return HttpResponse.notFoundText();
		return this.#showPage(req, shop.id, customer.id, customer);
	}

	/**
	 * POST /customers — add a customer.
	 * An Inertia form goes back to the list.
	 * With `Accept: application/json` (the checkout quick-add)
	 * the answer is 201 `{ customer }` or 422 `{ errors }`.
	 * @param req The current request.
	 * @returns Whichever of those the caller asked for.
	 */
	async store(req: Request) {
		const { shop } = ctx(req);
		const wantsJson =
			req.headers.get("accept")?.includes("application/json") &&
			!req.headers.get("X-Inertia");
		const v = validate(CustomerInput, await HttpRequest.body(req));
		const errors =
			v.errors ?? (await this.customers.phoneErrors(shop.id, v.data));
		if (errors || !v.data)
			return wantsJson
				? json({ errors }, 422)
				: inertia(req, "Customers/Index", {
						customers: await this.customers.page(shop.id, "", 1, 20),
						filters: { q: "", sort: null },
						errors,
					});
		const customer = await this.customers.create(shop.id, v.data);
		return wantsJson ? json({ customer }, 201) : back(req, "/customers");
	}

	/**
	 * PUT /customers/:id — edit a customer.
	 * @param req The current request.
	 * @returns Back to their page, the page with errors, or 404.
	 */
	async update(req: BunRequest<"/customers/:id">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		const v = validate(CustomerInput, await HttpRequest.body(req));
		const errors =
			v.errors ?? (await this.customers.phoneErrors(shop.id, v.data, id));
		if (errors || !v.data) {
			const customer = await this.customers.find(id, shop.id);
			return this.#showPage(req, shop.id, id, customer, { errors });
		}
		if (!(await this.customers.update(id, shop.id, v.data)))
			return HttpResponse.notFoundText();
		return back(req, `/customers/${id}`);
	}

	/**
	 * POST /customers/:id/addresses — add an address to a customer.
	 * PUT /customers/:id/addresses/:address — change one.
	 * @param req The current request.
	 * @returns Back to their page, the page with errors, or 404.
	 */
	async saveAddress(req: BunRequest<"/customers/:id/addresses/:address">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		const addressId = Number(req.params.address) || 0;
		const v = validate(CustomerAddressInput, await HttpRequest.body(req));
		if (v.errors || !v.data) return this.#addressErrors(req, id, v.errors);
		const saved = addressId
			? await this.customers.updateAddress(id, shop.id, addressId, v.data)
			: await this.customers.addAddress(id, shop.id, v.data);
		if (!saved) return HttpResponse.notFoundText();
		if ("errors" in saved && saved.errors)
			return this.#addressErrors(req, id, saved.errors);
		return back(req, `/customers/${id}`);
	}

	/**
	 * DELETE /customers/:id/addresses/:address — remove one address.
	 * @param req The current request.
	 * @returns Back to the customer's page.
	 */
	async destroyAddress(req: BunRequest<"/customers/:id/addresses/:address">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		await this.customers.removeAddress(
			id,
			shop.id,
			Number(req.params.address) || 0,
		);
		return back(req, `/customers/${id}`);
	}

	/**
	 * The customer's page with the errors of a refused address.
	 * @param req The current request.
	 * @param id The customer's id.
	 * @param errors The message per field.
	 * @returns The Customers/Show page.
	 */
	async #addressErrors(req: Request, id: number, errors?: Errors | null) {
		const { shop } = ctx(req);
		const customer = await this.customers.find(id, shop.id);
		return this.#showPage(req, shop.id, id, customer, { errors });
	}

	/**
	 * DELETE /customers/:id — delete a customer; their orders keep their history.
	 * @param req The current request.
	 * @returns A redirect to the list.
	 */
	async destroy(req: BunRequest<"/customers/:id">) {
		const { shop } = ctx(req);
		await this.customers.remove(HttpRequest.idOf(req), shop.id);
		return redirect("/customers");
	}

	/**
	 * A customer's page: the customer with their addresses and their
	 * purchase history.
	 * @param req The current request.
	 * @param shopId Active shop.
	 * @param id The customer's id.
	 * @param customer The customer, as it was found.
	 * @param extra `{ errors }` after a failed save. Left out otherwise.
	 * @returns The Customers/Show page. No orders for a missing customer.
	 */
	async #showPage(
		req: Request,
		shopId: number,
		id: number,
		customer: unknown,
		extra?: { errors: Errors | null | undefined },
	) {
		const { page, perPage } = Paginate.params(req, "customer_orders");
		return inertia(req, "Customers/Show", {
			customer,
			addresses: customer ? await this.customers.addresses(id, shopId) : [],
			orders: customer
				? await this.orders.forCustomer(id, shopId, page, perPage)
				: null,
			payment_methods: await this.methods.list(shopId),
			...extra,
		});
	}
}
