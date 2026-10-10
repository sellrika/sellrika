import { z } from "zod";
import {
	email,
	PASSWORD_MISMATCH,
	personName,
	samePassword,
} from "@validators/Fields.Validator";

/** The sign-in form. POST /login. */
export const LoginInput = z.object({
	/** The account's email. Kept in lower case. */
	email,
	/** The password. Needed. */
	password: z.string().min(1, "validation.password_required"),
});
/** A checked `LoginInput`. */
export type LoginInput = z.infer<typeof LoginInput>;

/**
 * The user's own new password, typed twice.
 * PUT /settings/password.
 */
export const PasswordInput = z
	.object({
		/** The password in use now. It proves who is asking. */
		current_password: z.string().min(1, "validation.current_password_required"),
		/** The new password, at least 8 characters. */
		password: z.string().min(8, "validation.password_min_8"),
		/** The new password typed again. It must match. */
		password_confirmation: z.string(),
	})
	.refine(samePassword, PASSWORD_MISMATCH);
/** A checked `PasswordInput`. */
export type PasswordInput = z.infer<typeof PasswordInput>;

/** The user's own name. PUT /settings/profile. */
export const ProfileInput = z.object({
	/** The person's name. Needed, at most 100 characters. */
	name: personName,
});
/** A checked `ProfileInput`. */
export type ProfileInput = z.infer<typeof ProfileInput>;

/**
 * Connecting a Microsoft account. POST /settings/microsoft.
 * The current password proves it is really them.
 */
export const MicrosoftConnectInput = z.object({
	/** The user's password in use now. */
	current_password: z.string().min(1, "validation.current_password_required"),
	/** The Firebase ID token of the Microsoft sign-in: 20 to 4096 characters. */
	token: z
		.string()
		.trim()
		.min(20, "validation.sign_in_again")
		.max(4096, "validation.sign_in_again"),
});
/** A checked `MicrosoftConnectInput`. */
export type MicrosoftConnectInput = z.infer<typeof MicrosoftConnectInput>;
