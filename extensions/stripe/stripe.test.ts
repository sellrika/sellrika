import { afterEach, expect, test } from "bun:test";
import { payment, stripeAmount } from "./index";

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

test("stripe amount: stored cents to the currency's smallest unit", () => {
	// a two-decimal currency keeps the stored cents as they are
	expect(stripeAmount(1250, "USD")).toBe(1250);
	// a zero-decimal currency: ¥500 is stored as 50000
	expect(stripeAmount(50000, "JPY")).toBe(500);
	// a three-decimal currency: fils, so the last digit is 0
	expect(stripeAmount(1250, "KWD")).toBe(12500);
});

test("stripe createCheckout: a one-off coupon for the discount, then the session that uses it", async () => {
	const calls = stub([
		{ body: { id: "co_1" } },
		{ body: { id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" } },
	]);
	const out = await payment.createCheckout(
		{ secret_key: "sk_test_1" },
		{
			lines: [{ name: "Tea", price: 1000, qty: 2 }],
			discount: { label: "Coupon SAVE10", amount: 200 },
			currency: "USD",
			successUrl: "https://shop.test/store/s/done",
			cancelUrl: "https://shop.test/store/s",
			reference: "42",
			email: "buyer@test.dev",
		},
	);
	expect(out).toEqual({
		id: "cs_1",
		url: "https://checkout.stripe.com/c/cs_1",
	});

	expect(calls[0]!.url).toBe("https://api.stripe.com/v1/coupons");
	expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
		"Bearer sk_test_1",
	);
	const coupon = new URLSearchParams(String(calls[0]!.init.body));
	expect(coupon.get("duration")).toBe("once");
	expect(coupon.get("amount_off")).toBe("200");
	expect(coupon.get("currency")).toBe("usd");
	expect(coupon.get("name")).toBe("Coupon SAVE10");

	expect(calls[1]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
	const session = new URLSearchParams(String(calls[1]!.init.body));
	expect(session.get("discounts[0][coupon]")).toBe("co_1");
	expect(session.get("mode")).toBe("payment");
	expect(session.get("client_reference_id")).toBe("42");
	expect(session.get("success_url")).toBe(
		"https://shop.test/store/s/done?sid={CHECKOUT_SESSION_ID}",
	);
	expect(session.get("cancel_url")).toBe("https://shop.test/store/s");
	expect(session.get("customer_email")).toBe("buyer@test.dev");
	expect(session.get("line_items[0][quantity]")).toBe("2");
	expect(session.get("line_items[0][price_data][unit_amount]")).toBe("1000");
	expect(session.get("line_items[0][price_data][product_data][name]")).toBe(
		"Tea",
	);
});

test("stripe createCheckout: no discount means no coupon call at all", async () => {
	const calls = stub([
		{ body: { id: "cs_2", url: "https://checkout.stripe.com/c/cs_2" } },
	]);
	await payment.createCheckout(
		{ secret_key: "sk" },
		{
			lines: [{ name: "Tea", price: 500, qty: 1 }],
			currency: "USD",
			successUrl: "https://s.test/done",
			cancelUrl: "https://s.test",
			reference: "1",
		},
	);
	expect(calls).toHaveLength(1);
	expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
});

test("stripe getPayment: paid with the buyer, and an expired session is done for", async () => {
	stub([
		{
			body: {
				payment_status: "paid",
				status: "complete",
				customer_details: { email: "b@t.dev", name: "Bee" },
			},
		},
	]);
	expect(await payment.getPayment({ secret_key: "sk" }, "cs_1")).toEqual({
		paid: true,
		buyer: { email: "b@t.dev", name: "Bee" },
		failed: false,
	});

	stub([{ body: { payment_status: "unpaid", status: "expired" } }]);
	expect(await payment.getPayment({ secret_key: "sk" }, "cs_1")).toEqual({
		paid: false,
		buyer: null,
		failed: true,
	});

	stub([{ body: { payment_status: "unpaid", status: "open" } }]);
	expect(await payment.getPayment({ secret_key: "sk" }, "cs_1")).toEqual({
		paid: false,
		buyer: null,
		failed: false,
	});
});

test("stripe: a refusal carries Stripe's own message, as an error the buyer may see", async () => {
	stub([
		{ status: 402, body: { error: { message: "Your card was declined." } } },
	]);
	const err = await payment
		.getPayment({ secret_key: "sk" }, "cs_1")
		.catch((e) => e);
	expect(err.name).toBe("GatewayError");
	expect(err.message).toBe("Your card was declined.");
});
