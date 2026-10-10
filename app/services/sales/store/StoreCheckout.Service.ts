import { Service } from "@xcore/di";
import { I18n, t } from "@xcore/i18n/I18n";
import type { Shop } from "@models/Shop";
import type { NewItem } from "@repositories/Order.Repository";
import {
	StoreCartRepository,
	type StoreCartCoupon,
} from "@repositories/StoreCart.Repository";
import { PostalCodeRepository } from "@repositories/PostalCode.Repository";
import { randomId } from "@helpers/crypto";
import { frozenTax, orderTotals, taxLabel } from "@helpers/tax";
import { CartPricer } from "@services/sales/CartPricer.Service";
import { CouponService } from "@services/sales/Coupon.Service";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import type {
	HostedPayment,
	PaymentLine,
	RunningPayment,
	TokenizePayment,
} from "@services/settings/extensions/types/Extension.Payments.Types";
import type {
	StoreCheckoutInput,
	StoreCouponInput,
	StoreSendInput,
} from "@validators/Store.Validator";
import {
	deliveryFee,
	undeliverable,
} from "@validators/StoreCustomer.Validator";
import { COUNTRIES } from "@constants/Country.Constant";
import { COUPON_HOLD_MS, type CouponType } from "@constants/Coupon.Constant";
import { STORE_DIRECT } from "@constants/Store.Constant";
import { StoreFulfillService } from "./StoreFulfill.Service";
import { StorePaymentService } from "./StorePayment.Service";

type Errors = Record<string, string>;

/**
 * What the storefront needs to open a tokenising gateway's own form.
 */
export type Tokenize = {
	gateway: string;
	public_key: string;
	/**
	 * Already in the provider's smallest currency unit.
	 */
	amount: number;
	currency: string;
	/**
	 * Keys the cart snapshot. It comes back to /checkout/pay.
	 */
	ref: string;
	methods: string[];
	/**
	 * The gateway extension's own checkout script.
	 */
	script: string;
	/**
	 * The gateway's own dictionary in the buyer's language.
	 * `api.t` in its checkout script reads it.
	 */
	strings: Record<string, string>;
};

/**
 * What the checkout page shows once a code is applied.
 * The discount, and the delivery fee after it (0 = waived).
 */
export type CouponQuote = {
	code: string;
	type: CouponType;
	value: number;
	description: string;
	discount: number;
	delivery_fee: number;
};

/**
 * What `checkout` takes.
 * The validated checkout form, with the optional parts optional.
 */
export type CheckoutArgs = Omit<
	StoreCheckoutInput,
	"payment" | "coupon" | "pickup" | "save_address"
> & {
	payment?: string;
	coupon?: string;
	pickup?: boolean;
	save_address?: boolean;
};

/**
 * What `checkout` answers.
 * Where to send the buyer, the provider's form, or errors.
 */
export type CheckoutResult =
	| { url?: string; tokenize?: Tokenize; errors?: never }
	| { errors: Errors; url?: never; tokenize?: never };

/**
 * An address as the buyer typed it.
 */
type TypedAddress = {
	country: string;
	state: string;
	city: string;
	postal_code: string;
};

/**
 * The money of a checkout that a hosted gateway is asked to charge.
 */
type HostedCharge = {
	lines: NewItem[];
	tax: number;
	delivery: number;
	discount: number;
	coupon: StoreCartCoupon | undefined;
};

/**
 * The online store's checkout.
 * Prices the cart, snapshots it and starts the payment.
 */
@Service()
export class StoreCheckoutService {
	constructor(
		private carts: StoreCartRepository,
		private postal: PostalCodeRepository,
		private pricer: CartPricer,
		private coupons: CouponService,
		private extensions: ExtensionService,
		private payments: StorePaymentService,
		private fulfills: StoreFulfillService,
	) {}

	/**
	 * Start an online checkout.
	 * Price the cart from the DB and snapshot it. Then one of three:
	 * create a hosted checkout page,
	 * hand the browser what the gateway's own form needs (a tokenize
	 * gateway, see `pay`),
	 * or, for a manual option (cash on delivery, bank transfer), record
	 * the order unpaid right away and send the buyer to /done.
	 * @param shop The selling shop.
	 * @param input Validated cart lines and the buyer's details.
	 *   Whether they collect in store.
	 *   The payment option picked ("" = online).
	 *   A discount code ("" = none).
	 * @param storeUrl Absolute URL of this storefront, for the gateway's
	 *   return links.
	 * @param customerId The signed-in customer (store accounts).
	 *   The order is theirs whatever email they typed. null = a guest.
	 * @returns `{url}` to send the customer to, `{tokenize}` to open the
	 *   provider's form, or `{errors}`.
	 */
	checkout(
		shop: Shop,
		input: CheckoutArgs,
		storeUrl: string,
		customerId: number | null = null,
	): Promise<CheckoutResult> {
		// one checkout per code at a time, until the cart holds the code
		return this.coupons.oneAtATime(shop.id, input.coupon ?? "", () =>
			this.#startCheckout(shop, input, storeUrl, customerId),
		);
	}

	/**
	 * "Send order" in the cart of a store with no payment option
	 * switched on. The order is written unpaid at once.
	 * No name, no address, no delivery fee, no code.
	 * The shop takes the money itself and records it on the order page.
	 * @param shop The selling shop.
	 * @param input Validated cart lines.
	 * @param storeUrl Absolute URL of this storefront.
	 * @param customerId The signed-in customer, or null for a guest.
	 * @returns `{url}` of the thank-you page, or `{errors}`.
	 */
	async send(
		shop: Shop,
		input: StoreSendInput,
		storeUrl: string,
		customerId: number | null = null,
	): Promise<CheckoutResult> {
		// a store that takes payments keeps its checkout page
		if ((await this.payments.paymentOptions(shop)).length)
			return { errors: { cart: t("store_server.payment_option_unavailable") } };
		const priced = await this.#priceCart(shop, input.items);
		if ("errors" in priced) return priced;
		const { lines, subtotal } = priced;
		const { tax, total } = orderTotals(shop, { subtotal });
		await this.carts.purgeStale();
		const cart = await this.carts.create(shop.id, {
			locale: I18n.current(),
			items: lines,
			subtotal,
			discount: 0,
			delivery_fee: 0,
			tax,
			...frozenTax(shop),
			total,
			gateway: STORE_DIRECT,
			...(customerId && { customer_id: customerId }),
		});
		return this.#placeUnpaid(shop, cart.id, STORE_DIRECT, storeUrl);
	}

	/**
	 * The guided address for the checkout page.
	 * A country's states / provinces and, once one is picked, that
	 * state's cities, each with a postal code.
	 * They come from the GeoNames list the admin downloaded.
	 * The cities are the first `CITY_PAGE` A–Z (or those matching `q`),
	 * and `more` says the state holds others. So the City box searches as
	 * the buyer types.
	 * @param country Country name as the checkout stores it ("" = unknown).
	 * @param state The chosen state ("" = just the states).
	 * @param q What the buyer typed in the City box
	 *   ("" = the start of the list).
	 * @returns The states, the cities and `more`.
	 *   Empty lists when the country isn't on the list (the page then
	 *   shows plain text boxes).
	 */
	async address(
		country: string,
		state: string,
		q = "",
	): Promise<{
		states: string[];
		cities: { place: string; postal_code: string }[];
		more: boolean;
	}> {
		const code = this.#countryCode(country);
		if (!code) return { states: [], cities: [], more: false };
		return {
			states: await this.postal.states(code),
			...(state
				? await this.postal.cities(code, state, q)
				: { cities: [], more: false }),
		};
	}

	/**
	 * "Apply" on the checkout page.
	 * Prices the cart and says what a discount code takes off it.
	 * It runs the same rules as the checkout itself.
	 * So the total the page shows is the total that will be charged.
	 * @param shop The selling shop.
	 * @param input The cart, the code, and what's typed so far: the
	 *   buyer's email, country / city and whether they collect in store.
	 * @param customerId The signed-in store customer (their email is the
	 *   account's), or null for a guest. Needed for a customer-only code.
	 * @returns `{quote}` (the code, what it is, the discount and the
	 *   delivery fee after it), or `{errors}` for the code box.
	 */
	async quote(
		shop: Shop,
		input: StoreCouponInput,
		customerId: number | null = null,
	): Promise<
		{ quote: CouponQuote; errors?: never } | { errors: Errors; quote?: never }
	> {
		const priced = await this.#priceCart(shop, input.items);
		if ("errors" in priced) return { errors: { coupon: priced.errors.cart! } };
		// No country yet = at home.
		// An undeliverable country is the address form's problem,
		// not the code's.
		const to = await this.#deliveryTo(shop, {
			country: input.country || shop.country || "",
			state: input.state,
			city: input.city,
			postal_code: input.postal_code,
		});
		const fee =
			(input.pickup && shop.pickup
				? 0
				: deliveryFee(shop, to, priced.subtotal)) ?? 0;
		const r = await this.coupons.resolve(shop, input.coupon, {
			lines: priced.lines,
			delivery_fee: fee,
			email: input.email,
			verified: customerId !== null,
			customer_id: customerId,
		});
		if ("error" in r) return { errors: { coupon: r.error } };
		return {
			quote: { ...CouponService.couponQuote(r), delivery_fee: r.delivery_fee },
		};
	}

	/**
	 * Charge the nonce the gateway's browser form produced.
	 * Tokenising gateways only.
	 * The cart was already priced and snapshotted by `checkout`.
	 * The amount is re-read from that snapshot, never from the client.
	 * @param shop The selling shop.
	 * @param ref The cart's own session key, handed to the browser by
	 *   `checkout`.
	 * @param token The nonce the provider's form produced.
	 * @param storeUrl Absolute URL of this storefront, for the return link.
	 * @returns `{url}` to send the buyer to: the redirect page when the
	 *   charge needs one, otherwise straight to /done, which verifies the
	 *   charge before it writes the order.
	 *   A QR method redirects nowhere, so its code comes back as `qr`
	 *   (and is kept on the snapshot for /done).
	 *   Or `{errors}`.
	 */
	async pay(
		shop: Shop,
		ref: string,
		token: string,
		storeUrl: string,
	): Promise<
		| { url: string; qr?: string; errors?: never }
		| { errors: Errors; url?: never; qr?: never }
	> {
		const cart = await this.carts.bySession(shop.id, ref);
		if (!cart || cart.order_id !== null)
			return { errors: { cart: t("store_server.unknown_session") } };
		// The code's hold ran out, or the shop switched the code off since.
		// The frozen discount no longer stands.
		if (cart.payload.coupon && !(await this.coupons.stillHeld(shop, cart)))
			return { errors: { cart: t("store_server.checkout_expired") } };
		const g = await this.payments.gatewayOf(shop);
		if ("errors" in g) return { errors: g.errors };
		if (g.ext.payment!.mode !== "tokenize")
			return { errors: StorePaymentService.paymentsOff() };
		const pay = g.payment as TokenizePayment;
		const done = `${storeUrl}/done?sid=${encodeURIComponent(ref)}`;
		try {
			const goods = cart.payload.items.map((i) => this.#qtyName(i)).join(", ");
			const ch = await pay.charge(g.config, {
				token,
				amount: pay.amount(cart.payload.total, shop.currency),
				currency: shop.currency,
				returnUri: done,
				reference: ref,
				description: `${shop.name} — ${goods}`.slice(0, 255),
			});
			await this.carts.setPayload(cart.id, {
				...cart.payload,
				charge_id: ch.id,
				qr: ch.qr,
			});
			return { url: ch.url ?? done, ...(ch.qr ? { qr: ch.qr } : {}) };
		} catch (e) {
			if (StorePaymentService.buyerError(e))
				return { errors: { cart: g.t((e as Error).message) } };
			throw e;
		}
	}

	/**
	 * The checkout itself.
	 * See `checkout`, which runs it one at a time per discount code.
	 * @param shop The selling shop.
	 * @param input Validated cart lines, the buyer's details, pickup,
	 *   payment option and discount code.
	 * @param storeUrl Absolute URL of this storefront.
	 * @param customerId The signed-in customer, or null for a guest.
	 * @returns `{url}`, `{tokenize}` or `{errors}`.
	 */
	async #startCheckout(
		shop: Shop,
		input: CheckoutArgs,
		storeUrl: string,
		customerId: number | null,
	): Promise<CheckoutResult> {
		// Collecting in store (when offered) costs nothing.
		// Else whether the shop delivers there at all is checked first.
		// The zone decides that. The amount waits for the priced goods.
		const pickup = !!input.pickup && shop.pickup;
		const to = pickup ? null : await this.#deliveryTo(shop, input.customer);
		const bad = to && undeliverable(shop.delivery_zones, to);
		if (bad)
			return { errors: { [`customer.${bad.field}`]: t(bad.key, bad.params) } };
		const manual = input.payment
			? this.payments.manualOf(shop, input.payment)
			: null;
		if (input.payment && !manual)
			return {
				errors: { cart: t("store_server.payment_option_unavailable") },
			};
		const g = manual ? null : await this.payments.gatewayOf(shop);
		if (g && "errors" in g) return { errors: g.errors };
		const priced = await this.#priceCart(shop, input.items);
		if ("errors" in priced) return priced;
		const { lines, subtotal } = priced;
		// the zone's price, or 0 from its free-delivery threshold
		const fee = to ? deliveryFee(shop, to, subtotal)! : 0;
		// A discount code: every rule lives in CouponService.
		// What it takes off is frozen on the snapshot.
		// A code the page shows but the server now refuses (used up
		// meanwhile, expired at midnight…) stops the checkout with why.
		let discount = 0,
			delivery = fee,
			coupon: StoreCartCoupon | undefined;
		if (input.coupon) {
			const r = await this.coupons.resolve(shop, input.coupon, {
				lines,
				delivery_fee: fee,
				email: input.customer.email,
				// a signed-in customer's email is always the account's
				verified: customerId !== null,
				customer_id: customerId,
			});
			if ("error" in r) return { errors: { coupon: r.error } };
			({ discount, delivery_fee: delivery } = r);
			coupon = {
				id: r.coupon.id,
				code: r.coupon.code,
				type: r.coupon.type,
				value: r.coupon.value,
				saved: r.saved,
			};
		}
		// the shop's tax line, frozen on the snapshot
		const { tax, total } = orderTotals(shop, {
			subtotal,
			discount,
			delivery_fee: delivery,
		});
		await this.carts.purgeStale();
		const cart = await this.carts.create(shop.id, {
			// The language the buyer checked out in.
			// The emails follow it, even from the reconcile sweep.
			locale: I18n.current(),
			items: lines,
			subtotal,
			discount,
			delivery_fee: delivery,
			tax,
			...frozenTax(shop),
			total,
			customer: input.customer,
			...(pickup && { pickup }),
			...(coupon && { coupon }),
			...(manual && { gateway: manual.key }),
			...(customerId && {
				customer_id: customerId,
				...(input.save_address === false && { save_address: false }),
			}),
		});
		// no provider at all: the order is written now, unpaid
		if (manual) return this.#placeUnpaid(shop, cart.id, manual.key, storeUrl);
		const running = g as RunningPayment;
		if (running.ext.payment!.mode === "tokenize")
			return this.#startTokenize(shop, running, cart.id, total);
		return this.#startHosted(
			shop,
			running,
			cart.id,
			{ lines, tax, delivery, discount, coupon },
			input.customer.email,
			storeUrl,
		);
	}

	/**
	 * Start a payment with a tokenize gateway.
	 * There is no hosted page: the payment is collected in the browser by
	 * the gateway's own form, then charged in `pay`.
	 * @param shop The selling shop.
	 * @param g The running gateway extension.
	 * @param cartId The cart snapshot.
	 * @param total The cents to charge.
	 * @returns `{tokenize}` with what the form needs.
	 */
	async #startTokenize(
		shop: Shop,
		g: RunningPayment,
		cartId: number,
		total: number,
	): Promise<CheckoutResult> {
		const { ext, config } = g;
		const pay = g.payment as TokenizePayment;
		// our own session key: the provider has no id yet
		const ref = `${ext.key}_${randomId()}`;
		await this.carts.setSession(cartId, ref);
		// Plus every other method this merchant's account accepts.
		// So the form offers all of them, not just card.
		let methods: string[] = [];
		try {
			methods = (await pay.methods?.(config)) ?? [];
		} catch {
			/* the form still opens on card */
		}
		return {
			tokenize: {
				gateway: ext.key,
				public_key: String(config[ext.payment!.public_field!] ?? ""),
				amount: pay.amount(total, shop.currency),
				currency: shop.currency,
				ref,
				methods,
				script: this.extensions.paymentScript(ext, shop.slug ?? ""),
				strings: this.extensions.strings(ext),
			},
		};
	}

	/**
	 * Start a payment on the gateway's own hosted page.
	 * @param shop The selling shop.
	 * @param g The running gateway extension.
	 * @param cartId The cart snapshot.
	 * @param charge The priced lines, tax, delivery fee and discount.
	 * @param email The buyer's email.
	 * @param storeUrl Absolute URL of this storefront.
	 * @returns `{url}` of the provider's page, or `{errors}` the buyer
	 *   may see.
	 */
	async #startHosted(
		shop: Shop,
		g: RunningPayment,
		cartId: number,
		charge: HostedCharge,
		email: string,
		storeUrl: string,
	): Promise<CheckoutResult> {
		const { discount, coupon } = charge;
		try {
			const co = await (g.payment as HostedPayment).createCheckout(g.config, {
				lines: this.#gatewayLines(shop, charge),
				...(discount > 0 &&
					coupon && {
						discount: {
							label: t("store_server.coupon_label", { code: coupon.code }),
							amount: discount,
						},
					}),
				currency: shop.currency,
				successUrl: `${storeUrl}/done`,
				cancelUrl: storeUrl,
				reference: String(cartId),
				email,
				// a code is held for this long: the page must not take money later
				...(coupon && {
					expires_at: Math.floor((Date.now() + COUPON_HOLD_MS) / 1000),
				}),
			});
			await this.carts.setSession(cartId, co.id);
			return { url: co.url };
		} catch (e) {
			if (StorePaymentService.buyerError(e))
				return { errors: { cart: g.t((e as Error).message) } };
			throw e;
		}
	}

	/**
	 * The lines a hosted gateway charges.
	 * A tax added on top is a line of its own, so the gateway charges it.
	 * An included tax is already inside the prices.
	 * A delivery fee is a line of its own too.
	 * @param shop The selling shop.
	 * @param charge The priced lines, the tax and the delivery fee.
	 * @returns The goods, then the tax line, then the delivery line.
	 */
	#gatewayLines(shop: Shop, charge: HostedCharge): PaymentLine[] {
		const out = charge.lines.map((l) => this.#paymentLine(l));
		if (charge.tax > 0 && !shop.tax_included)
			out.push({
				name: taxLabel(shop, t("common.tax_included_prefix")),
				price: charge.tax,
				qty: 1,
			});
		if (charge.delivery > 0)
			out.push({ name: t("store.delivery"), price: charge.delivery, qty: 1 });
		return out;
	}

	/**
	 * Write a snapshotted cart as an unpaid order right away.
	 * It goes through `fulfill`, so it happens once and fires the same
	 * emails and alerts.
	 * @param shop The selling shop.
	 * @param cartId The cart snapshot.
	 * @param key The start of its session key: a manual option's key,
	 *   or `STORE_DIRECT`.
	 * @param storeUrl Absolute URL of this storefront.
	 * @returns `{url}` of the thank-you page, or `{errors}`.
	 */
	async #placeUnpaid(
		shop: Shop,
		cartId: number,
		key: string,
		storeUrl: string,
	): Promise<CheckoutResult> {
		const ref = `${key}_${randomId()}`;
		await this.carts.setSession(cartId, ref);
		const r = await this.fulfills.fulfill(shop, ref);
		if (!r.order)
			return { errors: { cart: r.error ?? t("store_server.order_failed") } };
		return { url: `${storeUrl}/done?sid=${encodeURIComponent(ref)}` };
	}

	/**
	 * Where the delivery price is looked up.
	 * The buyer's postal code names the place, when the downloaded list
	 * knows it. So a city zone matches on the code, not on how the buyer
	 * spelled the city.
	 * A code covering several places picks the one a zone lists
	 * (else the first).
	 * No code or an unknown one falls back to the typed city name.
	 * That happens with no list, a typo, or a country without postal
	 * codes such as Myanmar.
	 * @param shop The selling shop (its zones).
	 * @param to The address as typed: country, state, city, postal code.
	 *   The state is matched by name: the list's admin1 name when picked
	 *   from it.
	 * @returns `{country, state, city}` for `deliveryFee()`.
	 */
	async #deliveryTo(
		shop: Shop,
		to: TypedAddress,
	): Promise<{ country: string; state: string; city: string }> {
		const code = this.#countryCode(to.country);
		const places = code ? await this.postal.placesOf(code, to.postal_code) : [];
		if (!places.length)
			return { country: to.country, state: to.state, city: to.city };
		const listed = new Set<string>();
		for (const zone of shop.delivery_zones)
			for (const city of zone.cities) listed.add(city.trim().toLowerCase());
		return {
			country: to.country,
			state: to.state,
			city:
				places.find((p) => listed.has(p.trim().toLowerCase())) ?? places[0]!,
		};
	}

	/**
	 * Price a cart from the DB, the online store's way.
	 * A product that asks for a note must get one.
	 * @param shop The selling shop.
	 * @param items The cart lines as posted.
	 * @returns The priced lines and their subtotal, or `{errors}`
	 *   (item gone, choice missing, not enough stock, note missing).
	 */
	async #priceCart(
		shop: Shop,
		items: StoreCheckoutInput["items"],
	): Promise<{ lines: NewItem[]; subtotal: number } | { errors: Errors }> {
		const priced = await this.pricer.price(shop.id, items, {
			goneKey: "store_server.item_unavailable",
			customRequest: true,
		});
		return priced.errors
			? { errors: priced.errors }
			: { lines: priced.lines, subtotal: priced.subtotal };
	}

	/**
	 * The ISO code of a country, by the name the checkout stores.
	 * @param name The country name ("" = unknown).
	 * @returns The code, or undefined when the name is not on the list.
	 */
	#countryCode(name: string) {
		return COUNTRIES.find((c) => c.name === name)?.code;
	}

	/**
	 * A priced line as a gateway is asked to charge it.
	 * @param l The priced line.
	 * @returns Its name, price and quantity.
	 */
	#paymentLine(l: NewItem): PaymentLine {
		return { name: l.name, price: l.price, qty: l.qty };
	}

	/**
	 * One line of the charge description: "2× Mug".
	 * @param i The priced line.
	 * @returns The text.
	 */
	#qtyName(i: NewItem) {
		return `${i.qty}× ${i.name}`;
	}
}
