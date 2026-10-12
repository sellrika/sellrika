/**
 * Stripe Terminal: card payments at the till with a Stripe card reader.
 * The server drives the reader. No Stripe JS SDK and no webhooks:
 * the pay dialog asks this extension, and this extension asks Stripe.
 *
 * How the money moves:
 * 1. `POST /charge` makes a PaymentIntent that only holds the money
 *    (`capture_method: manual`) and sends it to the reader.
 * 2. `GET /status` is asked every 2 seconds until the card is approved.
 * 3. The dialog then saves the order with the PaymentIntent ID as its
 *    payment reference. The listener below gets it and takes the money.
 * So no money is taken without an order.
 *
 * Every charge is one row of the `charges` collection. Its lookup key is
 * the PaymentIntent ID until the order is known, then `order:<id>`.
 */
import type {
	CollectionRow,
	Config,
	ExtensionData,
	Listeners,
	OrderFull,
	Routes,
	Translate,
} from "../types";
import type {
	Charge,
	OrderAnswer,
	Reader,
	StatusAnswer,
} from "./assets/utils.ts";
import { call, stripeAmount } from "./stripe.ts";

/** What a PaymentIntent ID looks like. Anything else is not ours. */
const INTENT_ID = /^pi_[A-Za-z0-9_]{1,100}$/;
/** What a reader ID looks like. It goes into a Stripe path. */
const READER_ID = /^tmr_[A-Za-z0-9_]{1,100}$/;
/** The most cents one charge may ask for. */
const MAX_CENTS = 99_999_999;
/** The most charges read for one order. */
const ORDER_CHARGES = 100;

/**
 * How long things wait, in milliseconds. A test sets them to 0.
 * `grace`: an approved hold is cancelled when its dialog closes, but the
 * dialog also closes right after it saved the order. The order's listener
 * needs a moment to claim the charge first.
 */
export const timing = { grace: 5000 };

/** What routes and listeners both have. */
type Ctx = { config: Config; data: ExtensionData; t: Translate };

/**
 * The shop's Stripe secret key.
 * @param config The extension's settings.
 * @returns The `sk_…` key.
 */
function keyOf(config: Config) {
	return String(config.secret_key ?? "");
}

/**
 * The list every charge is kept in.
 * @param data The extension's data for the shop.
 * @returns The `charges` collection.
 */
function chargesOf(data: ExtensionData) {
	return data.collection<Charge>("charges");
}

/**
 * Find a charge that has no order yet.
 * @param data The extension's data for the shop.
 * @param pi The PaymentIntent ID.
 * @returns Its row, or null when there is none or an order has claimed it.
 */
async function pending(data: ExtensionData, pi: string) {
	const page = await chargesOf(data).list({ ref: pi, per_page: 1 });
	return page.data[0] ?? null;
}

/**
 * The card payments of one order, newest first.
 * @param data The extension's data for the shop.
 * @param orderId The order.
 * @returns Their rows.
 */
async function ofOrder(data: ExtensionData, orderId: number) {
	const page = await chargesOf(data).list({
		ref: `order:${orderId}`,
		per_page: ORDER_CHARGES,
	});
	return page.data;
}

/**
 * Why something failed, as a person can read it.
 * Stripe's own message is the best hint. Anything else (no network) gets
 * one plain line.
 * @param t The extension's dictionary.
 * @param error What was thrown.
 * @returns The text.
 */
function reason(t: Translate, error: unknown) {
	return error instanceof Error && error.name === "StripeError"
		? t(error.message)
		: t("error.request_failed");
}

/**
 * A refusal the cashier can read.
 * @param message What went wrong.
 * @param status The HTTP status.
 * @returns A JSON answer.
 */
function refused(message: string, status = 422) {
	return Response.json({ error: message }, { status });
}

/**
 * Run a call whose failure does not matter (clearing a reader that is
 * already clear, cancelling a PaymentIntent that is already cancelled).
 * @param job The call.
 */
async function quiet(job: Promise<unknown>) {
	try {
		await job;
	} catch {
		/* nothing to do: the thing was already gone */
	}
}

/**
 * Wait.
 * @param ms How long, in milliseconds.
 * @returns When the time is over.
 */
function sleep(ms: number) {
	return new Promise(function wait(done) {
		setTimeout(done, ms);
	});
}

/**
 * Ask Stripe where a charge stands and keep the answer.
 * @param ctx The settings, the data and the dictionary.
 * @param row The charge's row.
 * @returns What the dialog shows.
 */
async function check(
	ctx: Ctx,
	row: CollectionRow<Charge>,
): Promise<StatusAnswer> {
	const c = row.value;
	if (c.state === "declined") return { state: "declined", message: c.error };
	if (c.state === "cancelled") return { state: "cancelled" };
	if (c.state !== "waiting") return { state: "approved" };
	const key = keyOf(ctx.config);
	const list = chargesOf(ctx.data);
	const intent = await call(key, "GET", `/payment_intents/${c.pi}`);
	if (intent.status === "requires_capture") {
		await list.update(row.id, { ...c, state: "held" });
		return { state: "approved" };
	}
	if (intent.status === "canceled") {
		await list.update(row.id, { ...c, state: "cancelled" });
		return { state: "cancelled" };
	}
	// no card yet, or a refused one: only the reader knows which
	const reader = await call(key, "GET", `/terminal/readers/${c.reader}`);
	const action = reader.action;
	const ours = action?.process_payment_intent?.payment_intent === c.pi;
	if (ours && action?.status !== "failed") return { state: "waiting" };
	// the card was refused, or the reader let go of the charge
	const message =
		(ours && action?.failure_message) || ctx.t("error.reader_stopped");
	await quiet(call(key, "POST", `/payment_intents/${c.pi}/cancel`));
	await list.update(row.id, { ...c, state: "declined", error: message });
	return { state: "declined", message };
}

/**
 * Take the held money of a charge and keep the result.
 * @param ctx The settings, the data and the dictionary.
 * @param id The charge's row.
 * @param c The charge.
 * @returns Null when the money is taken, else why not.
 */
async function capture(ctx: Ctx, id: number, c: Charge) {
	const list = chargesOf(ctx.data);
	try {
		await call(keyOf(ctx.config), "POST", `/payment_intents/${c.pi}/capture`);
		await list.update(id, { ...c, state: "captured", error: "" });
		return null;
	} catch (error) {
		const why = reason(ctx.t, error);
		await list.update(id, { ...c, state: "uncaptured", error: why });
		return why;
	}
}

/**
 * Give money back to the card of a charge and keep the result.
 * A refusal is kept as `failed` cents, so the order page can try again.
 * @param ctx The settings, the data and the dictionary.
 * @param id The charge's row.
 * @param c The charge.
 * @param cents How much goes back.
 * @returns Null when it went back, else why not.
 */
async function refund(ctx: Ctx, id: number, c: Charge, cents: number) {
	const list = chargesOf(ctx.data);
	try {
		await call(keyOf(ctx.config), "POST", "/refunds", {
			payment_intent: c.pi,
			amount: stripeAmount(cents, c.currency),
		});
		await list.update(id, { ...c, refunded: c.refunded + cents, error: "" });
		return null;
	} catch (error) {
		const why = reason(ctx.t, error);
		await list.update(id, { ...c, failed: c.failed + cents, error: why });
		return why;
	}
}

/**
 * An order was saved with a payment reference: when the reference is one
 * of our charges, tie the charge to the order and take the money.
 * `order.created`, `order.updated` and `order.paid` may all carry the same
 * reference. Only the first one finds the charge, so it is taken once.
 * @param ctx The settings, the data and the dictionary.
 * @param order The order.
 * @param ref The payment reference the pay dialog sent, if any.
 * @throws Error when Stripe refused to take the money (it is logged).
 */
async function settle(ctx: Ctx, order: OrderFull, ref: string | undefined) {
	// the reference comes from the browser: it counts only when it is a charge we made
	if (!ref || !INTENT_ID.test(ref)) return;
	const why = await ctx.data.lock(`pi:${ref}`, async function claim() {
		const row = await pending(ctx.data, ref);
		if (!row) return null;
		const list = chargesOf(ctx.data);
		const charge = { ...row.value, order: order.id };
		const id = await list.add(charge, `order:${order.id}`);
		await list.delete(row.id);
		return capture(ctx, id, charge);
	});
	if (why)
		throw new Error(`order #${order.id}: card payment not captured: ${why}`);
}

/**
 * Money goes back to the customer: refund the order's card payments,
 * newest first, up to the amount.
 * An order with no card payment is left alone.
 * @param ctx The settings, the data and the dictionary.
 * @param orderId The order.
 * @param cents How much goes back. Infinity = all that is left (a void).
 * @throws Error when Stripe refused a refund (it is logged).
 */
async function giveBack(ctx: Ctx, orderId: number, cents: number) {
	const failures = await ctx.data.lock(
		`order:${orderId}`,
		async function refundCards() {
			const failed: string[] = [];
			let left = cents;
			for (const row of await ofOrder(ctx.data, orderId)) {
				const c = row.value;
				// a void also lets go of a hold that was never taken
				if (c.state === "uncaptured" && cents === Infinity) {
					await quiet(
						call(keyOf(ctx.config), "POST", `/payment_intents/${c.pi}/cancel`),
					);
					await chargesOf(ctx.data).update(row.id, {
						...c,
						state: "cancelled",
					});
				}
				if (c.state !== "captured") continue;
				const take = Math.min(left, c.amount - c.refunded - c.failed);
				if (take <= 0) continue;
				left -= take;
				const why = await refund(ctx, row.id, c, take);
				if (why) failed.push(why);
			}
			return failed;
		},
	);
	if (failures.length)
		throw new Error(
			`order #${orderId}: card refund failed: ${failures.join("; ")}`,
		);
}

/**
 * What the order page shows: every card payment of the order.
 * @param data The extension's data for the shop.
 * @param orderId The order.
 * @returns The charges, newest first.
 */
async function orderAnswer(
	data: ExtensionData,
	orderId: number,
): Promise<OrderAnswer> {
	const rows = await ofOrder(data, orderId);
	return {
		charges: rows.map(function flat(row) {
			return { id: row.id, ...row.value };
		}),
	};
}

/**
 * Staff routes, served under `/ext/stripe-terminal/…`.
 * The secret key never leaves the server.
 */
export const routes: Routes = {
	/**
	 * The shop's readers, as registered in its Stripe Dashboard, and
	 * whether each is online. Nobody types a reader ID.
	 */
	"GET /readers": async (ctx) => {
		try {
			const list = await call(
				keyOf(ctx.config),
				"GET",
				"/terminal/readers?limit=100",
			);
			const readers: Reader[] = (list.data ?? []).map(function reader(r) {
				return {
					id: r.id,
					label: r.label || r.id,
					online: r.status === "online",
				};
			});
			return { readers };
		} catch (error) {
			return refused(reason(ctx.t, error));
		}
	},

	/**
	 * "Send to reader": `{ reader, amount }` = the reader's ID and the
	 * cents asked for. It makes a PaymentIntent that only holds the money
	 * and shows it on the reader. One at a time per reader.
	 * The answer is `{ pi }`, the PaymentIntent ID to ask `/status` about.
	 */
	"POST /charge": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			reader?: unknown;
			amount?: unknown;
		} | null;
		const reader = String(body?.reader ?? "");
		const amount = Number(body?.amount);
		if (!READER_ID.test(reader)) return refused(ctx.t("error.reader"));
		if (!Number.isInteger(amount) || amount < 1 || amount > MAX_CENTS)
			return refused(ctx.t("error.amount"));
		const key = keyOf(ctx.config);
		const currency = ctx.shop.currency;
		try {
			return await ctx.data.lock(`reader:${reader}`, async function send() {
				const intent = await call(key, "POST", "/payment_intents", {
					amount: stripeAmount(amount, currency),
					currency: currency.toLowerCase(),
					payment_method_types: ["card_present"],
					// hold only: the money is taken when the order is saved
					capture_method: "manual",
					metadata: { shop: ctx.shop.id },
				});
				const charge: Charge = {
					pi: intent.id,
					amount,
					currency,
					reader,
					state: "waiting",
					order: null,
					refunded: 0,
					failed: 0,
					error: "",
				};
				const list = chargesOf(ctx.data);
				const id = await list.add(charge, intent.id);
				try {
					await call(
						key,
						"POST",
						`/terminal/readers/${reader}/process_payment_intent`,
						{ payment_intent: intent.id },
					);
				} catch (error) {
					// the reader is offline or busy: nothing stays open at Stripe
					await quiet(
						call(key, "POST", `/payment_intents/${intent.id}/cancel`),
					);
					await list.update(id, { ...charge, state: "cancelled" });
					throw error;
				}
				return { pi: intent.id };
			});
		} catch (error) {
			return refused(reason(ctx.t, error));
		}
	},

	/**
	 * Where a charge stands: `?pi=<PaymentIntent ID>`.
	 * The dialog asks every 2 seconds while it waits for the card.
	 */
	"GET /status": async (ctx) => {
		const pi = ctx.url.searchParams.get("pi") ?? "";
		if (!INTENT_ID.test(pi)) return refused(ctx.t("error.unknown_charge"), 404);
		try {
			return await ctx.data.lock(`pi:${pi}`, async function ask() {
				const row = await pending(ctx.data, pi);
				// an order has claimed it: it was approved
				if (!row) return { state: "approved" } satisfies StatusAnswer;
				return check(ctx, row);
			});
		} catch (error) {
			return refused(reason(ctx.t, error));
		}
	},

	/**
	 * Give a charge up: `{ pi }`. It clears the reader and lets go of the
	 * money. A charge an order has claimed is never touched.
	 * The dialog calls it on Cancel and whenever it closes.
	 */
	"POST /cancel": async (ctx) => {
		const body = (await ctx.req.json().catch(() => null)) as {
			pi?: unknown;
		} | null;
		const pi = String(body?.pi ?? "");
		if (!INTENT_ID.test(pi)) return { ok: true };
		const first = await pending(ctx.data, pi);
		// approved: the dialog may have just saved the order (see `timing`)
		if (first?.value.state === "held") await sleep(timing.grace);
		const key = keyOf(ctx.config);
		await ctx.data.lock(`pi:${pi}`, async function letGo() {
			const row = await pending(ctx.data, pi);
			if (!row) return;
			const c = row.value;
			if (c.state !== "waiting" && c.state !== "held") return;
			// ponytail: clears whatever the reader shows. Check its action is this charge first if two tills ever fight over one reader.
			if (c.state === "waiting")
				await quiet(
					call(key, "POST", `/terminal/readers/${c.reader}/cancel_action`),
				);
			await quiet(call(key, "POST", `/payment_intents/${c.pi}/cancel`));
			await chargesOf(ctx.data).update(row.id, { ...c, state: "cancelled" });
		});
		return { ok: true };
	},

	/**
	 * The card payments of an order, for the order page: what was taken,
	 * what went back, and what failed.
	 */
	"GET /orders/:id": (ctx) => orderAnswer(ctx.data, Number(ctx.params.id)),

	/**
	 * "Try again" on the order page: takes money that was not captured and
	 * sends refunds that failed, for one order.
	 * The answer is the order's card payments after it.
	 */
	"POST /orders/:id/retry": async (ctx) => {
		const orderId = Number(ctx.params.id);
		await ctx.data.lock(`order:${orderId}`, async function again() {
			for (const row of await ofOrder(ctx.data, orderId)) {
				const c = row.value;
				if (c.state === "uncaptured") await capture(ctx, row.id, c);
				else if (c.failed > 0)
					await refund(ctx, row.id, { ...c, failed: 0 }, c.failed);
			}
		});
		return orderAnswer(ctx.data, orderId);
	},
};

/**
 * The event listeners of this extension.
 * A listener is never waited for and never stops the app, so what fails
 * here is kept on the charge and shown on the order page.
 */
export default {
	/**
	 * A sale was rung up: take the money of the card payment it names.
	 */
	"order.created": (ctx) => settle(ctx, ctx.order, ctx.payment_ref),
	/**
	 * A payment was recorded on an order (Record payment, a table's bill).
	 */
	"order.updated": (ctx) => settle(ctx, ctx.order, ctx.payment_ref),
	/**
	 * The order is paid in full. The events above already saw the same
	 * reference, so this one finds nothing left to do. It is here in case
	 * one of them was missed.
	 */
	"order.paid": (ctx) => settle(ctx, ctx.order, ctx.payment_ref),
	/**
	 * Money went back to the customer: the same amount goes back to the card.
	 */
	"order.refunded": (ctx) => giveBack(ctx, ctx.order.id, ctx.refund.amount),
	/**
	 * The order was voided: everything still on the card goes back.
	 */
	"order.voided": (ctx) => giveBack(ctx, ctx.order.id, Infinity),
} satisfies Listeners;
