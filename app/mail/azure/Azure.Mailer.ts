import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import {
	AZURE_EMAIL_API_VERSION,
	AZURE_MAX_TRIES,
} from "@constants/Mail.Constant";
import { HttpMailer, type MailCall } from "@mail/Http.Mailer";
import {
	MailError,
	type InlineImage,
	type MailField,
	type MailMessage,
} from "@mail/types";

// Azure Communication Services Email via its REST API over HTTPS (port 443).
// For servers whose host blocks the SMTP ports.
// Plain fetch + Bun.CryptoHasher, no npm package.

/**
 * Azure Communication Services Email.
 * The resource's connection string is the whole setup.
 */
@Service()
export class AzureMailer extends HttpMailer {
	readonly key = "azure";
	readonly label = "Azure Communication Services";
	readonly help_url =
		"https://learn.microsoft.com/azure/communication-services/quickstarts/create-communication-resource#access-your-connection-strings-and-service-endpoints";
	protected readonly maxTries = AZURE_MAX_TRIES;

	/**
	 * The host these credentials make the server connect to.
	 * @param creds The decrypted connection string.
	 * @returns The endpoint's host name.
	 *   Null when the string can't be read or the endpoint is not https.
	 */
	host(creds: Record<string, string>): string | null {
		const url = AzureMailer.parseConnection(creds.connection_string ?? "")?.url;
		return url?.protocol === "https:" ? url.hostname : null;
	}

	/**
	 * The credentials the admin fills in.
	 * A getter, not a field: the labels are translated per request.
	 * @returns The connection string field.
	 */
	get fields(): MailField[] {
		return [
			{
				name: "connection_string",
				label: t("server.mail_field_connection_string"),
				secret: true,
				required: true,
				placeholder: "endpoint=https://….communication.azure.com/;accesskey=…",
			},
		];
	}

	/**
	 * Read the endpoint and access key out of an Azure connection string.
	 * @param conn Like `endpoint=https://x.communication.azure.com/;accesskey=abc==`.
	 * @returns The endpoint URL and the key, or null when one is missing.
	 */
	static parseConnection(conn: string) {
		const parts = new Map<string, string>();
		for (const pair of conn.split(";")) {
			const at = pair.indexOf("=");
			if (at > 0)
				parts.set(
					pair.slice(0, at).trim().toLowerCase(),
					pair.slice(at + 1).trim(),
				);
		}
		const endpoint = parts.get("endpoint");
		const key = parts.get("accesskey");
		if (!endpoint || !key || !URL.canParse(endpoint)) return null;
		return { url: new URL(endpoint), key };
	}

	/**
	 * Sign one request the way Azure wants.
	 * HMAC-SHA256 over verb, path, date, host and body hash.
	 * @param url The full request URL.
	 * @param body The JSON body, exactly as it is sent.
	 * @param key The base64 access key.
	 * @param date The `x-ms-date` value (RFC 1123, UTC).
	 * @returns The headers to send.
	 */
	static signed(url: URL, body: string, key: string, date: string) {
		const hash = new Bun.CryptoHasher("sha256").update(body).digest("base64");
		const toSign = `POST\n${url.pathname}${url.search}\n${date};${url.host};${hash}`;
		const signature = new Bun.CryptoHasher("sha256", Buffer.from(key, "base64"))
			.update(toSign)
			.digest("base64");
		return {
			"Content-Type": "application/json",
			"x-ms-date": date,
			"x-ms-content-sha256": hash,
			Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
		};
	}

	/**
	 * The request for one message, as Azure's Email REST API wants it.
	 * Azure sends only from a MailFrom address added to the domain.
	 * It shows that address's own display name.
	 * So the name in `msg.from` is dropped.
	 * Every try is signed again, with the time of that try.
	 * @param creds The decrypted connection string.
	 * @param msg Sender, recipient, subject and body.
	 * @returns Where to post, the body, and the headers per try.
	 * @throws MailError when the connection string can't be read.
	 */
	protected call(creds: Record<string, string>, msg: MailMessage): MailCall {
		const conn = AzureMailer.parseConnection(creds.connection_string ?? "");
		if (!conn) throw new MailError(t("server.azure_bad_connection"));
		const url = new URL(
			`/emails:send?api-version=${AZURE_EMAIL_API_VERSION}`,
			conn.url,
		);
		const body = JSON.stringify({
			senderAddress: this.#bare(msg.from),
			recipients: { to: [{ address: this.#bare(msg.to) }] },
			content: {
				subject: msg.subject,
				plainText: msg.text,
				...(msg.html && { html: msg.html }),
			},
			...(msg.inline?.length && {
				attachments: msg.inline.map((img) => this.#attachment(img)),
			}),
			...(msg.headers && { headers: msg.headers }),
		});
		return {
			url,
			body,
			headers: () =>
				AzureMailer.signed(url, body, conn.key, new Date().toUTCString()),
		};
	}

	/**
	 * The words for a send Azure refused.
	 * @param data Azure's JSON answer.
	 * @param status The HTTP status.
	 * @returns Azure's own message, else "Azure rejected the email".
	 */
	protected refusal(data: unknown, status: number): string {
		return (
			(data as { error?: { message?: string } } | null)?.error?.message ??
			t("server.azure_rejected", { status })
		);
	}

	/**
	 * Turn an inline image into an Azure attachment.
	 * `contentId` makes it an inline image the HTML shows with `cid:`.
	 * @param img The image.
	 * @returns The attachment, as Azure's API wants it.
	 */
	#attachment(img: InlineImage) {
		return {
			name: img.filename,
			contentType: img.contentType,
			contentInBase64: Buffer.from(img.content).toString("base64"),
			contentId: img.cid,
		};
	}

	/**
	 * The bare address, without the display name.
	 * @param a Like `"Shop" <shop@x.io>` or `shop@x.io`.
	 * @returns `shop@x.io`.
	 */
	#bare(a: string): string {
		return /<([^<>]+)>\s*$/.exec(a)?.[1] ?? a.trim();
	}
}
