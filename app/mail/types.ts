/**
 * A credential input the admin fills in on the email page.
 * A `secret: true` field is stored encrypted (app/helpers/crypto.ts).
 * It is never sent back to the page.
 * Every `required` field must be filled before mail is sent.
 */
export type MailField = {
	name: string;
	label: string;
	secret: boolean;
	required: boolean;
	placeholder?: string;
};

/**
 * An image inside the HTML part (a CID / inline attachment).
 * The HTML shows it with `<img src="cid:<cid>">`.
 * The mail client reads it from the message itself.
 */
export type InlineImage = {
	/** The Content-ID, without angle brackets, e.g. `item-0@pos`. */
	cid: string;
	/** A file name, e.g. `item-0.jpg`. */
	filename: string;
	/** The MIME type, e.g. `image/jpeg`. */
	contentType: string;
	/** The image bytes. */
	content: Uint8Array;
};

/**
 * One email, ready for a provider to deliver.
 */
export type MailMessage = {
	from: string;
	to: string;
	subject: string;
	text: string;
	html?: string;
	/** Images the HTML shows by `cid:`. */
	inline?: InlineImage[];
	/** Extra header lines (ASCII), for example `List-Unsubscribe`. */
	headers?: Record<string, string>;
};

/**
 * Thrown by mailers for failures a person may read.
 * Auth refused, host unreachable, the provider said no.
 */
export class MailError extends Error {}

/**
 * One mail provider: what the admin fills in, and how it sends.
 */
export type Mailer = {
	key: string;
	label: string;
	/**
	 * Where the admin finds these credentials.
	 * Providers only: plain SMTP has no such page.
	 */
	help_url?: string;
	/** A warning shown on the provider's card, already translated. */
	note?: string;
	fields: MailField[];
	/**
	 * The host these credentials make the server connect to.
	 * Only for a mailer whose host the admin types (SMTP, Azure).
	 * Null = the host can't be read, so nothing may be sent.
	 */
	host?(creds: Record<string, string>): string | null;
	send(creds: Record<string, string>, msg: MailMessage): Promise<void>;
};
