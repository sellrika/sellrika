import { afterEach, expect, test } from "bun:test";
import { omiseAmount, payment } from "./index";

/**
 * The real fetch, kept so every test can put it back.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
	// one shared process: always put the real fetch back
	globalThis.fetch = realFetch;
});

/**
 * One call the code under test made.
 * `url` is where it went, `init` is what was sent.
 */
type Call = { url: string; init: RequestInit };
/**
 * Answer the next calls with these canned replies, and keep what was sent.
 * @param replies One reply body per call, in order, with its status.
 * @returns The list the calls are recorded into.
 */
function stub(replies: { body: unknown; status?: number }[]) {
	const calls: Call[] = [];
	let i = 0;
	globalThis.fetch = (async (url: any, init: any) => {
		calls.push({ url: String(url), init: init ?? {} });
		const r = replies[i++] ?? { body: {} };
		return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
	}) as typeof fetch;
	return calls;
}

/**
 * The charge every test sends, unless it changes a field.
 */
const CHARGE = {
	token: "tokn_1",
	amount: 1250,
	currency: "thb",
	returnUri: "https://s.test/done?sid=omise_1",
	reference: "omise_1",
	description: "Shop — 1× Tea",
};

/**
 * Stored cents become the currency's smallest unit.
 */
test("omise amount: stored cents to the currency's smallest unit", () => {
	// satang map 1:1 onto our cents
	expect(omiseAmount(1250, "THB")).toBe(1250);
	expect(omiseAmount(1250, "thb")).toBe(1250);
	// JPY is Omise's only zero-decimal currency: ¥500 is stored as 50000
	expect(omiseAmount(50000, "JPY")).toBe(500);
	expect(payment.amount(50000, "JPY")).toBe(500);
});

/**
 * A card token is sent in `card`.
 * The call signs in with the secret key over HTTP Basic.
 */
test("omise charge: a card token goes in `card`, basic auth with the secret key", async () => {
	const calls = stub([
		{ body: { id: "chrg_1", authorize_uri: "https://omise.co/pay/3ds" } },
	]);
	expect(await payment.charge({ secret_key: "skey_test_1" }, CHARGE)).toEqual({
		id: "chrg_1",
		url: "https://omise.co/pay/3ds",
		qr: undefined,
	});
	expect(calls[0]!.url).toBe("https://api.omise.co/charges");
	expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
		`Basic ${btoa("skey_test_1:")}`,
	);
	const body = new URLSearchParams(String(calls[0]!.init.body));
	expect(body.get("card")).toBe("tokn_1");
	expect(body.get("source")).toBeNull();
	expect(body.get("amount")).toBe("1250");
	expect(body.get("currency")).toBe("THB");
	expect(body.get("return_uri")).toBe(CHARGE.returnUri);
	expect(body.get("metadata[reference]")).toBe("omise_1");
});

/**
 * A source nonce is sent in `source`.
 * A QR method redirects nowhere and hands back a code instead.
 */
test("omise charge: a source nonce goes in `source`, and a QR method redirects nowhere", async () => {
	const calls = stub([
		{
			body: {
				id: "chrg_2",
				source: {
					scannable_code: {
						image: { download_uri: "https://omise.co/qr.png" },
					},
				},
			},
		},
	]);
	expect(
		await payment.charge({ secret_key: "skey" }, { ...CHARGE, token: "src_1" }),
	).toEqual({ id: "chrg_2", url: null, qr: "https://omise.co/qr.png" });
	const body = new URLSearchParams(String(calls[0]!.init.body));
	expect(body.get("source")).toBe("src_1");
	expect(body.get("card")).toBeNull();
});

/**
 * Only the methods the pre-built form can complete are offered.
 * Every installment bank folds into one tab.
 */
test("omise methods: only what the pre-built form can complete, installments folded into one tab", async () => {
	const calls = stub([
		{
			body: {
				payment_methods: [
					{ name: "promptpay" },
					{ name: "installment_kbank" },
					{ name: "installment_bay" },
					{ name: "truemoney" },
					{ name: "credit_card" },
				],
			},
		},
	]);
	expect(
		(await payment.methods!({ public_key: "pkey_test_1" })).sort(),
	).toEqual(["installment", "promptpay"]);
	expect(calls[0]!.url).toBe("https://api.omise.co/capability");
	expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
		`Basic ${btoa("pkey_test_1:")}`,
	);

	// the older shape the omise-php SDK still returns
	stub([{ body: { payment_backends: [{ promptpay: {} }, { econtext: {} }] } }]);
	expect(await payment.methods!({ public_key: "pkey" })).toEqual(["promptpay"]);

	// a nicety, never a blocker: any failure is an empty list
	stub([
		{
			status: 401,
			body: { object: "error", message: "authentication failure" },
		},
	]);
	expect(await payment.methods!({ public_key: "pkey" })).toEqual([]);
});

/**
 * A paid charge carries the name on the card.
 * A charge that is done for carries Omise's reason.
 */
test("omise getPayment: paid with the name on the card, and a dead charge carries Omise's reason", async () => {
	stub([
		{ body: { paid: true, status: "successful", card: { name: "BEE T" } } },
	]);
	expect(await payment.getPayment({ secret_key: "skey" }, "chrg_1")).toEqual({
		paid: true,
		buyer: { name: "BEE T", email: null },
	});

	stub([
		{
			body: {
				paid: false,
				status: "failed",
				failure_code: "insufficient_fund",
				failure_message: "Insufficient funds",
			},
		},
	]);
	expect(await payment.getPayment({ secret_key: "skey" }, "chrg_1")).toEqual({
		paid: false,
		buyer: null,
		failed: true,
		reason: "Insufficient funds",
	});

	stub([{ body: { paid: false, status: "pending" } }]);
	expect(await payment.getPayment({ secret_key: "skey" }, "chrg_1")).toEqual({
		paid: false,
		buyer: null,
		failed: false,
		reason: null,
	});
});

/**
 * A refusal is passed on with Omise's own message.
 */
test("omise: a refusal carries Omise's own message, as an error the buyer may see", async () => {
	// Omise answers 200 with `object: "error"` too
	// that is a failure just the same
	stub([
		{
			body: {
				object: "error",
				code: "invalid_card",
				message: "number is invalid",
			},
		},
	]);
	const err = await payment
		.charge({ secret_key: "skey" }, CHARGE)
		.catch((e) => e);
	expect(err.name).toBe("GatewayError");
	expect(err.message).toBe("number is invalid");
});
