import { Service } from "@xcore/di";
import type { Mailer } from "./types";
import { AzureMailer } from "./azure/Azure.Mailer";
import { ResendMailer } from "./resend/Resend.Mailer";
import { SmtpMailer } from "./smtp/Smtp.Mailer";

/**
 * Mail provider registry.
 * To add one (Postmark, SES, …):
 * create `app/mail/<name>/<Name>.Mailer.ts` implementing `Mailer`.
 * Its API client lives in the same file: plain fetch, no npm deps.
 * A provider reached over HTTPS extends `HttpMailer`.
 * Then inject it here.
 * Storage, the settings UI and sending all follow.
 */
@Service()
export class MailerRegistry {
	private readonly mailers: Mailer[];

	constructor(smtp: SmtpMailer, resend: ResendMailer, azure: AzureMailer) {
		this.mailers = [smtp, resend, azure];
	}

	/**
	 * Every registered mailer.
	 * @returns The mailers, in registration order.
	 */
	all(): Mailer[] {
		return this.mailers;
	}

	/**
	 * One mailer by the key stored in the `mail` setting.
	 * @param key The provider key ("" = email off).
	 * @returns The mailer, or undefined when the key is empty or no longer exists.
	 */
	get(key: string): Mailer | undefined {
		return this.mailers.find((m) => m.key === key);
	}

	/**
	 * Mailer metadata for the settings UI.
	 * Definitions only, never credentials.
	 * @returns One `{ key, label, help_url, note, fields }` per mailer.
	 */
	meta() {
		return this.mailers.map(({ key, label, help_url, note, fields }) => ({
			key,
			label,
			help_url: help_url ?? null,
			note: note ?? null,
			fields,
		}));
	}
}
