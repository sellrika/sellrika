/**
 * German text for this extension.
 * It has the same keys as en.ts, which is the fallback.
 * Brand and product names stay as they are.
 * That covers PayPal, Live, Sandbox and REST.
 */
export default {
	name: "PayPal",
	description:
		"Online-Zahlungen mit PayPal annehmen: Der Käufer bestätigt die Bestellung auf der Seite von PayPal, und das Geld wird bei seiner Rückkehr eingezogen.",
	"field.api_url": "Umgebung",
	"option.live": "Live",
	"option.sandbox": "Sandbox",
	"field.client_id": "Client-ID",
	"field.client_id_hint": "Die Client-ID der REST-App",
	"field.client_secret": "Geheimer Schlüssel",
	"field.client_secret_hint": "Das Geheimnis der REST-App",
	/**
	 * What the buyer is told when a call to PayPal fails.
	 * PayPal's own description is shown when it sends one.
	 * These lines are the fallbacks when it sends none.
	 */
	"error.credentials": "PayPal hat die Zugangsdaten abgelehnt",
	"error.request_failed": "Die Anfrage an PayPal ist fehlgeschlagen",
	"error.code_expired":
		"Der Rabattcode ist nicht mehr gültig. Es wurde nichts abgebucht. Bitte den Kauf erneut starten.",
	"error.start_failed": "PayPal konnte die Zahlung nicht starten",
};
