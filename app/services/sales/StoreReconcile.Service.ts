import { Service } from "@xcore/di";
import { I18n } from "@xcore/i18n/I18n";
import { ShopRepository } from "@repositories/Shop.Repository";
import {
	StoreCartRepository,
	type StoreCart,
} from "@repositories/StoreCart.Repository";
import {
	STORE_RECONCILE_MAX_WAIT_MS,
	STORE_RECONCILE_WINDOW_MS,
	STORE_RECONCILE_WORKERS,
} from "@constants/Store.Constant";
import { workers } from "@helpers/workers";
import type { Shop } from "@models/Shop";
import { StoreService } from "./Store.Service";

/**
 * Closes the gap between "the buyer paid" and "the buyer came back
 * to /done".
 * A lost connection, a closed tab, or our own server being down at that
 * moment would otherwise leave a paid checkout with no order.
 * Every checkout handed to a gateway is a `store_carts` row keyed by
 * the gateway's id. So this sweep simply asks the gateway again.
 * It uses the same `StoreService.fulfill` the return page uses,
 * which creates the order once and emails the receipt.
 * No webhooks: we pull.
 * So a gateway that never re-sends a notification, or a server that
 * was down when it did, changes nothing.
 */
@Service()
export class StoreReconcileService {
	constructor(
		private carts: StoreCartRepository,
		private shops: ShopRepository,
		private store: StoreService,
	) {}

	/**
	 * One sweep over every checkout that is due a look.
	 * Paid → the order is created (and the buyer emailed).
	 * Still pending → asked again later, waiting twice as long each time
	 * (2, 4, 8… minutes, capped).
	 * Failed → left alone, `purgeStale` drops it after a week.
	 * A gateway that can't be reached counts as pending.
	 * Carts whose buyer never even submitted a card (tokenising gateways
	 * with no charge) are deferred the same way and cost no API call.
	 * A few carts are looked at at the same time
	 * (`STORE_RECONCILE_WORKERS`), each shop is loaded once.
	 * Every outcome is logged under `[store-reconcile]`.
	 * A sweep with nothing to look at logs nothing (it runs every minute).
	 * @param now The current time (injectable for tests).
	 * @returns How many carts were looked at, and how many became orders.
	 */
	async run(now = new Date()): Promise<{ checked: number; fulfilled: number }> {
		const due = await this.carts.due(now);
		const shops = new Map<number, Promise<Shop | null>>();
		let fulfilled = 0;
		let next = 0;
		const check = this.#check.bind(this);
		/**
		 * The next cart nobody has taken yet.
		 * @returns The cart, or null when all are taken.
		 */
		async function take() {
			return due[next++] ?? null;
		}
		/**
		 * Look at one cart and count it when it became an order.
		 * @param cart The cart.
		 */
		async function look(cart: StoreCart) {
			if (await check(cart, shops, now)) fulfilled++;
		}
		await workers(STORE_RECONCILE_WORKERS, take, look);
		if (due.length)
			console.log(
				`[store-reconcile] ${due.length} checkout(s) looked at, ${fulfilled} became order(s)`,
			);
		return { checked: due.length, fulfilled };
	}

	/**
	 * Look at one cart. It never throws: one bad cart must not stop the others.
	 * @param cart The cart.
	 * @param shops The shops loaded so far in this sweep, by id.
	 * @param now The current time.
	 * @returns True when the cart became an order.
	 */
	async #check(
		cart: StoreCart,
		shops: Map<number, Promise<Shop | null>>,
		now: Date,
	): Promise<boolean> {
		try {
			let found = shops.get(cart.shop_id);
			if (!found) {
				found = this.shops.find(cart.shop_id);
				shops.set(cart.shop_id, found);
			}
			const shop = await found;
			return shop ? await this.#ask(shop, cart, now) : false;
		} catch (e) {
			console.error(`[store-reconcile] cart #${cart.id}: check failed —`, e);
			return false;
		}
	}

	/**
	 * Ask the gateway about one cart and act on the answer.
	 * @param shop The cart's shop.
	 * @param cart The cart.
	 * @param now The current time.
	 * @returns True when the cart became an order.
	 */
	async #ask(shop: Shop, cart: StoreCart, now: Date): Promise<boolean> {
		const tag = `[store-reconcile] cart #${cart.id} (${cart.stripe_session_id}, ${shop.name})`;
		let settled = false;
		let fulfilled = false;
		try {
			// No request here, so the buyer's own language comes off
			// the cart snapshot. Their confirmation email keeps it.
			const r = await I18n.withLocale(cart.payload.locale ?? "en", () =>
				this.store.fulfill(shop, cart.stripe_session_id!),
			);
			// true = nothing more to learn from the gateway
			settled = !!r.order || !!r.failed || !!r.error;
			if (r.order) {
				fulfilled = true;
				console.log(`${tag}: paid → order #${r.order.id} created`);
			} else if (r.failed)
				console.log(
					`${tag}: failed (${r.reason ?? "no reason given"}) — left for purge`,
				);
			else if (r.error) console.warn(`${tag}: ${r.error} — left for purge`);
		} catch (e) {
			console.error(`${tag}: gateway call failed, will retry —`, e);
		}
		// Failed for good: the provider is not asked again.
		// The next look is past the window the sweep reads.
		if (settled && !fulfilled)
			await this.carts.defer(
				cart.id,
				cart.checks + 1,
				new Date(now.getTime() + STORE_RECONCILE_WINDOW_MS),
			);
		if (!settled) {
			const next = new Date(now.getTime() + this.#wait(cart));
			await this.carts.defer(cart.id, cart.checks + 1, next);
			console.log(
				`${tag}: still pending (check ${cart.checks + 1}), next look at ${next.toISOString()}`,
			);
		}
		return fulfilled;
	}

	/**
	 * Exponential back-off.
	 * 2 min after the first look, 4 after the second…
	 * Never more than the cap.
	 * @param cart The cart, with how many times it has been checked so far.
	 * @returns Milliseconds until the next look.
	 */
	#wait(cart: StoreCart) {
		return Math.min(
			2 ** (cart.checks + 1) * 60_000,
			STORE_RECONCILE_MAX_WAIT_MS,
		);
	}
}
