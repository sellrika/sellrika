import { z } from "zod";
import { credentials, email, isEmail } from "@validators/Fields.Validator";

/**
 * PUT /email (the platform) and PUT /shop-email (the active shop).
 * One mail setup.
 * Every provider's credentials are saved at once
 * (`credentials[driverKey][field]`, blank secret = keep the stored one).
 * `driver` is the one that is switched on. "" means it is off.
 * It is checked against app/mail in MailService.
 * The switched-on setup needs `from_email`,
 * the one address every email goes out from.
 */
export const MailInput = z.object({
	/**
	 * The provider that is switched on, by its key.
	 * "" = email is off.
	 */
	driver: z.string().trim().max(30).default(""),
	/**
	 * The one address every email goes out from.
	 * Kept in lower case. "" = not set.
	 */
	from_email: z
		.string()
		.trim()
		.toLowerCase()
		.refine((v) => !v || isEmail(v), "validation.enter_valid_sender_email")
		.default(""),
	/**
	 * Every provider's fields: `credentials[driverKey][field]`.
	 * A blank secret keeps the stored one.
	 */
	credentials,
});
/** A checked `MailInput`. */
export type MailInput = z.infer<typeof MailInput>;

/**
 * Send one message to prove the setup works.
 * POST /email/test and POST /shop-email/test.
 */
export const TestMailInput = z.object({
	/** The address the test message goes to. */
	to: email,
});
/** A checked `TestMailInput`. */
export type TestMailInput = z.infer<typeof TestMailInput>;
