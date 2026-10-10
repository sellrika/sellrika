import type { BunRequest } from "bun";
import { Service } from "@xcore/di";
import { ApiResponse } from "@xcore/api/ApiResponse";
import { ctx } from "@xcore/http/Context";
import { HttpRequest } from "@xcore/http/Request";
import { json } from "@xcore/http/Response";
import { t } from "@xcore/i18n/I18n";
import { OrderService } from "@services/sales/Order.Service";
import {
	FulfillmentInput,
	OrderCreateInput,
	OrderItemsInput,
	PaymentInput,
	RefundInput,
	OrderDiscountInput,
	RemoveItemsInput,
	VoidInput,
} from "@validators/Order.Validator";
import { OrderQuery } from "@validators/ApiQuery.Validator";
import { ApiController } from "./Api.Controller";

/**
 * API: the orders of the key's shop.
 * An order is never deleted.
 * It is created by a sale, then paid, moved along, refunded or voided.
 * Only an order that is not paid yet can still change its lines.
 */
@Service()
export class OrderApiController extends ApiController<object> {
	constructor(private orders: OrderService) {
		super();
	}

	/**
	 * GET /orders — one page of orders, newest first.
	 * The filters are in the query string: `q`, `status`, `source`,
	 * `fulfillment`, `method`, `customer`, `cashier`, `sales`,
	 * `page`, `per_page`.
	 * @param req The current request.
	 * @returns A page of orders with their lines.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		const v = ApiResponse.query(req, OrderQuery);
		if (v.errors) return ApiResponse.invalid(v.errors);
		const f = v.data;
		const step = shop.fulfillment_steps.some(function same(s) {
			return s.key === f.fulfillment;
		});
		if (f.fulfillment !== "all" && !step)
			return ApiResponse.invalid({
				fulfillment: t("validation.pick_delivery_status"),
			});
		return json(
			await this.orders.page(
				shop.id,
				{
					q: f.q,
					method: f.method,
					status: f.status,
					source: f.source,
					fulfillment: f.fulfillment,
					customerId: f.customer ?? null,
					cashierId: f.cashier ?? null,
					salesStaffId: f.sales ?? null,
				},
				f.page,
				f.per_page,
			),
		);
	}

	/**
	 * GET /orders/:id — one order with its lines and refunds.
	 * @param req The current request.
	 * @returns The order, or 404.
	 */
	async show(req: BunRequest) {
		const order = await this.orders.find(
			HttpRequest.idOf(req),
			ctx(req).shop.id,
		);
		return order ? json(order) : ApiResponse.notFound();
	}

	/**
	 * POST /orders — make an order.
	 * With `paid` it is a sale like the POS rings up;
	 * without it the order is written unpaid, to be paid later.
	 * Prices, costs and the discount are worked out on the server; stock is taken.
	 * @param req The current request.
	 * @returns 201 with the order, or 422.
	 */
	async store(req: Request) {
		const { shop, user } = ctx(req);
		const data = await this.input(req, OrderCreateInput);
		if (data instanceof Response) return data;
		const r = await this.orders.create(shop.id, user.id, data);
		return r.errors
			? ApiResponse.invalid(r.errors)
			: ApiResponse.created(r.order);
	}

	/**
	 * POST /orders/:id/items — add lines to an order that is not paid in full yet.
	 * @param req The current request.
	 * @returns The order, 404 or 422.
	 */
	async addItems(req: BunRequest) {
		const { shop, user } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, OrderItemsInput);
		if (data instanceof Response) return data;
		const r = await this.orders.addItems(id, shop.id, user.id, data);
		return r.errors ? ApiResponse.invalid(r.errors) : json(r.order);
	}

	/**
	 * POST /orders/:id/items/remove — take units off an order that is not paid
	 * in full yet.
	 * @param req The current request.
	 * @returns The order, 404 or 422.
	 */
	async removeItems(req: BunRequest) {
		const { shop, user } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, RemoveItemsInput);
		if (data instanceof Response) return data;
		const r = await this.orders.removeItems(id, shop.id, user.id, data);
		return r.errors ? ApiResponse.invalid(r.errors) : json(r.order);
	}

	/**
	 * PUT /orders/:id/discount — give an order that is not paid in full a
	 * discount or a code, or take it off.
	 * @param req The current request.
	 * @returns The order, 404 or 422.
	 */
	async discount(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, OrderDiscountInput);
		if (data instanceof Response) return data;
		const r = await this.orders.setDiscount(id, shop.id, data);
		return r.errors ? ApiResponse.invalid(r.errors) : json(r.order);
	}

	/**
	 * POST /orders/:id/payments — record money received for an unpaid or
	 * partly paid order.
	 * @param req The current request.
	 * @returns 201 `{ paid, payment_status }`, 404 or 422.
	 */
	async payment(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, PaymentInput);
		if (data instanceof Response) return data;
		const r = await this.orders.recordPayment(id, shop.id, data);
		return r.errors ? ApiResponse.invalid(r.errors) : ApiResponse.created(r);
	}

	/**
	 * PUT /orders/:id/fulfillment — move an online order to a delivery step
	 * and keep its tracking number.
	 * Reaching "shipped" emails the buyer once.
	 * @param req The current request.
	 * @returns The order, 404 or 422.
	 */
	async fulfillment(req: BunRequest) {
		const { shop } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, FulfillmentInput);
		if (data instanceof Response) return data;
		const error = await this.orders.setFulfillment(id, shop.id, data);
		if (error) return ApiResponse.invalid({ fulfillment: error });
		return json(await this.orders.find(id, shop.id));
	}

	/**
	 * POST /orders/:id/refunds — give money back, with the option to put the
	 * units back in stock.
	 * @param req The current request.
	 * @returns 201 with the refund, 404 or 422.
	 */
	async refund(req: BunRequest) {
		const { shop, user } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, RefundInput);
		if (data instanceof Response) return data;
		const r = await this.orders.refund(id, shop.id, user.id, data);
		if ("refund" in r) return ApiResponse.created(r.refund);
		return ApiResponse.invalid(r.errors);
	}

	/**
	 * POST /orders/:id/void — undo a sale: stock goes back and reports leave it out.
	 * @param req The current request.
	 * @returns The order, 404 or 422.
	 */
	async void(req: BunRequest) {
		const { shop, user } = ctx(req);
		const own = await this.owned(req);
		if (own instanceof Response) return own;
		const { id } = own;
		const data = await this.input(req, VoidInput);
		if (data instanceof Response) return data;
		const error = await this.orders.void(id, shop.id, user.id, data);
		if (error) return ApiResponse.invalid({ order: error });
		return json(await this.orders.find(id, shop.id));
	}

	/**
	 * One order of a shop.
	 * @param id The record's id.
	 * @param shopId The key's shop.
	 * @returns The order, or nothing when the shop has none with this id.
	 */
	protected find(id: number, shopId: number) {
		return this.orders.find(id, shopId);
	}
}
