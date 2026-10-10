/**
 * Stripe over its REST API. No npm package, no dependencies.
 * Calls go out with fetch and a form-encoded body.
 * The buyer pays on a Checkout Session that Stripe hosts.
 * Stripe then sends them back to /done?sid=<session id>.
 */
import type {
	CheckoutArgs,
	Config,
	HostedPayment,
	PaymentStatus,
} from "../types";

/**
 * The root address of Stripe's REST API.
 * Every path is added to it.
 */
const API = "https://api.stripe.com/v1";

/**
 * Currencies Stripe charges without decimals.
 * The POS always stores 1/100 units, which it calls cents.
 * So an amount in one of these has to be divided down.
 */
export const ZERO_DECIMAL = new Set([
	"BIF",
	"CLP",
	"DJF",
	"GNF",
	"JPY",
	"KMF",
	"KRW",
	"MGA",
	"PYG",
	"RWF",
	"UGX",
	"VND",
	"VUV",
	"XAF",
	"XOF",
	"XPF",
]);
/**
 * Currencies Stripe charges with three decimals.
 * An amount in one of these has to be scaled up.
 */
export const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/**
 * A failure the buyer may be shown.
 * It covers a bad key, or Stripe turning the payment down.
 * The POS shows the message to the buyer.
 */
class GatewayError extends Error {
	override readonly name = "GatewayError";
}

/**
 * Turn a stored amount into the number Stripe wants.
 * Stripe charges in the currency's smallest unit.
 * The POS stores 1/100 units, which it calls cents.
 * @param cents The stored amount.
 * @param currency ISO currency code.
 * @returns The amount in Stripe's smallest unit for that currency.
 */
export function stripeAmount(cents: number, currency: string) {
	const c = currency.toUpperCase();
	if (ZERO_DECIMAL.has(c)) return Math.round(cents / 100);
	// KWD and its like are charged in fils, so the last digit must be 0
	if (THREE_DECIMAL.has(c)) return cents * 10;
	return cents;
}

/**
 * Flatten nested parameters into the bracket form Stripe's API expects.
 * `{a: {b: 1}, c: [{d: 2}]}` becomes `a[b]=1` and `c[0][d]=2`.
 * @param params The nested parameter object.
 * @param prefix The key prefix while it walks into a nested object.
 * @param out The result built up so far.
 * @returns The flat form body.
 */
function flatten(
	params: Record<string, unknown>,
	prefix = "",
	out = new URLSearchParams(),
) {
	for (const [k, v] of Object.entries(params)) {
		const name = prefix ? `${prefix}[${k}]` : k;
		if (v == null) continue;
		if (typeof v === "object") flatten(v as Record<string, unknown>, name, out);
		else out.append(name, String(v));
	}
	return out;
}

/**
 * The fields we read from Stripe's replies.
 * One shape covers coupons, checkout sessions and errors.
 */
type StripeReply = {
	id: string;
	url: string;
	payment_status?: string;
	status?: string;
	customer_details?: { email?: string | null; name?: string | null } | null;
	error?: { message?: string };
};

/**
 * One authenticated call to Stripe.
 * @param secretKey The merchant's `sk_…` key.
 * @param method HTTP method.
 * @param path Path below the API root, e.g. `/checkout/sessions`.
 * @param params Body parameters, flattened into Stripe's bracket form.
 * @returns The parsed JSON response.
 * @throws GatewayError when the call fails.
 *   The message is Stripe's own text, else a key of i18n/en.ts.
 */
async function call(
	secretKey: string,
	method: "GET" | "POST",
	path: string,
	params?: Record<string, unknown>,
): Promise<StripeReply> {
	const res = await fetch(API + path, {
		method,
		headers: {
			Authorization: `Bearer ${secretKey}`,
			...(method === "POST"
				? { "Content-Type": "application/x-www-form-urlencoded" }
				: {}),
		},
		body: method === "POST" && params ? flatten(params) : undefined,
	});
	const data: StripeReply = await res.json().catch(() => ({}));
	/**
	 * Stripe's own message is the best hint the buyer can get.
	 * So it is passed through exactly as it came.
	 * Our own fallback is a dictionary key.
	 * The POS shows that key in the buyer's language.
	 */
	if (!res.ok)
		throw new GatewayError(data?.error?.message ?? "error.request_failed");
	return data;
}

/**
 * The Stripe gateway.
 * Stripe hosts the payment page.
 * We send the buyer there and pick them up when they come back.
 */
export const payment: HostedPayment = {
	/**
	 * Create the hosted checkout page the buyer is sent to.
	 * @param config The merchant's decrypted keys.
	 * @param a The cart lines, currency and return URLs.
	 *   It also holds our cart reference and the buyer's email.
	 * @returns The session id, which `/done?sid=` carries back,
	 *   and the URL to send the buyer to.
	 */
	async createCheckout(config: Config, a: CheckoutArgs) {
		const c = config as Record<string, string>;
		/**
		 * A coupon discount becomes a one-off Stripe coupon of its own.
		 * That way the buyer sees "SAVE10 −$1.00" on Stripe's page.
		 */
		const coupon = a.discount?.amount
			? await call(c.secret_key!, "POST", "/coupons", {
					duration: "once",
					amount_off: stripeAmount(a.discount.amount, a.currency),
					currency: a.currency.toLowerCase(),
					name: a.discount.label,
				})
			: null;
		const s = await call(c.secret_key!, "POST", "/checkout/sessions", {
			...(coupon && { discounts: [{ coupon: coupon.id }] }),
			mode: "payment",
			// Stripe takes 30 minutes to 24 hours from now
			...(a.expires_at && { expires_at: a.expires_at }),
			client_reference_id: a.reference,
			/**
			 * Where Stripe sends the buyer once they have paid.
			 * Stripe puts the real session id in place of the placeholder.
			 */
			success_url: `${a.successUrl}?sid={CHECKOUT_SESSION_ID}`,
			cancel_url: a.cancelUrl,
			/**
			 * The buyer typed this email on our checkout.
			 * Stripe fills it in on its own page.
			 */
			...(a.email && { customer_email: a.email }),
			line_items: a.lines.map((l) => ({
				quantity: l.qty,
				price_data: {
					currency: a.currency.toLowerCase(),
					unit_amount: stripeAmount(l.price, a.currency),
					product_data: { name: l.name },
				},
			})),
		});
		return { id: s.id, url: s.url };
	},

	/**
	 * Look the payment up after the buyer returns.
	 * @param config The merchant's decrypted keys.
	 * @param id The `cs_…` session id from `?sid=`.
	 * @returns Whether it was paid, and who paid it.
	 *   A session that can never be paid comes back as failed.
	 */
	async getPayment(config: Config, id: string): Promise<PaymentStatus> {
		const c = config as Record<string, string>;
		const s = await call(
			c.secret_key!,
			"GET",
			`/checkout/sessions/${encodeURIComponent(id)}`,
		);
		// an expired session can never be paid, so the buyer must start over
		return {
			paid: s.payment_status === "paid",
			buyer: s.customer_details ?? null,
			failed: s.status === "expired",
		};
	},
};
