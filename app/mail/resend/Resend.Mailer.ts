import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { RESEND_API_URL, RESEND_MAX_TRIES } from "@constants/Mail.Constant";
import { HttpMailer, type MailCall } from "@mail/Http.Mailer";
import type { InlineImage, MailField, MailMessage } from "@mail/types";

// Resend via its REST API (fetch): no npm package, the backend stays Bun-only.

/**
 * Resend.
 * An API key is the whole setup.
 */
@Service()
export class ResendMailer extends HttpMailer {
	readonly key = "resend";
	readonly label = "Resend";
	readonly help_url = "https://resend.com/api-keys";
	protected readonly maxTries = RESEND_MAX_TRIES;

	/**
	 * The credentials the admin fills in.
	 * A getter, not a field: the labels are translated per request.
	 * @returns The API key field.
	 */
	get fields(): MailField[] {
		return [
			{
				name: "api_key",
				label: t("server.mail_field_api_key"),
				secret: true,
				required: true,
				placeholder: "re_…",
			},
		];
	}

	/**
	 * The request for one message, as Resend's REST API wants it.
	 * @param creds The merchant's decrypted API key.
	 * @param msg Sender, recipient, subject and body.
	 * @returns Where to post, the body, and the headers per try.
	 */
	protected call(creds: Record<string, string>, msg: MailMessage): MailCall {
		const headers = {
			Authorization: `Bearer ${creds.api_key}`,
			"Content-Type": "application/json",
		};
		return {
			url: RESEND_API_URL,
			body: JSON.stringify({
				from: msg.from,
				to: [msg.to],
				subject: msg.subject,
				text: msg.text,
				...(msg.html && { html: msg.html }),
				...(msg.inline?.length && {
					attachments: msg.inline.map((img) => this.#attachment(img)),
				}),
				...(msg.headers && { headers: msg.headers }),
			}),
			headers: () => headers,
		};
	}

	/**
	 * The words for a send Resend refused.
	 * @param data Resend's JSON answer.
	 * @param status The HTTP status.
	 * @returns Resend's own message, else "Resend rejected the email".
	 */
	protected refusal(data: unknown, status: number): string {
		return (
			(data as { message?: string } | null)?.message ??
			t("server.resend_rejected", { status })
		);
	}

	/**
	 * Turn an inline image into a Resend attachment.
	 * `content_id` makes it an inline image the HTML shows with `cid:`.
	 * @param img The image.
	 * @returns The attachment, as Resend's API wants it.
	 */
	#attachment(img: InlineImage) {
		return {
			filename: img.filename,
			content: Buffer.from(img.content).toString("base64"),
			content_type: img.contentType,
			content_id: img.cid,
		};
	}
}
