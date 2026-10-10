/**
 * German text for this extension.
 * It has the same keys as en.ts, which is the fallback.
 * Brand and product names stay as they are, so Stripe is kept.
 * The key examples like `pk_live_…` are kept as well.
 */
export default {
	name: "Stripe",
	description:
		"Online-Zahlungen mit Stripe annehmen: Der Käufer zahlt auf der gehosteten Seite von Stripe und kommt danach in den Shop zurück.",
	"field.publishable_key": "Veröffentlichbarer Schlüssel",
	"field.publishable_key_hint": "pk_live_…",
	"field.secret_key": "Geheimer Schlüssel",
	"field.secret_key_hint": "sk_live_…",
	/**
	 * What the buyer is told when a call to Stripe fails.
	 * Stripe's own message is shown when it sends one.
	 * This line is the fallback when it sends none.
	 */
	"error.request_failed": "Die Anfrage an Stripe ist fehlgeschlagen",
};
