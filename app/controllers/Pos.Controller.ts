import { Service } from "@xcore/di";
import { ctx } from "@xcore/http/Context";
import { Paginate } from "@xcore/http/Paginate";
import { HttpRequest, Query } from "@xcore/http/Request";
import { HttpResponse, json } from "@xcore/http/Response";
import { Url } from "@xcore/http/Url";
import { inertia } from "@xcore/view/Inertia";
import { CategoryService } from "@services/catalog/Category.Service";
import { OrderService } from "@services/sales/Order.Service";
import { PaymentMethodService } from "@services/settings/PaymentMethod.Service";
import { ProductService } from "@services/catalog/Product.Service";
import { SalesStaffService } from "@services/settings/SalesStaff.Service";
import { CustomerService } from "@services/sales/Customer.Service";
import {
	CheckoutInput,
	CouponQuoteInput,
	OrderCreateInput,
} from "@validators/Order.Validator";
import { validate } from "@validators/validate";
import { couponErrors } from "@controllers/support/couponErrors";
import { POS_PER_PAGE } from "@constants/Pagination.Constant";

/**
 * The Sell screen: the product grid
 * and the checkout endpoint behind it.
 */
@Service()
export class PosController {
	constructor(
		private catalog: ProductService,
		private categories: CategoryService,
		private methods: PaymentMethodService,
		private orders: OrderService,
		private salesStaff: SalesStaffService,
		private customers: CustomerService,
	) {}

	/**
	 * GET /pos — the Sell screen with the first page of products.
	 * `?order=<id>` opens it for an order that is not paid yet.
	 * The cart is then added to that order.
	 * `?customer=<id>` opens it for a customer's bill.
	 * That is their open order if they have one, else a new unpaid order.
	 * `?back=<path>` is where it goes once the cart is sent.
	 * The default is the order.
	 * `?category=<id>` opens it on that category,
	 * so a refresh keeps the picked one.
	 * @param req The current request.
	 * @returns The Pos/Index page.
	 */
	async index(req: Request) {
		const { shop } = ctx(req);
		const q = new Query(req);
		const customer = Number(q.raw("customer"))
			? await this.customers.find(Number(q.raw("customer")), shop.id)
			: null;
		const orderId =
			Number(q.raw("order")) ||
			(customer && (await this.orders.openFor(shop.id, customer.id))?.id);
		const order = orderId ? await this.orders.find(orderId, shop.id) : null;
		// only an order that can still take lines, or a customer's new bill
		// anything else is the plain Sell screen
		const open =
			order?.status === "completed" && order.payment_status !== "paid";
		const back = q.raw("back") ? Url.samePath(q.raw("back")) : null;
		return inertia(req, "Pos/Index", {
			adding:
				order && open
					? { id: order.id, code: order.reference ?? String(order.id), back }
					: customer
						? {
								id: null,
								code: "",
								customer: { id: customer.id, name: customer.name },
								back,
							}
						: null,
			products: await this.catalog.page(shop.id, "", 1, POS_PER_PAGE, {
				category: Number(q.raw("category")) || null,
				active: true,
			}),
			categories: await this.categories.list(shop.id),
			payment_methods: await this.methods.listEnabled(shop.id),
			sales_staff: await this.salesStaff.options(shop.id, true),
		});
	}

	/**
	 * GET /pos/display — the customer's screen, for a second monitor.
	 * It shows the cart and the total.
	 * It needs no props: the page reads the cart the Sell screen
	 * keeps in this browser.
	 * @param req The current request.
	 * @returns The Pos/Display page.
	 */
	display(req: Request) {
		return inertia(req, "Pos/Display", {});
	}

	/**
	 * JSON API: GET /pos/products?q=&category=&page=&ids=1,2
	 * — one page of products.
	 * `ids` returns exactly those products.
	 * A restored cart and barcode lookups use it.
	 * @param req The current request.
	 * @returns A paginated product list as JSON.
	 */
	async products(req: Request) {
		const { shop } = ctx(req);
		const q = new Query(req);
		const ids = (q.raw("ids") ?? "")
			.split(",")
			.map(Number)
			.filter((n) => n > 0)
			.slice(0, 100);
		const page = Paginate.number(q.raw("page"));
		return json(
			await this.catalog.page(
				shop.id,
				q.text("q"),
				ids.length ? 1 : page,
				ids.length || POS_PER_PAGE,
				{
					category: Number(q.raw("category")) || null,
					ids: ids.length ? ids : undefined,
					active: true,
				},
			),
		);
	}

	/**
	 * JSON API: POST /pos/checkout — ring up the cart.
	 * @param req The current request, carrying the cart and payment details.
	 * @returns 201 `{ order }`, or 422 `{ errors }`.
	 */
	async checkout(req: Request) {
		const { shop, user } = ctx(req);
		const v = validate(CheckoutInput, await HttpRequest.body(req));
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		const r = await this.orders.checkout(shop.id, user.id, v.data);
		return r.errors
			? HttpResponse.unprocessable(r.errors)
			: json({ order: r.order }, 201);
	}

	/**
	 * JSON API: POST /pos/open — save the cart as an order that is paid later.
	 * The order is written unpaid, so items can still be added or removed.
	 * When the customer already has an order not paid in full,
	 * the cart is added to that one instead.
	 * A discount or a code is refused: those belong to a paid sale.
	 * @param req The current request. It carries the cart,
	 *   and the customer and sales person if any.
	 * @returns 201 `{ order }`, or 422 `{ errors }`.
	 */
	async open(req: Request) {
		const { shop, user } = ctx(req);
		// this route never takes money, whatever `paid` the body carries
		const data = (await HttpRequest.body(req)) as object;
		const v = validate(OrderCreateInput, { ...data, paid: 0 });
		if (v.errors) return HttpResponse.unprocessable(v.errors);
		// a customer with a bill still open (a restaurant table)
		// gets one bill: the cart joins it
		const bill =
			v.data.customer_id == null
				? null
				: await this.orders.openFor(shop.id, v.data.customer_id);
		const r = bill
			? await this.orders.addItems(bill.id, shop.id, user.id, {
					items: v.data.items,
				})
			: await this.orders.open(shop.id, user.id, {
					...v.data,
					payment_method: "", // shown as "Pay later"
				});
		return r.errors
			? HttpResponse.unprocessable(r.errors)
			: json({ order: r.order }, 201);
	}

	/**
	 * JSON API: POST /pos/coupon — what a discount code takes off
	 * the cart, before charging.
	 * @param req The current request. It carries the cart, the code
	 *   and the attached customer.
	 * @returns `{ quote }`, or 422 `{ errors }`.
	 *   `coupon` = the message for the code box.
	 */
	async coupon(req: Request) {
		const { shop } = ctx(req);
		const v = validate(CouponQuoteInput, await HttpRequest.body(req));
		if (v.errors)
			return HttpResponse.unprocessable(
				couponErrors(v.errors, "server.coupon_invalid"),
			);
		const r = await this.orders.quote(shop.id, v.data);
		return r.errors
			? HttpResponse.unprocessable(r.errors)
			: json({ quote: r.quote });
	}
}
