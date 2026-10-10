import { linkEmail, type LinkTexts } from "./link";
import type { EmailContent, Mailable } from "./types";

/**
 * An email with one link button, from the app itself.
 * The invitation, the sign-up confirmation and "forgot password" are these.
 * Each one only says its subject and the texts around the link.
 */
export abstract class LinkEmail implements Mailable {
	fromShop = null;

	/**
	 * @param to Who gets it.
	 * @param link The link behind the button.
	 */
	constructor(
		public to: string,
		protected link: string,
	) {}

	/**
	 * Build the email.
	 * @returns Subject, text and html.
	 */
	async build(): Promise<EmailContent> {
		return {
			subject: this.subject(),
			...(await linkEmail({ link: this.link, ...this.texts() })),
		};
	}

	/**
	 * The subject line.
	 * @returns The subject, in the language of the current request.
	 */
	protected abstract subject(): string;

	/**
	 * The texts around the link.
	 * @returns Heading, intro, button label and the "expires" line.
	 */
	protected abstract texts(): Omit<LinkTexts, "link">;
}
