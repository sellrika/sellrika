import { z } from "zod";
import { ROLES } from "@constants/User.Constant";
import { ShopInput } from "@validators/Shop.Validator";
import {
	email,
	PASSWORD_MISMATCH,
	personName,
	samePassword,
} from "@validators/Fields.Validator";

/** The fields every staff form shares. */
const base = {
	/** The person's name. Needed, at most 100 characters. */
	name: personName,
	/**
	 * The email the person signs in with.
	 * Kept in lower case, at most 200 characters.
	 */
	email: email.max(200),
	/**
	 * What the person may do:
	 * `admin`, `manager` or `cashier`.
	 */
	role: z.enum(ROLES, { message: "validation.pick_a_role" }),
};

/** A new staff member. POST /users. */
export const NewUserInput = z.object({
	...base,
	/** The first password: 8 to 200 characters. */
	password: z.string().min(8, "validation.password_min_8").max(200),
});
/** A checked `NewUserInput`. */
export type NewUserInput = z.infer<typeof NewUserInput>;

/**
 * A staff member's details. PUT /users/:id.
 * Password is optional on edit: empty = keep the current one.
 */
export const EditUserInput = z.object({
	...base,
	/**
	 * False = the account is switched off
	 * and the person can no longer sign in.
	 */
	active: z.boolean().default(true),
	/**
	 * A new password, at least 8 characters.
	 * Empty = keep the current one.
	 */
	password: z
		.string()
		.max(200)
		.default("")
		.refine((s) => s === "" || s.length >= 8, "validation.password_min_8"),
});
/** A checked `EditUserInput`. */
export type EditUserInput = z.infer<typeof EditUserInput>;

/**
 * Who a new shop is for.
 * Read from the shop form on POST /shops, next to `ShopInput`.
 * Only the platform admin may fill it.
 */
export const ShopOwnerInput = z.object({
	/**
	 * The email of the new owner, who gets an invitation.
	 * Blank = the admin's own shop.
	 */
	owner_email: z.union([z.literal(""), email.max(200)]).default(""),
});
/** A checked `ShopOwnerInput`. */
export type ShopOwnerInput = z.infer<typeof ShopOwnerInput>;

/** A new password, typed twice. */
const newPassword = {
	/** The new password: 8 to 200 characters. */
	password: z.string().min(8, "validation.password_min_8").max(200),
	/** The same password typed again. It must match. */
	password_confirmation: z.string(),
};

/**
 * What an invited shop owner fills in on the invitation page.
 * POST /invite/:token.
 */
export const AcceptInviteInput = z
	.object({
		/** The owner's name. Needed, at most 100 characters. */
		name: base.name,
		...newPassword,
	})
	.refine(samePassword, PASSWORD_MISMATCH);
/** A checked `AcceptInviteInput`. */
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;

/**
 * The "forgot password" form: the email of the account.
 * POST /forgot-password.
 */
export const ForgotPasswordInput = z.object({
	/** The email of the account. Kept in lower case. */
	email: base.email,
});
/** A checked `ForgotPasswordInput`. */
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

/**
 * What the person fills in on the page of a "forgot password" link.
 * POST /reset-password/:token.
 */
export const ResetPasswordInput = z
	.object(newPassword)
	.refine(samePassword, PASSWORD_MISMATCH);
/** A checked `ResetPasswordInput`. */
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

/**
 * The public sign-up form. POST /register.
 * The person's name, email and password, and their first shop.
 */
export const RegisterInput = z
	.object({
		/** The person's name. Needed, at most 100 characters. */
		name: base.name,
		/**
		 * The email the person will sign in with.
		 * Kept in lower case, at most 200 characters.
		 */
		email: base.email,
		...newPassword,
		/** The first shop's name. Needed, at most 100 characters. */
		shop_name: ShopInput.shape.name,
		/** The first shop's currency: a 3-letter code like `USD`. */
		currency: ShopInput.shape.currency,
		/** The first shop's time zone. Left out = `UTC`. */
		timezone: ShopInput.shape.timezone,
	})
	.refine(samePassword, PASSWORD_MISMATCH);
/** A checked `RegisterInput`. */
export type RegisterInput = z.infer<typeof RegisterInput>;

/**
 * Sign-up with Google or Microsoft.
 * POST /register/google and /register/microsoft.
 * The name and email come from the provider, and there is no password.
 */
export const ProviderRegisterInput = z.object({
	/** The Firebase ID token of the sign-in: 20 to 4096 characters. */
	token: z
		.string()
		.trim()
		.min(20, "validation.sign_in_again")
		.max(4096, "validation.sign_in_again"),
	/** The first shop's name. Needed, at most 100 characters. */
	shop_name: ShopInput.shape.name,
	/** The first shop's currency: a 3-letter code like `USD`. */
	currency: ShopInput.shape.currency,
	/** The first shop's time zone. Left out = `UTC`. */
	timezone: ShopInput.shape.timezone,
});
/** A checked `ProviderRegisterInput`. */
export type ProviderRegisterInput = z.infer<typeof ProviderRegisterInput>;

/**
 * The platform admin's self sign-up switch.
 * PUT /owners/signup.
 */
export const SignupSettingInput = z.object({
	/** True = anyone may sign up at /register. */
	enabled: z.boolean(),
});
/** A checked `SignupSettingInput`. */
export type SignupSettingInput = z.infer<typeof SignupSettingInput>;

/**
 * The platform admin's monthly campaign email limit for one owner.
 * PUT /owners/:id/campaign-limit.
 */
export const CampaignLimitInput = z.object({
	/**
	 * Campaign emails per month, 0 to 1,000,000.
	 * null = the default.
	 */
	limit: z.number().int().min(0).max(1_000_000).nullable(),
});
/** A checked `CampaignLimitInput`. */
export type CampaignLimitInput = z.infer<typeof CampaignLimitInput>;
