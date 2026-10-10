import { z } from "zod";
import { PASSKEY_FIELD_MAX, PASSKEY_NAME_MAX } from "@constants/Auth.Constant";

/** A base64url value from the browser's passkey API, bounded. */
const encoded = z
	.string()
	.max(PASSKEY_FIELD_MAX, "server.passkey_invalid")
	.regex(/^[A-Za-z0-9_-]+$/, "server.passkey_invalid");

/**
 * Asking to add a passkey. POST /settings/passkeys/options.
 * The current password proves it is really them.
 */
export const PasskeyOptionsInput = z.object({
	/** The user's password in use now. */
	current_password: z.string().min(1, "validation.current_password_required"),
});
/** A checked `PasskeyOptionsInput`. */
export type PasskeyOptionsInput = z.infer<typeof PasskeyOptionsInput>;

/**
 * A new passkey, as the device made it.
 * POST /settings/passkeys.
 */
export const PasskeyRegisterInput = z.object({
	/**
	 * The name the user gives the passkey.
	 * At most 60 characters. Left out = "".
	 */
	name: z.string().trim().max(PASSKEY_NAME_MAX).default(""),
	/**
	 * The browser's `clientDataJSON`, base64url.
	 * It carries the challenge and the origin.
	 */
	client_data: encoded,
	/** The device's authenticator data, base64url. */
	authenticator_data: encoded,
	/** The new passkey's public key, base64url. */
	public_key: encoded,
});
/** A checked `PasskeyRegisterInput`. */
export type PasskeyRegisterInput = z.infer<typeof PasskeyRegisterInput>;

/** A sign-in answer from a passkey. POST /login/passkey. */
export const PasskeyLoginInput = z.object({
	/** The id of the passkey the device used, base64url. */
	id: encoded,
	/**
	 * The browser's `clientDataJSON`, base64url.
	 * It carries the challenge and the origin.
	 */
	client_data: encoded,
	/** The device's authenticator data, base64url. */
	authenticator_data: encoded,
	/** The device's signature over the two values above, base64url. */
	signature: encoded,
});
/** A checked `PasskeyLoginInput`. */
export type PasskeyLoginInput = z.infer<typeof PasskeyLoginInput>;
