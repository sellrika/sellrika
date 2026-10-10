import { I18n } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { Shop } from "@models/Shop";
import {
	MarketingRepository,
	type AbandonedSettings,
} from "@repositories/Marketing.Repository";
import {
	StoreCartRepository,
	type StoreCart,
} from "@repositories/StoreCart.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { MailService } from "@services/settings/Mail.Service";
import { AbandonedCartEmail } from "@emails/AbandonedCart.Email";
import { storeUrl, unsubscribeUrl } from "@emails/marketing";
import { dbDate } from "@helpers/time";
import { randomId, readUnsubscribeToken } from "@helpers/crypto";
import {
	ABANDONED_CART_DELAYS,
	ABANDONED_CART_LATE_MS,
	MARKETING_SHOP_BUDGET_MS,
} from "@constants/Marketing.Constant";
import { CampaignService } from "./Campaign.Service";

/**
 * One cart line as the storefront's cart needs it back.
 */
export type RestoredLine = {
	product_id: number;
	variant_id: number | null;
	name: string;
	image: string | null;
	price: number;
	qty: number;
	/**
	 * The buyer's custom request ("" = none).
	 */
	note: string;
};

/**
 * Marketing: the abandoned-cart email, the unsubscribe list,
 * and the one sweep (`run`) that sends what is due.
 * Campaigns themselves live in CampaignService.
 */
@Service()
export class MarketingService {
	constructor(
		private marketing: MarketingRepository,
		private carts: StoreCartRepository,
		private shops: ShopRepository,
		private mail: MailService,
		private campaigns: CampaignService,
		private limits: PlanLimitService,
	) {}

	/**
	 * The abandoned-cart settings of a shop.
	 * @param shopId The shop.
	 * @returns On / off and the delay in hours.
	 */
	settings(shopId: number) {
		return this.marketing.settings(shopId);
	}

	/**
	 * Save the abandoned-cart settings of a shop.
	 * @param shopId The shop.
	 * @param s On / off and the delay in hours.
	 */
	async saveSettings(shopId: number, s: AbandonedSettings) {
		await this.marketing.save(shopId, s);
	}

	/**
	 * The email an unsubscribe link was made for.
	 * @param shopId The shop of the page it was opened on.
	 * @param token The link's token.
	 * @returns The address, or null when the link is broken or forged.
	 */
	unsubscribeEmail(shopId: number, token: string) {
		try {
			return readUnsubscribeToken(shopId, token);
		} catch {
			return null; // no APP_KEY: no link can be checked
		}
	}

	/**
	 * Stop the shop's marketing emails to the address a link was made for.
	 * @param shopId The shop.
	 * @param token The link's token.
	 * @returns The address, or null when the link is broken or forged.
	 */
	async unsubscribe(shopId: number, token: string) {
		const email = this.unsubscribeEmail(shopId, token);
		if (email) await this.marketing.unsubscribe(shopId, email);
		return email;
	}

	/**
	 * The lines of the cart behind a "Complete your order" link.
	 * Only ids, names, pictures and quantities: the checkout re-prices anyway.
	 * @param shopId The shop of the store it was opened on.
	 * @param token The link's key.
	 * @returns The lines, or null when the link is unknown or expired.
	 */
	async restore(shopId: number, token: string): Promise<RestoredLine[] | null> {
		const cart = token ? await this.carts.byToken(shopId, token) : null;
		if (!cart) return null;
		return cart.payload.items.map(function line(i) {
			return {
				product_id: i.product_id,
				variant_id: i.variant_id,
				name: i.name,
				image: i.image ?? null,
				price: i.price,
				qty: i.qty,
				note: i.note ?? "",
			};
		});
	}

	/**
	 * The marketing sweep, run by cron: abandoned carts first, then campaigns.
	 * A shop whose email is off is skipped.
	 * @param now The current time.
	 * @returns How many emails of each kind went out.
	 */
	async run(now = new Date()) {
		const abandoned = await this.abandoned(now);
		const campaigns = await this.campaigns.sweep(now);
		return { abandoned, campaigns };
	}

	/**
	 * Send the abandoned-cart emails that are due, one per cart.
	 * A cart is due when it has no order, has a buyer email, is older than
	 * the shop's delay (but not a day past it), and was not reminded yet.
	 * Skipped: a newer checkout by the same buyer (that one gets it),
	 * a buyer who ordered since, and a buyer who unsubscribed.
	 * @param now The current time.
	 * @returns How many emails went out.
	 */
	async abandoned(now = new Date()) {
		let sent = 0;
		// most shops have no such cart: ask once, then skip them
		const widest = Math.max(...ABANDONED_CART_DELAYS) * 3_600_000;
		const waiting = new Set(
			await this.carts.shopsToRemind(
				new Date(now.getTime() - widest - ABANDONED_CART_LATE_MS),
			),
		);
		if (!waiting.size) return sent;
		for (const { id, hours } of await this.marketing.enabledShops()) {
			if (!waiting.has(id)) continue;
			// its email is off: the carts wait
			if (!(await this.mail.ready(id))) continue;
			const shop = await this.shops.find(id);
			if (!shop?.online_enabled || !shop.slug) continue;
			const due = now.getTime() - hours * 3_600_000;
			const carts = await this.carts.since(
				id,
				new Date(due - ABANDONED_CART_LATE_MS),
			);
			// reminders count in the account's monthly email limit,
			// and one shop gets only so much time per run
			let room = await this.limits.campaignEmailsLeft(shop, now);
			const until = Date.now() + MARKETING_SHOP_BUDGET_MS;
			for (const cart of carts) {
				if (room <= 0 || Date.now() > until) break;
				if (!(await this.#remind(shop, cart, carts, due, now))) continue;
				sent++;
				room--;
				// through the platform's email: it counts in the monthly limit
				if (room !== Infinity)
					await this.limits.countReminder(shop.owner_id, now);
			}
		}
		return sent;
	}

	/**
	 * Look at one cart and send its email when it is due.
	 * @param shop The shop.
	 * @param cart The cart.
	 * @param carts Every recent cart of the shop (to find a newer one).
	 * @param due Carts made before this time (ms) are due.
	 * @param now The current time.
	 * @returns True when the email went out.
	 */
	async #remind(
		shop: Shop,
		cart: StoreCart,
		carts: StoreCart[],
		due: number,
		now: Date,
	) {
		const email = this.#buyerEmail(cart);
		const made = dbDate(cart.created_at);
		if (cart.order_id !== null || cart.reminded_at || !email) return false;
		if (made.getTime() > due) return false;
		if (carts.some((c) => this.#newer(c, cart, email))) return false;
		if (await this.marketing.isUnsubscribed(shop.id, email)) return false;
		if (await this.marketing.orderedSince(shop.id, email, made)) return false;
		const token = randomId();
		if (!(await this.carts.remind(cart.id, token, now))) return false;
		const links = {
			restore: `${storeUrl(shop)}/cart/${token}`,
			unsubscribe: unsubscribeUrl(shop, email),
		};
		const locale = cart.payload.locale ?? CampaignService.shopLocale(shop);
		const error = await I18n.withLocale(locale, () =>
			this.mail.send(new AbandonedCartEmail(email, shop, cart, links)),
		);
		const tag = `[abandoned-cart] cart #${cart.id} (${shop.name})`;
		if (error) console.warn(`${tag}: ${error}`);
		else console.log(`${tag}: reminder sent`);
		return !error;
	}

	/**
	 * Is a cart a later checkout by the same buyer?
	 * @param c Another cart.
	 * @param cart The cart being looked at.
	 * @param email The buyer's email on that cart.
	 * @returns True when it is.
	 */
	#newer(c: StoreCart, cart: StoreCart, email: string) {
		return c.id > cart.id && this.#buyerEmail(c) === email;
	}

	/**
	 * The buyer's email on a cart, lower case.
	 * @param cart The cart snapshot.
	 * @returns The address, or "" when the buyer gave none.
	 */
	#buyerEmail(cart: StoreCart) {
		return cart.payload.customer?.email?.trim().toLowerCase() ?? "";
	}
}
