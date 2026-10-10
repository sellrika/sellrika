/**
 * English texts for the 2C2P extension.
 * English is the fallback for every other language.
 * The manifest names these keys where it shows text.
 * A GatewayError whose message is a key is shown to the
 * buyer in their own language.
 */
export default {
	/**
	 * What the Extensions page calls this extension,
	 * and the one line under that name.
	 */
	name: "2C2P",
	description:
		"Take online payments with 2C2P: the buyer pays on 2C2P's hosted page, which offers every channel your account has switched on.",
	/**
	 * The settings form.
	 * `field.*` are the labels and the hints under them.
	 * `option.*` are the choices of the Environment list.
	 */
	"field.api_url": "Environment",
	"option.production": "Production",
	"option.sandbox": "Sandbox",
	"field.merchant_id": "Merchant ID",
	"field.merchant_id_hint": "JT01",
	"field.secret_key": "Secret key",
	"field.secret_key_hint": "The merchant secret key",
	/**
	 * Failures the buyer may be shown.
	 * 2C2P's own respDesc is used when it sends one.
	 * These texts are the fallback when it does not.
	 */
	"error.bad_signature":
		"2C2P answered with a bad signature — check the secret key",
	"error.request_failed": "2C2P request failed",
	"error.start_failed": "2C2P could not start the payment",
};
