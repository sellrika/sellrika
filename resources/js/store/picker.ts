import {
	availableFor,
	type Choices,
	isChoice,
	lineKey,
	optionLeft,
} from "@/lib/bundles";
import type { StoreProduct, StoreVariant } from "@/types";
import { CUSTOM_REQUEST_MAX } from "@constants/Product.Constant";
import { noteKey } from "./cart";
import type { StoreApi, StorePicker } from "./types";

/** What a picker needs from `window.Store`. */
export type PickerDeps = {
	cart: Pick<StoreApi["cart"], "lines" | "add" | "remove">;
	t: StoreApi["t"];
};

/** Where a picker starts. `editing` = the key of the cart line being changed. */
export type PickerPreset = {
	variantId?: number | null;
	choices?: Choices;
	note?: string;
	editing?: string;
};

/**
 * Option groups from the variants' attributes.
 * @param variants The product's variants.
 * @returns e.g. [{ name: "Color", values: ["Red", "Blue"] }].
 */
function groupsOf(variants: StoreVariant[]) {
	const map = new Map<string, string[]>();
	for (const v of variants)
		for (const [k, val] of Object.entries(v.attributes ?? {})) {
			const values = map.get(k) ?? [];
			if (!values.includes(val)) values.push(val);
			map.set(k, values);
		}
	return [...map].map(function group([name, values]) {
		return { name, values };
	});
}

/**
 * Does a variant fit every picked value? An empty pick fits anything.
 * @param v The variant.
 * @param picked Group → picked value.
 * @returns true when it fits.
 */
function matches(v: StoreVariant, picked: Record<string, string>) {
	for (const [k, val] of Object.entries(picked))
		if (val && v.attributes?.[k] !== val) return false;
	return true;
}

/**
 * A CSS colour for a value that names one ("Red", "navy", "#336699").
 * @param value The attribute or option value.
 * @returns The colour, or null when it is not one.
 */
export function swatch(value: string) {
	const v = value.trim().toLowerCase();
	return typeof CSS !== "undefined" && CSS.supports("color", v) ? v : null;
}

/**
 * The option rules of one product: attribute groups (guided mode),
 * a plain variant list, or package slots. The theme draws the buttons.
 * @param product The product.
 * @param deps The cart and `t()`.
 * @param preset Where to start (a cart line being edited).
 * @returns The picker state and its methods.
 */
export function createPicker(
	product: StoreProduct,
	deps: PickerDeps,
	preset: PickerPreset = {},
): StorePicker {
	const { cart, t } = deps;
	const variants = product.variants;
	const isBundle = product.kind === "bundle";
	const groups = groupsOf(variants);
	const guided =
		groups.length > 0 &&
		variants.every(function hasAttributes(v) {
			return !!v.attributes && Object.keys(v.attributes).length > 0;
		});
	const slots = product.bundle_items.filter(isChoice);

	// a group with one value has nothing to ask: it starts picked
	const picked: Record<string, string> = {};
	for (const g of groups)
		if (g.values.length === 1) picked[g.name] = g.values[0]!;

	const self = {
		product,
		guided,
		groups,
		picked,
		variantId: null as number | null,
		slots,
		choices: { ...(preset.choices ?? {}) } as Choices,
		asksNote: product.custom_request !== null,
		noteLabel: product.custom_request || t("store_ui.custom_request"),
		noteMax: CUSTOM_REQUEST_MAX,
		note: preset.note ?? "",
		setNote,
		editing: preset.editing ?? null,
		choose,
		pickVariant,
		pickSlot,
		available,
		optionLeft: slotOptionLeft,
		chosen,
		canAdd,
		left,
		error,
		addToCart,
	};

	// reopened from the cart: start from the line's variant
	const start = preset.variantId
		? variants.find(function same(v) {
				return v.id === preset.variantId;
			})
		: null;
	if (start && guided) self.picked = { ...(start.attributes ?? {}) };
	else if (start) self.variantId = start.id;

	/**
	 * Pick a value in a group. Picking it again clears it.
	 * @param group The group name.
	 * @param value The value.
	 */
	function choose(group: string, value: string) {
		const same = self.picked[group] === value;
		self.picked = { ...self.picked, [group]: same ? "" : value };
	}

	/**
	 * Keep the buyer's custom request.
	 * @param text What they typed.
	 */
	function setNote(text: string) {
		self.note = text.slice(0, CUSTOM_REQUEST_MAX);
	}

	/** @returns The note the line gets: trimmed, "" when the product asks for none. */
	function lineNote() {
		return self.asksNote ? self.note.trim() : "";
	}

	/**
	 * Pick a variant from the plain list.
	 * @param id The variant id.
	 */
	function pickVariant(id: number) {
		self.variantId = id;
	}

	/**
	 * Answer a package slot. Picking the same option again clears it.
	 * @param slotId The slot id.
	 * @param variantId The option's variant id.
	 */
	function pickSlot(slotId: number, variantId: number) {
		const next = { ...self.choices };
		if (next[slotId] === variantId) delete next[slotId];
		else next[slotId] = variantId;
		self.choices = next;
	}

	/**
	 * Can this value still be picked with the other groups' picks?
	 * @param group The group name.
	 * @param value The value.
	 * @returns true when an in-stock variant has it.
	 */
	function available(group: string, value: string) {
		const others: Record<string, string> = {};
		for (const [k, v] of Object.entries(self.picked))
			if (k !== group) others[k] = v;
		return variants.some(function fits(v) {
			return (
				v.attributes?.[group] === value && matches(v, others) && !v.sold_out
			);
		});
	}

	/**
	 * How many packages one slot option allows on its own.
	 * @param slotId The slot id.
	 * @param variantId The option's variant id.
	 * @returns The count, null when not tracked, 0 for an unknown option.
	 */
	function slotOptionLeft(slotId: number, variantId: number | null) {
		const slot = product.bundle_items.find(function same(s) {
			return s.id === slotId;
		});
		const o = slot?.options.find(function same(x) {
			return x.variant_id === variantId;
		});
		return slot && o ? optionLeft(slot, o) : 0;
	}

	/** @returns The groups still to answer (guided mode). */
	function missing() {
		const out: string[] = [];
		for (const g of groups) if (!self.picked[g.name]) out.push(g.name);
		return out;
	}

	/** @returns true when every package slot is answered. */
	function bundleReady() {
		return slots.every(function answered(s) {
			return self.choices[s.id] != null;
		});
	}

	/**
	 * The unit that goes in the cart.
	 * @returns The variant, the product itself when it has none, or null.
	 */
	function chosen(): StoreVariant | StoreProduct | null {
		if (!variants.length) return product;
		if (!guided)
			return (
				variants.find(function same(v) {
					return v.id === self.variantId;
				}) ?? null
			);
		if (missing().length) return null;
		return (
			variants.find(function fits(v) {
				return matches(v, self.picked);
			}) ?? null
		);
	}

	/** @returns true when the Add button may fire (stock aside). */
	function canAdd() {
		return isBundle ? bundleReady() : !!chosen();
	}

	/**
	 * Units still addable, minus what the cart holds.
	 * The line being edited counts as 0, because it gets replaced.
	 * @param editing The key of the line being edited.
	 * @returns The count, or null when not tracked.
	 */
	function leftFor(editing: string | null) {
		let stock: number | null;
		let k: string;
		if (isBundle) {
			stock = bundleReady() ? availableFor(product, self.choices) : null;
			k = lineKey(product.id, null, self.choices);
		} else {
			const c = chosen();
			stock = c ? c.stock : null;
			k = lineKey(product.id, variants.length && c ? c.id : null);
		}
		k = noteKey(k, lineNote());
		if (stock === null) return null;
		const line = cart.lines().find(function same(l) {
			return l.key === k;
		});
		const inCart = k === editing ? 0 : (line?.qty ?? 0);
		return Math.max(0, stock - inCart);
	}

	/** @returns Units still addable (null = not tracked). */
	function left() {
		return leftFor(self.editing);
	}

	/**
	 * "Colour and Size": the names still to answer.
	 * @param names The group or slot names.
	 * @returns One line in the page's language.
	 */
	function joinNames(names: string[]) {
		return names.join(` ${t("store_ui.and")} `);
	}

	/**
	 * Why the Add button can't fire, for `qty` units.
	 * @param qty The wanted quantity.
	 * @param editing The key of the line being edited.
	 * @returns The translated message, or null.
	 */
	function errorFor(qty: number, editing: string | null) {
		if (isBundle && !bundleReady()) {
			const open = slots.filter(function unanswered(s) {
				return self.choices[s.id] == null;
			});
			const names = open.map(function name(s) {
				return s.name;
			});
			return t("store_ui.choose_to_continue", { what: joinNames(names) });
		}
		if (!canAdd()) {
			if (!guided) return t("store_ui.select_option");
			const names = missing();
			if (!names.length) return t("store_ui.combo_unavailable");
			return t("store_ui.choose_to_continue", { what: joinNames(names) });
		}
		const n = leftFor(editing);
		if (n === 0) return t("store_ui.out_of_stock");
		if (n !== null && qty > n) return t("store_ui.only_n_left", { count: n });
		return null;
	}

	/**
	 * Why the Add button can't fire, for `qty` units.
	 * @param qty The wanted quantity.
	 * @returns The translated message, or null.
	 */
	function error(qty: number) {
		return errorFor(qty, self.editing);
	}

	/**
	 * Put the chosen unit in the cart. An edited line is replaced.
	 * @param qty How many.
	 * @param editingKey The line being edited (default: the preset's).
	 * @returns How many were added (0 = nothing).
	 */
	function addToCart(qty: number, editingKey?: string) {
		const editing = editingKey ?? self.editing;
		if (!canAdd() || errorFor(qty, editing)) return 0;
		if (self.asksNote && !lineNote()) return 0;
		const c = chosen();
		const variant = variants.length ? (c as StoreVariant) : null;
		if (editing) cart.remove(editing);
		self.editing = null;
		return cart.add(
			product,
			variant,
			isBundle ? self.choices : {},
			qty,
			lineNote(),
		);
	}

	return self;
}
