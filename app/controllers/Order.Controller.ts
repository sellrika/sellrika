import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { back, inertia, redirect } from "@xcore/view/Inertia";
import { OrderService } from "@services/sales/Order.Service";
import { PaymentMethodService } from "@services/settings/PaymentMethod.Service";
import { SalesStaffService } from "@services/settings/SalesStaff.Service";
import {
	FulfillmentInput,
	FulfillmentStepsInput,
	OrderItemsInput,
	PaymentInput,
	RefundInput,
	RemoveItemsInput,
	VoidInput,
} from "@validators/Order.Validator";
import { validate, type Errors } from "@validators/validate";
import type { OrderFilters } from "@repositories/Order.Repository";
import {
	ORDER_SOURCE_FILTERS,
	ORDER_STATUS_FILTERS,
} from "@constants/Order.Constant";
import type { OrderFull } from "@models/Order";

/**
 * Order history: browsing sales.
 * Admins may also refund or void them.
 */
@Service()
export class OrderController {
	constructor(
		private orders: OrderService,
		private methods: PaymentMethodService,
		private salesStaff: SalesStaffService,
	) {}

	/**
	 * GET /orders — the order list with its headline stats.
	 * The filters are in the query string: `q`, `method`, `cashier`,
	 * `sales`, `status`, `source`, `fulfillment`, `customer`, `page`.
	 * @param req The current request.
	 * @returns The Orders/Index page.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		const q = new Query(req);
		const status = q.raw("status") ?? "all";
		const source = q.raw("source") ?? "all";
		const fulfillment = q.raw("fulfillment") ?? "all";
		const filters: OrderFilters = {
			q: q.text("q"),
			method: q.raw("method") || "all",
			status: (ORDER_STATUS_FILTERS.has(status)
				? status
				: "all") as OrderFilters["status"],
			customerId: q.id("customer"),
			cashierId: q.id("cashier"),
			salesStaffId: q.id("sales"),
			source: (ORDER_SOURCE_FILTERS.has(source)
				? source
				: "all") as OrderFilters["source"],
			fulfillment: shop.fulfillment_steps.some((s) => s.key === fulfillment)
				? fulfillment
				: "all",
		};
		const { page, perPage } = Paginate.params(req, "orders");
		return inertia(req, "Orders/Index", {
			// functions: Inertia runs them side by side
			orders: () => this.orders.page(shop.id, filters, page, perPage),
			stats: () => this.orders.stats(shop.id, shop.timezone),
			payment_methods: () => this.methods.list(shop.id),
			order_methods: () => this.orders.methodNames(shop.id),
			cashiers: () => this.orders.cashiers(shop.id),
			sales_staff: () => this.salesStaff.options(shop.id),
			filters: {
				q: filters.q,
				method: filters.method,
				cashier: filters.cashierId,
				sales: filters.salesStaffId,
				status: filters.status,
				customer: filters.customerId,
				source: filters.source,
				fulfillment: filters.fulfillment,
			},
		});
	}

	/**
	 * GET /orders/:id — one order with its lines, refunds and void info.
	 * @param req The current request.
	 * @returns The Orders/Show page, or 404.
	 */
	async show(req: BunRequest<"/orders/:id">) {
		const { shop } = ctx(req);
		const order = await this.orders.find(HttpRequest.idOf(req), shop.id);
		if (!order) return HttpResponse.notFoundText();
		return this.#showPage(req, order, shop.id);
	}

	/**
	 * JSON API (admin): POST /orders/:id/refund — money back.
	 * The returned units may be put back in stock.
	 * @param req The current request.
	 * @returns 201 `{ refund }`, or 422 `{ errors }`.
	 */
	async refund(req: BunRequest<"/orders/:id/refund">) {
		const { shop, user } = ctx(req);
		const v = validate(RefundInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.orders.refund(
			HttpRequest.idOf(req),
			shop.id,
			user.id,
			v.data,
		);
		return "errors" in r
			? json({ errors: r.errors }, 422)
			: json({ refund: r.refund }, 201);
	}

	/**
	 * PUT /orders/:id/fulfillment (admin + cashier, Inertia form).
	 * It moves an online order along and keeps its tracking number.
	 * Reaching "shipped" emails the buyer.
	 * @param req The current request.
	 * @returns Back to the order, or the order page with the refusal on it.
	 */
	async fulfillment(req: BunRequest<"/orders/:id/fulfillment">) {
		const { shop } = ctx(req);
		const id = HttpRequest.idOf(req);
		const v = validate(FulfillmentInput, await HttpRequest.body(req));
		const err =
			v.errors?.fulfillment ??
			v.errors?.tracking ??
			(await this.orders.setFulfillment(id, shop.id, v.data!));
		if (!err) return back(req, `/orders/${id}`);
		const order = await this.orders.find(id, shop.id);
		return this.#showPage(req, order, shop.id, { fulfillment: err });
	}

	/**
	 * JSON API (admin): PUT /orders/steps — the delivery steps
	 * of the shop's online orders.
	 * @param req The current request.
	 * @returns 200 `{ ok }`, or 422 `{ errors }`.
	 */
	async steps(req: Request) {
		const { shop } = ctx(req);
		const v = validate(FulfillmentStepsInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const err = await this.orders.saveSteps(shop, v.data);
		if (err) return HttpResponse.unprocessable({ steps: err });
		return json({ ok: true });
	}

	/**
	 * JSON API (admin + cashier): POST /orders/:id/payments.
	 * Money received for an unpaid or partly paid order:
	 * cash on delivery collected, bank transfer seen.
	 * @param req The current request.
	 * @returns 201 `{ paid, payment_status }`, or 422 `{ errors }`.
	 */
	async payment(req: BunRequest<"/orders/:id/payments">) {
		const { shop } = ctx(req);
		const v = validate(PaymentInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.orders.recordPayment(
			HttpRequest.idOf(req),
			shop.id,
			v.data,
		);
		return "errors" in r ? json({ errors: r.errors }, 422) : json(r, 201);
	}

	/**
	 * JSON API (every role): POST /orders/:id/items.
	 * It adds lines to an order that is not paid in full yet.
	 * The Sell screen posts its cart here when it was opened
	 * for an order (`/pos?order=`).
	 * @param req The current request.
	 * @returns 201 `{ order }`, or 422 `{ errors }`.
	 */
	async addItems(req: BunRequest<"/orders/:id/items">) {
		const { shop, user } = ctx(req);
		const v = validate(OrderItemsInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.orders.addItems(
			HttpRequest.idOf(req),
			shop.id,
			user.id,
			v.data,
		);
		return r.errors
			? HttpResponse.unprocessable(r.errors)
			: json({ order: r.order }, 201);
	}

	/**
	 * JSON API (every role): POST /orders/:id/items/remove.
	 * It takes units off an order that is not paid in full yet.
	 * @param req The current request.
	 * @returns 201 `{ order }`, or 422 `{ errors }`.
	 */
	async removeItems(req: BunRequest<"/orders/:id/items/remove">) {
		const { shop, user } = ctx(req);
		const v = validate(RemoveItemsInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const id = HttpRequest.idOf(req);
		const r = await this.orders.removeItems(id, shop.id, user.id, v.data);
		return r.errors
			? HttpResponse.unprocessable(r.errors)
			: json({ order: r.order }, 201);
	}

	/**
	 * Admin: POST /orders/:id/void — undo a sale entirely.
	 * Stock goes back and reports ignore it.
	 * @param req The current request.
	 * @returns A redirect to the order, or the order page
	 *   with the refusal on it.
	 */
	async void(req: BunRequest<"/orders/:id/void">) {
		const { shop, user } = ctx(req);
		const id = HttpRequest.idOf(req);
		const v = validate(VoidInput, await HttpRequest.body(req));
		const err =
			v.errors?.reason ??
			(await this.orders.void(id, shop.id, user.id, v.data ?? { reason: "" }));
		if (!err) return redirect(`/orders/${id}`);
		const order = await this.orders.find(id, shop.id);
		return this.#showPage(req, order, shop.id, { void: err });
	}

	/**
	 * The order page.
	 * @param req The current request.
	 * @param order The order, as it was found.
	 * @param shopId Active shop.
	 * @param errors Inertia errors to show, if any.
	 * @returns The Orders/Show page.
	 */
	async #showPage(
		req: Request,
		order: OrderFull | null | undefined,
		shopId: number,
		errors?: Errors,
	) {
		return inertia(req, "Orders/Show", {
			order,
			payment_methods: await this.methods.list(shopId),
			sales_staff: await this.salesStaff.options(shopId, true),
			...(errors && { errors }),
		});
	}
}
