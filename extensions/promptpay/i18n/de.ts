/**
 * German texts for this extension.
 */
export default {
	name: "PromptPay-QR",
	description:
		"Fügt die Zahlungsart PromptPay hinzu. Die Kundenanzeige zeigt einen QR-Code über den genauen Betrag, erstellt aus Ihrer eigenen PromptPay-ID. Kein Anbieter, keine Gebühr.",
	"method.name": "PromptPay",

	"field.id": "PromptPay-ID",
	"field.id_placeholder": "Telefonnummer oder Ausweisnummer",
	"field.id_hint":
		"Eine Telefonnummer (10 Ziffern), eine Ausweis- oder Steuernummer (13 Ziffern) oder eine E-Wallet-ID (15 Ziffern). Das Geld geht direkt auf dieses Konto.",
	"field.name": "Name unter dem QR-Code",
	"field.name_placeholder": "Beispiel (Thailand)",
	"field.name_hint": "Optional. Der große Name unter dem QR-Code.",
	"field.account": "Kontoname",
	"field.account_placeholder": "Beispiel (Thailand) Co., Ltd.",
	"field.account_hint":
		"Optional. Steht unter dem QR-Code, damit der Kunde ihn mit dem Namen in der Banking-App vergleichen kann.",

	"display.account": "Konto: {name}",
	"display.scan": "Zum Bezahlen mit der Banking-App scannen",
	"display.bad_id":
		"Die PromptPay-ID ist ungültig. Prüfen Sie sie unter Einstellungen › Erweiterungen.",
	"display.not_thb":
		"PromptPay funktioniert nur in einem Shop, der in Thai Baht verkauft.",
};
