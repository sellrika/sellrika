/**
 * The receipt's loyalty lines (slot `order.receipt`).
 * Under the totals it prints the points the order gave, the customer's
 * points, and every reward they have not used yet with its code.
 * An order with no customer prints nothing.
 * A sale's points are booked a moment after it is paid, so the script
 * asks again a few times before it prints what it has.
 */
import type { SlotScript } from "../../types";
import { json, type ReceiptAnswer, rewardLabel } from "./utils.ts";

/**
 * How often the script asks while the points are not booked yet.
 */
const TRIES = 6;

/**
 * How long it waits between two asks, in ms.
 */
const WAIT_MS = 500;

/**
 * Wait a moment.
 * @param ms How long, in ms.
 * @returns A promise that settles after it.
 */
function wait(ms: number) {
	return new Promise((done) => setTimeout(done, ms));
}

const mount: SlotScript<"order.receipt"> = function mount(_el, api) {
	const order = api.context.order();
	let stopped = false;
	/**
	 * Read the order's standing and add the lines once.
	 */
	async function run() {
		if (!order.customer_id) return;
		let answer: ReceiptAnswer | null = null;
		for (let i = 0; i < TRIES && !stopped; i++) {
			answer = await json<ReceiptAnswer | null>(
				await api.fetch(`/orders/${order.id}/receipt`),
			);
			if (!answer?.pending) break;
			await wait(WAIT_MS);
		}
		if (!answer || stopped) return;
		const lines = [];
		if (answer.earned > 0)
			lines.push({
				text: api.t("receipt.earned"),
				right: `+${answer.earned}`,
			});
		if (answer.goal > 0)
			lines.push({
				text: api.t("receipt.points"),
				right: api.t("receipt.of", {
					points: answer.points,
					goal: answer.goal,
				}),
			});
		for (const reward of answer.rewards) {
			const label = rewardLabel(
				api.t,
				reward,
				api.shop?.currency ?? "USD",
				api.locale,
			);
			lines.push(
				{ text: api.t("receipt.reward", { reward: label }), bold: true },
				{ text: api.t("receipt.code", { code: reward.code }) },
			);
		}
		api.context.add(lines);
	}
	// a receipt must print even when this fails
	run().catch(function failed(error) {
		console.warn("[loyalty] receipt:", error);
	});
	return function stop() {
		stopped = true;
	};
};

export default mount;
