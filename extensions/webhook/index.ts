/**
 * Webhook: posts events as JSON to the shop's own URLs.
 * Each webhook row picks the events it wants.
 * Every request is signed with one shared secret, an HMAC-SHA256 over
 * the body.
 * The receiver checks `X-Pos-Signature: sha256=<hex>` by working out the
 * same HMAC over the raw body.
 */
import type { Config, Events, Listeners, Outbound, Shop } from "../types";

/**
 * How long one POST to a receiver may take.
 */
const TIMEOUT_MS = 10_000;
/**
 * One row of the `hooks` field in extension.json.
 */
type Hook = { url: string; events: string[] };

/**
 * Sends one POST per webhook that picked this event.
 * Nothing is sent when no webhook wants it.
 * The body is `{ event, sent_at, shop: { id, name, currency }, ...data }`.
 * `data` is the event's payload as it is, so the receiver reads `order`,
 * `product`, `movement` and the rest by name.
 * @param event The event name. It is also sent as `X-Pos-Event`.
 * @param ctx The shop, the settings (`secret`, `hooks`) and the event's
 * payload.
 * @throws When any receiver failed. Every URL is still tried.
 */
async function send(
	event: keyof Events,
	ctx: { shop: Shop; config: Config; outbound: Outbound } & Record<
		string,
		unknown
	>,
) {
	const { shop, config, outbound, ...data } = ctx;
	const { secret, hooks } = config as { secret: string; hooks: Hook[] };
	const targets = hooks.filter((h) => h.events.includes(event));
	if (!targets.length) return;
	const body = JSON.stringify({
		event,
		sent_at: new Date().toISOString(),
		shop: { id: shop.id, name: shop.name, currency: shop.currency },
		...data,
	});
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"x-pos-event": event,
	};
	if (secret)
		headers["x-pos-signature"] =
			`sha256=${new Bun.CryptoHasher("sha256", secret).update(body).digest("hex")}`;
	/**
	 * ponytail: one try, no retry queue.
	 * Keep failed deliveries in a table with backoff if a receiver being
	 * down must not lose events.
	 */
	const results = await Promise.allSettled(
		targets.map(async (h) => {
			// the app's checked sender: an address inside the server's
			// own network is refused
			const res = await outbound(h.url, {
				method: "POST",
				headers,
				body,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`${h.url}: HTTP ${res.status}`);
		}),
	);
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
 * One listener per event the manifest offers.
 * `send` posts only to the webhooks that ticked that event.
 */
export default {
	"order.created": (ctx) => send("order.created", ctx),
	"order.updated": (ctx) => send("order.updated", ctx),
	"order.status_changed": (ctx) => send("order.status_changed", ctx),
	"order.paid": (ctx) => send("order.paid", ctx),
	"order.refunded": (ctx) => send("order.refunded", ctx),
	"order.voided": (ctx) => send("order.voided", ctx),
	"product.created": (ctx) => send("product.created", ctx),
	"product.updated": (ctx) => send("product.updated", ctx),
	"product.deleted": (ctx) => send("product.deleted", ctx),
	"customer.created": (ctx) => send("customer.created", ctx),
	"customer.updated": (ctx) => send("customer.updated", ctx),
	"customer.deleted": (ctx) => send("customer.deleted", ctx),
	"stock.updated": (ctx) => send("stock.updated", ctx),
	"staff.created": (ctx) => send("staff.created", ctx),
	"staff.updated": (ctx) => send("staff.updated", ctx),
	"staff.deleted": (ctx) => send("staff.deleted", ctx),
} satisfies Listeners;
