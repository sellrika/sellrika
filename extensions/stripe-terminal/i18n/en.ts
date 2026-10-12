/**
 * English texts for this extension.
 * It is the fallback for every other language.
 */
export default {
	name: "Stripe Terminal",
	description:
		"Take card payments at the till with a Stripe card reader (BBPOS WisePOS E, Stripe Reader S700). Tested with Stripe's simulated reader only, not yet on real hardware.",
	"method.name": "Card reader",

	"field.secret_key": "Secret key",
	"field.secret_key_placeholder": "sk_live_…",
	"field.secret_key_hint":
		"From your Stripe Dashboard › Developers › API keys. Register your reader in the Dashboard under Terminal first.",

	// the pay dialog
	"reader.title": "Card reader",
	"reader.loading": "Looking for readers…",
	"reader.none":
		"No reader found. Register one in your Stripe Dashboard under Terminal.",
	"reader.pick": "Reader",
	"reader.offline": "{name} (offline)",
	"reader.is_offline":
		"This reader is offline. Switch it on and check its internet.",
	"reader.reload": "Look again",
	"reader.send": "Send to reader",
	"reader.sending": "Sending to the reader…",
	"reader.waiting": "Waiting for the card…",
	"reader.cancel": "Cancel",
	"reader.approved": "Approved",
	"reader.declined": "Card declined",
	"reader.retry": "Try again",

	// the customer's screen
	"screen.tap": "Tap your card on the reader",

	// the order page
	"order.button": "Card payment",
	"order.button_uncaptured": "Card payment not captured",
	"order.button_refund_failed": "Card refund failed",
	"order.title": "Card payments",
	"order.description": "What the card reader took for this order.",
	"order.captured": "Paid by card",
	"order.uncaptured": "Card payment not captured",
	"order.cancelled": "Cancelled, nothing taken",
	"order.refund_done": "Card refund done: {amount}",
	"order.refund_failed": "Card refund failed: {amount}",
	"order.retry": "Try again",
	"order.close": "Close",
	"order.retry_ok": "Done. Everything went through.",
	"order.retry_failed": "Stripe refused again. See the reason below.",

	// refusals
	"error.request_failed": "Stripe could not be reached. Try again.",
	"error.reader": "Pick a reader first.",
	"error.amount": "The amount is not valid.",
	"error.unknown_charge": "This card payment is not known.",
	"error.reader_stopped": "The reader stopped before the card was taken.",
};
