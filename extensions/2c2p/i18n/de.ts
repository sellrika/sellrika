/**
 * German texts for the 2C2P extension.
 * It carries the same keys as i18n/en.ts.
 * Brand and product names stay as they are: 2C2P, Sandbox.
 * So do example values.
 */
export default {
	/**
	 * What the Extensions page calls this extension,
	 * and the one line under that name.
	 */
	name: "2C2P",
	description:
		"Online-Zahlungen mit 2C2P annehmen: Der Käufer zahlt auf der gehosteten Seite von 2C2P, die jeden Kanal anbietet, den Ihr Konto eingeschaltet hat.",
	/**
	 * The settings form.
	 * `field.*` are the labels and the hints under them.
	 * `option.*` are the choices of the Environment list.
	 */
	"field.api_url": "Umgebung",
	"option.production": "Produktion",
	"option.sandbox": "Sandbox",
	"field.merchant_id": "Händler-ID",
	"field.merchant_id_hint": "JT01",
	"field.secret_key": "Geheimer Schlüssel",
	"field.secret_key_hint": "Der geheime Schlüssel des Händlers",
	/**
	 * Failures the buyer may be shown.
	 * 2C2P's own respDesc is used when it sends one.
	 * These texts are the fallback when it does not.
	 */
	"error.bad_signature":
		"2C2P hat mit einer falschen Signatur geantwortet — bitte prüfen Sie den geheimen Schlüssel",
	"error.request_failed": "Die Anfrage an 2C2P ist fehlgeschlagen",
	"error.start_failed": "2C2P konnte die Zahlung nicht starten",
};
