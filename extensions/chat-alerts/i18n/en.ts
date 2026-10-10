/**
 * English texts for this extension.
 * Every other language falls back to this file.
 * The manifest names the `name`, `description`, `field.*` and `option.*`
 * keys.
 * index.ts builds every posted message from the `msg.*` keys with `t()`.
 */
export default {
	name: "Chat alerts",
	description:
		"Posts new orders, payments, refunds, voids and low-stock warnings to Slack, Discord and LINE. Fill in the channels you use; every filled channel gets every event you tick. The daily sales report of the Reports page is posted here too.",

	"field.events": "Send",
	"field.slack_url": "Slack — incoming webhook URL",
	"field.slack_url_hint": "Slack › Apps › Incoming Webhooks",
	"field.discord_url": "Discord — webhook URL",
	"field.discord_url_hint": "Channel › Edit › Integrations › Webhooks",
	"field.line_token": "LINE — channel access token",
	"field.line_token_hint":
		"LINE Official Account › Messaging API › long-lived token",
	"field.line_to": "LINE — user or group ID",
	"field.line_to_hint": "Blank = every follower of the account",

	"option.order.online": "New online order",
	"option.order.pos": "New POS sale",
	"option.order.paid":
		"Order paid later (cash on delivery collected, bank transfer seen)",
	"option.order.refunded": "Refund",
	"option.order.voided": "Order voided",
	"option.stock.low":
		'Low stock (a product reaches its "Low stock at" line, or runs out)',

	/**
	 * The posted texts.
	 * Keep the emoji and the spacing.
	 * Chat apps show them as they are.
	 */
	"msg.order_online": "🛒 New online order {code} — {shop}",
	"msg.order_pos": "🛒 New POS sale {code} — {shop}",
	"msg.money_line": "{money} · {paid}",
	"msg.paid_with": "Paid with {method}",
	"msg.unpaid": "UNPAID — {method}",
	"msg.item": "{qty} × {name}",
	"msg.paid": "💰 Order {code} paid — {money} with {method} — {shop}",
	"msg.refund": "↩️ Refund on {code} — {money}{why} — {shop}",
	"msg.void": "🚫 Order {code} voided{why} — {shop}",
	"msg.low_stock": "⚠️ Low stock: {name} — {stock} left (low at {low}) — {shop}",
	"msg.out_of_stock": "⚠️ Out of stock: {name} — {shop}",
	"msg.report_head": "📊 Daily report {date} — {shop}",
	"msg.report_empty": "No sales today.",
	"msg.report_sales": "Sales: {money} · {orders} orders",
	"msg.report_refunds": "Refunds: {money}",
	"msg.report_revenue": "Net revenue: {money}",
	"msg.report_profit": "Gross profit: {money}",
	"msg.report_top": "Top products",
	"msg.report_product": "{qty} × {name} — {money}",
	"msg.report_methods": "Payment methods",
	"msg.report_method": "{method}: {money} ({orders})",
};
