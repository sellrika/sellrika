/**
 * English texts for this extension.
 * It is the fallback for every other language.
 */
export default {
	name: "PromptPay QR",
	description:
		"Adds a PromptPay payment method. The customer screen shows a QR code for the exact amount, made from your own PromptPay ID. No provider, no fee.",
	"method.name": "PromptPay",

	"field.id": "PromptPay ID",
	"field.id_placeholder": "Phone number or national ID",
	"field.id_hint":
		"A phone number (10 digits), a national or tax ID (13 digits) or an e-wallet ID (15 digits). The money goes straight to this account.",
	"field.name": "Name under the QR code",
	"field.name_placeholder": "Plot (Thailand)",
	"field.name_hint": "Optional. The big name under the QR code.",
	"field.account": "Account name",
	"field.account_placeholder": "Plot (Thailand) Co., Ltd.",
	"field.account_hint":
		"Optional. Shown under the QR code, so the customer can check it against the name in the bank app.",

	"display.account": "Account: {name}",
	"display.scan": "Scan with your bank app to pay",
	"display.bad_id":
		"The PromptPay ID is not valid. Check it in Settings › Extensions.",
	"display.not_thb": "PromptPay works only in a shop that sells in Thai baht.",
};
