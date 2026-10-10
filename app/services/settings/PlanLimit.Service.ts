import { SettingRepository } from "@repositories/Setting.Repository";
import {
	CAMPAIGN_EMAILS_PER_MONTH,
	REMINDER_COUNT_KEY,
} from "@constants/Marketing.Constant";
import { Account } from "@xcore/auth/Account";
import { Service } from "@xcore/di";
import type { Shop } from "@models/Shop";
import { ShopRepository } from "@repositories/Shop.Repository";
import { UserRepository } from "@repositories/User.Repository";
import { CampaignRepository } from "@repositories/Campaign.Repository";
import { OwnerRepository } from "@repositories/Owner.Repository";
import { MailService } from "@services/settings/Mail.Service";

/**
 * How much one account may hold.
 * The source-available app has no plans:
 * shops, products, staff, codes and orders are never limited here.
 * An add-on may put its own class in this one's place in the DI container
 * and answer the "may they?" questions with its own rules (`app/cloud.ts`).
 * One limit is the app's own, to protect the platform's email:
 * the campaign emails an account sends a month through it.
 * Nothing is ever deleted or locked: only a new one is refused.
 */
@Service()
export class PlanLimitService {
	constructor(
		protected shops: ShopRepository,
		protected users: UserRepository,
		protected campaigns: CampaignRepository,
		protected owners: OwnerRepository,
		protected mail: MailService,
		protected settings: SettingRepository,
	) {}

	/**
	 * Is this account on a free plan?
	 * @param _ownerId The account's owner.
	 * @returns Always false here: there are no plans.
	 */
	async isFree(_ownerId: number): Promise<boolean> {
		return false;
	}

	/**
	 * May an account add one more staff user, sales person or discount code?
	 * The caller counts what the account has.
	 * @param _ownerId The account's owner.
	 * @param _what Which thing is counted.
	 * @param _have How many there are now.
	 * @returns Why not, or null when it may. Always null here.
	 */
	async freeError(
		_ownerId: number,
		_what: "staff" | "salesStaff" | "coupons",
		_have: number,
	): Promise<string | null> {
		return null;
	}

	/**
	 * May this shop's staff make one more order?
	 * The online store never asks: a buyer may have paid already.
	 * @param _shopId The shop.
	 * @param _now The current time.
	 * @returns Why not, or null when it may. Always null here.
	 */
	async orderError(_shopId: number, _now = new Date()): Promise<string | null> {
		return null;
	}

	/**
	 * May this shop send campaigns?
	 * @param _shop The shop.
	 * @returns Why not, or null when it may. Always null here.
	 */
	async campaignError(_shop: Shop): Promise<string | null> {
		return null;
	}

	/**
	 * May this account add one more shop?
	 * @param _ownerId The account's owner.
	 * @returns Why not, or null when it may. Always null here.
	 */
	async shopError(_ownerId: number): Promise<string | null> {
		return null;
	}

	/**
	 * How many more products a shop may get.
	 * @param _shopId The shop.
	 * @returns The room left. `Infinity` = no limit, always here.
	 */
	async productsLeft(_shopId: number): Promise<number> {
		return Infinity;
	}

	/**
	 * The message for a shop that is full.
	 * Never asked here: `productsLeft` has no end.
	 * @param _shopId The shop.
	 * @returns The text.
	 */
	async productError(_shopId: number): Promise<string> {
		return "";
	}

	/**
	 * The campaign emails an account sent this month
	 * through the platform's email.
	 * The month is the UTC calendar month.
	 * @param ownerId The account's owner.
	 * @param now The current time.
	 * @returns How many were sent, and the account's monthly limit.
	 */
	async campaignEmails(ownerId: number, now = new Date()) {
		const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()));
		const [campaigns, reminders, own] = await Promise.all([
			this.campaigns.platformSentSince(ownerId, month),
			this.#reminders(ownerId, month),
			this.owners.campaignLimit(ownerId),
		]);
		return {
			used: campaigns + reminders,
			limit: own ?? CAMPAIGN_EMAILS_PER_MONTH,
		};
	}

	/**
	 * Count one abandoned-cart email of an account.
	 * It is added to the month's count, which the limit reads.
	 * The count is kept in `settings`, so it outlives the cart.
	 * The sweep is one job at a time, so read-then-write is safe.
	 * @param ownerId The account's owner.
	 * @param now The current time.
	 */
	async countReminder(ownerId: number, now = new Date()) {
		const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()));
		const n = await this.#reminders(ownerId, month);
		await this.settings.set(this.#reminderKey(ownerId, month), String(n + 1));
	}

	/**
	 * How many abandoned-cart emails an account sent in a month.
	 * @param ownerId The account's owner.
	 * @param month The first moment of the month (UTC).
	 * @returns The count.
	 */
	async #reminders(ownerId: number, month: Date) {
		const key = this.#reminderKey(ownerId, month);
		return Number(await this.settings.get(key)) || 0;
	}

	/**
	 * The `settings` key of an account's reminder count of one month.
	 * @param ownerId The account's owner.
	 * @param month The first moment of the month (UTC).
	 * @returns Like `reminders:12:2026-10`.
	 */
	#reminderKey(ownerId: number, month: Date) {
		return `${REMINDER_COUNT_KEY}:${ownerId}:${month.toISOString().slice(0, 7)}`;
	}

	/**
	 * How many more campaign emails a shop may send this month.
	 * The limit is for the whole account, all its shops together.
	 * Only emails through the platform's setup count:
	 * a shop with its own Shop Email has no limit.
	 * @param shop The shop.
	 * @param now The current time.
	 * @returns The room left, never below 0. `Infinity` = no limit.
	 */
	async campaignEmailsLeft(shop: Shop, now = new Date()): Promise<number> {
		if (await this.mail.config(shop.id)) return Infinity;
		if (!(await this.limited(shop.owner_id))) return Infinity;
		// one campaign sends at a time per account (CampaignRepository.claim)
		// so this count stays right
		const { used, limit } = await this.campaignEmails(shop.owner_id, now);
		return Math.max(0, limit - used);
	}

	/**
	 * Do the limits count for this account?
	 * @param ownerId The account's owner.
	 * @returns False for the platform admin's account only.
	 */
	protected async limited(ownerId: number): Promise<boolean> {
		const owner = await this.users.find(ownerId);
		return !owner || !Account.isPlatformAdmin(owner);
	}
}
