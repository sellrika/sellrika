import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { randomToken, sha256Hex } from "@helpers/crypto";
import { sqlStamp } from "@helpers/time";
import { DAY_MS } from "@constants/Time.Constant";

/**
 * The one-time links of a user (`user_invites`, migration 0053):
 * the invitation to a new shop owner, the sign-up confirmation,
 * and "forgot password".
 * A user has one link at a time.
 */
@Service()
export class InviteRepository {
	/**
	 * Open an invitation for a user.
	 * Any older invitation of theirs stops working.
	 * @param userId The invited user.
	 * @param ttlDays How many days the link works.
	 * @returns The token to put in the link (only its hash is stored).
	 */
	async create(userId: number, ttlDays: number): Promise<string> {
		const token = randomToken(32);
		const expires = sqlStamp(new Date(Date.now() + ttlDays * DAY_MS));
		await this.deleteFor(userId);
		await sql`insert into user_invites (user_id, token_hash, expires_at) values (${userId}, ${sha256Hex(token)}, ${expires})`;
		return token;
	}

	/**
	 * Who a still-valid invitation is for.
	 * @param token The token from the link.
	 * @returns The user id, or null when the link is unknown or expired.
	 */
	async userOf(token: string): Promise<number | null> {
		const r = (
			await sql`select user_id from user_invites where token_hash = ${sha256Hex(token)} and expires_at > current_timestamp`
		)[0];
		return r ? Number(r.user_id) : null;
	}

	/**
	 * Did this user get a link a short while ago?
	 * @param userId The user.
	 * @param minutes How far to look back.
	 * @returns True when a link was made in that time.
	 */
	async madeSince(userId: number, minutes: number): Promise<boolean> {
		const from = sqlStamp(new Date(Date.now() - minutes * 60_000));
		return Db.exists(
			sql`select 1 from user_invites where user_id = ${userId} and created_at > ${from} limit 1`,
		);
	}

	/**
	 * Drop every invitation of a user.
	 * It was accepted, or a new one replaces it.
	 * @param userId The user.
	 * @returns The delete query.
	 */
	deleteFor(userId: number) {
		return sql`delete from user_invites where user_id = ${userId}`;
	}
}
