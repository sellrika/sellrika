/**
 * German texts for this extension.
 * A key missing here falls back to en.ts.
 */
export default {
	name: "Chat-Meldungen",
	description:
		"Schickt neue Bestellungen, Zahlungen, Erstattungen, Stornos und Warnungen bei wenig Bestand an Slack, Discord, LINE und Telegram. Tragen Sie die Kanäle ein, die Sie nutzen; jeder ausgefüllte Kanal bekommt jedes angehakte Ereignis. Der Tagesbericht der Seite Berichte wird ebenfalls hier gesendet.",

	"field.events": "Senden",
	"field.slack_url": "Slack — Incoming-Webhook-URL",
	"field.slack_url_hint": "Slack › Apps › Incoming Webhooks",
	"field.discord_url": "Discord — Webhook-URL",
	"field.discord_url_hint": "Kanal › Bearbeiten › Integrationen › Webhooks",
	"field.line_token": "LINE — Channel Access Token",
	"field.line_token_hint":
		"LINE Official Account › Messaging API › langlebiges Token",
	"field.line_to": "LINE — Nutzer- oder Gruppen-ID",
	"field.line_to_hint": "Leer = alle Follower des Kontos",
	"field.telegram_token": "Telegram — Bot-Token",
	"field.telegram_token_hint": "Telegram › @BotFather › /newbot",
	"field.telegram_chat": "Telegram — Chat-ID",
	"field.telegram_chat_hint":
		"Fügen Sie den Bot zuerst dem Chat hinzu. Ein Kanal kann @name sein",

	"option.order.online": "Neue Online-Bestellung",
	"option.order.pos": "Neuer POS-Verkauf",
	"option.order.paid":
		"Bestellung später bezahlt (Nachnahme kassiert, Überweisung eingegangen)",
	"option.order.refunded": "Erstattung",
	"option.order.voided": "Bestellung storniert",
	"option.stock.low":
		'Wenig Bestand (ein Produkt erreicht seine Grenze "Wenig Bestand ab" oder ist ausverkauft)',

	/**
	 * The posted texts.
	 * Keep the emoji and the spacing as they are.
	 */
	"msg.order_online": "🛒 Neue Online-Bestellung {code} — {shop}",
	"msg.order_pos": "🛒 Neuer POS-Verkauf {code} — {shop}",
	"msg.money_line": "{money} · {paid}",
	"msg.paid_with": "Bezahlt mit {method}",
	"msg.unpaid": "UNBEZAHLT — {method}",
	"msg.item": "{qty} × {name}",
	"msg.paid": "💰 Bestellung {code} bezahlt — {money} mit {method} — {shop}",
	"msg.refund": "↩️ Erstattung zu {code} — {money}{why} — {shop}",
	"msg.void": "🚫 Bestellung {code} storniert{why} — {shop}",
	"msg.low_stock":
		"⚠️ Wenig Bestand: {name} — noch {stock} (wenig ab {low}) — {shop}",
	"msg.out_of_stock": "⚠️ Nicht mehr vorrätig: {name} — {shop}",
	"msg.report_head": "📊 Tagesbericht {date} — {shop}",
	"msg.report_empty": "Heute keine Verkäufe.",
	"msg.report_sales": "Umsatz: {money} · {orders} Bestellungen",
	"msg.report_refunds": "Erstattungen: {money}",
	"msg.report_revenue": "Nettoumsatz: {money}",
	"msg.report_profit": "Rohgewinn: {money}",
	"msg.report_top": "Meistverkaufte Produkte",
	"msg.report_product": "{qty} × {name} — {money}",
	"msg.report_methods": "Zahlungsarten",
	"msg.report_method": "{method}: {money} ({orders})",
};
