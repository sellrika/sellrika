/**
 * The "Send to kitchen" card in the product form's side column, slot
 * `product.side`. Off = orders of this product never show on the Kitchen
 * page (ready-made items, like bottled drinks). The switch saves at once
 * through the extension's own route; a product that is not saved yet has no
 * id, so the switch waits for the first save.
 * JSX here is plain DOM, see ../../README.md › JSX.
 */
import type { SlotScript } from "../../types";
import { icon } from "./components/icons.ts";

/** The switch's id, for its label. */
const SWITCH_ID = "restaurant-send-to-kitchen";

const mount: SlotScript<"product.side"> = async (el, api) => {
	const id = api.context.id;
	const toggle = api.ui.switch({
		id: SWITCH_ID,
		"aria-label": api.t("product.kitchen"),
		checked: true,
	});
	toggle.disabled = id == null;
	const chip = (
		<span class="flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300" />
	) as HTMLElement;
	chip.innerHTML = icon("chef", 12);
	chip.append(api.t("name"));
	// the same look as the Active and Featured cards above it
	el.replaceChildren(
		<label
			for={SWITCH_ID}
			class="flex items-center justify-between gap-3 rounded-xl bg-card p-4 font-normal ring-1 ring-foreground/10"
			data-send-to-kitchen
		>
			<span>
				<span class="flex flex-wrap items-center gap-2 text-sm font-medium">
					{api.t("product.kitchen")}
					{chip}
				</span>
				<span class="block text-xs text-muted-foreground">
					{api.t(id == null ? "product.kitchen_new" : "product.kitchen_hint")}
				</span>
			</span>
			{toggle}
		</label>,
	);
	if (id == null) return undefined;
	const res = await api.fetch(`/products/${id}/kitchen`);
	if (res.ok) toggle.checked = (await res.json()).on;
	toggle.onchange = async () => {
		const on = toggle.checked;
		const saved = await api.fetch(`/products/${id}/kitchen`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ on }),
		});
		if (saved.ok)
			return api.toast(
				api.t(on ? "product.kitchen_on" : "product.kitchen_off"),
			);
		toggle.checked = !on;
		const answer = await saved.json().catch(() => null);
		api.toast(answer?.error ?? api.t("kitchen.failed"), "error");
	};
	return undefined;
};
export default mount;
