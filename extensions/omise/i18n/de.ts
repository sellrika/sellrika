/**
 * German texts for the Omise extension.
 * It carries the same keys as i18n/en.ts.
 * Brand and product names stay as they are, such as Omise.
 * So do the example keys.
 */
export default {
	/**
	 * What the Extensions page calls this extension,
	 * and the one line under that name.
	 */
	name: "Omise",
	description:
		"Online-Zahlungen mit Omise annehmen: Das Formular von Omise öffnet sich über der Kassenseite und bietet jede Methode an, die in Ihrem Konto eingeschaltet ist.",
	/**
	 * The settings form: the labels and the hints under them.
	 */
	"field.public_key": "Öffentlicher Schlüssel",
	"field.public_key_hint": "pkey_live_…",
	"field.secret_key": "Geheimer Schlüssel",
	"field.secret_key_hint": "skey_live_…",
	/**
	 * Failures the buyer may be shown.
	 * Omise's own message is used when it sends one.
	 * `error.request_failed` is the fallback when it does not.
	 * The `error.form_*` texts come from the checkout script.
	 */
	"error.request_failed": "Die Anfrage an Omise ist fehlgeschlagen",
	"error.form_load":
		"Das Zahlungsformular konnte nicht geladen werden — bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut",
	"error.form_missing":
		"Das Zahlungsformular konnte nicht geladen werden — bitte versuchen Sie es erneut",
	/**
	 * The submit button of Omise's own form.
	 */
	"form.pay": "Bezahlen",
};
