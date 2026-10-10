import { extensionT, locale, t } from "@/lib/i18n";
import type { StoreCouponQuote } from "@/types";
import type { StoreCartLine } from "./types";

/**
 * The server calls of the shared checkout page.
 * No Vue and no state here: the island keeps the spinner and the messages.
 */

/**
 * The buyer, as asked on the checkout page.
 * A guest's copy is remembered in localStorage, per shop (`store-customer:<slug>`).
 */
export type StoreCustomer = {
	name: string;
	phone: string;
	email: string;
	address_1: string;
	address_2: string;
	city: string;
	state: string;
	country: string;
	postal_code: string;
};

/**
 * A gateway extension with no hosted page.
 * `script` is its own browser module (default export = a `PaymentScript`,
 * see extensions/types.ts). It opens the provider's form here and hands back a nonce.
 * `amount` is already in the provider's smallest unit.
 * `methods` = the non-card methods the account switched on.
 */
type Tokenize = {
	gateway: string;
	public_key: string;
	amount: number;
	currency: string;
	ref: string;
	methods: string[];
	script: string;
	strings: Record<string, string>;
};

/**
 * What "Pay" sends.
 * `payment` = "" for the online gateway, else a manual option's key.
 * `coupon` = the applied code ("" = none); the server applies it again.
 * `pickup` = collect in store (no fee, no address), when the shop offers it.
 * `saveAddress` = a signed-in buyer keeps this address on the account.
 */
export type CheckoutOrder = {
	lines: StoreCartLine[];
	customer: StoreCustomer;
	payment: string;
	coupon: string;
	pickup: boolean;
	saveAddress: boolean;
};

/**
 * Called when checking out stops without leaving the page.
 * @param error The message to show ("" = none, e.g. the form was closed).
 */
export type StopCheckout = (error: string) => void;

/**
 * The cart lines as the server reads them.
 * @param lines The cart.
 * @returns One item per line.
 */
function items(lines: StoreCartLine[]) {
	return lines.map(function item(l) {
		return {
			product_id: l.product_id,
			variant_id: l.variant_id,
			qty: l.qty,
			choices: l.choices ?? {},
			note: l.note ?? "",
		};
	});
}

/**
 * POST the cart and the buyer.
 * On success the browser leaves for the gateway and `stop` is never called.
 * A tokenize gateway opens its own form first.
 * @param base The store's base path (`store.base`).
 * @param name The shop's name, for the payment form.
 * @param order What to buy and how.
 * @param stop Called when checking out ends here, with the message to show.
 * @returns The field errors (`customer.name` …) to show, if any.
 */
export async function checkout(
	base: string,
	name: string,
	order: CheckoutOrder,
	stop: StopCheckout,
): Promise<Record<string, string>> {
	try {
		const res = await fetch(`${base}/checkout`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: items(order.lines),
				customer: order.customer,
				payment: order.payment,
				coupon: order.coupon,
				pickup: order.pickup,
				save_address: order.saveAddress,
			}),
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok && data.url) {
			location.href = data.url;
			return {};
		}
		if (res.ok && data.tokenize) {
			await openPaymentForm(base, name, data.tokenize, stop);
			return {};
		}
		const errors: Record<string, string> = data.errors ?? {};
		stop(
			errors.cart ??
				errors.items ??
				(Object.keys(errors).length ? "" : t("store.checkout_failed")),
		);
		return errors;
	} catch {
		stop(t("store.checkout_failed_offline"));
		return {};
	}
}

/**
 * "Apply" on the checkout page: what does a discount code take off this cart?
 * The server runs the same rules as the checkout.
 * The email counts for customer-only codes and per-customer limits.
 * The place and pick-up count for delivery.
 * @param base The store's base path.
 * @param lines The cart.
 * @param code The code the buyer typed.
 * @param to The buyer's email and address.
 * @param pickup Collecting in store.
 * @returns The quote, or the message to show under the code box.
 */
export async function quoteCoupon(
	base: string,
	lines: StoreCartLine[],
	code: string,
	to: Pick<
		StoreCustomer,
		"email" | "country" | "state" | "city" | "postal_code"
	>,
	pickup = false,
): Promise<{ quote?: StoreCouponQuote; error?: string }> {
	try {
		const res = await fetch(`${base}/checkout/coupon`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: items(lines),
				coupon: code,
				email: to.email,
				country: to.country,
				state: to.state,
				city: to.city,
				postal_code: to.postal_code,
				pickup,
			}),
		});
		// a 429 is plain text, everything else JSON
		const text = await res.text();
		let data: {
			quote?: StoreCouponQuote;
			errors?: { coupon?: string; cart?: string };
		} = {};
		try {
			data = JSON.parse(text);
		} catch {
			// plain text
		}
		if (res.ok && data.quote) return { quote: data.quote };
		return {
			error:
				data.errors?.coupon ??
				data.errors?.cart ??
				(text && text.length < 200 ? text : t("store.code_invalid")),
		};
	} catch {
		return { error: t("store.code_check_failed") };
	}
}

/**
 * A gateway with no hosted page.
 * Load the extension's own browser script; it opens the provider's form here.
 * The nonce it hands back goes to /checkout/pay, which charges it on the server
 * and answers where to go next. The core knows no provider by name.
 * @param base The store's base path.
 * @param name The shop's name.
 * @param tk What the server sent for the form.
 * @param stop Called when the form closes or fails.
 */
export async function openPaymentForm(
	base: string,
	name: string,
	tk: Tokenize,
	stop: StopCheckout,
) {
	/**
	 * Charge the nonce the form made.
	 * On success the browser leaves for wherever the gateway says.
	 * @param token The provider's nonce.
	 */
	async function pay(token: string) {
		try {
			const res = await fetch(`${base}/checkout/pay`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ref: tk.ref, token }),
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok && data.url) {
				location.href = data.url;
				return;
			}
			stop(data.errors?.cart ?? t("store.payment_declined"));
		} catch {
			stop(t("store.payment_failed_offline"));
		}
	}
	/**
	 * The buyer closed the form: nothing to show.
	 */
	function cancel() {
		stop("");
	}
	try {
		// absolute against the page's origin, like the store scripts (dev: the JS itself comes from Vite)
		const mod = await import(
			/* @vite-ignore */ new URL(tk.script, location.origin).href
		);
		await mod.default(tk, {
			store: { name },
			pay,
			cancel,
			fail: stop,
			t: extensionT(tk.strings),
			locale: locale(),
		});
	} catch {
		stop(t("store.payment_form_failed"));
	}
}
