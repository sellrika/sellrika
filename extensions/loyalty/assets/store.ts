/**
 * The script on the shop's online store (slot `store.page`).
 * On the account page of a signed-in customer it shows their points and
 * every reward they have not used, with its code to type at the checkout.
 * It draws into the theme's `[data-account-extra]` box.
 * Plain DOM, styled with the theme's own `--store-*` colours.
 */
import type { StoreExtensionApi, StoreScript } from "../../types";
import { json, rewardLabel, type Standing } from "./utils.ts";

/**
 * Make an element with a style and a text.
 * @param tag The tag name.
 * @param style Its inline style.
 * @param text Its text, when it has one.
 * @returns The element.
 */
function box(tag: string, style: string, text?: string) {
	const el = document.createElement(tag);
	el.style.cssText = style;
	if (text !== undefined) el.textContent = text;
	return el;
}

/**
 * Draw a customer's standing into the account page.
 * @param api The store's extension api.
 * @param into The theme's box.
 * @param standing The customer's points and rewards.
 */
function draw(api: StoreExtensionApi, into: Element, standing: Standing) {
	const card = box(
		"section",
		"display:grid;gap:10px;margin:16px 0;padding:16px;border:1px solid var(--store-border, #e5e5e5);border-radius:var(--store-radius, 12px);background:var(--store-surface, #fff);color:var(--store-fg, #111)",
	);
	card.dataset.loyalty = "";
	card.append(
		box("strong", "font-size:15px", api.t("store.title")),
		box(
			"span",
			"font-size:14px;color:var(--store-muted, #666)",
			api.t("members.points", {
				points: standing.points,
				goal: standing.goal,
			}),
		),
	);
	const bar = box(
		"div",
		"height:6px;border-radius:999px;overflow:hidden;background:var(--store-border, #e5e5e5)",
	);
	const share = Math.min(1, standing.points / standing.goal);
	bar.append(
		box(
			"div",
			`height:100%;width:${Math.round(share * 100)}%;background:var(--store-accent, currentColor)`,
		),
	);
	card.append(bar);
	for (const reward of standing.rewards) {
		const label = rewardLabel(
			api.t,
			reward,
			api.store.data.store.currency,
			api.locale,
		);
		const row = box(
			"div",
			"display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding-top:10px;border-top:1px solid var(--store-border, #e5e5e5);font-size:14px",
		);
		row.append(
			box("span", "", api.t("store.reward", { reward: label })),
			box(
				"code",
				"font-family:ui-monospace,monospace;font-weight:600;user-select:all",
				reward.code,
			),
		);
		card.append(row);
	}
	if (standing.rewards.length)
		card.append(
			box(
				"span",
				"font-size:13px;color:var(--store-muted, #666)",
				api.t("store.how"),
			),
		);
	into.replaceChildren(card);
}

const run: StoreScript = async function run(api) {
	const into = document.querySelector("[data-account-extra]");
	// only the account page of a signed-in customer has the box
	if (!into) return;
	const standing = await json<Standing | null>(await api.fetch("/me"));
	if (standing && standing.goal > 0) draw(api, into, standing);
};

export default run;
