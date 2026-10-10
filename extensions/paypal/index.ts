/**
 * PayPal Orders v2 over plain fetch. No npm package, no dependencies.
 * Every call carries a bearer token.
 * The token is minted from the app's client id and secret.
 * See https://developer.paypal.com/api/rest/authentication/.
 * Errors come back as {name, message, details: [{issue, description}]}.
 *
 * The buyer approves the order on PayPal's page and comes back to /done.
 * PayPal adds its own `?token=<order id>`, which `returnId` reads.
 * Approving moves no money on its own.
 * `getPayment` captures an APPROVED order the first time it is asked,
 * either from the return page or from the reconcile sweep.
 * So a buyer who closes the tab still gets their order.
 */
import type {
	CheckoutArgs,
	Config,
	HostedPayment,
	PaymentLookup,
	PaymentStatus,
} from "../types";

/**
 * Currencies PayPal takes without decimals.
 * See https://developer.paypal.com/api/rest/reference/currency-codes.
 */
const ZERO_DECIMAL = new Set(["HUF", "JPY", "TWD"]);

/**
 * A PayPal refusal the buyer may be shown.
 * `issue` is PayPal's own machine code for the refusal.
 * For example `ORDER_ALREADY_CAPTURED` or `INSTRUMENT_DECLINED`.
 */
class GatewayError extends Error {
	override readonly name = "GatewayError";
	constructor(
		message: string,
		readonly issue = "",
	) {
		super(message);
	}
}

/**
 * Work out what the hosted checkout charges.
 * It is the cart lines less the discount.
 * It never goes below zero.
 * @param a The cart lines and the discount, when there is one.
 * @returns The amount to charge, in cents.
 */
const checkoutTotal = (a: Pick<CheckoutArgs, "lines" | "discount">) =>
	Math.max(
		0,
		a.lines.reduce((s, l) => s + l.price * l.qty, 0) -
			(a.discount?.amount ?? 0),
	);

/**
 * Turn a stored amount into the text PayPal wants.
 * PayPal takes a decimal string in the currency's major unit.
 * The POS stores whole cents.
 * @param cents The stored amount.
 * @param currency ISO currency code.
 * @returns "10.50" for USD, or "1500" for JPY, which takes no decimals.
 */
export function paypalAmount(cents: number, currency: string) {
	return ZERO_DECIMAL.has(currency.toUpperCase())
		? String(Math.round(cents / 100))
		: (cents / 100).toFixed(2);
}

/**
 * The API address every path is added to.
 * The merchant picks live or sandbox, so the address is theirs.
 * @param c The merchant's credentials, which hold `api_url`.
 * @returns The address with any trailing slashes removed.
 */
const root = (c: Record<string, string>) => c.api_url!.replace(/\/+$/, "");

/**
 * Mint an access token for the merchant's app.
 * @param c The merchant's `api_url`, `client_id` and `client_secret`.
 * @returns The bearer token.
 * @throws GatewayError when PayPal turns the credentials down.
 *   The message is PayPal's own text, else a key of i18n/en.ts.
 */
async function token(c: Record<string, string>) {
	// ponytail: a fresh token per call, they live about 9 hours.
	// Cache one per client id if PayPal's rate limit ever bites.
	const res = await fetch(`${root(c)}/v1/oauth2/token`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString("base64")}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: "grant_type=client_credentials",
	});
	const data: {
		access_token?: string;
		error?: string;
		error_description?: string;
	} = await res.json().catch(() => ({}));
	/**
	 * PayPal's own description is the best hint the buyer can get.
	 * So it is passed through exactly as it came.
	 * Our own fallback is a dictionary key.
	 * The POS shows that key in the buyer's language.
	 */
	if (!res.ok || !data?.access_token)
		throw new GatewayError(
			data?.error_description ?? "error.credentials",
			data?.error ?? "",
		);
	return data.access_token as string;
}

/**
 * The fields we read from PayPal's replies.
 * One shape covers orders, captures and errors.
 */
type PayPalReply = {
	id?: string;
	status?: string;
	links?: { rel: string; href: string }[];
	payer?: {
		email_address?: string;
		name?: { given_name?: string; surname?: string };
	};
	message?: string;
	name?: string;
	details?: { issue?: string; description?: string }[];
};

/**
 * One authenticated call to PayPal.
 * @param c The merchant's decrypted credentials.
 * @param method HTTP method.
 * @param path Path below the API root, e.g. `/v2/checkout/orders`.
 * @param body JSON body for POSTs.
 * @returns The parsed JSON response.
 * @throws GatewayError when the call fails.
 *   The message is PayPal's own description, else a key of i18n/en.ts.
 *   The issue holds PayPal's machine code for the refusal.
 */
async function call(
	c: Record<string, string>,
	method: "GET" | "POST",
	path: string,
	body?: Record<string, unknown>,
): Promise<PayPalReply> {
	const res = await fetch(root(c) + path, {
		method,
		headers: {
			Authorization: `Bearer ${await token(c)}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data: PayPalReply = await res.json().catch(() => ({}));
	if (!res.ok)
		throw new GatewayError(
			data?.details?.[0]?.description ??
				data?.message ??
				"error.request_failed",
			data?.details?.[0]?.issue ?? data?.name ?? "",
		);
	return data;
}

/**
 * The PayPal gateway.
 * PayPal hosts the page where the buyer approves the order.
 * We take the money when the buyer comes back to the store.
 */
export const payment: HostedPayment = {
	/**
	 * Create the order the buyer is sent to approve.
	 * @param config The merchant's decrypted credentials.
	 * @param a The cart lines, currency and return URLs.
	 *   It also holds our cart reference and the buyer's email.
	 * @returns The PayPal order id, which `/done?token=` carries back,
	 *   and the approval URL to send the buyer to.
	 */
	async createCheckout(config: Config, a: CheckoutArgs) {
		const c = config as Record<string, string>;
		const o = await call(c, "POST", "/v2/checkout/orders", {
			intent: "CAPTURE",
			purchase_units: [
				{
					/**
					 * Our own cart id.
					 * It shows up on the merchant's PayPal activity.
					 */
					custom_id: a.reference,
					description: a.lines
						.map((l) => `${l.qty}× ${l.name}`)
						.join(", ")
						.slice(0, 127),
					amount: {
						currency_code: a.currency.toUpperCase(),
						value: paypalAmount(checkoutTotal(a), a.currency),
					},
				},
			],
			payment_source: {
				paypal: {
					/**
					 * The buyer typed this email on our checkout.
					 * PayPal fills it in on its own page.
					 */
					...(a.email && { email_address: a.email }),
					experience_context: {
						user_action: "PAY_NOW",
						shipping_preference: "NO_SHIPPING",
						return_url: a.successUrl,
						cancel_url: a.cancelUrl,
					},
				},
			},
		});
		const url = (o.links ?? []).find(
			(l) => l.rel === "payer-action" || l.rel === "approve",
		)?.href;
		if (!o.id || !url) throw new GatewayError("error.start_failed");
		return { id: o.id, url };
	},

	/**
	 * Look the order up after the buyer returns.
	 * An order the buyer approved is captured here, so the money moves.
	 * @param config The merchant's decrypted credentials.
	 * @param id The PayPal order id.
	 * @returns Whether it was paid, and who paid it.
	 *   The buyer is their PayPal account email and name.
	 *   An order that can never be paid comes back as failed,
	 *   with PayPal's reason: it was voided, or the capture was turned down.
	 */
	async getPayment(
		config: Config,
		id: string,
		options?: PaymentLookup,
	): Promise<PaymentStatus> {
		const c = config as Record<string, string>;
		let o = await call(
			c,
			"GET",
			`/v2/checkout/orders/${encodeURIComponent(id)}`,
		);
		// The buyer said yes, but the money is taken only by the capture below.
		// The app says no when the discount code of this checkout is over.
		if (o.status === "APPROVED" && options?.capture === false)
			return {
				paid: false,
				buyer: null,
				failed: true,
				reason: "error.code_expired",
			};
		if (o.status === "APPROVED") {
			try {
				o = await call(
					c,
					"POST",
					`/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
					{},
				);
			} catch (e) {
				if (!(e instanceof GatewayError)) throw e;
				/**
				 * Another tab or the reconcile sweep may have captured it first.
				 * That is not a failure, so read the order back instead.
				 * Any other refusal is final: declined, expired, and so on.
				 */
				if (e.issue === "ORDER_ALREADY_CAPTURED")
					o = await call(
						c,
						"GET",
						`/v2/checkout/orders/${encodeURIComponent(id)}`,
					);
				else
					return { paid: false, buyer: null, failed: true, reason: e.message };
			}
		}
		if (o.status === "COMPLETED") {
			const name = [o.payer?.name?.given_name, o.payer?.name?.surname]
				.filter(Boolean)
				.join(" ");
			return {
				paid: true,
				buyer: { email: o.payer?.email_address ?? null, name: name || null },
			};
		}
		return {
			paid: false,
			buyer: null,
			failed: o.status === "VOIDED",
			reason: null,
		};
	},

	/**
	 * PayPal brings the buyer back with its own `?token=<order id>`.
	 * It does not use our `?sid=`.
	 * @param url The return URL.
	 * @returns The PayPal order id, or null when it isn't there.
	 */
	returnId(url: URL) {
		return url.searchParams.get("token");
	},
};
