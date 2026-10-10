import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { app } from "@config/app";
import { InviteRepository } from "@repositories/Invite.Repository";
import { SessionRepository } from "@repositories/Session.Repository";
import { SettingRepository } from "@repositories/Setting.Repository";
import { ShopRepository } from "@repositories/Shop.Repository";
import { UserRepository } from "@repositories/User.Repository";
import { LinkTokenService } from "@services/settings/LinkToken.Service";
import { MailService } from "@services/settings/Mail.Service";
import { ShopService } from "@services/settings/Shop.Service";
import { Hooks } from "@xcore/hooks/Hooks";
import { STORE_SYSTEM_EMAIL } from "@constants/Store.Constant";
import { INVITE_TTL_DAYS, SIGNUP_SETTING_KEY } from "@constants/Auth.Constant";
import type { User } from "@models/User";
import { ShopInput } from "@validators/Shop.Validator";
import type {
	ProviderRegisterInput,
	RegisterInput,
} from "@validators/User.Validator";
import { FirebaseApi } from "@gateways/firebase/Firebase.Api";
import { ConfirmEmail } from "@emails/Confirm.Email";

/**
 * What `register` answers.
 * The new owner, or the errors to show on the form.
 */
type Registered =
	| { user: User; errors?: never }
	| { errors: Record<string, string>; user?: never };

/**
 * Self sign-up.
 * When the platform admin switches it on, anyone can create an account
 * and their first shop on `/register`.
 * The new owner can use nothing until they open the link we email them,
 * while signed in.
 * That link sets `users.email_verified_at`.
 * The link's token is a `user_invites` row, like an invitation's.
 */
@Service()
export class SignupService {
	constructor(
		private settings: SettingRepository,
		private users: UserRepository,
		private shops: ShopService,
		private links: InviteRepository,
		private mail: MailService,
		private sessions: SessionRepository,
		private shopRows: ShopRepository,
		private tokens: LinkTokenService,
		private firebase: FirebaseApi,
	) {}

	/**
	 * Is self sign-up switched on?
	 * @returns True when on. Off until the platform admin turns it on.
	 */
	async enabled(): Promise<boolean> {
		return (await this.settings.get(SIGNUP_SETTING_KEY)) === "true";
	}

	/**
	 * Switch self sign-up on or off.
	 * @param on True = anyone may sign up.
	 */
	async setEnabled(on: boolean) {
		await this.settings.set(SIGNUP_SETTING_KEY, JSON.stringify(on));
	}

	/**
	 * Create a new owner and their first shop.
	 * Email them the confirmation link.
	 * The owner is an admin with their own account (no `owner_id`).
	 * The shop is theirs.
	 * The platform admin's email always counts as taken.
	 * So sign-up never makes a platform admin.
	 * An email held by a sign-up that was never confirmed is taken over
	 * (see `takeOver`).
	 * Refused while email is not set up: nobody could confirm the account.
	 * The free days start now, also for an account that is taken over.
	 * @param d Validated sign-up form.
	 * @param origin The app's origin, for the link.
	 * @returns The new user, or `{errors}`. Refused while sign-up is off.
	 */
	async register(d: RegisterInput, origin: string): Promise<Registered> {
		if (!(await this.enabled()))
			return { errors: { email: t("server.signup_off") } };
		if (!(await this.mail.config()))
			return { errors: { email: t("server.signup_needs_mail") } };
		const taken = { errors: { email: t("server.user_email_taken") } };
		if (d.email === app.adminEmail || d.email === STORE_SYSTEM_EMAIL)
			return taken;
		const shop = ShopInput.parse({
			name: d.shop_name,
			currency: d.currency,
			timezone: d.timezone,
		});
		const hash = await Bun.password.hash(d.password);
		const old = await this.users.findByEmail(d.email);
		if (old && (old.email_verified_at || old.owner_id !== null)) return taken;
		const user = old
			? await this.#takeOver(old, d.name, hash, shop)
			: await this.users.create(
					{ name: d.name, email: d.email, role: "admin", password: "" },
					hash,
					null,
					false,
				);
		if (!old) await this.shops.create(shop, user.id);
		await Hooks.signedUp(user.id);
		await this.sendConfirmation(user, origin);
		return { user };
	}

	/**
	 * Create a new owner and their first shop from a Google or Microsoft
	 * sign-in.
	 * There is no confirmation link and outgoing email is not needed:
	 * - the provider proved the email (Google): the owner signs in by it;
	 * - it did not (most Microsoft accounts): the owner signs in by the
	 *   sign-in account itself, kept in `users.firebase_uid`.
	 *   The email is then only what the provider claims.
	 *   Whoever really has that mailbox can take the account with
	 *   "Forgot password", which cuts the sign-in account off.
	 * The account gets a random password nobody knows:
	 * "Forgot password" sets a real one.
	 * The same rules as `register` for a taken email.
	 * @param d The Firebase ID token and the first shop.
	 * @returns The new user, or `{errors}` (under `provider`).
	 */
	async registerProvider(d: ProviderRegisterInput): Promise<Registered> {
		if (!(await this.enabled()))
			return { errors: { provider: t("server.signup_off") } };
		const who = await this.firebase.platformUser(d.token);
		if (!who)
			return { errors: { provider: t("server.signup_provider_failed") } };
		const taken = { errors: { provider: t("server.user_email_taken") } };
		if (who.email === app.adminEmail || who.email === STORE_SYSTEM_EMAIL)
			return taken;
		const shop = ShopInput.parse({
			name: d.shop_name,
			currency: d.currency,
			timezone: d.timezone,
		});
		// 100 = the limit of `personName` (Fields.Validator)
		const name = (who.name ?? who.email.split("@")[0]!).slice(0, 100);
		const hash = await Bun.password.hash(
			`${crypto.randomUUID()}${crypto.randomUUID()}`,
		);
		const old = await this.users.findByEmail(who.email);
		if (old && (old.email_verified_at || old.owner_id !== null)) return taken;
		// this sign-in account already has a user
		if (await this.users.findByFirebaseUid(who.uid)) return taken;
		const user = old
			? await this.#takeOver(old, name, hash, shop)
			: await this.users.create(
					{ name, email: who.email, role: "admin", password: "" },
					hash,
					null,
					true,
				);
		if (old) {
			await this.users.verifyEmail(user.id);
			await this.links.deleteFor(user.id);
		} else await this.shops.create(shop, user.id);
		if (!who.verified) await this.users.setFirebaseUid(user.id, who.uid);
		await Hooks.signedUp(user.id);
		return { user };
	}

	/**
	 * Email a new confirmation link. Any older link stops working.
	 * @param user The new owner.
	 * @param origin The app's origin, for the link.
	 * @returns Null when it went out, else why not.
	 */
	async sendConfirmation(user: User, origin: string) {
		const token = await this.links.create(user.id, INVITE_TTL_DAYS);
		const link = `${origin}/confirm/${token}`;
		const error = await this.mail.send(
			new ConfirmEmail(user.email, user.name, link),
		);
		if (error)
			console.warn(`[mail] sign-up confirmation to ${user.email}: ${error}`);
		return error;
	}

	/**
	 * Confirm an email from its link.
	 * The link stops working and the owner may use the app.
	 * Only for a user still unconfirmed.
	 * So an invitation's token can't be spent here.
	 * Only the signed-in owner of the link may spend it.
	 * Opening the link proves the mailbox, the session proves the password:
	 * both must be the same person, or someone could sign up with
	 * another person's email and have a mail scanner confirm it.
	 * @param token The token from the link.
	 * @param userId The signed-in user who opened the link.
	 * @returns True when the link was still valid and theirs.
	 */
	async confirm(token: string, userId: number): Promise<boolean> {
		const user = await this.tokens.userOf(token);
		if (!user || user.id !== userId || user.email_verified_at) return false;
		await this.users.verifyEmail(user.id);
		await this.links.deleteFor(user.id);
		return true;
	}

	/**
	 * Give an unconfirmed sign-up to the person signing up with its email now.
	 * Anyone may have typed that email, so it must not stay blocked forever.
	 * Whoever made it is signed out.
	 * The old link stops working (`sendConfirmation` replaces it).
	 * The account could do nothing before it was confirmed.
	 * So it has only the one shop.
	 * @param user The unconfirmed owner.
	 * @param name The new name.
	 * @param hash The new password, hashed.
	 * @param shop The new shop settings.
	 * @returns The user with the new name.
	 */
	async #takeOver(
		user: User,
		name: string,
		hash: string,
		shop: ShopInput,
	): Promise<User> {
		await this.users.updateName(user.id, name);
		await this.users.updatePassword(user.id, hash);
		await this.sessions.deleteAllFor(user.id);
		// whoever held the account before is out, their sign-in account too
		await this.users.setFirebaseUid(user.id, null);
		const first = await this.shopRows.first(user.id);
		if (first) await this.shops.update(first.id, shop);
		else await this.shops.create(shop, user.id);
		return { ...user, name, password_hash: hash };
	}
}
