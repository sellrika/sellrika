import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { InviteRepository } from "@repositories/Invite.Repository";
import { UserRepository } from "@repositories/User.Repository";
import { LinkTokenService } from "@services/settings/LinkToken.Service";
import { MailService } from "@services/settings/Mail.Service";
import { ShopService } from "@services/settings/Shop.Service";
import { INVITE_TTL_DAYS } from "@constants/Auth.Constant";
import type { User } from "@models/User";
import type { ShopInput } from "@validators/Shop.Validator";
import type { AcceptInviteInput } from "@validators/User.Validator";
import { InviteEmail } from "@emails/Invite.Email";

/**
 * What `createShopFor` answers.
 * The link to hand the new owner,
 * and why the email did not go out (null = sent).
 * Or the errors to show the platform admin.
 */
type Invited =
	| { link: string; mailError: string | null; errors?: never }
	| { errors: Record<string, string>; link?: never; mailError?: never };

/**
 * New shop owners.
 * The platform admin creates a shop for an email.
 * The person gets an invitation link,
 * and picks their own name and password there.
 */
@Service()
export class InviteService {
	constructor(
		private users: UserRepository,
		private invites: InviteRepository,
		private shops: ShopService,
		private mail: MailService,
		private tokens: LinkTokenService,
	) {}

	/**
	 * Create a shop for a new person and invite them to it.
	 * They become an owner with their own account; the shop is theirs.
	 * @param d Validated shop settings.
	 * @param email The new owner's email (lower case).
	 * @param origin The app's origin, for the link.
	 * @returns The link and the mail result, or `{errors}` under `owner_email`.
	 */
	async createShopFor(
		d: ShopInput,
		email: string,
		origin: string,
	): Promise<Invited> {
		if (await this.users.emailTaken(email))
			return { errors: { owner_email: t("server.user_email_taken") } };
		// no usable password until they accept
		// the random one is never shown to anyone
		const user = await this.users.create(
			{ name: email.split("@")[0]!, email, role: "admin", password: "" },
			await Bun.password.hash(crypto.randomUUID()),
			null,
		);
		const shop = await this.shops.create(d, user.id);
		const link = `${origin}/invite/${await this.invites.create(user.id, INVITE_TTL_DAYS)}`;
		return { link, mailError: await this.#send(email, shop.name, link) };
	}

	/**
	 * The person a still-valid invitation is for.
	 * @param token The token from the link.
	 * @returns The user, or null when the link is unknown or expired.
	 * Null too when the account is off.
	 * Also null for a sign-up confirmation token:
	 * that user is not confirmed yet.
	 */
	invited(token: string): Promise<User | null> {
		return this.tokens.confirmedUserOf(token);
	}

	/**
	 * Accept an invitation.
	 * The person's own name and password are saved.
	 * The link stops working.
	 * @param token The token from the link.
	 * @param d Validated name and password.
	 * @returns The user, or null when the link is no longer valid.
	 */
	async accept(token: string, d: AcceptInviteInput): Promise<User | null> {
		const user = await this.invited(token);
		if (!user) return null;
		await this.users.updateName(user.id, d.name);
		await this.users.updatePassword(
			user.id,
			await Bun.password.hash(d.password),
		);
		await this.invites.deleteFor(user.id);
		return user;
	}

	/**
	 * Email the invitation.
	 * @param to The new owner.
	 * @param shop The shop's name.
	 * @param link The invitation link.
	 * @returns Null when it went out, else why not.
	 */
	async #send(to: string, shop: string, link: string) {
		const error = await this.mail.send(new InviteEmail(to, shop, link));
		if (error && error !== t("server.mail_not_set_up"))
			console.warn(`[mail] invitation to ${to}: ${error}`);
		return error;
	}
}
