/**
 * What the page and the server half share: the shapes of the answers,
 * the points rule and a fetch that throws.
 */

/**
 * How many members or history lines one page holds.
 */
export const PER_PAGE = 20;

/**
 * How long the search box waits after the last key, in ms.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * One member, as `GET /members` answers.
 */
export type Member = {
	/**
	 * The customer's id.
	 */
	customer_id: number;
	/**
	 * The customer's name, "" when it could not be read.
	 */
	name: string;
	/**
	 * The customer's phone, "" when they have none.
	 */
	phone: string;
	/**
	 * The points they hold now.
	 */
	points: number;
	/**
	 * Every point they ever earned.
	 */
	total: number;
};

/**
 * One line of a member's history.
 * `earn` = an order gave points, `take` = a refund or a void took points
 * back, `reward` = the goal was reached and a discount code was made.
 */
export type Entry = {
	type: "earn" | "take" | "reward";
	/**
	 * The points added (above 0) or taken (below 0).
	 */
	points: number;
	/**
	 * The order's public code, for `earn` and `take`.
	 */
	reference?: string;
	/**
	 * The discount code, for `reward`.
	 */
	code?: string;
	/**
	 * When it happened.
	 */
	at: string;
};

/**
 * One page of a list, as the routes answer.
 */
export type Page<T> = {
	data: T[];
	total: number;
	page: number;
	last_page: number;
};

/**
 * The answer of `GET /members`: a page of members and the goal.
 */
export type MembersAnswer = Page<Member> & { goal: number };

/**
 * A reward a customer holds: a discount code they have not used yet.
 */
export type Reward = {
	code: string;
	type: "percent" | "fixed";
	/**
	 * A percent from 1 to 100, or cents.
	 */
	value: number;
};

/**
 * Where a customer stands: their points, the goal and their unused rewards.
 * The till, the receipt and the store's account page all show this.
 */
export type Standing = { points: number; goal: number; rewards: Reward[] };

/**
 * The answer of `GET /orders/:id/receipt`: the customer's standing after
 * one order.
 */
export type ReceiptAnswer = Standing & {
	/**
	 * The points this order gave.
	 */
	earned: number;
	/**
	 * True while the order's points are not booked yet: ask again shortly.
	 */
	pending: boolean;
};

/**
 * What a reward gives, in words: "5% off" or "$5 off".
 * @param t The extension's translate function.
 * @param reward The reward's type and value.
 * @param currency The shop's currency code.
 * @param locale The language to write the money in.
 * @returns The text.
 */
export function rewardLabel(
	t: (key: string, params?: Record<string, string | number>) => string,
	reward: Pick<Reward, "type" | "value">,
	currency: string,
	locale: string,
) {
	if (reward.type === "percent")
		return t("reward.percent", { value: reward.value });
	return t("reward.fixed", {
		amount: moneyText(reward.value / 100, currency, locale),
	});
}

/**
 * Money as people read it, with no ".00" on a whole amount.
 * @param amount The amount, in the currency's main unit.
 * @param currency The currency code.
 * @param locale The language to write it in.
 * @returns The text, like "$5" or "THB 1,000".
 */
export function moneyText(amount: number, currency: string, locale: string) {
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			trailingZeroDisplay: "stripIfInteger",
		} as Intl.NumberFormatOptions).format(amount);
	} catch {
		// a currency code the browser does not know
		return `${currency} ${amount}`;
	}
}

/**
 * What the points rule needs of an order.
 */
type Paid = {
	status: string;
	payment_status: string;
	total: number;
	refunded: number;
};

/**
 * The points an order is worth now.
 * An order gives points only while it is paid in full and not voided.
 * Money refunded gives none.
 * @param order The order.
 * @param spend The money for one point, in the shop's currency.
 * @returns The points, a whole number from 0 up.
 */
export function pointsFor(order: Paid, spend: number) {
	// the cents for one point: under 1 cent (or not a number) gives nothing
	const per = Math.round(spend * 100);
	if (!(per >= 1)) return 0;
	if (order.status === "voided" || order.payment_status !== "paid") return 0;
	return Math.floor(Math.max(0, order.total - order.refunded) / per);
}

/**
 * Read a response as JSON.
 * @param res The response of `api.fetch`.
 * @returns The body.
 * @throws When the server refused the request.
 */
export async function json<T>(res: Response): Promise<T> {
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return (await res.json()) as T;
}
