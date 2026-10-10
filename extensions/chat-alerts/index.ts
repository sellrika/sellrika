/**
 * Chat alerts: one short text per event, posted to every channel the
 * shop filled in.
 * Slack and Discord take a webhook URL.
 * LINE uses the Messaging API: a push to one ID, or a broadcast to the
 * official account's followers.
 * New orders and low stock are the point of it.
 * "Paid later" is the manual-payment case: cash on delivery and bank
 * transfer.
 * The daily sales report of the Reports page is posted here too, to the
 * channels the shop picked there.
 * Every text comes from i18n/<locale>.ts through `t`, so the shop reads
 * its alerts in its own language.
 */
import type {
	Config,
	DailyReport,
	Events,
	Listeners,
	OrderFull,
	Shop,
	StockMovement,
	StockUnit,
	Translate,
} from "../types";

/**
 * How long one request to a chat service may take.
 */
const TIMEOUT_MS = 10_000;
/**
 * Characters Discord takes in one message.
 */
const DISCORD_MAX = 2000;
/**
 * Characters LINE takes in one message.
 */
const LINE_MAX = 5000;
/**
 * Where a message to one LINE user or group is sent.
 */
const LINE_PUSH = "https://api.line.me/v2/bot/message/push";
/**
 * Where a message to every follower of the account is sent.
 */
const LINE_BROADCAST = "https://api.line.me/v2/bot/message/broadcast";

/**
 * The settings the admin filled in on /extensions.
 * A channel left empty is simply skipped.
 */
type Settings = {
	events: string[];
	slack_url: string;
	discord_url: string;
	line_token: string;
	line_to: string;
};
/**
 * What a listener for one event receives.
 * It is the shop and the settings, plus that event's own payload.
 */
type Ctx<E extends keyof Events> = {
	shop: Shop;
	config: Config;
	t: Translate;
	locale: string;
} & Events[E];

/**
 * The texts.
 */

/**
 * Formats an amount of money for a message.
 * @param cents The amount as the POS stores it.
 * @param currency The shop's currency.
 * @param locale The language to format for.
 * @returns The amount with its currency sign.
 */
function money(cents: number, currency: string, locale = "en"): string {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
		trailingZeroDisplay: "stripIfInteger",
	}).format(cents / 100);
}

/**
 * The order code a buyer would recognise.
 * @param order The order.
 * @returns Its public reference, or `#<id>` when it has none.
 */
function code(order: OrderFull): string {
	return order.reference ?? `#${order.id}`;
}

/**
 * The "new order" text.
 * It has the same shape as the built-in Telegram alert: headline, money
 * and how it was paid, the lines, then the delivery note.
 * @param shop The selling shop.
 * @param order The order with its lines.
 * @param t The extension's dictionary in the buyer's language.
 * @param locale That language, used to format the money.
 * @returns The message.
 */
function orderText(
	shop: Shop,
	order: OrderFull,
	t: Translate,
	locale: string,
): string {
	const head = order.fulfillment ? "msg.order_online" : "msg.order_pos";
	const paid =
		order.payment_status === "paid"
			? t("msg.paid_with", { method: order.payment_method })
			: t("msg.unpaid", { method: order.payment_method });
	const lines = order.items.map(function item(i) {
		return t("msg.item", { qty: i.qty, name: i.name });
	});
	const out = [
		t(head, { code: code(order), shop: shop.name }),
		t("msg.money_line", {
			money: money(order.total, shop.currency, locale),
			paid,
		}),
		"",
		...lines,
	];
	if (order.note) out.push("", order.note);
	return out.join("\n");
}

/**
 * The low-stock text.
 * Nothing comes back when this movement did not take the unit across
 * its "low" line, so a busy product alerts once, not on every sale.
 * @param shop The shop.
 * @param movement The ledger row.
 * @param unit The unit as it is after the row.
 * @param t The extension's dictionary in the shop's language.
 * @returns The message, or null when there is nothing to warn about.
 */
function lowStockText(
	shop: Shop,
	movement: StockMovement,
	unit: StockUnit,
	t: Translate,
): string | null {
	/**
	 * ponytail: several rows on one unit in one write see the same final
	 * count — fine for an alert.
	 */
	const before = unit.stock - movement.qty;
	const isLow = unit.stock <= unit.low_stock_at;
	const wasLow = before <= unit.low_stock_at;
	if (!isLow || wasLow) return null;
	const name = unit.variant ? `${unit.name} — ${unit.variant}` : unit.name;
	if (unit.stock <= 0) return t("msg.out_of_stock", { name, shop: shop.name });
	return t("msg.low_stock", {
		name,
		stock: unit.stock,
		low: unit.low_stock_at,
		shop: shop.name,
	});
}

/**
 * The daily report text.
 * It has the headline, the money of the day, the best sellers, then the
 * payment methods.
 * A day with no sale is one short line.
 * @param shop The shop.
 * @param report The shop's day.
 * @param t The extension's dictionary in the shop's language.
 * @param locale That language, used to format the money.
 * @returns The message.
 */
function reportText(
	shop: Shop,
	report: DailyReport,
	t: Translate,
	locale: string,
): string {
	/**
	 * Formats an amount in the shop's currency.
	 * @param cents The amount.
	 * @returns The amount with its currency sign.
	 */
	function cash(cents: number): string {
		return money(cents, shop.currency, locale);
	}
	const s = report.summary;
	const out = [t("msg.report_head", { date: report.date, shop: shop.name })];
	if (!s.orders && !s.refunds)
		return [...out, t("msg.report_empty")].join("\n");
	out.push(t("msg.report_sales", { money: cash(s.sales), orders: s.orders }));
	if (s.refunds) out.push(t("msg.report_refunds", { money: cash(s.refunds) }));
	out.push(t("msg.report_revenue", { money: cash(s.revenue) }));
	out.push(t("msg.report_profit", { money: cash(s.profit) }));
	if (report.top_products.length) {
		out.push("", t("msg.report_top"));
		for (const p of report.top_products)
			out.push(
				t("msg.report_product", {
					qty: p.qty,
					name: p.name,
					money: cash(p.revenue),
				}),
			);
	}
	if (report.by_method.length) {
		out.push("", t("msg.report_methods"));
		for (const m of report.by_method)
			out.push(
				t("msg.report_method", {
					method: m.method,
					money: cash(m.sales),
					orders: m.orders,
				}),
			);
	}
	return out.join("\n");
}

/**
 * The channels.
 */

/**
 * Makes one request to a chat service.
 * The error names only the host, so a webhook URL or a token never
 * lands in the server log.
 * @param url Where to send it.
 * @param init The request options.
 * @throws When the service answered with an error status.
 */
async function call(url: string, init: RequestInit): Promise<void> {
	const res = await fetch(url, {
		...init,
		redirect: "manual",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
}

/**
 * Posts a JSON body to one chat service.
 * @param url Where to send it.
 * @param body What to send. It is turned into JSON.
 * @param headers Extra headers, an authorization one for example.
 * @returns A promise that settles once the request is done.
 */
function postJson(
	url: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<void> {
	return call(url, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

/**
 * Posts the text to the shop's Slack webhook.
 * @param c The settings, which hold the webhook URL.
 * @param text The message.
 * @returns A promise that settles once the post is done.
 */
function toSlack(c: Settings, text: string): Promise<void> {
	return postJson(c.slack_url, { text });
}

/**
 * Posts the text to the shop's Discord webhook.
 * A message longer than Discord takes is cut short.
 * @param c The settings, which hold the webhook URL.
 * @param text The message.
 * @returns A promise that settles once the post is done.
 */
function toDiscord(c: Settings, text: string): Promise<void> {
	return postJson(c.discord_url, { content: text.slice(0, DISCORD_MAX) });
}

/**
 * Sends the text to LINE.
 * It is pushed to the one ID when that is set.
 * Otherwise it is broadcast to every follower of the official account.
 * @param c The settings, which hold the token and the optional ID.
 * @param text The message. It is cut short when LINE would refuse it.
 * @returns A promise that settles once the send is done.
 */
function toLine(c: Settings, text: string): Promise<void> {
	const messages = [{ type: "text", text: text.slice(0, LINE_MAX) }];
	const headers = { authorization: `Bearer ${c.line_token}` };
	if (c.line_to)
		return postJson(LINE_PUSH, { to: c.line_to, messages }, headers);
	return postJson(LINE_BROADCAST, { messages }, headers);
}

/**
 * Posts one text to every channel that is filled in.
 * Every channel is tried; the error lists the ones that failed.
 * @param config The settings.
 * @param text The message.
 * @param only When given, only these channels get it (`slack`,
 * `discord`, `line`).
 * @throws When any channel failed.
 */
async function send(
	config: Config,
	text: string,
	only?: string[],
): Promise<void> {
	const c = config as Settings;
	/**
	 * Says whether one channel should get this text.
	 * @param name The channel's name.
	 * @returns True when no list was given, or the list names it.
	 */
	function picked(name: string): boolean {
		return !only || only.includes(name);
	}
	const jobs: Promise<void>[] = [];
	if (c.slack_url && picked("slack")) jobs.push(toSlack(c, text));
	if (c.discord_url && picked("discord")) jobs.push(toDiscord(c, text));
	if (c.line_token && picked("line")) jobs.push(toLine(c, text));
	const results = await Promise.allSettled(jobs);
	const failed = results.filter(
		(r): r is PromiseRejectedResult => r.status === "rejected",
	);
	if (failed.length)
		throw new Error(
			failed
				.map((r) =>
					r.reason instanceof Error ? r.reason.message : String(r.reason),
				)
				.join("; "),
		);
}

/**
 * Says whether the shop ticked one alert on the settings page.
 * @param config The settings.
 * @param what The alert's name, `"order.pos"` for example.
 * @returns True when the shop wants it.
 */
function wants(config: Config, what: string): boolean {
	return (config.events as string[]).includes(what);
}

/**
 * The listeners.
 */

/**
 * Alerts about a new order, online or at the till.
 * @param ctx The shop, the settings and the new order.
 */
async function onOrderCreated({
	shop,
	config,
	order,
	t,
	locale,
}: Ctx<"order.created">): Promise<void> {
	const what = order.fulfillment ? "order.online" : "order.pos";
	if (wants(config, what))
		await send(config, orderText(shop, order, t, locale));
}

/**
 * Alerts when an order is paid later.
 * Only a payment recorded on an existing order moves payment_status.
 * A POS sale or a gateway checkout is paid the moment it exists, so it
 * never fires this.
 * @param ctx The shop, the settings, the order and what changed.
 */
async function onStatusChanged({
	shop,
	config,
	order,
	field,
	to,
	t,
	locale,
}: Ctx<"order.status_changed">): Promise<void> {
	if (
		field !== "payment_status" ||
		to !== "paid" ||
		!wants(config, "order.paid")
	)
		return;
	await send(
		config,
		t("msg.paid", {
			code: code(order),
			money: money(order.total, shop.currency, locale),
			method: order.payment_method,
			shop: shop.name,
		}),
	);
}

/**
 * Alerts about money going back to a customer.
 * @param ctx The shop, the settings, the order and the refund.
 */
async function onRefunded({
	shop,
	config,
	order,
	refund,
	t,
	locale,
}: Ctx<"order.refunded">): Promise<void> {
	if (!wants(config, "order.refunded")) return;
	const why = refund.reason ? ` (${refund.reason})` : "";
	await send(
		config,
		t("msg.refund", {
			code: code(order),
			money: money(refund.amount, shop.currency, locale),
			why,
			shop: shop.name,
		}),
	);
}

/**
 * Alerts about a voided order.
 * @param ctx The shop, the settings, the order and the reason given.
 */
async function onVoided({
	shop,
	config,
	order,
	reason,
	t,
}: Ctx<"order.voided">): Promise<void> {
	if (!wants(config, "order.voided")) return;
	const why = reason ? ` — ${reason}` : "";
	await send(
		config,
		t("msg.void", { code: code(order), why, shop: shop.name }),
	);
}

/**
 * Warns when a stock move leaves a unit low or empty.
 * @param ctx The shop, the settings, the ledger row and the unit.
 */
async function onStockUpdated({
	shop,
	config,
	movement,
	unit,
	t,
}: Ctx<"stock.updated">): Promise<void> {
	if (!wants(config, "stock.low")) return;
	const text = lowStockText(shop, movement, unit, t);
	if (text) await send(config, text);
}

/**
 * Posts the shop's daily sales report.
 * The Reports page is its switch, so the tick list is not asked.
 * @param ctx The shop, the settings, the report and the picked channels.
 */
async function onDailyReport({
	shop,
	config,
	report,
	channels,
	t,
	locale,
}: Ctx<"report.daily">): Promise<void> {
	await send(config, reportText(shop, report, t, locale), channels);
}

/**
 * The events this extension listens for.
 * Each order and stock one still checks the shop's own tick list before
 * it posts.
 */
export default {
	"order.created": onOrderCreated,
	"order.status_changed": onStatusChanged,
	"order.refunded": onRefunded,
	"order.voided": onVoided,
	"stock.updated": onStockUpdated,
	"report.daily": onDailyReport,
} satisfies Listeners;
