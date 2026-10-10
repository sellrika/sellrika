import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { UserRepository } from "@repositories/User.Repository";
import { PasskeyRepository } from "@repositories/Passkey.Repository";
import { SessionRepository } from "@repositories/Session.Repository";
import type { User } from "@models/User";
import { InviteRepository } from "@repositories/Invite.Repository";
import { LinkTokenService } from "@services/settings/LinkToken.Service";
import { MailService } from "@services/settings/Mail.Service";
import { ResetEmail } from "@emails/Reset.Email";
import { RESET_TTL_HOURS, RESET_WAIT_MINUTES } from "@constants/Auth.Constant";
import { FirebaseApi } from "@gateways/firebase/Firebase.Api";
import type { LoginInput, PasswordInput } from "@validators/Auth.Validator";

/**
 * An argon2 hash of a value nobody knows, built once on first use.
 */
let dummyHash: Promise<string> | null = null;

/**
 * Signing in, changing your own password, and "forgot password".
 */
@Service()
export class AuthService {
	constructor(
		private users: UserRepository,
		private sessions: SessionRepository,
		private links: InviteRepository,
		private mail: MailService,
		private tokens: LinkTokenService,
		private passkeys: PasskeyRepository,
		private firebase: FirebaseApi,
	) {}

	/**
	 * Check a login.
	 * @param credentials Email + plain-text password as typed on the login form.
	 * @returns The user when they match.
	 * "disabled" for a deactivated account, else null.
	 */
	async attempt({
		email,
		password,
	}: LoginInput): Promise<User | "disabled" | null> {
		const user = await this.users.findByEmail(email);
		// an unknown email is verified against a throwaway hash
		// so "no such user" and "wrong password" take the same time
		// else the response time tells which emails have an account
		if (!user) {
			await Bun.password.verify(password, await this.#decoyHash());
			return null;
		}
		if (!(await Bun.password.verify(password, user.password_hash))) return null;
		return user.active ? user : "disabled";
	}

	/**
	 * Check a Google or Microsoft sign-in, made through Firebase.
	 * Two ways in:
	 * - the sign-in account is tied to a user (`users.firebase_uid`):
	 *   they signed up with it, or connected it in /settings;
	 * - the provider proved the email (Google): the user with that email.
	 * An email that is not proved (most Microsoft accounts) is never used
	 * to find a user: anyone can make an account that claims any email.
	 * It never makes a new account.
	 * @param token The Firebase ID token the browser got.
	 * @returns The user, or "disabled" for a deactivated account.
	 * "new" = nobody has this sign-in account or its email:
	 * the person may sign up with it.
	 * Null = Firebase refuses the token, or the email belongs to an
	 * account this sign-in is not tied to.
	 */
	async firebaseSignIn(
		token: string,
	): Promise<User | "disabled" | "new" | null> {
		const who = await this.firebase.platformUser(token);
		if (!who) return null;
		const byEmail = await this.users.findByEmail(who.email);
		const user =
			(await this.users.findByFirebaseUid(who.uid)) ??
			(who.verified ? byEmail : null);
		if (user) return user.active ? user : "disabled";
		return byEmail ? null : "new";
	}

	/**
	 * Connect a Microsoft account to the signed-in user, from /settings.
	 * The current password proves it is really them.
	 * After it, that Microsoft account signs them in.
	 * @param user The signed-in user.
	 * @param password Their current password, as typed.
	 * @param token The Firebase ID token of the Microsoft sign-in.
	 * @returns Errors by field, or null on success.
	 */
	async connectProvider(
		user: User,
		password: string,
		token: string,
	): Promise<Record<string, string> | null> {
		if (!(await Bun.password.verify(password, user.password_hash)))
			return { current_password: t("server.auth_current_password_wrong") };
		const who = await this.firebase.platformUser(token);
		if (!who) return { microsoft: t("server.microsoft_connect_failed") };
		const other = await this.users.findByFirebaseUid(who.uid);
		if (other && other.id !== user.id)
			return { microsoft: t("server.microsoft_taken") };
		await this.users.setFirebaseUid(user.id, who.uid);
		return null;
	}

	/**
	 * Is a sign-in account connected to this user?
	 * @param userId The user.
	 * @returns True when one is.
	 */
	providerConnected(userId: number) {
		return this.users.hasFirebaseUid(userId);
	}

	/**
	 * Take the connected sign-in account off a user.
	 * @param userId The user.
	 */
	async disconnectProvider(userId: number) {
		await this.users.setFirebaseUid(userId, null);
	}

	/**
	 * Re-hash the password after checking the current one.
	 * Signs out every other device.
	 * @param user The signed-in user.
	 * @param keepSessionId The session doing the change.
	 * It is the only one that stays alive.
	 * @param input Current password + the new one.
	 * @returns An error message, or null on success.
	 */
	async changePassword(
		user: User,
		keepSessionId: string,
		{ current_password, password }: PasswordInput,
	) {
		if (!(await Bun.password.verify(current_password, user.password_hash)))
			return t("server.auth_current_password_wrong");
		await this.users.updatePassword(user.id, await Bun.password.hash(password));
		await this.sessions.deleteOthers(user.id, keepSessionId);
		return null;
	}

	/**
	 * "Forgot password": email a link to pick a new one.
	 * The answer is the same for every email.
	 * So nobody learns which emails have an account.
	 * The email is sent after the answer.
	 * So the time it takes says nothing either.
	 * @param email The email as typed (lower case).
	 * @param origin The app's origin, for the link.
	 * @returns Null, or why no email can go out at all (email is off).
	 */
	async forgot(email: string, origin: string): Promise<string | null> {
		if (!(await this.mail.config())) return t("server.mail_not_set_up");
		void this.#sendReset(email, origin);
		return null;
	}

	/**
	 * Make a "forgot password" link for an email.
	 * Any older link of that user stops working.
	 * None for an unknown email or a switched-off account.
	 * None for a sign-up that was never confirmed: that person signs up again.
	 * None either when the account got a link a moment ago.
	 * @param email The email (lower case).
	 * @param origin The app's origin, for the link.
	 * @returns The user and the link, or null.
	 */
	async resetLink(
		email: string,
		origin: string,
	): Promise<{ user: User; link: string } | null> {
		const user = await this.users.findByEmail(email);
		if (!user?.active || !user.email_verified_at) return null;
		if (await this.links.madeSince(user.id, RESET_WAIT_MINUTES)) return null;
		const token = await this.links.create(user.id, RESET_TTL_HOURS / 24);
		return { user, link: `${origin}/reset-password/${token}` };
	}

	/**
	 * The person a still-valid "forgot password" link is for.
	 * @param token The token from the link.
	 * @returns The user, or null when the link is unknown, used or expired.
	 * Null too when the account is off.
	 */
	resettable(token: string): Promise<User | null> {
		return this.tokens.confirmedUserOf(token);
	}

	/**
	 * Set the new password from a "forgot password" link.
	 * The link stops working and every device is signed out.
	 * @param token The token from the link.
	 * @param password The new password.
	 * @returns The user, or null when the link is no longer valid.
	 */
	async resetPassword(token: string, password: string): Promise<User | null> {
		const user = await this.resettable(token);
		if (!user) return null;
		await this.users.updatePassword(user.id, await Bun.password.hash(password));
		await this.links.deleteFor(user.id);
		await this.sessions.deleteAllFor(user.id);
		// a reset closes every other way in: whoever added a passkey is out too
		await this.passkeys.deleteAllFor(user.id);
		// The sign-in account the user signed up with is cut off too.
		// Its email was never proved, so the mailbox's owner may be
		// somebody else, taking the account back with this reset.
		// They can connect it again in /settings.
		await this.users.setFirebaseUid(user.id, null);
		return user;
	}

	/**
	 * Make the link and send it. Never throws.
	 * @param email The email as typed (lower case).
	 * @param origin The app's origin, for the link.
	 */
	async #sendReset(email: string, origin: string) {
		try {
			const made = await this.resetLink(email, origin);
			if (!made) return;
			const error = await this.mail.send(
				new ResetEmail(made.user.email, made.user.name, made.link),
			);
			if (error) console.warn(`[mail] password reset to ${email}: ${error}`);
		} catch (e) {
			console.warn(`[mail] password reset to ${email}:`, e);
		}
	}

	/**
	 * The hash to verify against when the email is unknown.
	 * It costs as much as a real verify.
	 * So an unknown email takes as long as a wrong password.
	 * @returns The hash, built on the first call.
	 */
	#decoyHash(): Promise<string> {
		dummyHash ??= Bun.password.hash(crypto.randomUUID());
		return dummyHash;
	}
}
