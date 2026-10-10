import { Service } from "@xcore/di";
import { InviteRepository } from "@repositories/Invite.Repository";
import { UserRepository } from "@repositories/User.Repository";
import type { User } from "@models/User";

/**
 * The tokens in the links we email.
 * An invitation, a sign-up confirmation and "forgot password"
 * all keep theirs in `user_invites`.
 */
@Service()
export class LinkTokenService {
	constructor(
		private links: InviteRepository,
		private users: UserRepository,
	) {}

	/**
	 * The person a still-valid link is for, whatever their state.
	 * @param token The token from the link.
	 * @returns The user, or null when the link is unknown or expired.
	 */
	async userOf(token: string): Promise<User | null> {
		const id = await this.links.userOf(token);
		return id ? this.users.find(id) : null;
	}

	/**
	 * The person a still-valid link is for,
	 * when they may use the app: switched on and confirmed.
	 * @param token The token from the link.
	 * @returns The user, or null when the link is unknown or expired.
	 * Null too when the account is off or was never confirmed.
	 */
	async confirmedUserOf(token: string): Promise<User | null> {
		const user = await this.userOf(token);
		return user?.active && user.email_verified_at ? user : null;
	}
}
