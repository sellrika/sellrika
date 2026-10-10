import { z } from "zod";
import { ADJUST_REASONS } from "@constants/Stock.Constant";

/**
 * One stock change. POST /stock/adjust.
 * The REST API uses it too (POST /api/v1/stock/adjustments).
 * Either add/remove `delta` units, or set the on-hand count to `set`.
 * The repository turns `set` into a signed movement.
 */
export const StockAdjustInput = z
	.object({
		/** The product whose stock changes. */
		product_id: z.number().int(),
		/**
		 * The variant, when the product has variants.
		 * null = the product itself.
		 */
		variant_id: z.number().int().nullable().default(null),
		/**
		 * Units to add (+) or remove (−).
		 * null = not used. `set` wins when both are given.
		 */
		delta: z.number().int().nullable().default(null),
		/**
		 * The new on-hand count, 0 or more.
		 * null = not used.
		 */
		set: z
			.number()
			.int()
			.min(0, "validation.stock_not_negative")
			.nullable()
			.default(null),
		/**
		 * Why the count changes:
		 * `received`, `count` (a count correction), `damaged` or `other`.
		 */
		reason: z.enum(ADJUST_REASONS, { message: "validation.pick_a_reason" }),
		/** A free note. At most 500 characters. Left out = "". */
		note: z.string().trim().max(500).default(""),
	})
	.refine(
		/**
		 * Is there something to change?
		 * @param d The form.
		 * @returns True for a `delta` that is not 0, or a `set` count.
		 */
		function hasQuantity(d) {
			return (d.delta !== null && d.delta !== 0) || d.set !== null;
		},
		{ path: ["delta"], message: "validation.enter_a_quantity" },
	);
/** A checked `StockAdjustInput`. */
export type StockAdjustInput = z.infer<typeof StockAdjustInput>;
