/**
 * Omise (Thailand) over its REST API, with fetch and form encoding.
 * No npm package, no dependencies.
 * There is no hosted checkout page.
 * Omise's own pre-built form (omise.js / OmiseCard) collects the
 * payment in the buyer's browser, see assets/checkout.ts.
 * The nonce that form returns is charged here.
 * Redirect methods — 3-D Secure, wallets — send the buyer to
 * `charge.authorize_uri` and back.
 * QR methods redirect nowhere: their code is shown on /done.
 */
import type { Charge, Config, PaymentStatus, TokenizePayment } from "../types";

/**
 * The root every Omise API path sits below.
 */
const API = "https://api.omise.co";
/**
 * How long the capability lookup may take.
 * It is capped because the payment page must open
 * even when Omise is slow.
 */
const CAPABILITY_TIMEOUT_MS = 5000;

/**
 * Everything OmiseCard's pre-built form can complete on its own.
 * The list comes from the "Supported Payment Methods for Pre-Built
 * Form" table in https://docs.omise.co/omise-js.
 * `credit_card` is left out on purpose: it is the default tab,
 * not an "other" method.
 * Anything else the account enables — internet_banking_*, truemoney,
 * points_citi, atome, bill_payment_*, barcode_alipay, econtext and
 * the like — needs details the form never asks for.
 * Offering one of those would only produce a dead tab.
 */
const FORM_METHODS = new Set([
	"alipay",
	"alipay_cn",
	"alipay_hk",
	"boost",
	"convenience_store",
	"net_banking",
	"pay_easy",
	"dana",
	"duitnow_obw",
	"duitnow_qr",
	"fpx",
	"gcash",
	"googlepay",
	"applepay",
	"grabpay",
	"installment",
	"kakaopay",
	"maybank_qr",
	"mobile_banking_bay",
	"mobile_banking_bbl",
	"mobile_banking_kbank",
	"mobile_banking_ktb",
	"mobile_banking_ocbc_pao",
	"mobile_banking_scb",
	"paynow",
	"promptpay",
	"rabbit_linepay",
	"shopeepay",
	"touch_n_go",
	"truemoney_jumpapp",
]);

/**
 * A failure the buyer may be shown.
 * A bad key, a declined card, and so on.
 * The POS shows the message.
 */
class GatewayError extends Error {
	override readonly name = "GatewayError";
}

/**
 * Turn stored cents into the amount Omise wants.
 * Omise wants the smallest currency unit.
 * The POS stores 1/100 units, which we call cents.
 * JPY is Omise's only zero-decimal currency.
 * THB satang map 1:1 onto our cents.
 * @param cents The stored amount.
 * @param currency ISO currency code.
 * @returns The amount in Omise's smallest unit for that currency.
 */
export function omiseAmount(cents: number, currency: string) {
	return currency.toUpperCase() === "JPY" ? Math.round(cents / 100) : cents;
}

/**
 * The name the pre-built form knows a method by.
 * Capability lists one entry per installment bank, such as
 * `installment_kbank` or `installment_bay`.
 * The form has a single `installment` tab, and it asks for the
 * bank and the term itself.
 * @param name The method name Omise reported.
 * @returns The name as the pre-built form knows it.
 */
const formId = (name: string) =>
	name.startsWith("installment_") ? "installment" : name;

/**
 * The fields we read from Omise's replies.
 * One shape covers charges, `/capability` and errors.
 */
type OmiseReply = {
	object?: string;
	message?: string;
	id: string;
	status: string;
	paid?: boolean;
	authorize_uri?: string | null;
	failure_code?: string | null;
	failure_message?: string | null;
	card?: { name?: string | null } | null;
	source?: {
		scannable_code?: { image?: { download_uri?: string } } | null;
	} | null;
	payment_backends?: (Record<string, unknown> | null)[];
	payment_methods?: ({ name?: string } | null)[];
};

/**
 * One authenticated call to Omise.
 * It uses HTTP Basic: the key as the username, and a blank password.
 * @param key The `skey_…` secret key, or the `pkey_…` public key,
 *   which is the one `/capability` takes.
 * @param method HTTP method.
 * @param path Path below the API root, e.g. `/charges`.
 * @param params Form body for a POST.
 * @param timeoutMs Abort after this many milliseconds.
 *   Never set it on a charge: a half-sent charge may still land.
 * @returns The parsed JSON response.
 * @throws GatewayError with Omise's own message when the call fails,
 *   else with a key of i18n/en.ts.
 */
async function call(
	key: string,
	method: "GET" | "POST",
	path: string,
	params?: Record<string, string | number | boolean>,
	timeoutMs?: number,
): Promise<OmiseReply> {
	const res = await fetch(API + path, {
		method,
		signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
		headers: {
			Authorization: `Basic ${btoa(`${key}:`)}`,
			...(method === "POST"
				? { "Content-Type": "application/x-www-form-urlencoded" }
				: {}),
		},
		body:
			method === "POST" && params
				? new URLSearchParams(
						Object.entries(params).map(([k, v]): [string, string] => [
							k,
							String(v),
						]),
					)
				: undefined,
	});
	const data: OmiseReply = await res.json().catch(() => ({}));
	/**
	 * Omise's own message is the buyer's best hint.
	 * So it is passed through exactly as it came.
	 * Our own fallback is a dictionary key instead,
	 * which the POS shows in the buyer's language.
	 */
	if (!res.ok || data?.object === "error")
		throw new GatewayError(data?.message ?? "error.request_failed");
	return data;
}

/**
 * The Omise gateway.
 * The provider's own form collects the payment in the browser.
 * The nonce it hands back is charged here.
 */
export const payment: TokenizePayment = {
	/**
	 * Stored cents → Omise's smallest currency unit.
	 * @param cents The stored amount.
	 * @param currency ISO currency code.
	 * @returns What the form shows and the charge costs.
	 */
	amount: omiseAmount,

	/**
	 * Non-card methods this merchant's account has switched on.
	 * They are named the way the browser form names them.
	 * @param config The merchant's decrypted keys.
	 * @returns The method names the pre-built form can complete.
	 *   Any failure gives `[]`, because the list is only a nicety
	 *   and must never stop someone paying by card.
	 */
	async methods(config: Config): Promise<string[]> {
		const c = config as Record<string, string>;
		try {
			/**
			 * Omise says this verb accepts public key authentication only.
			 * The call is capped in time as well, so the payment page
			 * opens even when Omise is slow or unreachable.
			 */
			const cap = await call(
				c.public_key!,
				"GET",
				"/capability",
				undefined,
				CAPABILITY_TIMEOUT_MS,
			);
			/**
			 * The shape Omise documents today is payment_methods: [{name, …}].
			 * The older one, which the omise-php SDK still returns, is
			 * payment_backends: [{ promptpay: {…} }, …].
			 * Read whichever one came back.
			 */
			const names = Array.isArray(cap.payment_backends)
				? cap.payment_backends.flatMap((b) => Object.keys(b ?? {}))
				: (cap.payment_methods ?? []).map((m) => m?.name ?? "");
			return [
				...new Set(
					names
						.filter(Boolean)
						.map(formId)
						.filter((n) => FORM_METHODS.has(n)),
				),
			];
		} catch {
			return [];
		}
	},

	/**
	 * Charge the nonce the browser form produced.
	 * @param config The merchant's decrypted keys.
	 * @param a The nonce, amount, currency and return URI,
	 *   plus our cart reference and a description.
	 * @returns The charge id, and the page to send the buyer through,
	 *   which is null when the charge is already final.
	 *   It also carries a QR code to scan when the method
	 *   redirects nowhere.
	 */
	async charge(
		config: Config,
		a: {
			token: string;
			amount: number;
			currency: string;
			returnUri: string;
			reference: string;
			description: string;
		},
	): Promise<Charge> {
		const c = config as Record<string, string>;
		const ch = await call(c.secret_key!, "POST", "/charges", {
			amount: a.amount,
			currency: a.currency.toUpperCase(),
			/**
			 * omise.js hands back a card token (tokn_…) or a source (src_…).
			 * They go in different parameters, but they fill the same
			 * nonce slot.
			 */
			[a.token.startsWith("src_") ? "source" : "card"]: a.token,
			/**
			 * Where 3-D Secure drops the buyer back off.
			 */
			return_uri: a.returnUri,
			description: a.description,
			"metadata[reference]": a.reference,
		});
		/**
		 * A charge that needs 3-D Secure, or a wallet's own app, is
		 * only authorised after that redirect.
		 * QR methods, whose flow is "offline", redirect nowhere at all.
		 * They hand back a code to scan instead.
		 */
		return {
			id: ch.id,
			url: ch.authorize_uri ?? null,
			qr: ch.source?.scannable_code?.image?.download_uri,
		};
	},

	/**
	 * Look the charge up after the buyer returns.
	 * @param config The merchant's decrypted keys.
	 * @param id The `chrg_…` id the checkout snapshot kept.
	 * @returns Whether it was paid, and who paid.
	 *   Omise only knows the name on the card.
	 *   When the charge is done for — declined, timed out, reversed —
	 *   the answer carries Omise's own reason.
	 */
	async getPayment(config: Config, id: string): Promise<PaymentStatus> {
		const c = config as Record<string, string>;
		const ch = await call(
			c.secret_key!,
			"GET",
			`/charges/${encodeURIComponent(id)}`,
		);
		if (ch.paid === true && ch.status === "successful" && !ch.failure_code)
			return {
				paid: true,
				buyer: { name: ch.card?.name ?? null, email: null },
			};
		/**
		 * A charge that is done for never becomes paid.
		 * Say so, instead of leaving the buyer on a page
		 * that waits forever.
		 */
		const dead =
			["failed", "expired", "reversed"].includes(ch.status) ||
			!!ch.failure_code;
		return {
			paid: false,
			buyer: null,
			failed: dead,
			reason: dead ? (ch.failure_message ?? null) : null,
		};
	},
};
