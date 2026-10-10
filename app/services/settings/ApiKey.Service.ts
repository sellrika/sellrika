import { Account } from "@xcore/auth/Account";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { apiKeyHash, randomToken } from "@helpers/crypto";
import { ApiKeyRepository } from "@repositories/ApiKey.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { UserRepository } from "@repositories/User.Repository";
import type { ApiKey } from "@models/ApiKey";
import type { Shop } from "@models/Shop";
import type { User } from "@models/User";
import type { ApiKeyInput } from "@validators/ApiKey.Validator";
import {
	API_KEY_BYTES,
	API_KEY_MAX,
	API_KEY_PREFIX,
	API_KEY_SEEN_EVERY_MS,
} from "@constants/Api.Constant";
import type { Errors } from "@validators/validate";

/**
 * Who a key speaks for.
 * The key, the user it acts as (with the key's role) and its shop.
 */
export type ApiCaller = { key: ApiKey; user: User; shop: Shop };

/**
 * API keys: a program calls `/api/v1` with one.
 * A key works in one shop and acts as the admin who made it.
 * It has at most the key's role.
 */
@Service()
export class ApiKeyService {
	/** When each key's `last_used_at` was last written, by key id. */
	private seen = new Map<number, number>();

	constructor(
		private keys: ApiKeyRepository,
		private users: UserRepository,
		private shops: ShopRepository,
	) {}

	/**
	 * Every key of a shop, for the API keys page.
	 * @param shopId Owning shop.
	 * @returns The keys, newest first. The key itself is not in them.
	 */
	list(shopId: number) {
		return this.keys.all(shopId);
	}

	/**
	 * Make a key for a shop.
	 * The key is returned here once. Only its hash is saved.
	 * @param shopId The shop the key works in.
	 * @param actor The admin making it. The key acts as them.
	 * @param d Validated name and role.
	 * @returns `{key, token}` (`token` = the key to show once), or `{errors}`.
	 */
	async create(
		shopId: number,
		actor: User,
		d: ApiKeyInput,
	): Promise<
		{ key: ApiKey; token: string; errors?: never } | { errors: Errors }
	> {
		if (await this.full(shopId))
			return { errors: { name: t("api_keys.too_many", { max: API_KEY_MAX }) } };
		const token = API_KEY_PREFIX + randomToken(API_KEY_BYTES);
		const key = await this.keys.create({
			shopId,
			userId: actor.id,
			name: d.name,
			role: d.role,
			hash: apiKeyHash(token),
			last4: token.slice(-4),
		});
		return { key, token };
	}

	/**
	 * Does the shop already have as many keys as it may?
	 * @param shopId The shop.
	 * @returns True when no more key can be made.
	 */
	async full(shopId: number) {
		return (await this.keys.count(shopId)) >= API_KEY_MAX;
	}

	/**
	 * Delete a key of a shop. It stops working at once.
	 * @param id Key id.
	 * @param shopId The shop it must belong to.
	 */
	async remove(id: number, shopId: number) {
		await this.keys.delete(id, shopId);
		this.seen.delete(id);
	}

	/**
	 * Who is calling with this key?
	 * The key must exist, its maker must still be an active, confirmed user,
	 * and the shop must still belong to their account.
	 * The role is the lower of the key's role and the maker's role today.
	 * @param token The key from the `Authorization` header.
	 * @param now The current time, in milliseconds.
	 * @returns The caller, or null when the key is not good.
	 */
	async authenticate(
		token: string,
		now = Date.now(),
	): Promise<ApiCaller | null> {
		if (!token.startsWith(API_KEY_PREFIX)) return null;
		const key = await this.keys.findByHash(apiKeyHash(token));
		if (!key) return null;
		const user = await this.users.find(key.user_id);
		if (!user?.active || !user.email_verified_at) return null;
		const shop = await this.shops.findOwned(key.shop_id, Account.id(user));
		if (!shop) return null;
		if (now - (this.seen.get(key.id) ?? 0) >= API_KEY_SEEN_EVERY_MS) {
			this.seen.set(key.id, now);
			await this.keys.touch(key.id, new Date(now));
		}
		const role = Account.atLeast(user.role, key.role) ? key.role : user.role;
		return { key, user: { ...user, role }, shop };
	}
}
