/**
 * English text for this extension.
 * It is the fallback when a language file has no entry.
 * The manifest names these keys wherever it shows text.
 * A GatewayError whose message is a key is shown to the buyer
 * in their own language.
 */
export default {
	name: "Stripe",
	description:
		"Take online payments with Stripe: the buyer pays on Stripe's own hosted page and comes back to the store.",
	"field.publishable_key": "Publishable key",
	"field.publishable_key_hint": "pk_live_…",
	"field.secret_key": "Secret key",
	"field.secret_key_hint": "sk_live_…",
	/**
	 * What the buyer is told when a call to Stripe fails.
	 * Stripe's own message is shown when it sends one.
	 * This line is the fallback when it sends none.
	 */
	"error.request_failed": "Stripe request failed",
};
