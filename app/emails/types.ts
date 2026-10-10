import type { InlineImage } from "@mail/types";
import type { Shop } from "@models/Shop";

/**
 * What an email says.
 * The subject, the plain-text part and the (optional) HTML part.
 * And the images the HTML shows by `cid:`.
 */
export type EmailContent = {
	subject: string;
	text: string;
	html?: string;
	inline?: InlineImage[];
	/**
	 * Extra header lines, for example `List-Unsubscribe`.
	 * ASCII values only.
	 */
	headers?: Record<string, string>;
};

/**
 * One email the app sends.
 * Every one has its own class in `app/emails/`.
 * `MailService.send()` takes only these.
 * So all the wording lives in one folder.
 * The provider that delivers it (`Mailer`, app/mail) is a separate thing.
 */
export interface Mailable {
	/** Who gets it. */
	to: string;
	/**
	 * Who sends it: the shop on email to its customers.
	 * Null = the app itself.
	 * A shop's email carries its name.
	 * It goes out through the shop's own mail setup.
	 * Without one it goes through the platform's, from the platform's address.
	 */
	fromShop: Pick<Shop, "id" | "name" | "slug"> | null;
	/**
	 * Build the email, in the language of the current request.
	 * @returns Subject, text and html.
	 */
	build(): Promise<EmailContent>;
}
