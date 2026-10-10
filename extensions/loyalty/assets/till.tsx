/**
 * The Sell screen's loyalty strip (slot `pos.cart`), under the customer.
 * It shows the picked customer's points and a button for every reward
 * they have not used: one press puts the code on the sale.
 * So the cashier knows, and the customer need not remember a code.
 * Empty while no customer is picked.
 * JSX here is plain DOM, see ../../README.md › JSX.
 */
import type { SlotScript } from "../../types";
import { json, rewardLabel, type Standing } from "./utils.ts";

const mount: SlotScript<"pos.cart"> = function mount(el, api) {
	const { context } = api;
	/**
	 * The customer the last answer is for, and that answer.
	 */
	let shown: { id: number; standing: Standing } | null = null;
	/**
	 * Counts the loads, so a slow answer for an earlier customer is dropped.
	 */
	let turn = 0;

	/**
	 * Put a reward's code on the sale.
	 * @param code The code.
	 */
	async function use(code: string) {
		const refused = await context.applyCode(code);
		if (refused) api.toast(refused, "error");
	}

	/**
	 * Draw the strip from the last answer.
	 */
	function draw() {
		if (!shown || shown.standing.goal < 1) return el.replaceChildren();
		const { standing } = shown;
		const applied = context.code();
		el.replaceChildren(
			<div
				class="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm"
				data-loyalty
			>
				<span class="text-muted-foreground tabular-nums">
					{api.t("members.points", {
						points: standing.points,
						goal: standing.goal,
					})}
				</span>
				{standing.rewards.map(function button(reward) {
					const label = rewardLabel(
						api.t,
						reward,
						api.shop?.currency ?? "USD",
						api.locale,
					);
					const on = applied === reward.code;
					const b = api.ui.button(
						api.t(on ? "till.applied" : "till.use", { reward: label }),
						{ variant: on ? "secondary" : "default", size: "xs" },
					);
					b.disabled = on;
					b.onclick = () => use(reward.code);
					return b;
				})}
			</div>,
		);
	}

	/**
	 * Read the picked customer's standing, then draw.
	 */
	async function load() {
		const customer = context.customer();
		const mine = ++turn;
		if (!customer) {
			shown = null;
			return draw();
		}
		// the same customer: only the code changed
		if (shown?.id === customer.id) return draw();
		shown = null;
		draw();
		const standing = await json<Standing>(
			await api.fetch(`/customers/${customer.id}/standing`),
		);
		if (mine !== turn) return;
		shown = { id: customer.id, standing };
		draw();
	}

	/**
	 * Load, and keep a failure off the Sell screen.
	 */
	function refresh() {
		load().catch(function failed(error) {
			console.warn("[loyalty] till:", error);
		});
	}
	refresh();
	return context.onChange(refresh);
};

export default mount;
