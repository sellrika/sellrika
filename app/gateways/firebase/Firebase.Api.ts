import { Service } from "@xcore/di";
import { app } from "@config/app";
import { FIREBASE_TIMEOUT_MS } from "@constants/Store.Constant";

/**
 * What Firebase knows about the user behind a sign-in token.
 */
export type FirebaseUser = {
	uid: string;
	email: string | null;
	email_verified: boolean;
	name: string | null;
};

/**
 * A person who signed in on the staff pages with Google or Microsoft.
 */
export type PlatformUser = {
	/** The Firebase user id: fixed per sign-in account, never typed. */
	uid: string;
	email: string;
	/** False = the provider did not prove the email. */
	verified: boolean;
	name: string | null;
};

/**
 * Firebase Authentication, server side.
 * It is an identity provider, not a payment gateway.
 * It lives here because it is the same shape:
 * a plain-fetch client to an outside service,
 * stubbed in tests through the container.
 * The storefront signs the customer in with the Firebase JS SDK.
 * It posts the ID token it got.
 * This asks Identity Toolkit whether that token is real.
 * `accounts:lookup` with the *web API key* only answers
 * for tokens of that key's project.
 * So a token minted elsewhere is refused.
 * No JWT verification code and no service account are needed.
 */
@Service()
export class FirebaseApi {
	/**
	 * Who signed in with Google or Microsoft on the staff pages,
	 * through the platform's own Firebase project.
	 * `verified` = Firebase says the provider proved the email.
	 * Google always does. Microsoft mostly does not.
	 * Never throws: Firebase being down reads as "nobody".
	 * @param idToken The token the browser's Firebase SDK produced.
	 * @returns The person, or null (a bad token, or no email).
	 */
	async platformUser(idToken: string): Promise<PlatformUser | null> {
		const who = await this.lookup(app.firebase.apiKey, idToken).catch(
			() => null,
		);
		if (!who?.email) return null;
		return {
			uid: who.uid,
			email: who.email,
			verified: who.email_verified,
			name: who.name,
		};
	}

	/**
	 * Verify a Firebase ID token and read its user.
	 * @param apiKey The shop's Firebase web API key (`shops.firebase_config.api_key`).
	 * @param idToken The token the browser's Firebase SDK produced.
	 * @returns The user, or null when Firebase rejects the token.
	 * That is: expired, forged, or of another project.
	 * @throws When Firebase can't be reached,
	 * or takes longer than `FIREBASE_TIMEOUT_MS`.
	 * The caller shows "could not verify" for both.
	 */
	async lookup(apiKey: string, idToken: string): Promise<FirebaseUser | null> {
		const res = await fetch(
			`${app.firebaseLookupUrl}?key=${encodeURIComponent(apiKey)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idToken }),
				signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
			},
		);
		// INVALID_ID_TOKEN, USER_NOT_FOUND, or a key of another project
		if (res.status === 400) return null;
		if (!res.ok) throw new Error(`Firebase answered ${res.status}`);
		const data = (await res.json()) as {
			users?: {
				localId: string;
				email?: string;
				emailVerified?: boolean;
				displayName?: string;
			}[];
		};
		const u = data.users?.[0];
		return u
			? {
					uid: u.localId,
					email: u.email?.trim().toLowerCase() || null,
					email_verified: !!u.emailVerified,
					name: u.displayName?.trim() || null,
				}
			: null;
	}
}
