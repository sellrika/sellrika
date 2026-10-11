import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { sqlStamp } from "@helpers/time";
import type { ApiKey, ApiKeyRow } from "@models/ApiKey";
import type { Role } from "@constants/User.Constant";

/** Every column but the hash: the hash never leaves this file. */
const COLS = sql`k.id, k.shop_id, k.user_id, k.name, k.role, k.last4, k.last_used_at, k.created_at`;

/** API keys (`api_keys`): one shop each, stored as a hash. */
@Service()
export class ApiKeyRepository {
	/**
	 * Every key of a shop, newest first, with who made it.
	 * @param shopId Owning shop.
	 * @returns The keys, without their hash.
	 */
	async all(shopId: number): Promise<ApiKeyRow[]> {
		return await sql`select ${COLS}, u.name as created_by from api_keys k
      left join users u on u.id = k.user_id where k.shop_id = ${shopId} order by k.id desc`;
	}

	/**
	 * How many keys a shop has.
	 * @param shopId Owning shop.
	 * @returns The count.
	 */
	async count(shopId: number) {
		const [r] =
			await sql`select count(*) as n from api_keys where shop_id = ${shopId}`;
		return Number(r.n);
	}

	/**
	 * Save a new key.
	 * @param d The shop, who made it, its name, role, hash and last 4 characters.
	 * @returns The saved key, without its hash.
	 */
	async create(d: {
		shopId: number;
		userId: number;
		name: string;
		role: Role;
		hash: string;
		last4: string;
	}): Promise<ApiKey> {
		const [r] = await Db.insert(
			sql,
			"api_keys",
			sql`insert into api_keys (shop_id, user_id, name, role, key_hash, last4)
      values (${d.shopId}, ${d.userId}, ${d.name}, ${d.role}, ${d.hash}, ${d.last4})`,
			sql`id, shop_id, user_id, name, role, last4, last_used_at, created_at`,
		);
		return r;
	}

	/**
	 * The key with this hash.
	 * @param hash SHA-256 of the key a caller sent.
	 * @returns The key, or null.
	 */
	async findByHash(hash: string): Promise<ApiKey | null> {
		const [r] =
			await sql`select ${COLS} from api_keys k where k.key_hash = ${hash}`;
		return r ?? null;
	}

	/**
	 * Note that a key was just used.
	 * @param id Key id.
	 * @param now The moment.
	 */
	async touch(id: number, now = new Date()) {
		await sql`update api_keys set last_used_at = ${sqlStamp(now)} where id = ${id}`;
	}

	/**
	 * Delete one key of a shop. It stops working at once.
	 * @param id Key id.
	 * @param shopId The shop it must belong to.
	 */
	async delete(id: number, shopId: number) {
		await sql`delete from api_keys where id = ${id} and shop_id = ${shopId}`;
	}

	/**
	 * Delete every key a user made.
	 * @param userId The user.
	 */
	async deleteAllFor(userId: number) {
		await sql`delete from api_keys where user_id = ${userId}`;
	}
}
