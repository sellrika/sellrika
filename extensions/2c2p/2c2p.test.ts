/**
 * Used only to cross-check the signature.
 * The code under test signs with Bun.CryptoHasher.
 */
import { createHmac } from "node:crypto";
import { afterEach, expect, test } from "bun:test";
import { jwtDecode, jwtSign, jwtVerify, payment, twoC2PAmount } from "./index";

/**
 * The real fetch, kept so every test can put it back.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
	// one shared process: always put the real fetch back
	globalThis.fetch = realFetch;
});

/**
 * Sandbox credentials every test signs and calls with.
 */
const CREDS = {
	api_url: "https://sandbox-pgw.2c2p.com",
	merchant_id: "JT01",
	secret_key: "merchant-secret",
};
/**
 * One call the code under test made.
 * `url` is where it went, `init` is what was sent.
 */
type Call = { url: string; init: RequestInit };
/**
 * Answer the next calls with a signed payload, and keep what was sent.
 * @param replies One payload per call, in order.
 * @returns The list the calls are recorded into.
 */
function stub(replies: Record<string, unknown>[]) {
	const calls: Call[] = [];
	let i = 0;
	globalThis.fetch = (async (url: any, init: any) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(
			JSON.stringify({
				payload: jwtSign(CREDS.secret_key, replies[i++] ?? {}),
			}),
			{ status: 200 },
		);
	}) as typeof fetch;
	return calls;
}

/**
 * Read back the signed request body 2C2P was sent.
 * @param c The recorded call.
 * @returns The decoded JWT payload of that request.
 */
const sent = (c: Call) => jwtDecode(JSON.parse(String(c.init.body)).payload);

/**
 * Signing matches 2C2P's own samples.
 * Verifying refuses a tampered payload, and decoding never throws.
 */
test("2c2p jwt: HS256 the way 2C2P's own samples sign it, verify rejects a tampered payload, decode never throws", () => {
	const key = "merchant-secret";
	const payload = {
		merchantID: "JT01",
		invoiceNo: "1523953661",
		amount: 1000,
		currencyCode: "SGD",
	};
	const token = jwtSign(key, payload);
	const [h, p, s] = token.split(".");
	expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({
		alg: "HS256",
		typ: "JWT",
	});
	expect(s).toBe(
		createHmac("sha256", key).update(`${h}.${p}`).digest("base64url"),
	);
	expect(jwtVerify(key, token)).toEqual(payload);
	// a payload swapped under the same signature, or another key, is refused
	const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, amount: 1 })).toString("base64url")}.${s}`;
	// a dictionary key: the buyer is shown its text
	expect(() => jwtVerify(key, forged)).toThrow("error.bad_signature");
	expect(() => jwtVerify("other", token)).toThrow("error.bad_signature");
	expect(() => jwtVerify(key, "nope")).toThrow("error.bad_signature");
	// decode is the unchecked read used for the return-POST lookup key
	expect(jwtDecode(forged).amount).toBe(1);
	expect(jwtDecode("garbage")).toEqual({});
});

/**
 * Cents become the currency's major unit, with its own decimals.
 */
test("2c2p amount: major units with the currency's decimals", () => {
	expect(twoC2PAmount(100050, "THB")).toBe(1000.5);
	expect(twoC2PAmount(1, "USD")).toBe(0.01);
	expect(twoC2PAmount(1500000, "IDR")).toBe(15000);
});

/**
 * A checkout asks for a paymentToken with a fresh invoice number.
 * The amount sent is the lines less the discount.
 */
test("2c2p createCheckout: a signed paymentToken with a fresh invoice number, less the discount", async () => {
	const calls = stub([
		{ respCode: "0000", webPaymentUrl: "https://sandbox-pgw.2c2p.com/pay/abc" },
	]);
	const out = await payment.createCheckout(CREDS, {
		lines: [{ name: "Tea", price: 100000, qty: 2 }],
		discount: { label: "Coupon SAVE10", amount: 50 },
		currency: "thb",
		successUrl: "https://shop.test/store/s/done",
		cancelUrl: "https://shop.test/store/s",
		reference: "42",
	});
	expect(out.url).toBe("https://sandbox-pgw.2c2p.com/pay/abc");
	// random, never the cart id
	expect(out.id).toMatch(/^[A-Z0-9]{20}$/);
	expect(calls[0]!.url).toBe(
		"https://sandbox-pgw.2c2p.com/payment/4.3/paymentToken",
	);

	const body = sent(calls[0]!);
	expect(body.merchantID).toBe("JT01");
	expect(body.invoiceNo).toBe(out.id);
	// (2 × 1000.00) − 0.50
	expect(body.amount).toBe(1999.5);
	expect(body.currencyCode).toBe("THB");
	expect(body.frontendReturnUrl).toBe(
		`https://shop.test/store/s/done?sid=${out.id}`,
	);
	expect(body.userDefined1).toBe("42");
	expect(body.description).toBe("2× Tea");
});

/**
 * When 2C2P refuses, the buyer gets 2C2P's own message.
 */
test("2c2p createCheckout: a refusal is an error the buyer may see", async () => {
	stub([{ respCode: "1005", respDesc: "Invalid merchant ID" }]);
	const err = await payment
		.createCheckout(CREDS, {
			lines: [{ name: "Tea", price: 100, qty: 1 }],
			currency: "THB",
			successUrl: "https://s.test/done",
			cancelUrl: "https://s.test",
			reference: "1",
		})
		.catch((e) => e);
	expect(err.name).toBe("GatewayError");
	expect(err.message).toBe("Invalid merchant ID");
});

/**
 * `0000` means paid.
 * The pending codes keep waiting, and anything else is done for.
 */
test("2c2p getPayment: 0000 is paid, the pending codes wait, anything else is done for", async () => {
	const calls = stub([{ respCode: "0000" }]);
	expect(await payment.getPayment(CREDS, "INV1")).toEqual({
		paid: true,
		buyer: null,
	});
	expect(calls[0]!.url).toBe(
		"https://sandbox-pgw.2c2p.com/payment/4.3/paymentInquiry",
	);
	expect(sent(calls[0]!).invoiceNo).toBe("INV1");

	stub([{ respCode: "0001" }]);
	expect(await payment.getPayment(CREDS, "INV1")).toEqual({
		paid: false,
		buyer: null,
		failed: false,
		reason: null,
	});

	stub([{ respCode: "2003", respDesc: "Transaction cancelled" }]);
	expect(await payment.getPayment(CREDS, "INV1")).toEqual({
		paid: false,
		buyer: null,
		failed: true,
		reason: "Transaction cancelled",
	});
});

/**
 * An answer signed with the wrong key is never trusted.
 */
test("2c2p getPayment: an answer signed with the wrong key is refused", async () => {
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				payload: jwtSign("someone-else", { respCode: "0000" }),
			}),
			{ status: 200 },
		)) as unknown as typeof fetch;
	const err = await payment.getPayment(CREDS, "INV1").catch((e) => e);
	expect(err.name).toBe("GatewayError");
	/**
	 * The message is a dictionary key.
	 * The storefront shows i18n/<locale>.ts's text for it.
	 */
	expect(err.message).toBe("error.bad_signature");
});

/**
 * The invoice number is read out of the JWT 2C2P posts back.
 */
test("2c2p returnId: the invoice number comes out of the JWT 2C2P posts back", () => {
	const form = new FormData();
	form.set(
		"paymentResponse",
		jwtSign(CREDS.secret_key, { invoiceNo: "INV1", respCode: "0000" }),
	);
	const url = new URL("https://shop.test/store/s/done");
	expect(payment.returnId!(url, form)).toBe("INV1");
	expect(payment.returnId!(url, new FormData())).toBeNull();
	expect(payment.returnId!(url, null)).toBeNull();
});
