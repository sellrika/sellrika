import { t } from "@xcore/i18n/I18n";
import { edge } from "@xcore/view/Edge";
// embedded at compile time, so it works inside the single binary too
import testTemplate from "@resources/views/emails/test.edge" with {
	type: "text",
};
import type { EmailContent, Mailable } from "./types";

edge.registerTemplate("emails/test", { template: testTemplate });

/**
 * The test email from an email page.
 * It proves the setup works.
 */
export class TestEmail implements Mailable {
	/**
	 * @param to Where the admin wants it.
	 * @param fromShop The shop whose setup is tested; null = the platform's.
	 */
	constructor(
		public to: string,
		public fromShop: Mailable["fromShop"] = null,
	) {}

	/**
	 * Build the email.
	 * @returns Subject, text and html.
	 */
	async build(): Promise<EmailContent> {
		const heading = t("server.mail_test_subject");
		const body = t("server.mail_test_body");
		const html = await edge.render("emails/test", { t, heading, body });
		return { subject: heading, text: body, html };
	}
}
