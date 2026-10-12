/**
 * The shapes the extension's routes answer with, shared by the server and
 * the browser scripts, and the few helpers both sides use.
 */

/** One of the shop's card readers. */
export type Reader = {
	id: string;
	/** The name the shop gave it at Stripe. */
	label: string;
	/** False while the reader is switched off or has no internet. */
	online: boolean;
};

/**
 * Where a charge stands.
 * `waiting` = sent to the reader, no card yet.
 * `declined` = the card was refused, or the reader stopped.
 * `held` = approved: the money is held on the card, not taken yet.
 * `cancelled` = given up before it was taken.
 * `captured` = taken, the order has it.
 * `uncaptured` = the order is saved but taking the money failed.
 */
export type ChargeState =
	| "waiting"
	| "declined"
	| "held"
	| "cancelled"
	| "captured"
	| "uncaptured";

/** One card payment, as the `charges` collection keeps it. */
export type Charge = {
	/** Stripe's PaymentIntent ID. It is also the payment reference. */
	pi: string;
	/** The cents asked for, as the app stores money. */
	amount: number;
	/** The shop's currency when it was charged. */
	currency: string;
	/** The reader it was sent to. */
	reader: string;
	state: ChargeState;
	/** The order it paid, null until the order is saved. */
	order: number | null;
	/** The cents given back to the card. */
	refunded: number;
	/** The cents that should have gone back but Stripe refused. */
	failed: number;
	/** Why the last capture or refund failed, "" for none. */
	error: string;
};

/** `GET /status`: what the dialog shows for a charge. */
export type StatusAnswer = {
	state: "waiting" | "approved" | "declined" | "cancelled";
	/** Why it was declined, when Stripe says. */
	message?: string;
};

/** `GET /orders/:id` and `POST /orders/:id/retry`: an order's card payments. */
export type OrderAnswer = { charges: (Charge & { id: number })[] };

/** A refusal of one of the routes. */
export type Refusal = { error: string };

/**
 * Does an order's card payment need the staff's eye?
 * @param c The card payment.
 * @returns "capture" when the money was not taken, "refund" when a refund failed, else null.
 */
export function problemOf(c: Pick<Charge, "state" | "failed">) {
	if (c.state === "uncaptured") return "capture" as const;
	return c.failed > 0 ? ("refund" as const) : null;
}

/**
 * Format the app's cents for a person.
 * @param cents The amount.
 * @param currency ISO currency code.
 * @param locale The page's language.
 * @returns The amount, e.g. "$12.50".
 */
export function money(cents: number, currency: string, locale: string) {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
		currencyDisplay: "narrowSymbol",
		trailingZeroDisplay: "stripIfInteger",
	} as Intl.NumberFormatOptions).format(cents / 100);
}
