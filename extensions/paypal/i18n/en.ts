/**
 * English text for this extension.
 * It is the fallback when a language file has no entry.
 * The manifest names these keys wherever it shows text.
 * A GatewayError whose message is a key is shown to the buyer
 * in their own language.
 */
export default {
	name: "PayPal",
	description:
		"Take online payments with PayPal: the buyer approves the order on PayPal's page and the money is taken when they come back.",
	"field.api_url": "Environment",
	"option.live": "Live",
	"option.sandbox": "Sandbox",
	"field.client_id": "Client ID",
	"field.client_id_hint": "The REST app's client ID",
	"field.client_secret": "Secret key",
	"field.client_secret_hint": "The REST app's secret",
	/**
	 * What the buyer is told when a call to PayPal fails.
	 * PayPal's own description is shown when it sends one.
	 * These lines are the fallbacks when it sends none.
	 */
	"error.credentials": "PayPal rejected the credentials",
	"error.request_failed": "PayPal request failed",
	"error.code_expired":
		"The discount code is no longer valid. Nothing was charged. Please check out again.",
	"error.start_failed": "PayPal could not start the payment",
};
