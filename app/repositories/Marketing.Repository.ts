import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { sqlStamp } from "@helpers/time";

/** A shop's abandoned-cart settings (`shops.abandoned_cart*`). */
export type AbandonedSettings = { enabled: boolean; hours: number };

/**
 * The shop-level marketing data: the abandoned-cart settings
 * and who unsubscribed from a shop's emails.
 */
@Service()
export class MarketingRepository {
	/**
	 * The abandoned-cart settings of one shop.
	 * @param shopId The shop.
	 * @returns On / off and the delay in hours.
	 */
	async settings(shopId: number): Promise<AbandonedSettings> {
		const r = (
			await sql`select abandoned_cart, abandoned_cart_hours from shops where id = ${shopId}`
		)[0];
		return {
			enabled: !!r?.abandoned_cart,
			hours: Number(r?.abandoned_cart_hours ?? 4),
		};
	}

	/**
	 * Save the abandoned-cart settings of one shop.
	 * @param shopId The shop.
	 * @param s On / off and the delay in hours.
	 */
	save(shopId: number, s: AbandonedSettings) {
		return sql`update shops set abandoned_cart = ${s.enabled}, abandoned_cart_hours = ${s.hours} where id = ${shopId}`;
	}

	/**
	 * Every shop with the abandoned-cart email switched on.
	 * @returns Each shop id with its delay in hours.
	 */
	async enabledShops(): Promise<{ id: number; hours: number }[]> {
		const rows: { id: unknown; abandoned_cart_hours: unknown }[] =
			await sql`select id, abandoned_cart_hours from shops where abandoned_cart = ${true}`;
		return rows.map((r) => this.#enabledShop(r));
	}

	/**
	 * Stop a shop's marketing emails to one address. Doing it twice is fine.
	 * @param shopId The shop.
	 * @param email The address.
	 */
	unsubscribe(shopId: number, email: string) {
		return sql`insert into email_unsubscribes (shop_id, email) values (${shopId}, ${email.trim().toLowerCase()}) on conflict (shop_id, email) do nothing`;
	}

	/**
	 * Did this address unsubscribe from the shop's emails?
	 * @param shopId The shop.
	 * @param email The address.
	 * @returns True when it did.
	 */
	async isUnsubscribed(shopId: number, email: string) {
		return Db.exists(
			sql`select 1 from email_unsubscribes where shop_id = ${shopId} and email = ${email.trim().toLowerCase()}`,
		);
	}

	/**
	 * Did this address place an order in the shop since a moment?
	 * The order is matched through its customer's email. Voided orders don't count.
	 * @param shopId The shop.
	 * @param email The buyer's address.
	 * @param since The moment, for example when the cart was made.
	 * @returns True when it did.
	 */
	async orderedSince(shopId: number, email: string, since: Date) {
		return Db.exists(
			sql`select 1 from orders o join customers c on c.id = o.customer_id where o.shop_id = ${shopId} and c.email = ${email.trim().toLowerCase()} and o.status <> 'voided' and o.created_at >= ${sqlStamp(since)} limit 1`,
		);
	}
	/**
	 * One shop with the abandoned-cart email on.
	 * @param r The raw row.
	 * @returns Its id and delay as numbers.
	 */
	#enabledShop(r: { id: unknown; abandoned_cart_hours: unknown }) {
		return { id: Number(r.id), hours: Number(r.abandoned_cart_hours) };
	}
}
