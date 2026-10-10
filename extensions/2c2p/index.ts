/**
 * 2C2P (Thailand / SEA) Payment API 4.3, redirect integration.
 * Plain fetch only: no npm package, no dependencies.
 * Every request and response body is `{"payload": "<JWT>"}`.
 * The JWT is signed HS256 with the merchant's secret key
 * (https://developer.2c2p.com/docs/json-web-tokens-jwt).
 * A failed call may come back as plain `{respCode, respDesc}`
 * with no payload at all.
 * 2C2P hosts the payment page and offers every channel the
 * merchant's account has switched on: no `paymentChannel` = all of them.
 * It sends the buyer back with a POST, so `returnId` reads the
 * invoice number out of the posted JWT.
 * The payment itself is always confirmed by a Payment Inquiry.
 */
import type {
	CheckoutArgs,
	Config,
	HostedPayment,
	PaymentStatus,
} from "../types";

/**
 * Every API 4.3 path sits below this one.
 */
const API_PATH = "/payment/4.3";
/**
 * Payment Inquiry `respCode`s that mean "not paid yet".
 * They are: pending, in progress, request in progress,
 * and "not found", which means the buyer never started paying.
 * `0000` is paid; anything else is done for.
 * See https://developer.2c2p.com/docs/response-code-payment.
 */
const PENDING = new Set(["0001", "2001", "4009", "2002"]);
/**
 * How many characters an `invoiceNo` we make has.
 * 2C2P allows AN 50, but QR channels cap it at 20 alphanumerics.
 * 20 random ones is 36^20, so nobody can guess one.
 */
const INVOICE_LENGTH = 20;
/**
 * ISO 4217's zero-decimal currencies.
 * They are charged as whole units, not hundredths.
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
 * A failure the buyer may be shown.
 * A bad key, 2C2P refusing the call, and so on.
 * The POS shows the message.
 */
class GatewayError extends Error {
	override readonly name = "GatewayError";
}

/**
 * The amount a hosted checkout charges.
 * It is the cart lines less the discount, never below zero.
 * @param a The cart lines and the discount, if there is one.
 * @returns The amount to charge, in stored cents.
 */
const checkoutTotal = (a: Pick<CheckoutArgs, "lines" | "discount">) =>
	Math.max(
		0,
		a.lines.reduce((s, l) => s + l.price * l.qty, 0) -
			(a.discount?.amount ?? 0),
	);

/**
 * Turn stored cents into the amount 2C2P wants.
 * 2C2P wants a decimal in the currency's major unit,
 * with that currency's own number of decimals.
 * @param cents The stored amount.
 * @param currency ISO currency code.
 * @returns 1000.5 for THB, or 15000 for IDR, which takes no decimals.
 */
export function twoC2PAmount(cents: number, currency: string) {
	return ZERO_DECIMAL.has(currency.toUpperCase())
		? Math.round(cents / 100)
		: Number((cents / 100).toFixed(2));
}

/**
 * Base64url encoding, the form a JWT is written in.
 * @param s The text or bytes to encode.
 * @returns The encoded string.
 */
const b64url = (s: string | Uint8Array) => Buffer.from(s).toString("base64url");

/**
 * HS256 signature of `data` with `key`, base64url.
 * @param key The merchant's secret key.
 * @param data The `<header>.<payload>` string to sign.
 * @returns The signature part of the JWT.
 */
const sign = (key: string, data: string) =>
	b64url(new Bun.CryptoHasher("sha256", key).update(data).digest());

/**
 * Build a signed JWT the way 2C2P expects it.
 * @param key The merchant's secret key.
 * @param payload The request parameters.
 * @returns `<header>.<payload>.<signature>`.
 */
export function jwtSign(key: string, payload: Record<string, unknown>) {
	const body = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
	return `${body}.${sign(key, body)}`;
}

/**
 * Check a JWT's signature and read its payload.
 * @param key The merchant's secret key.
 * @param token The JWT 2C2P answered with.
 * @returns The decoded payload.
 * @throws GatewayError when the token is malformed, or when the
 *   signature does not match. Its message is a key of i18n/en.ts.
 */
export function jwtVerify(key: string, token: string): Record<string, unknown> {
	const [h, p, s] = token.split(".");
	// a timing-safe compare is not needed: this is 2C2P's reply to us
	if (!h || !p || !s || sign(key, `${h}.${p}`) !== s)
		throw new GatewayError("error.bad_signature");
	return jwtDecode(token);
}

/**
 * Read a JWT's payload *without* checking it.
 * Only used to pull a lookup key out of the form 2C2P
 * POSTs the buyer back with.
 * The payment itself is always verified by a Payment Inquiry.
 * @param token The JWT.
 * @returns The decoded payload, or `{}` when it isn't one.
 */
export function jwtDecode(token: string): Record<string, unknown> {
	try {
		return JSON.parse(
			Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
		);
	} catch {
		return {};
	}
}

/**
 * The characters an `invoiceNo` we make is built from.
 */
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/**
 * Make a fresh `invoiceNo`.
 * 2C2P needs it unique per merchant, and it doubles as our `?sid=`.
 * So it is random, never the cart id.
 * @returns A new invoice number of `INVOICE_LENGTH` characters.
 */
const invoiceNo = () =>
	Array.from(
		crypto.getRandomValues(new Uint8Array(INVOICE_LENGTH)),
		(b) => ALNUM[b % ALNUM.length],
	).join("");

/**
 * The fields we read from 2C2P's replies.
 * One shape covers the plain reply and the JWT payload inside it.
 */
type TwoC2PReply = {
	respCode?: string;
	respDesc?: string;
	webPaymentUrl?: string;
	payload?: unknown;
};

/**
 * One signed call to 2C2P.
 * @param c The merchant's `api_url`, `merchant_id` and `secret_key`.
 * @param path Path below `/payment/4.3`, e.g. `/paymentToken`.
 * @param params The request payload (`merchantID` is filled in here).
 * @returns The verified response payload.
 *   Judging its `respCode` is left to the caller.
 * @throws GatewayError with 2C2P's own message when the call fails,
 *   else with a key of i18n/en.ts.
 */
async function call(
	c: Record<string, string>,
	path: string,
	params: Record<string, unknown>,
): Promise<TwoC2PReply> {
	const res = await fetch(c.api_url!.replace(/\/+$/, "") + API_PATH + path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			payload: jwtSign(c.secret_key!, { merchantID: c.merchant_id, ...params }),
		}),
	});
	const data: TwoC2PReply = await res.json().catch(() => ({}));
	/**
	 * 2C2P's own respDesc is the buyer's best hint.
	 * So it is passed through exactly as it came.
	 * Our own fallback is a dictionary key instead,
	 * which the POS shows in the buyer's language.
	 */
	if (!res.ok) throw new GatewayError(data?.respDesc ?? "error.request_failed");
	return typeof data?.payload === "string"
		? (jwtVerify(c.secret_key!, data.payload) as TwoC2PReply)
		: data;
}

/**
 * The 2C2P gateway.
 * The provider hosts the payment page.
 * We send the buyer there, and 2C2P sends them back.
 */
export const payment: HostedPayment = {
	/**
	 * Create the hosted payment page the buyer is sent to.
	 * @param config The merchant's decrypted credentials.
	 * @param a Cart lines, currency, return URLs, our cart reference.
	 * @returns The invoice number, which `/done?sid=` carries back,
	 *   and the URL to redirect the buyer to.
	 */
	async createCheckout(config: Config, a: CheckoutArgs) {
		const c = config as Record<string, string>;
		const id = invoiceNo();
		const r = await call(c, "/paymentToken", {
			invoiceNo: id,
			description: a.lines
				.map((l) => `${l.qty}× ${l.name}`)
				.join(", ")
				.replace(/[<>&"]/g, "")
				.slice(0, 250),
			amount: twoC2PAmount(checkoutTotal(a), a.currency),
			currencyCode: a.currency.toUpperCase(),
			/**
			 * 2C2P POSTs the buyer back to this URL.
			 * The query is only a hint: the JWT it posts carries
			 * `invoiceNo` too.
			 */
			frontendReturnUrl: `${a.successUrl}?sid=${id}`,
			/**
			 * Our cart id.
			 * It shows on the merchant's 2C2P dashboard.
			 */
			userDefined1: a.reference,
		});
		if (r.respCode !== "0000" || !r.webPaymentUrl)
			throw new GatewayError(r.respDesc ?? "error.start_failed");
		return { id, url: r.webPaymentUrl };
	},

	/**
	 * Look the payment up after the buyer returns.
	 * @param config The merchant's decrypted credentials.
	 * @param id The invoice number from `?sid=`.
	 * @returns Whether it was paid. 2C2P knows no buyer details.
	 *   When it is done for — cancelled, declined and the like —
	 *   the answer carries 2C2P's own reason.
	 */
	async getPayment(config: Config, id: string): Promise<PaymentStatus> {
		const c = config as Record<string, string>;
		const r = await call(c, "/paymentInquiry", { invoiceNo: id, locale: "en" });
		if (r.respCode === "0000") return { paid: true, buyer: null };
		const dead = !PENDING.has(r.respCode ?? "");
		return {
			paid: false,
			buyer: null,
			failed: dead,
			reason: dead ? (r.respDesc ?? null) : null,
		};
	},

	/**
	 * Read the invoice number out of the JWT 2C2P posted.
	 * 2C2P brings the buyer back with a POST, not with our `?sid=`.
	 * @param _url The return URL. Unused, the id is in the form.
	 * @param form The posted form, when there was one.
	 * @returns The invoice number, or null when the form carries none.
	 */
	returnId(_url: URL, form: FormData | null) {
		const invoice = jwtDecode(
			String(form?.get("paymentResponse") ?? ""),
		).invoiceNo;
		return typeof invoice === "string" && invoice ? invoice : null;
	},
};
