/**
 * German texts for this extension.
 * A key missing here falls back to en.ts.
 */
export default {
	name: "Webhook",
	description:
		"Schickt Ereignisse als JSON an Ihre eigenen URLs, damit andere Systeme (Buchhaltung, ein Versanddienst, eine Tabelle) sofort davon erfahren. Jeder Webhook wählt seine eigenen Ereignisse.",

	"field.secret": "Signaturschlüssel",
	"field.secret_hint":
		"Eine beliebige lange Zufallszeichenfolge — jede Anfrage wird damit signiert",
	"field.hooks": "Webhooks",
	"field.hooks_add": "Webhook hinzufügen",
	"field.url": "URL",
	"field.events": "Ereignisse",

	"option.order.created": "Bestellung angelegt",
	"option.order.updated": "Bestellung geändert",
	"option.order.status_changed": "Bestellstatus geändert",
	"option.order.paid": "Bestellung bezahlt",
	"option.order.refunded": "Bestellung erstattet",
	"option.order.voided": "Bestellung storniert",
	"option.product.created": "Produkt angelegt",
	"option.product.updated": "Produkt geändert",
	"option.product.deleted": "Produkt gelöscht",
	"option.customer.created": "Kunde angelegt",
	"option.customer.updated": "Kunde geändert",
	"option.customer.deleted": "Kunde gelöscht",
	"option.stock.updated": "Bestand geändert",
	"option.staff.created": "Mitarbeiter angelegt",
	"option.staff.updated": "Mitarbeiter geändert",
	"option.staff.deleted": "Mitarbeiter gelöscht",
};
