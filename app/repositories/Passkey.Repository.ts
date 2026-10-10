import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import type { Passkey } from "@models/Passkey";

/** Passkeys of staff users: one row per device or password manager. */
@Service()
export class PasskeyRepository {
	/**
	 * Every passkey of a user, oldest first.
	 * @param userId Whose passkeys.
	 * @returns The rows.
	 */
	async forUser(userId: number): Promise<Passkey[]> {
		return sql`select * from passkeys where user_id = ${userId} order by id`;
	}

	/**
	 * Find a passkey by the id its device gave it.
	 * @param credentialId The credential id, base64url.
	 * @returns The passkey, or null.
	 */
	async findByCredential(credentialId: string): Promise<Passkey | null> {
		return Db.one(
			sql`select * from passkeys where credential_id = ${credentialId}`,
		);
	}

	/**
	 * Save a new passkey.
	 * @param userId Who it belongs to.
	 * @param data Its id, public key, name and use counter.
	 */
	create(
		userId: number,
		data: Pick<Passkey, "credential_id" | "public_key" | "name" | "sign_count">,
	) {
		return sql`insert into passkeys (user_id, credential_id, public_key, name, sign_count)
			values (${userId}, ${data.credential_id}, ${data.public_key}, ${data.name}, ${data.sign_count})`;
	}

	/**
	 * Note a sign-in: the new use counter and the time.
	 * @param id The passkey.
	 * @param signCount The counter the device sent.
	 */
	used(id: number, signCount: number) {
		return sql`update passkeys set sign_count = ${signCount}, last_used_at = current_timestamp where id = ${id}`;
	}

	/**
	 * Delete one passkey of a user.
	 * @param id The passkey.
	 * @param userId Its owner; another user's passkey is left alone.
	 */
	delete(id: number, userId: number) {
		return sql`delete from passkeys where id = ${id} and user_id = ${userId}`;
	}

	/**
	 * Delete every passkey of a user (the user is deleted).
	 * @param userId Whose passkeys.
	 */
	deleteAllFor(userId: number) {
		return sql`delete from passkeys where user_id = ${userId}`;
	}
}
