/**
 * Stripe over its REST API, for the card reader. No npm package.
 * This is the extension's own copy of the call and of the amount rule:
 * it imports nothing from the Stripe online payment extension, so a shop
 * can run one without the other.
 */

/**
 * The root address of Stripe's REST API.
 * `STRIPE_TERMINAL_API_URL` puts a stand-in there, for tests only.
 * @returns The address every path is added to.
 */
function apiRoot() {
	return process.env.STRIPE_TERMINAL_API_URL || "https://api.stripe.com/v1";
}

/**
 * Currencies Stripe charges without decimals.
 * The POS always stores 1/100 units, which it calls cents.
 * So an amount in one of these has to be divided down.
 */
const ZERO_DECIMAL = new Set([
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
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/**
 * A call Stripe refused.
 * The message is Stripe's own text, else a key of i18n/en.ts.
 */
export class StripeError extends Error {
	override readonly name = "StripeError";
}

/**
 * Turn a stored amount into the number Stripe wants.
 * Stripe charges in the currency's smallest unit.
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
 * `{a: {b: 1}, c: ["x"]}` becomes `a[b]=1` and `c[0]=x`.
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
 * What a card reader is doing, as Stripe reports it.
 */
export type ReaderAction = {
	status?: "in_progress" | "succeeded" | "failed";
	failure_message?: string | null;
	process_payment_intent?: { payment_intent?: string } | null;
};

/**
 * The fields we read from Stripe's replies.
 * One shape covers readers, payment intents, refunds and errors.
 */
export type StripeReply = {
	id: string;
	/** A payment intent's or a reader's status. */
	status?: string;
	/** A reader's name, as the shop typed it at Stripe. */
	label?: string | null;
	/** What a reader is doing now, null when nothing. */
	action?: ReaderAction | null;
	/** A list answer's rows. */
	data?: StripeReply[];
	error?: { message?: string };
};

/**
 * One authenticated call to Stripe.
 * @param secretKey The shop's `sk_…` key.
 * @param method HTTP method.
 * @param path Path below the API root, e.g. `/terminal/readers`.
 * @param params Body parameters, flattened into Stripe's bracket form.
 * @returns The parsed JSON response.
 * @throws StripeError when the call fails.
 */
export async function call(
	secretKey: string,
	method: "GET" | "POST",
	path: string,
	params?: Record<string, unknown>,
): Promise<StripeReply> {
	const res = await fetch(apiRoot() + path, {
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
	if (!res.ok)
		throw new StripeError(data?.error?.message ?? "error.request_failed");
	return data;
}
