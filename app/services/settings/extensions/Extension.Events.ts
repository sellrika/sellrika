import { Outbound } from "@xcore/http/Outbound";
import { I18n } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { ShopRepository } from "@repositories/Shop.Repository";
import { StockRepository } from "@repositories/Stock.Repository";
import type { Shop } from "@models/Shop";
import { messageOf } from "@helpers/error";
import type { ExtensionEvent } from "@constants/Extension.Constant";
import { translatorOf } from "./Extension.Manifest";
import { ExtensionMail } from "./Extension.Mail";
import { ExtensionRuntime } from "./Extension.Runtime";
import type {
	ExtensionContext,
	ExtensionEvents as EventData,
	ExtensionListener,
} from "./types/Extension.Events.Types";

/**
 * The events extensions listen for.
 * Each running extension of a shop is handed the events it asked for.
 * An emit is fired with `void` right after a write.
 * It is never awaited and it never throws.
 */
@Service()
export class ExtensionEvents {
	/**
	 * Every emit in flight, since callers never await them.
	 * `idle()` lets a test wait for all of them.
	 */
	private pending = new Set<Promise<void>>();

	constructor(
		private runtime: ExtensionRuntime,
		private shops: ShopRepository,
		private stock: StockRepository,
		private mail: ExtensionMail,
	) {}

	/**
	 * The shop's listeners that run right now for an event.
	 * Installed, enabled, fully configured, module loaded.
	 * @param shopId The shop.
	 * @param event The event.
	 * @returns Each listener with its extension key and decrypted settings.
	 */
	async running<E extends ExtensionEvent>(
		shopId: number,
		event: E,
	): Promise<ExtensionListener<E>[]> {
		const listeners: ExtensionListener<E>[] = [];
		for (const { ext, config } of await this.runtime.allActive(shopId)) {
			const fn = (await this.runtime.moduleOf(ext))?.on[event];
			if (typeof fn === "function")
				listeners.push({
					key: ext.key,
					config,
					t: translatorOf(ext),
					fn: fn as ExtensionListener<E>["fn"],
				});
		}
		return listeners;
	}

	/**
	 * Hand an event to every running extension of the shop.
	 * Best effort: it never throws, and callers never await it.
	 * A slow receiver must not hold up a checkout.
	 * @param event The event.
	 * @param shop The shop it happened in (the row, or its id).
	 * @param data The event's data.
	 * @returns A promise that settles once every listener has run.
	 */
	emit<E extends ExtensionEvent>(
		event: E,
		shop: Shop | number,
		data: EventData[E],
	): Promise<void> {
		return this.#track(this.#deliver(event, shop, data));
	}

	/**
	 * An account-wide event (staff): every shop of that account hears it.
	 * @param ownerId The account's owner.
	 * @param event The event.
	 * @param data The event's data.
	 * @returns A promise that settles once every shop was told.
	 */
	emitAll<E extends ExtensionEvent>(
		ownerId: number,
		event: E,
		data: EventData[E],
	): Promise<void> {
		return this.#track(this.#deliverAll(ownerId, event, data));
	}

	/**
	 * Resolves once every emit started so far has finished.
	 * For tests: they can't await the `void` calls in the services.
	 */
	async idle(): Promise<void> {
		while (this.pending.size) await Promise.allSettled([...this.pending]);
	}

	/**
	 * Where the shop's stock ledger ends right now.
	 * Take it before a write that moves stock.
	 * @param shopId The shop.
	 * @returns The mark for `stockMoved()`.
	 */
	stockMark(shopId: number) {
		return this.stock.lastId(shopId);
	}

	/**
	 * `stock.updated` for every ledger row a write added after the mark.
	 * One event per row, each with its unit as it stands now.
	 * @param shopId The shop.
	 * @param mark From `stockMark()`, taken before the write.
	 * @param of The order, or the unit, the write was about.
	 * It keeps a concurrent sale's rows out.
	 * @returns A promise that settles once every event was handed out.
	 */
	stockMoved(
		shopId: number,
		mark: number,
		of: { orderId?: number; productId?: number; variantId?: number | null },
	): Promise<void> {
		return this.#track(this.#deliverStock(shopId, mark, of));
	}

	/**
	 * The work behind `emitAll()`: one emit per shop of the account.
	 * Never throws: a failure is logged.
	 * @param ownerId The account's owner.
	 * @param event The event.
	 * @param data The event's data.
	 */
	async #deliverAll<E extends ExtensionEvent>(
		ownerId: number,
		event: E,
		data: EventData[E],
	): Promise<void> {
		try {
			for (const shop of await this.shops.all(ownerId))
				await this.emit(event, shop, data);
		} catch (error) {
			console.warn(`[extensions] ${event}:`, error);
		}
	}

	/**
	 * The work behind `emit()`.
	 * Find the shop, find its listeners, call them all.
	 * One listener's failure is its own: it never stops the others,
	 * and never reaches the caller.
	 * @param event The event.
	 * @param target The shop it happened in (the row, or its id).
	 * @param data The event's data.
	 */
	async #deliver<E extends ExtensionEvent>(
		event: E,
		target: Shop | number,
		data: EventData[E],
	): Promise<void> {
		let shop: Shop;
		let listeners: ExtensionListener<E>[];
		try {
			const found =
				typeof target === "number" ? await this.shops.find(target) : target;
			if (!found) return;
			shop = found;
			listeners = await this.running(shop.id, event);
		} catch (error) {
			const id = typeof target === "number" ? target : target.id;
			return console.warn(`[extensions] ${event} for shop #${id}:`, error);
		}
		// a listener gets every API route as a function,
		// run as the shop's owner
		const functions = this.runtime.functionsFor(shop);
		const runtime = this.runtime;
		const mail = this.mail.for(shop);
		await Promise.all(
			listeners.map(async function call({ key, config, t: translate, fn }) {
				try {
					await fn({
						shop,
						config,
						t: translate,
						locale: I18n.current(),
						data: runtime.dataOf(shop.id, key),
						outbound: Outbound.send,
						mail,
						...functions,
						...data,
					} as ExtensionContext<E>);
				} catch (error) {
					console.warn(
						`[extensions] ${key} ${event} for shop #${shop.id}:`,
						messageOf(error),
					);
				}
			}),
		);
	}

	/**
	 * Remember an emit until it settles.
	 * @param promise The emit.
	 * @returns The same promise.
	 */
	#track(promise: Promise<void>): Promise<void> {
		this.pending.add(promise);
		promise.finally(() => this.pending.delete(promise));
		return promise;
	}

	/**
	 * The work behind `stockMoved()`.
	 * Never throws: a failure is logged.
	 * @param shopId The shop.
	 * @param mark From `stockMark()`, taken before the write.
	 * @param of The order, or the unit, the write was about.
	 */
	async #deliverStock(
		shopId: number,
		mark: number,
		of: { orderId?: number; productId?: number; variantId?: number | null },
	): Promise<void> {
		try {
			for (const movement of await this.stock.since(shopId, mark, of)) {
				const unit = await this.stock.unit(
					shopId,
					movement.product_id,
					movement.variant_id,
				);
				if (unit) await this.emit("stock.updated", shopId, { movement, unit });
			}
		} catch (error) {
			console.warn(`[extensions] stock.updated for shop #${shopId}:`, error);
		}
	}
}
