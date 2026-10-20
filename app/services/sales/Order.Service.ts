import { I18n, t } from "@xcore/i18n/I18n";
import { OrderImages } from "@xcore/storage/OrderImages";
import { Service } from "@xcore/di";
import { CustomerRepository } from "@repositories/Customer.Repository";
import { CouponRepository } from "@repositories/Coupon.Repository";
import {
	OrderRepository,
	OutOfStockError,
	type OrderFilters,
} from "@repositories/Order.Repository";
import { PaymentMethodRepository } from "@repositories/PaymentMethod.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { SalesStaffRepository } from "@repositories/SalesStaff.Repository";
import type { Order, OrderDetail, OrderFull, OrderItem } from "@models/Order";
import { oneAtATime } from "@helpers/lock";
import { formatMoney } from "@helpers/currency";
import type { FulfillmentStep, PaymentStatus } from "@constants/Order.Constant";
import type { Shop } from "@models/Shop";
import type { Key } from "@i18n";
import type {
	CheckoutInput,
	CouponQuoteInput,
	FulfillmentInput,
	FulfillmentStepsInput,
	OrderCreateInput,
	OrderItemsInput,
	PaymentInput,
	RefundInput,
	OrderDiscountInput,
	RemoveItemsInput,
	VoidInput,
} from "@validators/Order.Validator";
import { OrderMailService } from "./OrderMail.Service";
import { frozenTax, orderTotals } from "@helpers/tax";
import { discountAmount } from "@helpers/discount";
import {
	type CouponLine,
	type CouponResult,
	CouponService,
} from "./Coupon.Service";
import { type CartItem, CartPricer } from "./CartPricer.Service";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";

type Errors = Record<string, string>;

/**
 * What changing an open order answers: the order after it, or why not.
 */
type OrderChange =
	| { order: OrderFull; errors?: never }
	| { errors: Errors; order?: never };

/**
 * A code that passed every rule at the till.
 * Its type is narrowed to percent | fixed.
 * `email` is the address the use counts against.
 */
type TillCoupon = CouponResult & { type: "percent" | "fixed"; email: string };

/**
 * One line of a request that names an order line and a quantity.
 */
type LineQty = { order_item_id: number; qty: number };

/**
 * Selling, refunding and voiding at the POS.
 * The money rules of an order.
 */
@Service()
export class OrderService {
	constructor(
		private orders: OrderRepository,
		private pricer: CartPricer,
		private customers: CustomerRepository,
		private methods: PaymentMethodRepository,
		private shops: ShopRepository,
		private orderMail: OrderMailService,
		private coupons: CouponRepository,
		private couponRules: CouponService,
		private extensions: ExtensionService,
		private salesStaff: SalesStaffRepository,
		private limits: PlanLimitService,
	) {}

	/**
	 * One page of orders for the Orders screen.
	 * @param shopId Owning shop.
	 * @param f Search text, payment method, status and customer filters.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of orders with their lines.
	 */
	page(shopId: number, f: OrderFilters, page: number, perPage: number) {
		return this.orders.pageForShop(shopId, f, page, perPage);
	}

	/**
	 * The staff who made sales in this shop.
	 * For the Orders screen's cashier filter.
	 * @param shopId Owning shop.
	 * @returns Id and name, A–Z.
	 */
	cashiers(shopId: number) {
		return this.orders.cashiers(shopId);
	}

	/**
	 * Every payment name used on the shop's orders.
	 * For the Orders screen's payment filter.
	 * @param shopId Owning shop.
	 * @returns Distinct names, A–Z.
	 */
	methodNames(shopId: number) {
		return this.orders.methodNames(shopId);
	}

	/**
	 * Full detail of one order.
	 * @param id Order id.
	 * @param shopId Shop it must belong to.
	 * @returns The order with lines, refunds and void info, or null.
	 */
	find(id: number, shopId: number) {
		return this.orders.find(id, shopId);
	}

	/**
	 * Headline numbers for the Orders screen.
	 * @param shopId Owning shop.
	 * @param tz The shop's timezone. It decides where "today" starts.
	 * @returns Today's orders, today's net revenue and the all-time
	 *   average order.
	 */
	stats(shopId: number, tz: string) {
		return this.orders.stats(shopId, tz);
	}

	/**
	 * Orders of one customer, for their detail page.
	 * @param customerId Customer id.
	 * @param shopId Owning shop.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of that customer's orders.
	 */
	forCustomer(
		customerId: number,
		shopId: number,
		page: number,
		perPage: number,
	) {
		return this.orders.forCustomer(customerId, shopId, page, perPage);
	}

	/**
	 * The order a customer can still add items to (their open bill).
	 * @param shopId Owning shop.
	 * @param customerId The customer.
	 * @returns Their newest order that is not paid in full, refunded or
	 *   voided, or null.
	 */
	async openFor(shopId: number, customerId: number) {
		const id = await this.orders.openFor(shopId, customerId);
		return id == null ? null : this.orders.find(id, shopId);
	}

	/**
	 * "Apply" in the cart's discount popover.
	 * Prices the cart and says what a code takes off it.
	 * It runs the same rules as `checkout`.
	 * So the total the till shows is the total that will be charged.
	 * @param shopId Owning shop.
	 * @param input Validated cart, code and the attached customer.
	 * @returns `{quote}` (the code, what it is and the discount in cents),
	 *   or `{errors}` for the code box.
	 */
	async quote(
		shopId: number,
		input: CouponQuoteInput,
	): Promise<
		| {
				quote: {
					code: string;
					type: "percent" | "fixed";
					value: number;
					description: string;
					discount: number;
				};
				errors?: never;
		  }
		| { errors: Errors; quote?: never }
	> {
		const priced = await this.#priceLines(shopId, input.items);
		if (priced.errors) return { errors: { coupon: priced.errors.cart! } };
		const shop = (await this.shops.find(shopId))!;
		const r = await this.#applyCoupon(
			shop,
			input.coupon,
			priced.lines,
			input.customer_id,
		);
		if ("errors" in r) return r;
		return { quote: { ...CouponService.couponQuote(r), type: r.type } };
	}

	/**
	 * Ring up a sale.
	 * Prices, costs and names are re-read from the DB.
	 * The discount is recomputed. A coupon code is re-applied from scratch
	 * and replaces the manual discount.
	 * Stock is checked up front (friendly error) and again atomically
	 * inside the transaction.
	 * @param shopId Owning shop.
	 * @param userId The cashier.
	 * @param input Validated cart, discount / coupon, payment method,
	 *   amount paid and optional customer.
	 * @returns `{order}` on success, or `{errors}` to show on the
	 *   checkout sheet.
	 */
	checkout(shopId: number, userId: number, input: CheckoutInput) {
		// one sale per code at a time, until the use is written
		return this.couponRules.oneAtATime(shopId, input.coupon ?? "", () =>
			this.#ringUp(shopId, userId, input),
		);
	}

	/**
	 * Make an order, the one way in for the REST API and for extensions.
	 * With `paid` it is a sale, like the till rings up (`checkout`).
	 * Without `paid` it is written unpaid, to be paid later (`open`).
	 * @param shopId Owning shop.
	 * @param userId Who makes it.
	 * @param input Validated order: lines, and the payment when it is paid now.
	 * @returns `{order}` on success, or `{errors}`.
	 */
	create(shopId: number, userId: number, input: OrderCreateInput) {
		return input.paid
			? this.checkout(shopId, userId, input)
			: this.open(shopId, userId, input);
	}

	/**
	 * Open an order that is paid later (a table's bill, a tab).
	 * Prices are re-read from the DB and the stock is taken now, like a sale.
	 * No discount and no code: those belong to the checkout.
	 * @param shopId Owning shop.
	 * @param userId Who opens it.
	 * @param input Validated lines, optional customer, sales person,
	 *   payment name and note.
	 * @returns `{order}` on success, or `{errors}`.
	 */
	async open(
		shopId: number,
		userId: number,
		input: Pick<
			OrderCreateInput,
			"items" | "customer_id" | "payment_method" | "note" | "sales_staff_id"
		>,
	): Promise<
		{ order: OrderFull; errors?: never } | { errors: Errors; order?: never }
	> {
		const full = await this.limits.orderError(shopId);
		if (full) return { errors: { cart: full } };
		if (await this.#customerGone(shopId, input.customer_id))
			return { errors: { customer_id: t("server.order_customer_gone") } };
		// the sales person is optional
		const { seller, gone } = await this.#sellerOf(shopId, input.sales_staff_id);
		if (gone) return { errors: { cart: t("server.order_sales_staff_gone") } };
		const priced = await this.#priceLines(shopId, input.items);
		if (priced.errors) return { errors: priced.errors };
		const { lines, subtotal } = priced;
		const shop = (await this.shops.find(shopId))!;
		const { tax, total } = orderTotals(shop, { subtotal });
		const stockMark = await this.extensions.stockMark(shopId);
		const items = await OrderImages.copyAll(lines, shopId);
		try {
			const order = await this.orders.create(
				{
					shop_id: shopId,
					user_id: userId,
					customer_id: input.customer_id,
					subtotal,
					discount_type: null,
					discount_value: 0,
					discount: 0,
					delivery_fee: 0,
					tax,
					...frozenTax(shop),
					total,
					paid: 0,
					change: 0,
					payment_method: input.payment_method || t("server.order_pay_later"),
					// unpaid, unless there is nothing to pay
					payment_status: OrderRepository.paymentStatus(0, total),
					fulfillment: "",
					note: input.note,
					sales_staff_id: seller?.id ?? null,
				},
				items,
			);
			const full = (await this.orders.find(order.id, shopId)) ?? order;
			void this.extensions.emit("order.created", shop, { order: full });
			void this.extensions.stockMoved(shopId, stockMark, { orderId: order.id });
			return { order: full };
		} catch (e) {
			// no order, so nothing holds these copies
			await OrderImages.drop(items);
			if (e instanceof OutOfStockError)
				return {
					errors: { cart: CartPricer.stockMessage(e.item, e.available) },
				};
			throw e;
		}
	}

	/**
	 * Add lines to an order that is not paid in full yet.
	 * The stock is taken, the totals and the tax are worked out again, and
	 * one `order_history` row keeps the order before and after.
	 * Runs one at a time per order, so two rounds sent together both land.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param userId Who adds them.
	 * @param input Validated lines.
	 * @returns `{order, added}` (the order after, and the new lines),
	 *   or `{errors}`.
	 */
	addItems(
		orderId: number,
		shopId: number,
		userId: number,
		input: OrderItemsInput,
	) {
		return oneAtATime(`order:${orderId}`, () =>
			this.#appendItems(orderId, shopId, userId, input),
		);
	}

	/**
	 * Take units off an order that is not paid in full yet.
	 * Their stock goes back, the totals and the tax are worked out again,
	 * and one `order_history` row keeps the order before and after.
	 * The last line can't go (void the order instead).
	 * The total can't drop under the money already received.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param userId Who removes them.
	 * @param input Validated lines and how many units leave each.
	 * @returns `{order}` (the order after), or `{errors}`.
	 */
	removeItems(
		orderId: number,
		shopId: number,
		userId: number,
		input: RemoveItemsInput,
	) {
		return oneAtATime(`order:${orderId}`, () =>
			this.#dropItems(orderId, shopId, userId, input),
		);
	}

	/**
	 * Give an order that is not paid in full to another customer of the shop.
	 * For example a restaurant table's bill moving to another table.
	 * Its lines and money stay as they are.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param customerId The new customer.
	 * @returns `{order}` (the order after), or `{errors}`.
	 */
	moveTo(
		orderId: number,
		shopId: number,
		customerId: number,
	): Promise<OrderChange> {
		return oneAtATime(`order:${orderId}`, () =>
			this.#reassign(orderId, shopId, customerId),
		);
	}

	/**
	 * Join two orders that are not paid yet into one.
	 * For example two restaurant tables sharing one bill.
	 * Every line of `fromId` moves to `intoId`.
	 * The totals and tax of `intoId` are worked out again
	 * (one `order_history` row), and `fromId` is gone.
	 * Stock does not move.
	 * The order that goes may not have money received or a discount on it.
	 * @param fromId The order that goes.
	 * @param intoId The order that stays.
	 * @param shopId Shop both must belong to.
	 * @param userId Who joins them.
	 * @returns `{order}` (the joined order), or `{errors}`.
	 */
	join(
		fromId: number,
		intoId: number,
		shopId: number,
		userId: number,
	): Promise<OrderChange> {
		if (fromId === intoId)
			return Promise.resolve({
				errors: { order: t("server.order_join_same") },
			});
		// Both locks, the lower id first.
		// So two joins the other way round can't wait on each other.
		const [first, second] = [fromId, intoId].sort((a, b) => a - b);
		return oneAtATime(`order:${first}`, () =>
			oneAtATime(`order:${second}`, () =>
				this.#merge(fromId, intoId, shopId, userId),
			),
		);
	}

	/**
	 * Give an order that is not paid in full a discount, change it or
	 * take it off.
	 * Percent / fixed like the till's, or a discount code (which
	 * replaces them).
	 * The tax and the total are worked out again.
	 * A code's use is recorded, the old code's given back.
	 * ponytail: POS orders only (an online order's code may also waive
	 * its delivery fee), and no `order_history` row. The order itself
	 * shows the discount.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param input Validated discount type + value, or a code.
	 * @returns `{order}` (the order after), or `{errors}`.
	 */
	setDiscount(
		orderId: number,
		shopId: number,
		input: OrderDiscountInput,
	): Promise<OrderChange> {
		return this.couponRules.oneAtATime(shopId, input.coupon ?? "", () =>
			oneAtATime(`order:${orderId}`, () =>
				this.#discountOrder(orderId, shopId, input),
			),
		);
	}

	/**
	 * Refund part or all of an order (money-only, with optional restock).
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param userId Who is doing it.
	 * @param input Validated amount, reason, restock flag and returned units.
	 * @returns `{refund}` on success, or `{errors}`.
	 */
	async refund(
		orderId: number,
		shopId: number,
		userId: number,
		input: RefundInput,
	) {
		const order = await this.orders.find(orderId, shopId);
		if (!order)
			return { errors: { order: t("server.order_not_found") } as Errors };
		if (order.status === "voided")
			return { errors: { order: t("server.order_voided") } as Errors };
		// Only money that actually came in can go back:
		// what was handed over less the change, less earlier refunds.
		const remaining = this.#refundable(order);
		if (order.payment_status === "unpaid")
			return {
				errors: {
					order: t("server.order_nothing_paid"),
				} as Errors,
			};
		if (remaining <= 0)
			return {
				errors: { order: t("server.order_fully_refunded") } as Errors,
			};
		if (input.amount > remaining)
			return {
				errors: {
					amount: t("server.order_refund_max", {
						amount: await this.#money(remaining, shopId),
					}),
				} as Errors,
			};
		const lines: OrderItem[] = order.items;
		const matched = this.#matchLines(
			lines,
			input.items,
			(l) => this.#returnable(l),
			"server.order_return_max",
		);
		if (matched.errors) return { errors: matched.errors };
		const stockMark = await this.extensions.stockMark(shopId);
		const refund = await this.orders.refund(order, userId, input, lines);
		if (!refund) return this.#refundRaced(orderId, shopId);
		const after = await this.#changed(order, shopId);
		if (after) {
			void this.extensions.emit("order.refunded", shopId, {
				order: after,
				refund,
			});
			void this.extensions.stockMoved(shopId, stockMark, { orderId: order.id });
		}
		return { refund };
	}

	/**
	 * Money arrived for an unpaid / partly paid order.
	 * For example cash on delivery collected, or a bank transfer seen.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param input Validated cents received, and optionally the payment
	 *   method, the cash handed over (the change) and the sales person.
	 * @returns The new paid total + payment status, or `{errors}`.
	 */
	async recordPayment(
		orderId: number,
		shopId: number,
		input: PaymentInput,
	): Promise<
		| { paid: number; payment_status: PaymentStatus; errors?: never }
		| { errors: Errors; paid?: never; payment_status?: never }
	> {
		const order = await this.orders.find(orderId, shopId);
		if (!order) return { errors: { order: t("server.order_not_found") } };
		if (order.status === "voided")
			return { errors: { order: t("server.order_voided") } };
		const due = order.total - (order.paid - order.change);
		if (due <= 0) return { errors: { amount: t("server.order_already_paid") } };
		if (input.amount > due)
			return {
				errors: {
					amount: t("server.order_due_max", {
						amount: await this.#money(due, shopId),
					}),
				},
			};
		if (
			input.payment_method != null &&
			!(await this.methods.usable(shopId, input.payment_method))
		)
			return {
				errors: { payment_method: t("server.order_method_unavailable") },
			};
		if ((await this.#sellerOf(shopId, input.sales_staff_id)).gone)
			return {
				errors: { sales_staff_id: t("server.order_sales_staff_gone") },
			};
		const r = await this.orders.addPayment(order, input.amount, {
			// change is given only when the order is paid off
			change:
				input.amount === due
					? Math.max(0, (input.tendered ?? 0) - input.amount)
					: 0,
			payment_method: input.payment_method,
			sales_staff_id: input.sales_staff_id,
		});
		// another payment got there first
		if (!r) return { errors: { amount: t("server.order_already_paid") } };
		const ref = input.payment_ref || undefined;
		this.#paidNow(await this.#changed(order, shopId, ref), shopId, ref);
		return r;
	}

	/**
	 * Move an online order along the shop's delivery steps and keep its
	 * tracking number.
	 * Reaching "shipped" emails the buyer once.
	 * The email is fire-and-forget, a silent no-op when email is off.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param input Validated stage + tracking.
	 * @returns An error message, or null on success.
	 */
	async setFulfillment(
		orderId: number,
		shopId: number,
		input: FulfillmentInput,
	): Promise<string | null> {
		const order = await this.orders.find(orderId, shopId);
		if (!order) return t("server.order_not_found");
		if (!order.fulfillment) return t("server.order_online_only_fulfillment");
		if (order.status === "voided") return t("server.order_voided");
		const shop = await this.shops.find(shopId);
		if (!shop?.fulfillment_steps.some((s) => s.key === input.fulfillment))
			return t("validation.pick_delivery_status");
		await this.orders.setFulfillment(
			order.id,
			input.fulfillment,
			input.tracking,
		);
		await this.#changed(order, shopId);
		if (input.fulfillment === "shipped" && order.fulfillment !== "shipped") {
			const to = order.customer_id
				? (await this.customers.find(order.customer_id, shopId))?.email
				: null;
			if (to)
				void this.orderMail.sendShipped(
					shop,
					{ ...order, fulfillment: "shipped", tracking: input.tracking },
					to,
					order.customer?.name,
				);
		}
		return null;
	}

	/**
	 * Save the delivery steps of the shop's online orders.
	 * A step that open orders still sit on cannot be removed.
	 * @param shop The active shop.
	 * @param input Validated steps, in order.
	 * @returns An error message, or null on success.
	 */
	async saveSteps(
		shop: Shop,
		input: FulfillmentStepsInput,
	): Promise<string | null> {
		const keep = new Set(input.steps.map((s) => this.#stepKey(s)));
		const gone = shop.fulfillment_steps.filter((s) => !keep.has(s.key));
		const used = await this.orders.fulfillmentInUse(
			shop.id,
			gone.map((s) => this.#stepKey(s)),
		);
		const step = gone.find((s) => s.key === used);
		if (step) return t("server.step_in_use", { name: this.#stepName(step) });
		await this.shops.updateFulfillmentSteps(shop.id, input.steps);
		return null;
	}

	/**
	 * Void a sale that shouldn't have happened.
	 * Stock goes back and reports ignore it.
	 * Only orders without refunds can be voided.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param userId Who is doing it.
	 * @param input Validated reason.
	 * @returns An error message, or null on success.
	 */
	async void(
		orderId: number,
		shopId: number,
		userId: number,
		input: VoidInput,
	): Promise<string | null> {
		const order = await this.orders.find(orderId, shopId);
		if (!order) return t("server.order_not_found");
		if (order.status === "voided") return t("server.order_already_voided");
		if (order.status !== "completed") return t("server.order_refunded_no_void");
		const stockMark = await this.extensions.stockMark(shopId);
		if (!(await this.orders.void(order, userId, input.reason, order.items))) {
			// someone voided or refunded it a moment ago
			const now = await this.orders.find(orderId, shopId);
			return now?.status === "voided"
				? t("server.order_already_voided")
				: t("server.order_refunded_no_void");
		}
		// the code can be used again
		if (order.coupon_code) await this.coupons.release(order.id);
		const after = await this.#changed(order, shopId);
		if (after) {
			void this.extensions.emit("order.voided", shopId, {
				order: after,
				reason: input.reason,
			});
			void this.extensions.stockMoved(shopId, stockMark, { orderId: order.id });
		}
		return null;
	}

	/**
	 * Default refund for returned units: their share of what was actually paid.
	 * That is the line value less the order's pro-rata discount.
	 * @param order The order's subtotal and total.
	 * @param lines The unit price and returned quantity of each line.
	 * @returns The suggested refund in cents.
	 */
	static refundValue(
		order: Pick<Order, "subtotal" | "total">,
		lines: { price: number; qty: number }[],
	) {
		const gross = CartPricer.linesTotal(lines);
		return order.subtotal
			? Math.round((gross * order.total) / order.subtotal)
			: gross;
	}

	/**
	 * The sale itself.
	 * See `checkout`, which runs it one at a time per discount code.
	 * @param shopId Owning shop.
	 * @param userId The cashier.
	 * @param input Validated cart, discount / coupon, payment method,
	 *   amount paid and optional customer.
	 * @returns `{order}` on success, or `{errors}`.
	 */
	async #ringUp(
		shopId: number,
		userId: number,
		input: CheckoutInput,
	): Promise<
		| { order: Awaited<ReturnType<OrderRepository["create"]>>; errors?: never }
		| { errors: Errors; order?: never }
	> {
		const full = await this.limits.orderError(shopId);
		if (full) return { errors: { cart: full } };
		if (!(await this.methods.usable(shopId, input.payment_method)))
			return { errors: { cart: t("server.order_method_unavailable") } };
		if (await this.#customerGone(shopId, input.customer_id))
			return { errors: { customer_id: t("server.order_customer_gone") } };
		const priced = await this.#priceLines(shopId, input.items);
		if (priced.errors) return { errors: priced.errors };
		const { lines, subtotal } = priced;
		let discount = discountAmount(
				subtotal,
				input.discount_type,
				input.discount_value,
			),
			{ discount_type, discount_value } = input;
		const shop = (await this.shops.find(shopId))!;
		const coupon = input.coupon
			? await this.#applyCoupon(shop, input.coupon, lines, input.customer_id)
			: null;
		if (coupon && "errors" in coupon) return coupon;
		if (coupon)
			({
				discount,
				type: discount_type,
				coupon: { value: discount_value },
			} = coupon);
		// the shop's tax line, frozen on the order
		const { tax, total } = orderTotals(shop, { subtotal, discount });
		if (input.paid < total)
			return { errors: { cart: t("server.order_paid_too_little") } };
		// the sales person is optional
		const { seller, gone } = await this.#sellerOf(shopId, input.sales_staff_id);
		if (gone) return { errors: { cart: t("server.order_sales_staff_gone") } };
		const stockMark = await this.extensions.stockMark(shopId);
		// the order keeps its own copy of each picture:
		// the product may delete its own later
		const items = await OrderImages.copyAll(lines, shopId);
		let placed = false;
		try {
			const order = await this.orders.create(
				{
					shop_id: shopId,
					user_id: userId,
					customer_id: input.customer_id,
					subtotal,
					discount_type: discount ? discount_type : null,
					discount_value: discount ? discount_value : 0,
					discount,
					delivery_fee: 0,
					tax,
					...frozenTax(shop),
					total,
					paid: input.paid,
					change: input.paid - total,
					payment_method: input.payment_method,
					payment_status: "paid",
					fulfillment: "",
					note: "",
					coupon_code: coupon?.coupon.code ?? null,
					sales_staff_id: seller?.id ?? null,
				},
				items,
			);
			placed = true;
			if (coupon) await this.#redeemCoupon(coupon, shopId, order.id);
			// The shop's extensions (webhook…): never awaited, never throws.
			// A POS sale is paid the moment it exists.
			// Re-read first, so listeners get the customer and the cashier,
			// not the bare inserted row.
			const full = (await this.orders.find(order.id, shopId)) ?? order;
			// the reference of an approved payment (a card reader's charge)
			// rides along, so its extension can tie the charge to the order
			const paid = { order: full, payment_ref: input.payment_ref || undefined };
			void this.extensions.emit("order.created", shop, paid);
			void this.extensions.emit("order.paid", shop, paid);
			void this.extensions.stockMoved(shopId, stockMark, { orderId: order.id });
			return { order };
		} catch (e) {
			// no order, so nothing holds these copies
			if (!placed) await OrderImages.drop(items);
			// someone else took it first
			if (e instanceof OutOfStockError)
				return {
					errors: { cart: CartPricer.stockMessage(e.item, e.available) },
				};
			throw e;
		}
	}

	/**
	 * Re-price the cart from the DB, the till's way.
	 * A note is kept as sent: the till sends none, an opened order's
	 * lines may.
	 * @param shopId Owning shop.
	 * @param items The raw cart lines.
	 * @returns The priced lines and their subtotal, or `{errors}` (`cart`)
	 *   when a line is gone, unresolved or out of stock.
	 */
	#priceLines(shopId: number, items: CartItem[]) {
		return this.pricer.price(shopId, items, {
			goneKey: "server.order_item_gone",
			customRequest: false,
		});
	}

	/**
	 * Is the customer named on a request missing from the shop?
	 * @param shopId Owning shop.
	 * @param customerId The customer, or null when none is named.
	 * @returns True when one is named and it does not exist.
	 */
	async #customerGone(shopId: number, customerId: number | null | undefined) {
		return (
			customerId != null && !(await this.customers.find(customerId, shopId))
		);
	}

	/**
	 * The sales person named on a request. Naming one is optional.
	 * @param shopId Owning shop.
	 * @param id The sales person, or null when none is named.
	 * @returns `seller` (null when none is named) and `gone` = one is
	 *   named, but it is missing or switched off.
	 */
	async #sellerOf(shopId: number, id: number | null | undefined) {
		const seller = id == null ? null : await this.salesStaff.find(id, shopId);
		return { seller, gone: id != null && !seller?.active };
	}

	/**
	 * The adding itself.
	 * See `addItems`, which runs it one at a time per order.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param userId Who adds them.
	 * @param input Validated lines.
	 * @returns `{order, added}`, or `{errors}`.
	 */
	async #appendItems(
		orderId: number,
		shopId: number,
		userId: number,
		input: OrderItemsInput,
	): Promise<
		| { order: OrderFull; added: OrderItem[]; errors?: never }
		| { errors: Errors; order?: never; added?: never }
	> {
		const order = await this.#openOrder(orderId, shopId);
		if ("errors" in order) return order;
		const priced = await this.#priceLines(shopId, input.items);
		if (priced.errors) return { errors: priced.errors };
		const totals = this.#totalsOf(order, order.subtotal + priced.subtotal);
		const stockMark = await this.extensions.stockMark(shopId);
		const items = await OrderImages.copyAll(priced.lines, shopId);
		let added: OrderItem[] | null = null;
		try {
			added = await this.orders.addItems(order, userId, items, totals);
		} catch (e) {
			await OrderImages.drop(items);
			if (e instanceof OutOfStockError)
				return {
					errors: { cart: CartPricer.stockMessage(e.item, e.available) },
				};
			throw e;
		}
		if (!added) {
			// paid or voided between our read and our write
			await OrderImages.drop(items);
			return { errors: { order: t("server.order_closed") } };
		}
		const after = await this.#changed(order, shopId);
		if (after) void this.extensions.stockMoved(shopId, stockMark, { orderId });
		return { order: after ?? order, added };
	}

	/**
	 * The removing itself.
	 * See `removeItems`, which runs it one at a time per order.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param userId Who removes them.
	 * @param input Validated lines and how many units leave each.
	 * @returns `{order}`, or `{errors}`.
	 */
	async #dropItems(
		orderId: number,
		shopId: number,
		userId: number,
		input: RemoveItemsInput,
	): Promise<
		{ order: OrderFull; errors?: never } | { errors: Errors; order?: never }
	> {
		const order = await this.#openOrder(orderId, shopId);
		if ("errors" in order) return order;
		const matched = this.#matchLines(
			order.items,
			input.items,
			(l) => this.#removable(l),
			"server.order_remove_max",
		);
		if (matched.errors) return { errors: matched.errors };
		let gone = 0;
		let units = 0;
		for (const l of order.items) units += l.qty;
		for (const { line, qty } of matched.pairs) {
			gone += line.price * qty;
			units -= qty;
		}
		if (units <= 0) return { errors: { order: t("server.order_remove_last") } };
		const totals = this.#totalsOf(order, order.subtotal - gone);
		if (totals.total < order.paid - order.change)
			return { errors: { order: t("server.order_remove_under_paid") } };
		const stockMark = await this.extensions.stockMark(shopId);
		// false = paid or voided between our read and our write
		if (!(await this.orders.removeItems(order, userId, input.items, totals)))
			return { errors: { order: t("server.order_closed") } };
		const after = await this.#changed(order, shopId);
		if (after) void this.extensions.stockMoved(shopId, stockMark, { orderId });
		return { order: after ?? order };
	}

	/**
	 * Check the lines a request names against the order's own lines.
	 * A line must be on the order and be named once.
	 * Its quantity can't pass what the line still allows.
	 * @param lines The order's lines.
	 * @param items The request: an order line id and a quantity each.
	 * @param maxOf How many units a line still allows.
	 * @param maxKey The message when a quantity passes that.
	 * @returns `{pairs}` (each request line with its order line), or
	 *   `{errors}` on the field of the first wrong line.
	 */
	#matchLines(
		lines: OrderItem[],
		items: LineQty[],
		maxOf: (line: OrderItem) => number,
		maxKey: "server.order_remove_max" | "server.order_return_max",
	):
		| { pairs: { line: OrderItem; qty: number }[]; errors?: never }
		| { errors: Errors; pairs?: never } {
		const seen = new Set<number>();
		const pairs: { line: OrderItem; qty: number }[] = [];
		for (const [i, it] of items.entries()) {
			const line = lines.find((l) => l.id === it.order_item_id);
			if (!line || seen.has(it.order_item_id))
				return {
					errors: {
						[`items.${i}.order_item_id`]: t("server.order_invalid_line"),
					},
				};
			seen.add(it.order_item_id);
			const max = maxOf(line);
			if (it.qty > max)
				return {
					errors: {
						[`items.${i}.qty`]: t(maxKey, { count: max, name: line.name }),
					},
				};
			pairs.push({ line, qty: it.qty });
		}
		return { pairs };
	}

	/**
	 * The move itself.
	 * See `moveTo`, which runs it one at a time per order.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param customerId The new customer.
	 * @returns `{order}`, or `{errors}`.
	 */
	async #reassign(
		orderId: number,
		shopId: number,
		customerId: number,
	): Promise<OrderChange> {
		const order = await this.#openOrder(orderId, shopId);
		if ("errors" in order) return order;
		if (await this.#customerGone(shopId, customerId))
			return { errors: { customer_id: t("server.order_customer_gone") } };
		if (!(await this.orders.moveTo(order, customerId)))
			return { errors: { order: t("server.order_closed") } };
		return { order: (await this.#changed(order, shopId)) ?? order };
	}

	/**
	 * The joining itself.
	 * See `join`, which runs it one at a time per order, for both orders.
	 * @param fromId The order that goes.
	 * @param intoId The order that stays.
	 * @param shopId Shop both must belong to.
	 * @param userId Who joins them.
	 * @returns `{order}`, or `{errors}`.
	 */
	async #merge(
		fromId: number,
		intoId: number,
		shopId: number,
		userId: number,
	): Promise<OrderChange> {
		const from = await this.#openOrder(fromId, shopId);
		if ("errors" in from) return from;
		const into = await this.#openOrder(intoId, shopId);
		if ("errors" in into) return into;
		if (from.paid > 0 || from.discount > 0 || from.coupon_code)
			return { errors: { order: t("server.order_join_paid") } };
		const totals = this.#totalsOf(into, into.subtotal + from.subtotal);
		if (!(await this.orders.join(from, into, userId, totals)))
			return { errors: { order: t("server.order_closed") } };
		return { order: (await this.#changed(into, shopId)) ?? into };
	}

	/**
	 * An order that can still change.
	 * It is found in the shop, completed and not paid in full.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @returns The order with its lines, or `{errors}`.
	 */
	async #openOrder(
		orderId: number,
		shopId: number,
	): Promise<OrderDetail | { errors: Errors }> {
		const order = await this.orders.find(orderId, shopId);
		if (!order) return { errors: { order: t("server.order_not_found") } };
		if (order.status === "voided")
			return { errors: { order: t("server.order_voided") } };
		if (order.status !== "completed" || order.payment_status === "paid")
			return { errors: { order: t("server.order_closed") } };
		return order;
	}

	/**
	 * The discount itself.
	 * See `setDiscount`, which runs it one at a time per order and per code.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @param input Validated discount type + value, or a code.
	 * @returns `{order}`, or `{errors}`.
	 */
	async #discountOrder(
		orderId: number,
		shopId: number,
		input: OrderDiscountInput,
	): Promise<OrderChange> {
		const order = await this.#openOrder(orderId, shopId);
		if ("errors" in order) return order;
		if (order.fulfillment !== "")
			return { errors: { order: t("server.order_closed") } };
		const code = input.coupon?.toUpperCase() ?? "";
		if (code && code === order.coupon_code) return { order }; // already on it
		const coupon = code
			? await this.#applyCoupon(
					(await this.shops.find(shopId))!,
					code,
					order.items.map((l) => this.#couponLine(l)),
					order.customer_id,
				)
			: null;
		if (coupon && "errors" in coupon) return coupon;
		const discount = coupon
			? coupon.discount
			: discountAmount(
					order.subtotal,
					input.discount_type,
					input.discount_value,
				);
		// the tax follows the rules frozen on the order
		const { tax, total } = orderTotals(order, {
			subtotal: order.subtotal,
			discount,
			delivery_fee: order.delivery_fee,
		});
		const received = order.paid - order.change;
		if (total < received)
			return { errors: { order: t("server.order_remove_under_paid") } };
		const saved = await this.orders.setDiscount(order, {
			discount_type: discount ? (coupon?.type ?? input.discount_type) : null,
			discount_value: discount
				? (coupon?.coupon.value ?? input.discount_value)
				: 0,
			discount,
			tax,
			total,
			payment_status: OrderRepository.paymentStatus(received, total),
			coupon_code: coupon?.coupon.code ?? null,
		});
		// false = paid or voided between our read and our write
		if (!saved) return { errors: { order: t("server.order_closed") } };
		// the old code can be used again
		if (order.coupon_code) await this.coupons.release(order.id);
		if (coupon) await this.#redeemCoupon(coupon, shopId, order.id);
		const after = await this.#changed(order, shopId);
		this.#paidNow(after, shopId);
		return { order: after ?? order };
	}

	/**
	 * An open order's money once its lines add up to a new subtotal.
	 * A manual percent / fixed discount is worked out again.
	 * The tax follows the rules frozen on the order, not the shop's of today.
	 * ponytail: a code's discount stays as it was (its rules ran on the
	 * first lines only), capped at the subtotal.
	 * @param order The order as read.
	 * @param subtotal The new sum of its lines.
	 * @returns Subtotal, discount, tax, total and the payment status
	 *   they give.
	 */
	#totalsOf(order: Order, subtotal: number) {
		const discount = order.coupon_code
			? Math.min(order.discount, subtotal)
			: discountAmount(subtotal, order.discount_type, order.discount_value);
		const { tax, total } = orderTotals(order, {
			subtotal,
			discount,
			delivery_fee: order.delivery_fee,
		});
		return {
			subtotal,
			discount,
			tax,
			total,
			payment_status: OrderRepository.paymentStatus(
				order.paid - order.change,
				total,
			),
		};
	}

	/**
	 * Run a discount code against the priced cart with
	 * `CouponService.resolve`.
	 * There is no delivery at the till, so a free-delivery code is refused.
	 * The attached customer's email stands in for the checkout email
	 * (customer-only codes, per-customer limits).
	 * @param shop The selling shop.
	 * @param code What the cashier typed.
	 * @param lines The priced cart lines.
	 * @param customerId The attached customer, if any.
	 * @returns The resolved coupon, with its type narrowed to
	 *   percent | fixed and the email it counts against,
	 *   or `{errors}` (`coupon`).
	 */
	async #applyCoupon(
		shop: Shop,
		code: string,
		lines: CouponLine[],
		customerId: number | null,
	): Promise<TillCoupon | { errors: Errors }> {
		const email =
			(customerId != null
				? (await this.customers.find(customerId, shop.id))?.email
				: null) ?? "";
		const r = await this.couponRules.resolve(shop, code, {
			lines,
			delivery_fee: 0,
			email,
			verified: true, // the cashier attached the customer
			customer_id: customerId,
		});
		if ("error" in r) return { errors: { coupon: r.error } };
		const type = r.coupon.type;
		// ponytail: unreachable (resolve refuses it at fee 0).
		// It keeps the type honest.
		if (type === "free_delivery")
			return { errors: { coupon: t("server.coupon_online_only") } };
		return { ...r, type, email };
	}

	/**
	 * Count one use of a code for an order made or changed at the till.
	 * @param coupon The resolved code and the email it counts against.
	 * @param shopId Owning shop.
	 * @param orderId The order that uses it.
	 * @returns When the use is written.
	 */
	#redeemCoupon(coupon: TillCoupon, shopId: number, orderId: number) {
		return this.couponRules.redeem(
			{ id: coupon.coupon.id, saved: coupon.saved },
			shopId,
			orderId,
			coupon.email,
		);
	}

	/**
	 * Another refund or a void got in between our checks and our write.
	 * Say why, with fresh numbers.
	 * @param orderId Order id.
	 * @param shopId Shop it must belong to.
	 * @returns `{errors}` for the refund form.
	 */
	async #refundRaced(orderId: number, shopId: number) {
		const now = await this.orders.find(orderId, shopId);
		if (!now || now.status === "voided")
			return { errors: { order: t("server.order_voided") } as Errors };
		return {
			errors: {
				amount: t("server.order_refund_max", {
					amount: await this.#money(this.#refundable(now), shopId),
				}),
			} as Errors,
		};
	}

	/**
	 * An amount as an error message shows it, e.g. "$27".
	 * @param cents The amount in cents.
	 * @param shopId The shop whose currency it is in.
	 * @returns The formatted amount.
	 */
	async #money(cents: number, shopId: number) {
		const shop = (await this.shops.find(shopId))!;
		return formatMoney(cents, shop.currency, I18n.current());
	}

	/**
	 * After a write to an existing order: re-read it (one query) and
	 * tell the extensions.
	 * `order.updated` always, then one `order.status_changed` per status
	 * field that moved.
	 * The emits themselves are never awaited.
	 * The caller fires its own events after this, with the order it gets
	 * back.
	 * @param before The order as it was before the write.
	 * @param shopId Owning shop.
	 * @param paymentRef The reference of the payment that was recorded,
	 *   when an extension approved it.
	 * @returns The re-read order, or null when it is gone.
	 */
	async #changed(before: Order, shopId: number, paymentRef?: string) {
		const after = await this.orders.find(before.id, shopId);
		if (!after) return null;
		void this.extensions.emit("order.updated", shopId, {
			order: after,
			payment_ref: paymentRef,
		});
		for (const field of ["status", "fulfillment", "payment_status"] as const)
			if (after[field] !== before[field])
				void this.extensions.emit("order.status_changed", shopId, {
					order: after,
					field,
					from: before[field],
					to: after[field],
				});
		return after;
	}

	/**
	 * Tell the extensions an order is paid in full now.
	 * Does nothing while money is still due, or when the order is gone.
	 * @param after The order as re-read after the write, or null.
	 * @param shopId Owning shop.
	 * @param paymentRef The reference of the last payment, when an
	 *   extension approved it.
	 */
	#paidNow(after: OrderFull | null, shopId: number, paymentRef?: string) {
		if (after?.payment_status === "paid")
			void this.extensions.emit("order.paid", shopId, {
				order: after,
				payment_ref: paymentRef,
			});
	}

	/**
	 * Cents that can still go back to the customer.
	 * What came in (less the change handed back) minus earlier refunds.
	 * @param order The order's paid, change and refunded cents.
	 * @returns The refundable cents (0 for an unpaid order).
	 */
	#refundable(order: Pick<Order, "paid" | "change" | "refunded">) {
		return Math.max(0, order.paid - order.change - order.refunded);
	}

	/**
	 * How many units of a line can still be taken off an open order.
	 * @param line The order line.
	 * @returns Every unit on it.
	 */
	#removable(line: OrderItem) {
		return line.qty;
	}

	/**
	 * How many units of a line can still be returned.
	 * @param line The order line.
	 * @returns The units not returned yet.
	 */
	#returnable(line: OrderItem) {
		return line.qty - line.refunded_qty;
	}

	/**
	 * An order line as the coupon rules need it.
	 * @param line The order line.
	 * @returns Its product, price and quantity.
	 */
	#couponLine(line: OrderItem): CouponLine {
		return {
			product_id: line.product_id ?? 0,
			price: line.price,
			qty: line.qty,
		};
	}

	/**
	 * The key of a delivery step.
	 * @param step The step.
	 * @returns Its key.
	 */
	#stepKey(step: FulfillmentStep) {
		return step.key;
	}

	/**
	 * What a delivery step is called, in the request's language.
	 * @param step The step.
	 * @returns The shop's own name, else the built-in one.
	 */
	#stepName(step: FulfillmentStep) {
		return step.label || t(`orders.${step.key}` as Key);
	}
}
