import { usePage } from "@inertiajs/vue3";
import type { Key } from "@i18n";
import { FULFILLMENT_COLORS } from "@constants/Order.Constant";
import { t } from "@/lib/i18n";
import type {
	FulfillmentStep,
	Order,
	OrderStatus,
	PaymentStatus,
	SharedProps,
} from "@/types";

/** Label key + badge classes per order status (Orders list, order page, customer history); translate `label` where it is shown. */
export const ORDER_STATUS: Record<OrderStatus, { label: Key; class: string }> =
	{
		completed: {
			label: "orders.completed",
			class:
				"border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
		},
		partially_refunded: {
			label: "orders.partly_refunded",
			class:
				"border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
		},
		refunded: {
			label: "orders.refunded",
			class:
				"border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
		},
		voided: {
			label: "orders.voided",
			class:
				"border-zinc-300 bg-zinc-100 text-zinc-600 line-through dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
		},
	};

/** Label key + badge classes per payment state; `paid` is the norm and gets no badge. */
export const PAYMENT_STATUS: Record<
	PaymentStatus,
	{ label: Key; class: string }
> = {
	unpaid: {
		label: "orders.unpaid",
		class:
			"border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
	},
	partial: {
		label: "orders.partly_paid",
		class:
			"border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
	},
	paid: {
		label: "orders.paid",
		class:
			"border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
	},
};

/** Label key per built-in delivery step of an online order (their colours: `FULFILLMENT_COLORS`). */
export const FULFILLMENT: Record<string, { label: Key }> = {
	new: { label: "orders.new" },
	packing: { label: "orders.packing" },
	shipped: { label: "orders.shipped" },
	delivered: { label: "orders.delivered" },
};

/** The badge colour of a step with none: grey. */
const NO_COLOR = "#64748b";

/** The built-in steps a shop can never remove (the checkout writes `new`, `shipped` emails the buyer). */
export const LOCKED_STEPS = ["new", "shipped", "delivered"];

/**
 * What a delivery step is called.
 * @param key the step key
 * @param steps the shop's steps
 * @returns the shop's own name, else the built-in one, else the key
 */
export function stepLabel(key: string, steps: FulfillmentStep[] = []) {
	const own = steps.find((s) => s.key === key)?.label;
	if (own) return own;
	const built = FULFILLMENT[key];
	return built ? t(built.label) : key;
}

/**
 * Did a running extension take the delivery steps off the order pages?
 * (`orders.delivery: hide`, e.g. a restaurant: nothing is shipped.)
 * @returns true when the step tabs, badges and the Delivery card stay hidden
 */
export function deliveryHidden() {
	return (usePage<SharedProps>().props.extension_ui ?? []).some(
		function hides(e) {
			return e.app?.["orders.delivery"] === "hide";
		},
	);
}

/**
 * The status badges of an order (list + detail page): order status + delivery step.
 * The delivery step is left out while an extension hides delivery (`deliveryHidden`).
 * "Completed" is the normal case, so it only shows when nothing more useful does.
 * Payment status is not here; `PaymentState.vue` shows it next to the payment method.
 * @param o the order
 * @param steps the shop's delivery steps (for their names)
 * @returns the text + classes of each badge
 */
export function statusBadges(
	o: Pick<Order, "status" | "fulfillment">,
	steps: FulfillmentStep[] = [],
) {
	/**
	 * One order-status badge.
	 * @param s the order status
	 * @returns its text + classes
	 */
	function status(s: OrderStatus): {
		label: string;
		class: string;
		style?: Record<string, string>;
	} {
		return { label: t(ORDER_STATUS[s].label), class: ORDER_STATUS[s].class };
	}
	if (o.status === "voided") return [status("voided")];
	const list = [];
	if (o.status !== "completed") list.push(status(o.status));
	if (o.fulfillment && !deliveryHidden())
		list.push({
			label: stepLabel(o.fulfillment, steps),
			class: "",
			style: stepStyle(stepColor(o.fulfillment, steps)),
		});
	return list.length ? list : [status("completed")];
}

/**
 * The colour of a delivery step.
 * @param key the step key
 * @param steps the shop's steps
 * @returns the shop's pick, else the built-in colour, else grey
 */
export function stepColor(key: string, steps: FulfillmentStep[] = []) {
	return (
		steps.find((s) => s.key === key)?.color ||
		FULFILLMENT_COLORS[key] ||
		NO_COLOR
	);
}

/**
 * Badge colours from a step's own colour: the text in it, a light border and fill.
 * Tinted with transparency, so it reads on light and dark pages.
 * @param color the step's `#rrggbb`
 * @returns the inline style
 */
export function stepStyle(color: string) {
	return {
		color,
		borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
		backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
	};
}
