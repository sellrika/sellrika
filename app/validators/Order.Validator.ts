import { z } from "zod";
import {
	DISCOUNT_TYPES,
	FULFILLMENT_LOCKED,
	FULFILLMENT_STATUSES,
	FULFILLMENT_STEPS_MAX,
} from "@constants/Order.Constant";
import {
	MAX_CART_ITEMS,
	MAX_LINE_QTY,
	MAX_PAID_CENTS,
	MAX_REFUND_ITEMS,
} from "@constants/Security.Constant";
import { COUPON_CODE_MAX } from "@constants/Coupon.Constant";
import { CUSTOM_REQUEST_MAX } from "@constants/Product.Constant";
import { hexColor } from "@validators/Fields.Validator";

/**
 * One cart line.
 * The till and the online store share the shape.
 * Only the most units differ.
 * @param maxQty The most units one line may hold.
 * @returns The schema.
 */
export function cartItem(maxQty: number) {
	return z.object({
		/** The product to sell. */
		product_id: z.number().int(),
		/**
		 * The variant, when the product has variants.
		 * null = the product itself.
		 */
		variant_id: z.number().int().nullable().default(null),
		/** How many units: 1 to `maxQty`. */
		qty: z.number().int().min(1).max(maxQty),
		/**
		 * Package lines only.
		 * Slot id (as a string key) → the variant the customer picked
		 * for that slot.
		 */
		choices: z.record(z.string(), z.number().int()).optional(),
		/**
		 * A note for this line ("no onions"), kept on the order line.
		 * Online it is the buyer's custom request,
		 * for a product that asks for one.
		 */
		note: z
			.string()
			.trim()
			.max(CUSTOM_REQUEST_MAX, "validation.custom_request_too_long")
			.optional(),
	});
}

/**
 * The lines of a cart: at least one, at most `MAX_CART_ITEMS`.
 * Each line costs a DB round trip, so the list is capped.
 * @param item The schema of one line.
 * @param tooManyKey The message key for a cart with too many lines.
 * @returns The schema.
 */
export function cartItems<T extends z.ZodType>(item: T, tooManyKey: string) {
	return z
		.array(item)
		.min(1, "validation.cart_is_empty")
		.max(MAX_CART_ITEMS, tooManyKey);
}

/**
 * The cart lines of the till.
 * The checkout, the coupon quote and an order that grows all take them.
 */
const CartItems = cartItems(
	cartItem(MAX_LINE_QTY),
	"validation.too_many_lines",
);

/** Cents handed over: 0 or more, capped. */
const paidCents = z.number().int().min(0).max(MAX_PAID_CENTS);

/**
 * Add lines to an order that is not paid yet (`OrderService.addItems`).
 * POST /orders/:id/items.
 * The REST API uses it too (POST /api/v1/orders/:id/items).
 */
export const OrderItemsInput = z.object({
	/** The lines to add: 1 to 100. */
	items: CartItems,
});
/** A checked `OrderItemsInput`. */
export type OrderItemsInput = z.infer<typeof OrderItemsInput>;

/**
 * Take units off an order that is not paid yet
 * (`OrderService.removeItems`).
 * POST /orders/:id/items/remove.
 * The REST API uses it too (POST /api/v1/orders/:id/items/remove).
 * `qty` = how many units leave that line.
 * The whole quantity deletes the line.
 */
export const RemoveItemsInput = z.object({
	/** The lines to change: 1 to 100. */
	items: z
		.array(
			z.object({
				/** The order line to take units off. */
				order_item_id: z.number().int(),
				/** How many units leave the line: 1 to 10000. */
				qty: z.number().int().min(1).max(MAX_LINE_QTY),
			}),
		)
		.min(1, "validation.cart_is_empty")
		.max(MAX_CART_ITEMS, "validation.too_many_lines"),
});
/** A checked `RemoveItemsInput`. */
export type RemoveItemsInput = z.infer<typeof RemoveItemsInput>;

/** The fields of a sale, before the rules that span several of them. */
const CheckoutFields = z.object({
	/** The cart lines: 1 to 100. */
	items: CartItems,
	/**
	 * Cents the customer handed over. It must cover the total.
	 * What is over the total is given back as change.
	 */
	paid: paidCents,
	/**
	 * Name of one of the shop's payment_methods
	 * (checked in OrderService).
	 */
	payment_method: z
		.string()
		.trim()
		.min(1, "validation.pick_payment_method")
		.max(50),
	/**
	 * The customer the sale is for.
	 * null = no customer.
	 */
	customer_id: z.number().int().nullable().default(null),
	/**
	 * The sales person to name on the sale.
	 * Optional. Checked against the shop in OrderService.
	 */
	sales_staff_id: z.number().int().nullable().optional(),
	/**
	 * Order-level discount: `percent` or `fixed` (cents).
	 * null = no manual discount.
	 * The cents amount is always recomputed server-side
	 * from subtotal + type + value.
	 */
	discount_type: z.enum(DISCOUNT_TYPES).nullable().default(null),
	/**
	 * How much the discount is:
	 * a percent (0 to 100) or cents, by `discount_type`.
	 * Left out = 0.
	 */
	discount_value: z.number().int().min(0).default(0),
	/**
	 * A discount code.
	 * When given it replaces the manual discount
	 * and is re-applied from scratch server-side.
	 */
	coupon: z
		.string()
		.trim()
		.max(COUPON_CODE_MAX, "validation.code_not_valid")
		.optional(),
});

/**
 * A percent discount is 0–100.
 * @param d The discount fields.
 * @returns False when the percent is out of range.
 */
function percentInRange(d: {
	discount_type: "percent" | "fixed" | null;
	discount_value: number;
}) {
	return d.discount_type !== "percent" || d.discount_value <= 100;
}

/** Where the "percent is 0–100" message goes, and its key. */
const PERCENT_RULE = {
	/** The field the message is shown under. */
	path: ["discount_value"],
	/** The message key. */
	message: "validation.percent_0_100",
};

/** One sale at the till. POST /pos/checkout. */
export const CheckoutInput = CheckoutFields.refine(
	percentInRange,
	PERCENT_RULE,
);
/** A checked `CheckoutInput`. */
export type CheckoutInput = z.infer<typeof CheckoutInput>;

/**
 * PUT /api/v1/orders/:id/discount and an extension's `orders.setDiscount()`.
 * The discount of an order that is not paid in full yet
 * (`OrderService.setDiscount`).
 * The same fields as the till's: percent / fixed, or a code that replaces them.
 * No type and no code = the discount is taken off again.
 */
export const OrderDiscountInput = CheckoutFields.pick({
	discount_type: true,
	discount_value: true,
	coupon: true,
}).refine(percentInRange, PERCENT_RULE);
/** A checked `OrderDiscountInput`. */
export type OrderDiscountInput = z.infer<typeof OrderDiscountInput>;

/**
 * One way to make an order:
 * POST /api/v1/orders and an extension's `orders.create()`.
 * POST /pos/open ("Pay later") uses it too, with `paid` 0.
 * With `paid` it is a sale, like the till (`payment_method` is then needed).
 * Without `paid` (or 0) it is written unpaid and is paid later;
 * `payment_method` is then only the name shown ("" = "Pay later").
 * An unpaid order takes no discount and no code.
 */
export const OrderCreateInput = CheckoutFields.extend({
	/**
	 * Cents the customer handed over.
	 * Left out or 0 = an unpaid order.
	 */
	paid: paidCents.default(0),
	/**
	 * The payment method's name.
	 * Needed when `paid` is over 0.
	 * On an unpaid order it is only the name shown: "" = "Pay later".
	 */
	payment_method: z.string().trim().max(50).default(""),
	/**
	 * A note on the order itself ("Table 5"). Unpaid orders only.
	 * At most 1000 characters. Left out = "".
	 */
	note: z.string().trim().max(1000).default(""),
})
	.refine(percentInRange, PERCENT_RULE)
	/**
	 * A paid order needs a payment method.
	 * An unpaid order takes no discount and no code.
	 * @param d The order fields.
	 * @param c Where the problems are written.
	 */
	.superRefine(function paidOrNot(d, c) {
		if (d.paid > 0 && !d.payment_method)
			c.addIssue({
				code: "custom",
				path: ["payment_method"],
				message: "validation.pick_payment_method",
			});
		if (!d.paid && (d.discount_type || d.coupon))
			c.addIssue({
				code: "custom",
				path: ["paid"],
				message: "validation.unpaid_no_discount",
			});
	});
/** A checked `OrderCreateInput`. */
export type OrderCreateInput = z.infer<typeof OrderCreateInput>;

/**
 * POST /pos/coupon: "Apply" in the cart's discount popover.
 * It carries the cart, the code and the attached customer.
 * Their email decides customer-only codes and per-customer limits.
 */
export const CouponQuoteInput = z.object({
	/** The cart lines: 1 to 100. */
	items: CartItems,
	/** The discount code, as typed. At most 30 characters. */
	coupon: z
		.string()
		.trim()
		.min(1, "validation.enter_a_code")
		.max(COUPON_CODE_MAX, "validation.code_not_valid"),
	/**
	 * The customer attached to the sale.
	 * null = no customer.
	 */
	customer_id: z.number().int().nullable().default(null),
});
/** A checked `CouponQuoteInput`. */
export type CouponQuoteInput = z.infer<typeof CouponQuoteInput>;

/**
 * Give money back. POST /orders/:id/refund.
 * The REST API uses it too (POST /api/v1/orders/:id/refunds).
 * Items are optional (money-only refund).
 * When given, qty per order item.
 * Amount is what goes back to the customer.
 */
export const RefundInput = z.object({
	/** Cents that go back to the customer. At least 1. */
	amount: z.number().int().min(1, "validation.refund_amount_positive"),
	/** Why the money goes back. At most 500 characters. */
	reason: z.string().trim().max(500).default(""),
	/**
	 * True = the returned units go back into stock.
	 * Left out = true.
	 */
	restock: z.boolean().default(true),
	/**
	 * The units that come back, 200 lines at most.
	 * [] = a money-only refund.
	 */
	items: z
		.array(
			z.object({
				/** The order line the units come from. */
				order_item_id: z.number().int(),
				/** How many units of that line come back: 1 to 10000. */
				qty: z.number().int().min(1).max(MAX_LINE_QTY),
			}),
		)
		.max(MAX_REFUND_ITEMS)
		.default([]),
});
/** A checked `RefundInput`. */
export type RefundInput = z.infer<typeof RefundInput>;

/**
 * Why the order is voided. POST /orders/:id/void.
 * The REST API uses it too (POST /api/v1/orders/:id/void).
 */
export const VoidInput = z.object({
	/** Why the order is voided. At most 500 characters. */
	reason: z.string().trim().max(500).default(""),
});
/** A checked `VoidInput`. */
export type VoidInput = z.infer<typeof VoidInput>;

/**
 * Move an online order along and keep its tracking number.
 * PUT /orders/:id/fulfillment.
 * The REST API uses it too (PUT /api/v1/orders/:id/fulfillment).
 */
export const FulfillmentInput = z.object({
	/**
	 * One of the shop's steps.
	 * OrderService checks it against `shops.fulfillment_steps`.
	 */
	fulfillment: z
		.string("validation.pick_delivery_status")
		.trim()
		.min(1, "validation.pick_delivery_status")
		.max(30, "validation.pick_delivery_status"),
	/**
	 * The tracking number of the parcel.
	 * At most 100 characters. Left out = "".
	 */
	tracking: z
		.string()
		.trim()
		.max(100, "validation.tracking_max_100")
		.default(""),
});
/** A checked `FulfillmentInput`. */
export type FulfillmentInput = z.infer<typeof FulfillmentInput>;

/**
 * Is this a built-in step (its name may stay empty)?
 * @param key The step key.
 * @returns True for new, packing, shipped and delivered.
 */
function builtIn(key: string) {
	return (FULFILLMENT_STATUSES as readonly string[]).includes(key);
}

/**
 * Does the list keep every locked step? Their order is the shop's choice.
 * @param steps The steps, in order.
 * @returns True when new, shipped and delivered are all there.
 */
function keepsLocked(steps: { key: string }[]) {
	const keys = steps.map(function key(s) {
		return s.key;
	});
	return FULFILLMENT_LOCKED.every(function has(k) {
		return keys.includes(k);
	});
}

/**
 * Is every key used once only?
 * @param steps The steps.
 * @returns True when no key repeats.
 */
function uniqueKeys(steps: { key: string }[]) {
	return new Set(steps.map((s) => s.key)).size === steps.length;
}

/**
 * The delivery steps of the shop's online orders, in order.
 * PUT /orders/steps.
 */
export const FulfillmentStepsInput = z.object({
	/**
	 * The steps, in the order the shop wants: 12 at most.
	 * `new`, `shipped` and `delivered` must stay in the list.
	 * Each key is used once.
	 */
	steps: z
		.array(
			z
				.object({
					/**
					 * The step's key, as saved on orders.
					 * Lower-case letters, digits, `_` and `-`, 30 at most.
					 */
					key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,29}$/),
					/**
					 * The step's name, at most 40 characters.
					 * A built-in step may leave it empty. Any other step needs one.
					 */
					label: z.string().trim().max(40, "validation.step_name_max_40"),
					/** The step's badge colour as `#rrggbb`. null = none. */
					color: hexColor,
				})
				.refine(
					(s) => builtIn(s.key) || s.label !== "",
					"validation.step_name_required",
				),
		)
		.max(FULFILLMENT_STEPS_MAX, "validation.steps_max")
		.refine(uniqueKeys, "validation.steps_unique")
		.refine(keepsLocked, "validation.steps_locked"),
});
/** A checked `FulfillmentStepsInput`. */
export type FulfillmentStepsInput = z.infer<typeof FulfillmentStepsInput>;

/**
 * Cents received for an unpaid / partly paid order
 * (cash on delivery, bank transfer, a bill paid at the end).
 * POST /orders/:id/payments.
 * The REST API uses it too (POST /api/v1/orders/:id/payments).
 * The rest is optional, for a bill paid like at the till.
 */
export const PaymentInput = z.object({
	/** Cents received now. At least 1. */
	amount: z
		.number()
		.int()
		.min(1, "validation.amount_positive")
		.max(MAX_PAID_CENTS),
	/** The name of one of the shop's payment methods: the order then shows it. */
	payment_method: z.string().trim().min(1).max(50).optional(),
	/**
	 * The cents the buyer handed over when `amount` pays the order off:
	 * what is over is kept as the order's change. Ignored on a part payment.
	 */
	tendered: paidCents.optional(),
	/**
	 * The sales person to name on the order.
	 * null takes the name off. Left out = unchanged.
	 */
	sales_staff_id: z.number().int().nullable().optional(),
});
/** A checked `PaymentInput`. */
export type PaymentInput = z.infer<typeof PaymentInput>;
