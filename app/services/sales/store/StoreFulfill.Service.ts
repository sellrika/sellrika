import { Service } from "@xcore/di";
import { t } from "@xcore/i18n/I18n";
import { OrderImages } from "@xcore/storage/OrderImages";
import type { Shop } from "@models/Shop";
import type { OrderFull } from "@models/Order";
import { CustomerRepository } from "@repositories/Customer.Repository";
import { CustomerAddressRepository } from "@repositories/CustomerAddress.Repository";
import {
	OrderRepository,
	OutOfStockError,
	type NewItem,
} from "@repositories/Order.Repository";
import {
	StoreCartRepository,
	type StoreCart,
	type StoreCustomer,
} from "@repositories/StoreCart.Repository";
import { UserRepository } from "@repositories/User.Repository";
import { OrderMailService } from "@services/sales/OrderMail.Service";
import { OrderAlertService } from "@services/sales/OrderAlert.Service";
import { CouponService } from "@services/sales/Coupon.Service";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import type {
	HostedPayment,
	PaymentStatus,
} from "@services/settings/extensions/types/Extension.Payments.Types";
import { CartPricer } from "@services/sales/CartPricer.Service";
import { STORE_DIRECT, STORE_SYSTEM_EMAIL } from "@constants/Store.Constant";
import { StorePaymentService } from "./StorePayment.Service";

/**
 * What `fulfill` answers.
 * `{order}` when it's done.
 * `{pending}` (with the `qr` still to scan) while the payment hasn't landed.
 * `{failed, reason}` when the provider says it never will.
 * `{error}` for an unknown session.
 */
export type FulfillResult = {
	order?: OrderFull;
	pending?: boolean;
	qr?: string;
	failed?: boolean;
	reason?: string | null;
	error?: string;
};

/**
 * Where a checkout's money stands.
 * `label` is the payment name the order keeps.
 * `stop` is the answer for a checkout that can't become an order yet.
 */
type Settled =
	| { label: string; payment: PaymentStatus; stop?: never }
	| { stop: FulfillResult; label?: never; payment?: never };

/**
 * What is known about a buyer: from the checkout page, or the gateway.
 */
type Buyer = {
	email?: string | null;
	name?: string | null;
	phone?: string | null;
} | null;

/**
 * Turns a paid (or unpaid by design) checkout into an order, once.
 */
@Service()
export class StoreFulfillService {
	constructor(
		private orders: OrderRepository,
		private carts: StoreCartRepository,
		private customers: CustomerRepository,
		private addresses: CustomerAddressRepository,
		private users: UserRepository,
		private orderMail: OrderMailService,
		private alerts: OrderAlertService,
		private coupons: CouponService,
		private extensions: ExtensionService,
		private payments: StorePaymentService,
	) {}

	/**
	 * "Track my order": the order by its public code.
	 * Only for whoever also knows the buyer's email or phone.
	 * @param shop The shop whose store the lookup runs on.
	 * @param code The public order code (normalised, `P8J4-MJSQ-4Z8T`).
	 * @param contact The email or phone they ordered with.
	 * @returns The order with its lines, or null.
	 */
	track(shop: Shop, code: string, contact: string) {
		return this.orders.findForBuyer(code, shop.id, contact);
	}

	/**
	 * The customer came back from the gateway.
	 * Verify the payment, then turn the cart snapshot into an order, once.
	 * Concurrent returns see the same order.
	 * A manual option (cash on delivery, bank transfer) and an order sent
	 * straight from the cart have nothing to verify: the order is written
	 * unpaid.
	 * Either way the buyer is emailed a confirmation, fire-and-forget.
	 * @param shop The selling shop.
	 * @param sessionId The `sid` the customer came back with.
	 * @returns `{order}` when it's done.
	 *   `{pending}` (with the `qr` still to scan) while the payment
	 *   hasn't landed.
	 *   `{failed, reason}` when the provider says it never will.
	 *   Nothing is recorded for that.
	 *   `{error}` for an unknown session.
	 */
	async fulfill(shop: Shop, sessionId: string): Promise<FulfillResult> {
		const cart = await this.carts.bySession(shop.id, sessionId);
		if (!cart) return { error: t("store_server.unknown_session") };
		if (cart.order_id)
			return { order: await this.#orderOf(cart.order_id, shop.id) };
		const settled = await this.#settle(shop, cart, sessionId);
		if (settled.stop) return settled.stop;
		const { label, payment } = settled;
		if (!(await this.carts.claim(cart.id))) {
			// another tab/request is creating the order right now
			const again = await this.carts.bySession(shop.id, sessionId);
			return again?.order_id
				? { order: await this.#orderOf(again.order_id, shop.id) }
				: { pending: true };
		}
		try {
			return { order: await this.#place(shop, cart, label, payment) };
		} catch (e) {
			// release the claim so a retry can fulfil
			await this.carts.attachOrder(cart.id, null);
			// nothing was paid: the buyer is told, and no order is written
			if (e instanceof OutOfStockError && !payment.paid)
				return { error: CartPricer.stockMessage(e.item, e.available) };
			throw e;
		}
	}

	/**
	 * The hidden, deactivated user that online orders are signed by.
	 * Created on first use.
	 * @returns That user.
	 */
	async systemUser() {
		const existing = await this.users.findByEmail(STORE_SYSTEM_EMAIL);
		if (existing) return existing;
		// One system user for every shop's online orders.
		// It is in no account's staff list (owner = null).
		const u = await this.users.create(
			{
				name: "Online Store",
				email: STORE_SYSTEM_EMAIL,
				role: "cashier",
				password: "",
			},
			await Bun.password.hash(crypto.randomUUID()),
			null,
		);
		// deactivated, so it can't log in
		await this.users.update(
			u.id,
			{
				name: u.name,
				email: u.email,
				role: "cashier",
				active: false,
				password: "",
			},
			null,
		);
		return u;
	}

	/**
	 * An order a cart already became.
	 * @param orderId The order id on the cart.
	 * @param shopId Owning shop.
	 * @returns The order with its lines, or undefined when it is gone.
	 */
	async #orderOf(orderId: number, shopId: number) {
		return (await this.orders.find(orderId, shopId)) ?? undefined;
	}

	/**
	 * Where a checkout's money stands, and the payment name its order keeps.
	 * A direct order and a manual option have nothing to verify.
	 * A gateway is asked about the payment.
	 * @param shop The selling shop.
	 * @param cart The cart snapshot.
	 * @param sessionId The `sid` the customer came back with.
	 * @returns `{label, payment}`, or `{stop}` with the answer for a
	 *   checkout that is pending, failed, or has no gateway.
	 */
	async #settle(
		shop: Shop,
		cart: StoreCart,
		sessionId: string,
	): Promise<Settled> {
		const direct = cart.payload.gateway === STORE_DIRECT;
		const manual =
			!direct && cart.payload.gateway
				? this.payments.manualOf(shop, cart.payload.gateway)
				: null;
		// sent straight from the cart:
		// the shop takes the money itself, later
		if (direct)
			return {
				label: t("server.order_pay_later"),
				payment: { paid: false, buyer: null },
			};
		// cash on delivery with nothing delivered
		// is paid when the buyer picks it up
		if (manual)
			return {
				label:
					manual.key === "cod" && cart.payload.pickup
						? t("store.pay_at_pickup")
						: manual.label,
				payment: { paid: false, buyer: null },
			};
		const g = await this.payments.gatewayOf(shop);
		if ("errors" in g) return { stop: { error: g.errors.cart! } };
		// A tokenising gateway's rows are keyed by our own ref.
		// The payment is looked up by the charge id `pay` stored in the
		// snapshot. Until that exists no card has been submitted at all.
		if (g.ext.payment!.mode === "tokenize" && !cart.payload.charge_id)
			return { stop: { pending: true } };
		// The code's hold ran out, or the shop switched the code off since:
		// a gateway that would take the money only now must not take it.
		const capture =
			!cart.payload.coupon || (await this.coupons.stillHeld(shop, cart));
		const payment = await (g.payment as HostedPayment).getPayment(
			g.config,
			cart.payload.charge_id ?? sessionId,
			{ capture },
		);
		if (payment.failed)
			return {
				stop: {
					failed: true,
					reason: payment.reason ? g.t(payment.reason) : null,
				},
			};
		if (!payment.paid) return { stop: { pending: true, qr: cart.payload.qr } };
		return { label: g.ext.name, payment };
	}

	/**
	 * Write the order of a claimed cart, and tell everyone.
	 * Runs once per cart: only the request that claimed it gets here.
	 * @param shop The selling shop.
	 * @param cart The cart snapshot.
	 * @param label The payment name the order keeps.
	 * @param payment Whether it is paid, and what the gateway knows of
	 *   the buyer.
	 * @returns The new order.
	 */
	async #place(
		shop: Shop,
		cart: StoreCart,
		label: string,
		payment: PaymentStatus,
	): Promise<OrderFull> {
		const coupon = cart.payload.coupon;
		// A percent/fixed code is stored the way a POS discount is.
		// Free delivery shows as a 0 fee + the code.
		const discountType =
			coupon && coupon.type !== "free_delivery" ? coupon.type : null;
		const base = {
			shop_id: shop.id,
			user_id: (await this.systemUser()).id,
			// A signed-in customer owns the order outright.
			// A guest is matched by what they typed on our page,
			// which beats the gateway's record.
			customer_id:
				cart.payload.customer_id ??
				(await this.#orderCustomer(
					shop.id,
					cart.payload.customer ?? payment.buyer,
				)),
			subtotal: cart.payload.subtotal,
			discount_type: discountType,
			discount_value: discountType && coupon ? coupon.value : 0,
			discount: cart.payload.discount ?? 0,
			delivery_fee: cart.payload.delivery_fee ?? 0,
			tax: cart.payload.tax ?? 0,
			tax_rate: cart.payload.tax_rate ?? 0,
			tax_label: cart.payload.tax_label ?? "Tax",
			tax_included: cart.payload.tax_included ?? false,
			total: cart.payload.total,
			coupon_code: coupon?.code ?? null,
			paid: payment.paid ? cart.payload.total : 0,
			change: 0,
			payment_method: label,
			payment_status: payment.paid ? ("paid" as const) : ("unpaid" as const),
			fulfillment: "new" as const,
			note: this.#deliveryNote(
				cart.payload.customer,
				cart.payload.pickup,
				shop.address,
			),
		};
		const stockMark = await this.extensions.stockMark(shop.id);
		// The snapshot holds the product pictures.
		// The order gets its own copies, made only now that it is paid.
		const items = await OrderImages.copyAll(cart.payload.items, shop.id);
		let order: OrderFull;
		try {
			try {
				order = await this.orders.create(base, items);
			} catch (e) {
				// An unpaid order must not sell what is not there:
				// anyone could order any number of units for free.
				if (!(e instanceof OutOfStockError) || !payment.paid) throw e;
				// ponytail: the customer already paid.
				// Record the sale without taking stock.
				// The owner fixes the count with an adjustment.
				order = await this.orders.create(
					base,
					items.map((i) => this.#untracked(i)),
				);
			}
		} catch (e) {
			// no order, so nothing holds these copies
			await OrderImages.drop(items);
			throw e;
		}
		// The checkout's hold on the code turns into a real use.
		// It is written before the cart gets its order.
		// So for a moment the use counts twice rather than not at all.
		// The order exists from here on.
		// A step that fails must not fail the checkout: the cart would be
		// released, and the next reload would write a second order.
		if (coupon)
			await this.#quietly(`coupon use of order #${order.id}`, () =>
				this.coupons.redeem(
					coupon,
					shop.id,
					order.id,
					cart.payload.customer?.email ?? "",
				),
			);
		await this.carts.attachOrder(cart.id, order.id);
		await this.#quietly(`address of order #${order.id}`, () =>
			this.#rememberAddress(shop, cart),
		);
		// Order confirmation, once, and not awaited.
		// A slow or broken mail server must not hold up the customer's
		// "thank you" page.
		const buyer = cart.payload.customer ?? payment.buyer;
		const to = buyer?.email?.trim();
		if (to)
			void this.orderMail.sendOrderConfirmation(
				shop,
				order,
				to,
				buyer?.name,
				await this.payments.paymentInstructions(shop, order),
				!!cart.payload.pickup,
			);
		// The owner's "new order" email / Telegram message.
		// Same rules: once, never awaited.
		void this.alerts.notify(shop, order);
		// The shop's extensions (webhook…), same rules.
		// Re-read first, so the customer is on the order they get.
		const full = (await this.orders.find(order.id, shop.id)) ?? order;
		void this.extensions.emit("order.created", shop, { order: full });
		// a manual (cash on delivery…) order gets it
		// when the money is recorded
		if (payment.paid)
			void this.extensions.emit("order.paid", shop, { order: full });
		void this.extensions.stockMoved(shop.id, stockMark, {
			orderId: order.id,
		});
		return order;
	}

	/**
	 * Run a step that comes after the order is written.
	 * Its failure is logged, never thrown.
	 * @param what The step, for the log.
	 * @param job The step.
	 */
	async #quietly(what: string, job: () => Promise<unknown>) {
		try {
			await job();
		} catch (e) {
			console.error(`[store] ${what} failed:`, e);
		}
	}

	/**
	 * Keep a signed-in customer's delivery address on their account.
	 * Only when it is new to the account (they manage the list on /account).
	 * Not for a pick-up, and not when they unticked
	 * "Save address for next order" at the checkout.
	 * @param shop The selling shop.
	 * @param cart The cart snapshot.
	 */
	async #rememberAddress(shop: Shop, cart: StoreCart) {
		if (
			!cart.payload.customer_id ||
			!cart.payload.customer ||
			cart.payload.pickup ||
			cart.payload.save_address === false
		)
			return;
		const { phone, address_1, address_2, city, state, country, postal_code } =
			cart.payload.customer;
		await this.addresses.remember(cart.payload.customer_id, shop.id, {
			label: "",
			phone,
			address_1,
			address_2,
			city,
			state,
			country,
			postal_code,
		});
	}

	/**
	 * Attach the buyer to a customer record.
	 * Matched by email, then by phone (unique per shop).
	 * Created on first purchase.
	 * @param shopId Owning shop.
	 * @param buyer What the checkout page (or the gateway) knows about them.
	 * @returns The customer id, or null when there is nothing to match
	 *   or store.
	 */
	async #orderCustomer(shopId: number, buyer: Buyer) {
		const email = buyer?.email?.trim() || null;
		const phone = buyer?.phone?.trim() || null;
		if (!email && !phone) return null;
		const byEmail = email ? await this.customers.byEmail(shopId, email) : null;
		const byPhone =
			!byEmail && phone ? await this.customers.phoneOwner(shopId, phone) : null;
		// Anyone can type a phone number, nothing proves it.
		// So it never joins the record of a person with another email:
		// that person could then read this order.
		const stranger =
			!!byPhone?.email &&
			!!email &&
			byPhone.email.toLowerCase() !== email.toLowerCase();
		const existing = byEmail || (stranger ? null : byPhone);
		// A store account's history is only ever filled by that account
		// signed in. A guest who types its email or phone gets no customer
		// record. The delivery details stay on the order note.
		if (existing) return existing.firebase_uid ? null : existing.id;
		return (
			await this.customers.create(shopId, {
				name: buyer?.name?.trim() || email || phone!,
				// the phone is unique per shop, and the other person has it
				phone: stranger ? null : phone,
				email,
				note: "",
			})
		).id;
	}

	/**
	 * The same line, sold without taking stock.
	 * @param item The order line.
	 * @returns The line with `track_stock` off.
	 */
	#untracked(item: NewItem): NewItem {
		return { ...item, track_stock: false };
	}

	/**
	 * The order note the checkout form turns into.
	 * Delivery: who and where to deliver.
	 * Pick up: who is collecting, and the shop's address (from Banner &
	 * contact) so the buyer knows where to go.
	 * The note is frozen on the order.
	 * So a later move doesn't change old orders.
	 * @param c The buyer from the checkout form.
	 * @param pickup true = collected in store.
	 * @param shopAddress The shop's own address, or null when it has none.
	 * @returns The note, one fact per line.
	 */
	#deliveryNote(
		c: StoreCustomer | undefined,
		pickup = false,
		shopAddress: string | null = null,
	) {
		if (!c) return "";
		if (pickup)
			return [
				t("store_server.note_pickup", { name: c.name, phone: c.phone }),
				shopAddress
					? t("store_server.note_pickup_at", { address: shopAddress })
					: "",
			]
				.filter(Boolean)
				.join("\n");
		return [
			t("store_server.note_deliver_to", {
				name: c.name,
				phone: c.phone,
			}),
			c.address_1,
			c.address_2,
			`${c.city}, ${c.state} ${c.postal_code}`.trim(),
			c.country,
		]
			.filter(Boolean)
			.join("\n");
	}
}
