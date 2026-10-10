import { afterEach, expect, test } from "bun:test";
import { paypalAmount, payment } from "./index";

/**
 * The real fetch, kept so it can be put back.
 * All tests share one process.
 * A stub left in place would break every later test file.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/**
 * The merchant credentials every test calls with.
 * The sandbox host shows up in the URLs the tests check.
 */
const CREDS = {
	api_url: "https://api-m.sandbox.paypal.com",
	client_id: "cid",
	client_secret: "csec",
};

/**
 * The token reply.
 * Every call to PayPal mints a token first, so this comes first
 * in most reply lists.
 */
const TOKEN = { body: { access_token: "at_1" } };

/**
 * One call the stub caught.
 * It holds where the call went and what was sent with it.
 */
type Call = { url: string; init: RequestInit };

/**
 * Take over fetch and answer the next calls with canned replies.
 * A call past the end of the list gets an empty body.
 * @param replies The replies to hand back, in order.
 * @returns The list the calls are pushed into, so a test can check them.
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

test("paypal amount: a decimal string in major units, whole for the no-decimal currencies", () => {
	expect(paypalAmount(100050, "USD")).toBe("1000.50");
	expect(paypalAmount(1, "usd")).toBe("0.01");
	expect(paypalAmount(150000, "JPY")).toBe("1500");
	expect(paypalAmount(150050, "HUF")).toBe("1501");
});

test("paypal createCheckout: a client-credentials token, then an order for the lines less the discount", async () => {
	const calls = stub([
		TOKEN,
		{
			body: {
				id: "ord_1",
				status: "PAYER_ACTION_REQUIRED",
				links: [
					{ rel: "self", href: "x" },
					{ rel: "payer-action", href: "https://paypal.com/approve/ord_1" },
				],
			},
		},
	]);
	const out = await payment.createCheckout(CREDS, {
		lines: [{ name: "Tea", price: 100000, qty: 2 }],
		discount: { label: "Coupon SAVE10", amount: 50 },
		currency: "usd",
		successUrl: "https://shop.test/store/s/done",
		cancelUrl: "https://shop.test/store/s",
		reference: "42",
		email: "buyer@test.dev",
	});
	expect(out).toEqual({ id: "ord_1", url: "https://paypal.com/approve/ord_1" });

	expect(calls[0]!.url).toBe(
		"https://api-m.sandbox.paypal.com/v1/oauth2/token",
	);
	expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
		`Basic ${Buffer.from("cid:csec").toString("base64")}`,
	);
	expect(calls[0]!.init.body).toBe("grant_type=client_credentials");

	expect(calls[1]!.url).toBe(
		"https://api-m.sandbox.paypal.com/v2/checkout/orders",
	);
	expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe(
		"Bearer at_1",
	);
	const body = JSON.parse(String(calls[1]!.init.body));
	expect(body.intent).toBe("CAPTURE");
	expect(body.purchase_units[0].custom_id).toBe("42");
	expect(body.purchase_units[0].description).toBe("2× Tea");
	// two lines at 1000.00 each, less the 0.50 coupon
	expect(body.purchase_units[0].amount).toEqual({
		currency_code: "USD",
		value: "1999.50",
	});
	expect(body.payment_source.paypal.email_address).toBe("buyer@test.dev");
	expect(body.payment_source.paypal.experience_context).toEqual({
		user_action: "PAY_NOW",
		shipping_preference: "NO_SHIPPING",
		return_url: "https://shop.test/store/s/done",
		cancel_url: "https://shop.test/store/s",
	});
});

test("paypal getPayment: an approved order is captured, and the payer comes back with it", async () => {
	const calls = stub([
		TOKEN,
		{ body: { id: "ord_1", status: "APPROVED" } },
		TOKEN,
		{
			body: {
				status: "COMPLETED",
				payer: {
					email_address: "b@t.dev",
					name: { given_name: "Bee", surname: "Tea" },
				},
			},
		},
	]);
	expect(await payment.getPayment(CREDS, "ord_1")).toEqual({
		paid: true,
		buyer: { email: "b@t.dev", name: "Bee Tea" },
	});
	expect(calls[3]!.url).toBe(
		"https://api-m.sandbox.paypal.com/v2/checkout/orders/ord_1/capture",
	);
});

test("paypal getPayment: told not to take the money, an approved order is not captured", async () => {
	// the checkout's discount code is no longer held: the total no longer stands
	const calls = stub([TOKEN, { body: { id: "ord_1", status: "APPROVED" } }]);
	expect(await payment.getPayment(CREDS, "ord_1", { capture: false })).toEqual({
		paid: false,
		buyer: null,
		failed: true,
		reason: "error.code_expired",
	});
	expect(calls.some((c) => c.url.endsWith("/capture"))).toBe(false);
});

test("paypal getPayment: someone else captured it first — read the order back instead of failing", async () => {
	stub([
		TOKEN,
		{ body: { status: "APPROVED" } },
		TOKEN,
		{
			status: 422,
			body: {
				details: [
					{
						issue: "ORDER_ALREADY_CAPTURED",
						description: "Order already captured",
					},
				],
			},
		},
		TOKEN,
		{ body: { status: "COMPLETED", payer: { email_address: "b@t.dev" } } },
	]);
	expect(await payment.getPayment(CREDS, "ord_1")).toEqual({
		paid: true,
		buyer: { email: "b@t.dev", name: null },
	});
});

test("paypal getPayment: a declined capture is done for, a voided order too, anything else waits", async () => {
	stub([
		TOKEN,
		{ body: { status: "APPROVED" } },
		TOKEN,
		{
			status: 422,
			body: {
				details: [
					{
						issue: "INSTRUMENT_DECLINED",
						description: "The instrument was declined",
					},
				],
			},
		},
	]);
	expect(await payment.getPayment(CREDS, "ord_1")).toEqual({
		paid: false,
		buyer: null,
		failed: true,
		reason: "The instrument was declined",
	});

	stub([TOKEN, { body: { status: "VOIDED" } }]);
	expect(await payment.getPayment(CREDS, "ord_1")).toEqual({
		paid: false,
		buyer: null,
		failed: true,
		reason: null,
	});

	stub([TOKEN, { body: { status: "CREATED" } }]);
	expect(await payment.getPayment(CREDS, "ord_1")).toEqual({
		paid: false,
		buyer: null,
		failed: false,
		reason: null,
	});
});

test("paypal: bad credentials are an error the buyer may see", async () => {
	stub([
		{
			status: 401,
			body: {
				error: "invalid_client",
				error_description: "Client Authentication failed",
			},
		},
	]);
	const err = await payment.getPayment(CREDS, "ord_1").catch((e) => e);
	expect(err.name).toBe("GatewayError");
	expect(err.message).toBe("Client Authentication failed");
});

test("paypal returnId: PayPal appends its own ?token=<order id>", () => {
	expect(
		payment.returnId!(
			new URL("https://shop.test/store/s/done?token=ord_1"),
			null,
		),
	).toBe("ord_1");
	expect(
		payment.returnId!(new URL("https://shop.test/store/s/done"), null),
	).toBeNull();
});
