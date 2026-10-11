import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import type { Session } from "@models/User";
import { randomToken } from "@helpers/crypto";
import { sqlStamp } from "@helpers/time";
import { DAY_MS } from "@constants/Time.Constant";

/**
 * Login sessions.
 * One row per signed-in browser, keyed by the random cookie value.
 */
@Service()
export class SessionRepository {
	/**
	 * Open a new session for a user.
	 * @param userId Who is signing in.
	 * @param shopId Shop the session starts on (null = fall back to the first shop).
	 * @param ttlDays How many days before the session expires.
	 * @returns The created session row.
	 */
	async create(
		userId: number,
		shopId: number | null,
		ttlDays: number,
	): Promise<Session> {
		const id = randomToken(32);
		const expires = sqlStamp(new Date(Date.now() + ttlDays * DAY_MS));
		await sql`insert into sessions (id, user_id, shop_id, expires_at) values (${id}, ${userId}, ${shopId}, ${expires})`;
		return (await sql`select * from sessions where id = ${id}`)[0];
	}

	/**
	 * Look a session up by its cookie value.
	 * @param id Session id (the cookie value).
	 * @returns The session, or null when it doesn't exist or has expired.
	 */
	async findValid(id: string): Promise<Session | null> {
		return Db.one(
			sql`select * from sessions where id = ${id} and expires_at > current_timestamp`,
		);
	}

	/**
	 * Switch the active shop of one session.
	 * @param id Session id.
	 * @param shopId The shop to make active.
	 */
	setShop(id: string, shopId: number) {
		return sql`update sessions set shop_id = ${shopId} where id = ${id}`;
	}

	/**
	 * Sign one browser out.
	 * @param id Session id.
	 */
	delete(id: string) {
		return sql`delete from sessions where id = ${id}`;
	}

	/**
	 * Log the user out everywhere except the given session.
	 * Used after a password change.
	 * @param userId Whose sessions to drop.
	 * @param keepId The session that stays signed in.
	 */
	deleteOthers(userId: number, keepId: string) {
		return sql`delete from sessions where user_id = ${userId} and id <> ${keepId}`;
	}

	/**
	 * Sign a user out everywhere (deactivated, password reset by an admin, deleted).
	 * @param userId Whose sessions to drop.
	 */
	deleteAllFor(userId: number) {
		return sql`delete from sessions where user_id = ${userId}`;
	}

	/**
	 * Drop sessions that have already expired.
	 * They can't authenticate, they only sit there.
	 * @returns The delete query.
	 */
	purgeExpired() {
		return sql`delete from sessions where expires_at <= current_timestamp`;
	}
}
