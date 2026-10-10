import { t } from "@/lib/i18n";
import type { BundleItem } from "@/types";

/*
 * Package contents in words, for the staff pages.
 * Kept apart from bundles.ts: `t` pulls in Inertia, and the store's window.Store must stay small.
 */

/** One slot in words: "12 × Pen (Red or Blue)", "1 × Notebook". */
export const contentsLabel = (slot: BundleItem) =>
	`${slot.qty} × ${slot.name}${slot.options.length === 1 && slot.options[0]!.variant_id === null ? "" : ` (${slot.options.map((o) => o.name).join(` ${t("products.or_joiner")} `)})`}`;
/** The whole recipe on one line. */
export const contentsOf = (p: { bundle_items: BundleItem[] }) =>
	p.bundle_items.map(contentsLabel).join(" · ");
