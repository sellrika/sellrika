/**
 * English texts for the Omise extension.
 * English is the fallback for every other language.
 * The manifest names these keys where it shows text.
 * The checkout script reads them with `api.t`.
 * A GatewayError whose message is a key is shown translated.
 */
export default {
	/**
	 * What the Extensions page calls this extension,
	 * and the one line under that name.
	 */
	name: "Omise",
	description:
		"Take online payments with Omise: its own form opens over the checkout page and offers every method your account has switched on.",
	/**
	 * The settings form: the labels and the hints under them.
	 */
	"field.public_key": "Public key",
	"field.public_key_hint": "pkey_live_…",
	"field.secret_key": "Secret key",
	"field.secret_key_hint": "skey_live_…",
	/**
	 * Failures the buyer may be shown.
	 * Omise's own message is used when it sends one.
	 * `error.request_failed` is the fallback when it does not.
	 * The `error.form_*` texts come from the checkout script.
	 */
	"error.request_failed": "Omise request failed",
	"error.form_load":
		"Could not load the payment form — please check your connection and try again",
	"error.form_missing": "Could not load the payment form — please try again",
	/**
	 * The submit button of Omise's own form.
	 */
	"form.pay": "Pay",
};
