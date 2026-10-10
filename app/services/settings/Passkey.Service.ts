import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { PasskeyRepository } from "@repositories/Passkey.Repository";
import { UserRepository } from "@repositories/User.Repository";
import type { User } from "@models/User";
import type { PasskeyInfo } from "@models/Passkey";
import type { Errors } from "@validators/validate";
import type {
	PasskeyLoginInput,
	PasskeyRegisterInput,
} from "@validators/Passkey.Validator";
import {
	PASSKEY_ALGORITHMS,
	PASSKEY_CHALLENGE_TTL_MS,
	PASSKEY_CHALLENGES_MAX,
	PASSKEY_MAX,
	PASSKEY_RP_NAME,
} from "@constants/Auth.Constant";
import { randomToken } from "@helpers/crypto";
import {
	readAuthenticatorData,
	readClientData,
	validPublicKey,
	verifySignature,
} from "@helpers/webauthn";

/**
 * A challenge the server handed out and still waits for.
 * `userId` = who may answer it with a new passkey; null = a sign-in.
 */
type Pending = { userId: number | null; expires: number };

/**
 * Passkeys: adding one in Settings, signing in with one.
 */
@Service()
export class PasskeyService {
	/**
	 * The challenges waiting for an answer, oldest first.
	 * ponytail: kept in memory, fine for one server process.
	 * Move them to a table when the app runs as several.
	 */
	private challenges = new Map<string, Pending>();

	constructor(
		private passkeys: PasskeyRepository,
		private users: UserRepository,
	) {}

	/**
	 * The passkeys of a user, for the Settings page.
	 * @param userId Whose passkeys.
	 * @returns Name and dates only, never the keys.
	 */
	async list(userId: number): Promise<PasskeyInfo[]> {
		const rows = await this.passkeys.forUser(userId);
		return rows.map(({ id, name, last_used_at, created_at }) => ({
			id,
			name,
			last_used_at,
			created_at,
		}));
	}

	/**
	 * What the browser needs to ask for a passkey at sign-in.
	 * No email is asked: the device offers the passkeys it holds for this site.
	 * @param origin The app's origin.
	 * @returns The options for `navigator.credentials.get`, values as base64url.
	 */
	loginOptions(origin: string) {
		return {
			challenge: this.#issue(null),
			rpId: this.#rpIdOf(origin),
			userVerification: "required",
			timeout: PASSKEY_CHALLENGE_TTL_MS,
		};
	}

	/**
	 * What the browser needs to make a new passkey.
	 * The current password is asked first.
	 * So a browser left open cannot add a way in for somebody else.
	 * @param user The signed-in user.
	 * @param password Their current password, as typed.
	 * @param origin The app's origin.
	 * @returns The options for `navigator.credentials.create`, or errors.
	 */
	async registerOptions(user: User, password: string, origin: string) {
		if (!(await Bun.password.verify(password, user.password_hash)))
			return {
				errors: {
					current_password: t("server.auth_current_password_wrong"),
				} as Errors,
			};
		const own = await this.passkeys.forUser(user.id);
		if (own.length >= PASSKEY_MAX)
			return {
				errors: {
					passkey: t("server.passkey_limit", { max: PASSKEY_MAX }),
				} as Errors,
			};
		return {
			options: {
				challenge: this.#issue(user.id),
				rp: { id: this.#rpIdOf(origin), name: PASSKEY_RP_NAME },
				user: {
					id: Buffer.from(String(user.id)).toString("base64url"),
					name: user.email,
					displayName: user.name,
				},
				pubKeyCredParams: PASSKEY_ALGORITHMS.map((alg) => ({
					type: "public-key",
					alg,
				})),
				excludeCredentials: own.map((p) => ({
					type: "public-key",
					id: p.credential_id,
				})),
				authenticatorSelection: {
					residentKey: "required",
					userVerification: "required",
				},
				// ponytail: any device is accepted. Check attestation when only some may be.
				attestation: "none",
				timeout: PASSKEY_CHALLENGE_TTL_MS,
			},
		};
	}

	/**
	 * Save the passkey the device just made.
	 * @param user The signed-in user.
	 * @param input The device's answer and the name the user typed.
	 * @param origin The app's origin.
	 * @returns Inertia errors, or null on success.
	 */
	async register(
		user: User,
		input: PasskeyRegisterInput,
		origin: string,
	): Promise<Errors | null> {
		const invalid = { passkey: t("server.passkey_invalid") };
		const challenge = readClientData(
			input.client_data,
			"webauthn.create",
			origin,
		);
		if (!this.#redeem(challenge, user.id)) return invalid;
		const data = readAuthenticatorData(
			input.authenticator_data,
			this.#rpIdOf(origin),
		);
		if (!data?.credentialId || !validPublicKey(input.public_key))
			return invalid;
		if ((await this.passkeys.forUser(user.id)).length >= PASSKEY_MAX)
			return { passkey: t("server.passkey_limit", { max: PASSKEY_MAX }) };
		if (await this.passkeys.findByCredential(data.credentialId))
			return { passkey: t("server.passkey_exists") };
		await this.passkeys.create(user.id, {
			credential_id: data.credentialId,
			public_key: input.public_key,
			name: input.name,
			sign_count: data.signCount,
		});
		return null;
	}

	/**
	 * Check a sign-in with a passkey.
	 * @param input The device's answer.
	 * @param origin The app's origin.
	 * @returns The user, "disabled" for a deactivated account, else null.
	 */
	async login(
		input: PasskeyLoginInput,
		origin: string,
	): Promise<User | "disabled" | null> {
		const challenge = readClientData(input.client_data, "webauthn.get", origin);
		if (!this.#redeem(challenge, null)) return null;
		const data = readAuthenticatorData(
			input.authenticator_data,
			this.#rpIdOf(origin),
		);
		const passkey = await this.passkeys.findByCredential(input.id);
		if (!data || !passkey) return null;
		const signed = verifySignature(
			passkey.public_key,
			input.authenticator_data,
			input.client_data,
			input.signature,
		);
		if (!signed) return null;
		// a counter that does not go up means a copy of the passkey is in use
		const counted = passkey.sign_count > 0 || data.signCount > 0;
		if (counted && data.signCount <= passkey.sign_count) return null;
		const user = await this.users.find(passkey.user_id);
		if (!user) return null;
		if (!user.active) return "disabled";
		await this.passkeys.used(passkey.id, data.signCount);
		return user;
	}

	/**
	 * Delete one of the user's own passkeys.
	 * @param userId The signed-in user.
	 * @param id The passkey.
	 */
	async remove(userId: number, id: number) {
		await this.passkeys.delete(id, userId);
	}

	/**
	 * Make a new one-time challenge.
	 * Expired ones are dropped on the way.
	 * @param userId Who may answer it with a new passkey; null for a sign-in.
	 * @returns The challenge, 32 random bytes as base64url.
	 */
	#issue(userId: number | null): string {
		const now = Date.now();
		for (const [key, pending] of this.challenges) {
			const full = this.challenges.size >= PASSKEY_CHALLENGES_MAX;
			if (pending.expires > now && !full) break;
			this.challenges.delete(key);
		}
		const challenge = randomToken(32);
		this.challenges.set(challenge, {
			userId,
			expires: now + PASSKEY_CHALLENGE_TTL_MS,
		});
		return challenge;
	}

	/**
	 * Use a challenge up. It works once.
	 * @param challenge The challenge the browser signed, or null.
	 * @param userId Who answers: the user adding a passkey, null for a sign-in.
	 * @returns True when the server handed it out for this, and it is not too old.
	 */
	#redeem(challenge: string | null, userId: number | null): boolean {
		const pending = challenge ? this.challenges.get(challenge) : undefined;
		if (!challenge || !pending) return false;
		this.challenges.delete(challenge);
		return pending.userId === userId && pending.expires > Date.now();
	}

	/**
	 * The site a passkey belongs to: the app's hostname.
	 * @param origin The app's origin.
	 * @returns The hostname, like `sellrika.com`.
	 */
	#rpIdOf(origin: string) {
		return new URL(origin).hostname;
	}
}
