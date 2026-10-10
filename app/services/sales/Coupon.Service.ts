import { ShopRepository } from "@repositories/Shop.Repository";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { Shop } from "@models/Shop";
import type { Coupon } from "@models/Coupon";
import { CouponRepository } from "@repositories/Coupon.Repository";
import type { CouponInput } from "@validators/Coupon.Validator";
import { dbDate, ymd } from "@helpers/time";
import { oneAtATime } from "@helpers/lock";
import { COUPON_HOLD_MS, type CouponSort } from "@constants/Coupon.Constant";
import type { StoreCart } from "@repositories/StoreCart.Repository";
import { discountAmount } from "@helpers/discount";
import { CartPricer } from "./CartPricer.Service";

type Errors = Record<string, string>;
/**
 * A priced cart line, as the checkouts build it.
 * Only what the rules need.
 */
export type CouponLine = { product_id: number; price: number; qty: number };
/**
 * What a code did to a cart.
 * The goods discount and the (possibly waived) delivery fee.
 */
export type CouponResult = {
	coupon: Coupon;
	discount: number;
	delivery_fee: number;
	saved: number;
};

/**
 * Discount codes.
 * The admin's list, and the one rule set the checkout applies.
 */
@Service()
export class CouponService {
	constructor(
		private coupons: CouponRepository,
		private shops: ShopRepository,
		private limits: PlanLimitService,
	) {}

	/**
	 * One page of a shop's codes.
	 * @param shopId Owning shop.
	 * @param q Search text ("" = all).
	 * @param sort "used" = most used first, else newest first.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of coupons with their usage.
	 */
	page(
		shopId: number,
		q: string,
		sort: CouponSort,
		page: number,
		perPage: number,
	) {
		return this.coupons.pageForShop(shopId, q, sort, page, perPage);
	}

	/**
	 * Totals over every code of a shop.
	 * @param shopId Owning shop.
	 * @returns Times used, the discount given and the order totals.
	 */
	summary(shopId: number) {
		return this.coupons.summary(shopId);
	}

	/**
	 * One coupon with its usage, for the history page.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 * @returns The coupon with its counters, or null.
	 */
	find(id: number, shopId: number) {
		return this.coupons.findWithStats(id, shopId);
	}

	/**
	 * The orders that used a coupon, newest first.
	 * @param id Coupon id.
	 * @param shopId Owning shop.
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @returns A page of history rows.
	 */
	history(id: number, shopId: number, page: number, perPage: number) {
		return this.coupons.history(id, shopId, page, perPage);
	}

	/**
	 * Create a coupon.
	 * @param shopId Owning shop.
	 * @param d Validated input.
	 * @returns `{errors}` when the code is taken, else `{coupon}`.
	 */
	async create(
		shopId: number,
		d: CouponInput,
	): Promise<{ coupon?: Coupon; errors?: Errors }> {
		if (await this.coupons.codeTaken(shopId, d.code))
			return { errors: { code: t("server.coupon_code_exists") } };
		const shop = await this.shops.find(shopId);
		// a plan may allow only so many codes that can still be used
		const full =
			shop &&
			(await this.limits.freeError(
				shop.owner_id,
				"coupons",
				await this.coupons.countUsable(shopId),
			));
		if (full) return { errors: { code: full } };
		return { coupon: await this.coupons.create(shopId, d) };
	}

	/**
	 * Edit a coupon.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated input.
	 * @returns `{errors}` when the code is taken or the coupon is gone,
	 *   else `{coupon}`.
	 */
	async update(
		id: number,
		shopId: number,
		d: CouponInput,
	): Promise<{ coupon?: Coupon; errors?: Errors }> {
		if (await this.coupons.codeTaken(shopId, d.code, id))
			return { errors: { code: t("server.coupon_code_exists") } };
		const coupon = await this.coupons.update(id, shopId, d);
		return coupon
			? { coupon }
			: { errors: { code: t("server.coupon_not_found") } };
	}

	/**
	 * Delete a coupon. Orders that used it keep the code as text.
	 * @param id Coupon id.
	 * @param shopId Shop it must belong to.
	 * @returns When the coupon is deleted.
	 */
	remove(id: number, shopId: number) {
		return this.coupons.delete(id, shopId);
	}

	/**
	 * Apply a code to a priced cart. Every rule is in this one place.
	 * The rules are checked in the order a buyer would expect to hear
	 * about them: does it exist, is it live today, is it theirs,
	 * is it used up, is the cart big enough, does it touch anything
	 * in the cart.
	 * @param shop The selling shop (currency for the messages, time zone
	 *   for "today").
	 * @param code What the buyer typed (any case, surrounding spaces).
	 * @param cart The priced lines, the delivery fee before the code and
	 *   the buyer's email ("" while unknown). `verified` = that email is
	 *   proven (a signed-in store customer, or entered by staff at the POS).
	 * @returns The coupon with what it takes off, or `{error}` with the
	 *   message to show under the code box.
	 */
	async resolve(
		shop: Shop,
		code: string,
		cart: {
			lines: CouponLine[];
			delivery_fee: number;
			email: string;
			verified: boolean;
			/** The proven customer: a signed-in store customer, or the one a cashier attached. */
			customer_id?: number | null;
		},
	): Promise<CouponResult | { error: string }> {
		// A code that is missing, off, out of its dates, for other emails
		// or used up all get the same answer.
		// Anything more would tell a stranger which codes exist
		// and which emails hold or used them.
		const invalid = { error: t("server.coupon_invalid") };
		const c = await this.coupons.findByCode(shop.id, code.trim().toUpperCase());
		if (!c?.active) return invalid;
		const today = ymd(new Date(), shop.timezone);
		if (c.starts_at && today < c.starts_at) return invalid;
		if (c.ends_at && today > c.ends_at) return invalid;
		const email = cart.email.trim().toLowerCase();
		// A typed email proves nothing.
		// A customer-only code needs the buyer signed in as that email,
		// or a cashier. The answer is the same for every typed email,
		// so it does not tell a stranger who is on the list.
		if (c.emails.length && !cart.verified)
			return { error: t("server.coupon_sign_in") };
		if (c.emails.length && !c.emails.includes(email)) return invalid;
		const used = await this.coupons.usage(c.id, email, cart.customer_id ?? 0);
		if (c.usage_limit !== null && used.total >= c.usage_limit) return invalid;
		if (c.per_customer_limit !== null && !email)
			return { error: t("server.coupon_enter_email") };
		if (c.per_customer_limit !== null && used.mine >= c.per_customer_limit)
			return invalid;
		const subtotal = CartPricer.linesTotal(cart.lines);
		if (subtotal < c.min_subtotal)
			return {
				error: t("server.coupon_min_subtotal", {
					amount: this.#money(c.min_subtotal, shop.currency),
				}),
			};
		const eligible = CartPricer.linesTotal(await this.#eligible(c, cart.lines));
		if (eligible === 0) return { error: t("server.coupon_nothing_eligible") };
		if (c.type === "free_delivery" && cart.delivery_fee === 0)
			return { error: t("server.coupon_delivery_already_free") };
		const r = CouponService.couponDiscount(c, eligible, cart.delivery_fee);
		return {
			coupon: c,
			...r,
			saved: r.discount + (cart.delivery_fee - r.delivery_fee),
		};
	}

	/**
	 * Run a checkout that uses a code, one at a time per code.
	 * The usage check and the hold (or the use) must not interleave.
	 * Else parallel checkouts all pass the limit.
	 * @param shopId The shop.
	 * @param code The code as typed ("" = no code, no waiting).
	 * @param job The checkout.
	 * @returns What the checkout returns.
	 */
	oneAtATime<T>(shopId: number, code: string, job: () => Promise<T>) {
		const key = code.trim().toUpperCase();
		return key ? oneAtATime(`coupon:${shopId}:${key}`, job) : job();
	}

	/**
	 * Does a checkout still hold its code?
	 * Asked before a late card charge (`StoreService.pay`).
	 * @param shop The shop (its time zone decides "today").
	 * @param cart The checkout snapshot with a code on it.
	 * @returns False when the hold ran out (COUPON_HOLD_MS), or the code
	 *   was switched off, deleted or expired since.
	 */
	async stillHeld(shop: Shop, cart: StoreCart) {
		if (Date.now() - dbDate(cart.created_at).getTime() > COUPON_HOLD_MS)
			return false;
		const c = await this.coupons.find(cart.payload.coupon!.id, shop.id);
		return (
			!!c?.active && !(c.ends_at && ymd(new Date(), shop.timezone) > c.ends_at)
		);
	}

	/**
	 * Count one use: the order is written.
	 * Called once per order by the online store's `fulfill` and by the till.
	 * @param c The code as frozen on the cart snapshot (id + what it saved).
	 * @param shopId Owning shop.
	 * @param orderId The order that used it.
	 * @param email The buyer's email as typed at the checkout.
	 * @returns When the use is written.
	 */
	redeem(
		c: { id: number; saved: number },
		shopId: number,
		orderId: number,
		email: string,
	) {
		return this.coupons.redeem(
			c.id,
			shopId,
			orderId,
			email.trim().toLowerCase(),
			c.saved,
		);
	}

	/**
	 * What both "Apply" buttons say about a code that passed.
	 * The store adds the delivery fee after the code.
	 * The till narrows the type.
	 * @param r The resolved code.
	 * @returns The code, what it is and the discount in cents.
	 */
	static couponQuote(r: CouponResult) {
		return {
			code: r.coupon.code,
			type: r.coupon.type,
			value: r.coupon.value,
			description: r.coupon.description,
			discount: r.discount,
		};
	}

	/**
	 * What a coupon takes off, given the eligible goods and the delivery fee.
	 * Pure. Shared by the checkout and the tests.
	 * `free_delivery` waives the fee. The others cut the goods.
	 * A percentage is rounded like the POS discount and capped by
	 * `max_discount`. A flat amount never exceeds the goods.
	 * @param c The coupon's type, value and cap.
	 * @param eligible Cents of goods the code applies to.
	 * @param fee The delivery fee before the code.
	 * @returns The goods discount and the delivery fee after the code.
	 */
	static couponDiscount(
		c: Pick<Coupon, "type" | "value" | "max_discount">,
		eligible: number,
		fee: number,
	): { discount: number; delivery_fee: number } {
		if (c.type === "free_delivery") return { discount: 0, delivery_fee: 0 };
		const raw = discountAmount(eligible, c.type, c.value);
		return {
			discount:
				c.type === "percent" && c.max_discount
					? Math.min(raw, c.max_discount)
					: raw,
			delivery_fee: fee,
		};
	}

	/**
	 * The lines a code applies to.
	 * Every line, or only the products / categories it names.
	 * @param c The coupon.
	 * @param lines The priced cart lines.
	 * @returns The eligible lines.
	 */
	async #eligible(c: Coupon, lines: CouponLine[]) {
		if (!c.product_ids.length && !c.category_ids.length) return lines;
		const cats = c.category_ids.length
			? await this.coupons.categoriesOf([
					...new Set(lines.map((l) => l.product_id)),
				])
			: {};
		return lines.filter(
			(l) =>
				c.product_ids.includes(l.product_id) ||
				(cats[l.product_id] ?? []).some((id) => c.category_ids.includes(id)),
		);
	}

	/**
	 * An amount as a message shows it, e.g. "$18" or "$18.23".
	 * @param cents The amount in cents.
	 * @param currency The shop's currency code.
	 * @returns The formatted amount.
	 */
	#money(cents: number, currency: string) {
		return new Intl.NumberFormat("en", {
			style: "currency",
			currency,
			trailingZeroDisplay: "stripIfInteger",
		}).format(cents / 100);
	}
}
