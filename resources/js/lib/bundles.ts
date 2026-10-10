import type { BundleItem, BundleOption } from "@/types";

/** Anything with a package recipe — `Product` and `StoreProduct` both qualify. */
type Packageable = { bundle_items: BundleItem[] };
/** Slot id → chosen variant id. `{}` on ordinary lines and on packages with no choice slot. */
export type Choices = Record<number, number>;

/** A slot the customer has to answer (a single-option slot is fixed by the recipe). */
export const isChoice = (slot: BundleItem) => slot.options.length > 1;
/** Does this package ask anything at sale time? */
export const hasChoices = (p: Packageable) => p.bundle_items.some(isChoice);

/** The option filling a slot: the only one when fixed, else the picked variant (null when unpicked/stale). */
export const optionFor = (
	slot: BundleItem,
	choices: Choices,
): BundleOption | null =>
	slot.options.length === 1
		? slot.options[0]!
		: (slot.options.find((o) => o.variant_id === choices[slot.id]) ?? null);

/** Every slot resolved to its option, or null when one choice is missing or no longer exists. */
export function resolveSlots(p: Packageable, choices: Choices) {
	const out: { slot: BundleItem; option: BundleOption }[] = [];
	for (const slot of p.bundle_items) {
		const option = optionFor(slot, choices);
		if (!option) return null;
		out.push({ slot, option });
	}
	return out;
}

/** How many of this package the chosen options allow — min over slots of ⌊stock / qty⌋; null when nothing is tracked. */
export function availableFor(p: Packageable, choices: Choices): number | null {
	const slots = resolveSlots(p, choices);
	if (!slots) return 0; // an unanswered or vanished choice → nothing sellable
	let min: number | null = null;
	for (const { slot, option } of slots) {
		if (option.stock === null) continue; // untracked component never limits
		const n = Math.floor(option.stock / slot.qty);
		min = min === null ? n : Math.min(min, n);
	}
	return min;
}
/** Units of a package one option allows on its own (null = untracked) — drives the disabled pills. */
export const optionLeft = (slot: BundleItem, o: BundleOption) =>
	o.stock === null ? null : Math.floor(o.stock / slot.qty);

/** Cart identity: repeat taps of the same product + variant + choices bump one line. */
export const lineKey = (
	productId: number,
	variantId: number | null,
	choices: Choices = {},
) =>
	`${productId}:${variantId ?? ""}:${Object.entries(choices)
		.sort(([a], [b]) => Number(a) - Number(b))
		.map(([k, v]) => `${k}=${v}`)
		.join(",")}`;

/** What the customer picked, for the cart line / receipt — "Red", "Red, Small"; null when nothing was asked. */
export function chosenNames(p: Packageable, choices: Choices) {
	const names = p.bundle_items
		.filter(isChoice)
		.map((s) => {
			const o = optionFor(s, choices);
			return o && `${s.qty} × ${o.name}`;
		})
		.filter(Boolean);
	return names.length ? names.join(", ") : null;
}
