import { afterEach, beforeEach, expect, test } from "bun:test";
import type { CollectionRow, ExtensionData } from "../types";
import type { OrderAnswer } from "./assets/utils.ts";
import { problemOf } from "./assets/utils.ts";
import listeners, { routes, timing } from "./index";
import { stripeAmount } from "./stripe";

/**
 * The real fetch, kept so it can be put back.
 * All tests share one process.
 * A stub left in place would break every later test file.
 */
const realFetch = globalThis.fetch;
const realGrace = timing.grace;
beforeEach(() => {
	timing.grace = 0;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	timing.grace = realGrace;
});

/** One call the stand-in caught: `POST /payment_intents` and its form. */
type Call = { op: string; form: URLSearchParams };

/**
 * A small stand-in for Stripe: readers, payment intents and refunds.
 * `tap()` plays the customer's card, `decline()` a refused one.
 * `fail` makes the next call to a path answer with an error.
 */
function fakeStripe() {
	const intents = new Map<string, { status: string }>();
	const readers = new Map<
		string,
		{ label: string; status: string; action: Record<string, unknown> | null }
	>([
		["tmr_front", { label: "Front till", status: "online", action: null }],
		["tmr_back", { label: "Back till", status: "offline", action: null }],
	]);
	const calls: Call[] = [];
	const fail = new Map<string, string>();
	/**
	 * Answer with Stripe's error shape.
	 * @param message The error's text.
	 * @returns The response.
	 */
	function refuse(message: string) {
		return Response.json({ error: { message } }, { status: 402 });
	}
	globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
		const path = String(url).replace("https://api.stripe.com/v1", "");
		const method = init.method ?? "GET";
		const form = new URLSearchParams(String(init.body ?? ""));
		const op = `${method} ${path}`;
		calls.push({ op, form });
		const planned = fail.get(op);
		if (planned) {
			fail.delete(op);
			return refuse(planned);
		}
		const [, a, b, c, d] = path.split("?")[0]!.split("/");
		if (a === "terminal" && !c)
			return Response.json({
				data: [...readers].map(([id, r]) => ({ id, ...r })),
			});
		if (a === "terminal") {
			const reader = readers.get(c ?? "");
			if (!reader) return refuse("No such reader");
			if (d === "process_payment_intent") {
				if (reader.status !== "online") return refuse("Reader is offline");
				if (reader.action?.status === "in_progress")
					return refuse("Reader is busy");
				reader.action = {
					status: "in_progress",
					process_payment_intent: {
						payment_intent: form.get("payment_intent"),
					},
				};
			}
			if (d === "cancel_action") reader.action = null;
			return Response.json({ id: c, ...reader });
		}
		if (a === "payment_intents" && !b) {
			const id = `pi_${intents.size + 1}`;
			intents.set(id, { status: "requires_payment_method" });
			return Response.json({ id, status: "requires_payment_method" });
		}
		if (a === "payment_intents") {
			const intent = intents.get(b ?? "");
			if (!intent) return refuse("No such payment_intent");
			if (c === "capture") {
				if (intent.status !== "requires_capture")
					return refuse("This PaymentIntent could not be captured");
				intent.status = "succeeded";
			}
			if (c === "cancel") intent.status = "canceled";
			return Response.json({ id: b, ...intent });
		}
		if (a === "refunds") return Response.json({ id: `re_${calls.length}` });
		return refuse("Unknown path");
	}) as typeof fetch;
	return {
		calls,
		intents,
		readers,
		fail,
		/** The calls that changed something, as `POST /path` texts. */
		posts: () => calls.filter((c) => c.op.startsWith("POST")).map((c) => c.op),
		/**
		 * The customer taps a good card: the money is held.
		 * @param pi The charge on the reader.
		 */
		tap(pi: string) {
			intents.get(pi)!.status = "requires_capture";
			for (const r of readers.values())
				if (r.action) r.action = { ...r.action, status: "succeeded" };
		},
		/**
		 * The customer taps a card the bank refuses.
		 * @param reader The reader.
		 * @param message What Stripe says.
		 */
		decline(reader: string, message: string) {
			const r = readers.get(reader)!;
			r.action = { ...r.action, status: "failed", failure_message: message };
		},
	};
}

/**
 * The extension's data for one shop, kept in memory.
 * Collections list newest first, like the real ones.
 * @returns The data and the rows of every collection, for a test to read.
 */
function fakeData() {
	const rows: (CollectionRow<unknown> & { list: string })[] = [];
	const locks = new Map<string, Promise<unknown>>();
	let next = 1;
	const data: ExtensionData = {
		get: async () => null,
		set: async () => {},
		delete: async () => {},
		collection: <T>(name: string) => ({
			async add(value: T, ref = "") {
				rows.push({
					id: next,
					ref,
					value,
					list: name,
					created_at: "",
					updated_at: "",
				});
				return next++;
			},
			async get(id: number) {
				return (rows.find((r) => r.id === id) as CollectionRow<T>) ?? null;
			},
			async list(query = {}) {
				const found = rows
					.filter((r) => r.list === name)
					.filter((r) => query.ref == null || r.ref === query.ref)
					.sort((x, y) => y.id - x.id) as CollectionRow<T>[];
				return {
					data: found.slice(0, query.per_page ?? 20),
					total: found.length,
					page: 1,
					per_page: query.per_page ?? 20,
					last_page: 1,
				};
			},
			async update(id: number, value: T) {
				const row = rows.find((r) => r.id === id);
				if (row) row.value = value;
			},
			async delete(id: number) {
				const at = rows.findIndex((r) => r.id === id);
				if (at >= 0) rows.splice(at, 1);
			},
			async clear() {},
		}),
		lock<T>(name: string, job: () => Promise<T>) {
			const before = locks.get(name) ?? Promise.resolve();
			const run = before.then(job, job);
			locks.set(
				name,
				run.catch(() => {}),
			);
			return run;
		},
	};
	return { data, rows };
}

/** What every route and listener of a test shares. */
type World = ReturnType<typeof fakeData> & { currency: string };

/**
 * Call one of the extension's staff routes.
 * @param w The shop's data and currency.
 * @param route The route, like `"POST /charge"`.
 * @param opts The JSON body, the query string and the `:id`.
 * @returns The status and the JSON answer.
 */
async function hit(
	w: World,
	route: string,
	opts: { body?: unknown; query?: string; id?: number } = {},
) {
	const url = new URL(`http://app.test/ext/stripe-terminal${opts.query ?? ""}`);
	const out = await routes[route]!({
		req: new Request(url, {
			method: "POST",
			body: JSON.stringify(opts.body ?? {}),
		}),
		url,
		params: { id: String(opts.id ?? "") },
		shop: { id: 7, currency: w.currency },
		config: { secret_key: "sk_test_1" },
		t: (key: string) => key,
		data: w.data,
	} as never);
	return out instanceof Response
		? { status: out.status, body: await out.json() }
		: { status: 200, body: out as any };
}

/**
 * Fire one of the extension's listeners, like the app does after a write.
 * @param w The shop's data and currency.
 * @param event The event.
 * @param more The event's own data.
 * @returns When the listener is done (it throws what the app would log).
 */
function fire(
	w: World,
	event: keyof typeof listeners,
	more: Record<string, unknown>,
) {
	return listeners[event]({
		shop: { id: 7, currency: w.currency },
		config: { secret_key: "sk_test_1" },
		t: (key: string) => key,
		data: w.data,
		...more,
	} as never);
}

/**
 * Charge a card up to Approved: send, tap, ask.
 * @param w The shop's data and currency.
 * @param stripe The Stripe stand-in.
 * @param amount The cents.
 * @returns The PaymentIntent ID, which is the payment reference.
 */
async function approved(
	w: World,
	stripe: ReturnType<typeof fakeStripe>,
	amount: number,
) {
	const sent = await hit(w, "POST /charge", {
		body: { reader: "tmr_front", amount },
	});
	const pi: string = sent.body.pi;
	stripe.tap(pi);
	expect((await hit(w, "GET /status", { query: `?pi=${pi}` })).body).toEqual({
		state: "approved",
	});
	// the reader is free for the next customer
	stripe.readers.get("tmr_front")!.action = null;
	return pi;
}

/**
 * The card payments of an order, as the order page gets them.
 * @param w The shop's data.
 * @param id The order.
 * @returns The charges, newest first.
 */
async function chargesOf(w: World, id: number) {
	const answer: OrderAnswer = (await hit(w, "GET /orders/:id", { id })).body;
	return answer.charges;
}

test("stripe amount: stored cents to the currency's smallest unit", () => {
	expect(stripeAmount(1250, "USD")).toBe(1250);
	expect(stripeAmount(50000, "JPY")).toBe(500);
	expect(stripeAmount(1250, "KWD")).toBe(12500);
});

test("readers come from Stripe, with whether each is online", async () => {
	fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	expect((await hit(w, "GET /readers")).body).toEqual({
		readers: [
			{ id: "tmr_front", label: "Front till", online: true },
			{ id: "tmr_back", label: "Back till", online: false },
		],
	});
});

test("a bad key: Stripe's own message reaches the cashier", async () => {
	const stripe = fakeStripe();
	stripe.fail.set("GET /terminal/readers?limit=100", "Invalid API Key");
	const w = { ...fakeData(), currency: "USD" };
	expect(await hit(w, "GET /readers")).toEqual({
		status: 422,
		body: { error: "Invalid API Key" },
	});
});

test("charge: a card_present hold is made and sent to the reader, then waits", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	const sent = await hit(w, "POST /charge", {
		body: { reader: "tmr_front", amount: 1250 },
	});
	expect(sent.body).toEqual({ pi: "pi_1" });
	const [make, show] = stripe.calls;
	expect(make!.op).toBe("POST /payment_intents");
	expect(Object.fromEntries(make!.form)).toEqual({
		amount: "1250",
		currency: "usd",
		"payment_method_types[0]": "card_present",
		// the money is only held until the order is saved
		capture_method: "manual",
		"metadata[shop]": "7",
	});
	expect(show!.op).toBe(
		"POST /terminal/readers/tmr_front/process_payment_intent",
	);
	expect(show!.form.get("payment_intent")).toBe("pi_1");
	expect((await hit(w, "GET /status", { query: "?pi=pi_1" })).body).toEqual({
		state: "waiting",
	});
	expect(w.rows).toMatchObject([
		{ ref: "pi_1", value: { state: "waiting", amount: 1250, order: null } },
	]);
});

test("charge: a zero-decimal currency is sent in whole units", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "JPY" };
	await hit(w, "POST /charge", {
		body: { reader: "tmr_front", amount: 50000 },
	});
	expect(stripe.calls[0]!.form.get("amount")).toBe("500");
	expect(stripe.calls[0]!.form.get("currency")).toBe("jpy");
});

test("charge: a wrong amount or reader is refused before Stripe is asked", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	for (const body of [
		{ reader: "tmr_front", amount: 0 },
		{ reader: "tmr_front", amount: 12.5 },
		{ reader: "tmr_front/../x", amount: 100 },
		{ amount: 100 },
	])
		expect((await hit(w, "POST /charge", { body })).status).toBe(422);
	expect(stripe.calls).toEqual([]);
});

test("two readers: an offline one is refused and leaves nothing open, a busy one takes one charge at a time", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	const off = await hit(w, "POST /charge", {
		body: { reader: "tmr_back", amount: 500 },
	});
	expect(off).toEqual({ status: 422, body: { error: "Reader is offline" } });
	expect(stripe.intents.get("pi_1")!.status).toBe("canceled");
	// the other reader works at the same time
	stripe.readers.get("tmr_back")!.status = "online";
	const [front, back, again] = await Promise.all([
		hit(w, "POST /charge", { body: { reader: "tmr_front", amount: 500 } }),
		hit(w, "POST /charge", { body: { reader: "tmr_back", amount: 700 } }),
		hit(w, "POST /charge", { body: { reader: "tmr_front", amount: 900 } }),
	]);
	expect([front.status, back.status]).toEqual([200, 200]);
	expect(again).toEqual({ status: 422, body: { error: "Reader is busy" } });
});

test("approved: the order's listener ties the charge to the order and takes the money once", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	const pi = await approved(w, stripe, 1250);
	// nothing is taken while there is no order
	expect(stripe.intents.get(pi)!.status).toBe("requires_capture");
	// a POS sale fires both events with the same reference
	await Promise.all([
		fire(w, "order.created", { order: { id: 42 }, payment_ref: pi }),
		fire(w, "order.paid", { order: { id: 42 }, payment_ref: pi }),
	]);
	expect(stripe.intents.get(pi)!.status).toBe("succeeded");
	expect(stripe.posts().filter((op) => op.endsWith("/capture"))).toHaveLength(
		1,
	);
	expect(await chargesOf(w, 42)).toMatchObject([
		{ pi, order: 42, state: "captured", amount: 1250 },
	]);
	// the dialog closes after the sale: its cancel leaves the paid charge alone
	await hit(w, "POST /cancel", { body: { pi } });
	expect(stripe.intents.get(pi)!.status).toBe("succeeded");
});

test("a reference that is not one of our charges is left alone", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	await fire(w, "order.created", { order: { id: 1 }, payment_ref: "pi_999" });
	await fire(w, "order.created", { order: { id: 1 }, payment_ref: "x/../y" });
	await fire(w, "order.created", { order: { id: 1 } });
	expect(stripe.calls).toEqual([]);
});

test("declined: the reason is shown, the hold is given up, and a new try works", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	await hit(w, "POST /charge", { body: { reader: "tmr_front", amount: 1250 } });
	stripe.decline("tmr_front", "Your card was declined.");
	const status = await hit(w, "GET /status", { query: "?pi=pi_1" });
	expect(status.body).toEqual({
		state: "declined",
		message: "Your card was declined.",
	});
	expect(stripe.intents.get("pi_1")!.status).toBe("canceled");
	// asked again: the same answer, Stripe is not asked a second time
	const before = stripe.calls.length;
	expect((await hit(w, "GET /status", { query: "?pi=pi_1" })).body).toEqual(
		status.body,
	);
	expect(stripe.calls).toHaveLength(before);
	// Try again is a fresh charge
	const again = await hit(w, "POST /charge", {
		body: { reader: "tmr_front", amount: 1250 },
	});
	expect(again.body).toEqual({ pi: "pi_2" });
});

test("cancel: a waiting charge clears the reader and lets go of the money", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	await hit(w, "POST /charge", { body: { reader: "tmr_front", amount: 1250 } });
	expect(await hit(w, "POST /cancel", { body: { pi: "pi_1" } })).toEqual({
		status: 200,
		body: { ok: true },
	});
	expect(stripe.posts().slice(2)).toEqual([
		"POST /terminal/readers/tmr_front/cancel_action",
		"POST /payment_intents/pi_1/cancel",
	]);
	expect(stripe.readers.get("tmr_front")!.action).toBeNull();
	expect((await hit(w, "GET /status", { query: "?pi=pi_1" })).body).toEqual({
		state: "cancelled",
	});
});

test("cancel: an approved hold with no order is let go when the dialog closes", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	const pi = await approved(w, stripe, 1250);
	await hit(w, "POST /cancel", { body: { pi } });
	expect(stripe.intents.get(pi)!.status).toBe("canceled");
	// an order saved with it afterwards is shown as not captured
	await expect(
		fire(w, "order.created", { order: { id: 5 }, payment_ref: pi }),
	).rejects.toThrow("card payment not captured");
	expect(await chargesOf(w, 5)).toMatchObject([{ state: "uncaptured" }]);
});

test("cancel: an approved hold waits a moment, so the order that was just saved keeps its money", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	const pi = await approved(w, stripe, 1250);
	timing.grace = 30;
	// the dialog's cancel arrives before the order's listener
	const cancel = hit(w, "POST /cancel", { body: { pi } });
	await fire(w, "order.created", { order: { id: 8 }, payment_ref: pi });
	await cancel;
	expect(stripe.intents.get(pi)!.status).toBe("succeeded");
});

test("capture can fail: the order page shows it and Try again takes the money", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	const pi = await approved(w, stripe, 1250);
	stripe.fail.set(`POST /payment_intents/${pi}/capture`, "Try again later");
	await expect(
		fire(w, "order.created", { order: { id: 9 }, payment_ref: pi }),
	).rejects.toThrow("order #9: card payment not captured: Try again later");
	const [charge] = await chargesOf(w, 9);
	expect(charge).toMatchObject({
		state: "uncaptured",
		error: "Try again later",
	});
	expect(problemOf(charge!)).toBe("capture");
	const retried: OrderAnswer = (
		await hit(w, "POST /orders/:id/retry", { id: 9 })
	).body;
	expect(retried.charges).toMatchObject([{ state: "captured", error: "" }]);
	expect(problemOf(retried.charges[0]!)).toBeNull();
	expect(stripe.intents.get(pi)!.status).toBe("succeeded");
});

test("refund: the same amount goes back to the card, newest card payment first", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	// an order paid in two card payments (Record payment twice)
	const first = await approved(w, stripe, 1000);
	await fire(w, "order.updated", { order: { id: 3 }, payment_ref: first });
	const second = await approved(w, stripe, 500);
	await fire(w, "order.paid", { order: { id: 3 }, payment_ref: second });
	await fire(w, "order.refunded", {
		order: { id: 3 },
		refund: { amount: 700 },
	});
	const refunds = stripe.calls.filter((c) => c.op === "POST /refunds");
	expect(refunds.map((c) => Object.fromEntries(c.form))).toEqual([
		{ payment_intent: second, amount: "500" },
		{ payment_intent: first, amount: "200" },
	]);
	expect(await chargesOf(w, 3)).toMatchObject([
		{ pi: second, refunded: 500 },
		{ pi: first, refunded: 200 },
	]);
	// a void sends back all that is left
	await fire(w, "order.voided", { order: { id: 3 }, reason: "" });
	expect(Object.fromEntries(stripe.calls.at(-1)!.form)).toEqual({
		payment_intent: first,
		amount: "800",
	});
	expect(await chargesOf(w, 3)).toMatchObject([
		{ refunded: 500 },
		{ refunded: 1000 },
	]);
});

test("refund: an order with no card payment is left alone", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	await fire(w, "order.refunded", {
		order: { id: 77 },
		refund: { amount: 500 },
	});
	await fire(w, "order.voided", { order: { id: 77 }, reason: "" });
	expect(stripe.calls).toEqual([]);
});

test("refund can fail: it is kept as failed, and Try again sends it", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "JPY" };
	const pi = await approved(w, stripe, 50000);
	await fire(w, "order.created", { order: { id: 4 }, payment_ref: pi });
	stripe.fail.set("POST /refunds", "This card needs to be present");
	await expect(
		fire(w, "order.refunded", { order: { id: 4 }, refund: { amount: 20000 } }),
	).rejects.toThrow("card refund failed");
	const [failed] = await chargesOf(w, 4);
	expect(failed).toMatchObject({
		refunded: 0,
		failed: 20000,
		error: "This card needs to be present",
	});
	expect(problemOf(failed!)).toBe("refund");
	const retried: OrderAnswer = (
		await hit(w, "POST /orders/:id/retry", { id: 4 })
	).body;
	expect(retried.charges).toMatchObject([
		{ refunded: 20000, failed: 0, error: "" },
	]);
	// the refund is in the currency's own unit too
	expect(stripe.calls.at(-1)!.form.get("amount")).toBe("200");
});

test("a void lets go of a hold that was never taken", async () => {
	const stripe = fakeStripe();
	const w = { ...fakeData(), currency: "USD" };
	const pi = await approved(w, stripe, 1250);
	stripe.fail.set(`POST /payment_intents/${pi}/capture`, "Try again later");
	await fire(w, "order.created", { order: { id: 6 }, payment_ref: pi }).catch(
		() => {},
	);
	await fire(w, "order.voided", { order: { id: 6 }, reason: "" });
	expect(stripe.intents.get(pi)!.status).toBe("canceled");
	expect(await chargesOf(w, 6)).toMatchObject([{ state: "cancelled" }]);
	expect(stripe.calls.some((c) => c.op === "POST /refunds")).toBe(false);
});
