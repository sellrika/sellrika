import { t } from "@xcore/i18n/I18n";
import { edge } from "@xcore/view/Edge";
// embedded at compile time, so it works inside the single binary too
import noteTemplate from "@resources/views/emails/note.edge" with {
	type: "text",
};
import type { EmailContent, Mailable } from "./types";

edge.registerTemplate("emails/note", { template: noteTemplate });

/**
 * A short note from a shop to one of its customers.
 * An extension sends it (`mail.customer`): a subject and plain text.
 * The text is never read as HTML.
 */
export class NoteEmail implements Mailable {
	/**
	 * @param to The customer's email.
	 * @param fromShop The shop that sends it.
	 * @param subject The subject, also the heading.
	 * @param text The body. Each line is one paragraph.
	 */
	constructor(
		public to: string,
		public fromShop: NonNullable<Mailable["fromShop"]>,
		private subject: string,
		private text: string,
	) {}

	/**
	 * Build the email.
	 * @returns Subject, text and html.
	 */
	async build(): Promise<EmailContent> {
		const lines = this.text.split("\n").filter((line) => line.trim());
		const html = await edge.render("emails/note", {
			t,
			heading: this.subject,
			lines,
			shop: this.fromShop.name,
		});
		const text = [...lines, "", this.fromShop.name, t("mail.no_reply")];
		return { subject: this.subject, text: text.join("\n"), html };
	}
}
