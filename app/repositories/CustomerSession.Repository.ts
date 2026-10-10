import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { randomToken } from "@helpers/crypto";
import { sqlStamp } from "@helpers/time";
import { DAY_MS } from "@constants/Time.Constant";

/**
 * One signed-in browser of a store customer (migration 0046).
 * Keyed by the `csid` cookie value.
 */
export type CustomerSession = {
	id: string;
	customer_id: number;
	shop_id: number;
	expires_at: string;
};

/**
 * Customer sign-ins on the online store.
 * The customer twin of `SessionRepository` (staff).
 */
@Service()
export class CustomerSessionRepository {
	/**
	 * Open a session for a customer.
	 * @param customerId Who signed in.
	 * @param shopId The shop whose store they signed in to.
	 *   A session only counts on that store.
	 * @param ttlDays How many days before it expires.
	 * @returns The created session row.
	 */
	async create(
		customerId: number,
		shopId: number,
		ttlDays: number,
	): Promise<CustomerSession> {
		const id = randomToken(32);
		const expires = sqlStamp(new Date(Date.now() + ttlDays * DAY_MS));
		return (
			await sql`insert into customer_sessions (id, customer_id, shop_id, expires_at) values (${id}, ${customerId}, ${shopId}, ${expires}) returning *`
		)[0];
	}

	/**
	 * Look a session up by its cookie value.
	 * @param id Session id (the cookie value).
	 * @returns The session, or null when it doesn't exist or has expired.
	 */
	async findValid(id: string): Promise<CustomerSession | null> {
		return Db.one(
			sql`select * from customer_sessions where id = ${id} and expires_at > current_timestamp`,
		);
	}

	/**
	 * Sign one browser out.
	 * @param id Session id.
	 */
	delete(id: string) {
		return sql`delete from customer_sessions where id = ${id}`;
	}

	/**
	 * Drop sessions that have already expired.
	 * They can't authenticate, they only sit there.
	 * @returns The delete query.
	 */
	purgeExpired() {
		return sql`delete from customer_sessions where expires_at <= current_timestamp`;
	}
}
