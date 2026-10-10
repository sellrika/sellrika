import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { CustomerRepository } from "@repositories/Customer.Repository";
import { MailService } from "@services/settings/Mail.Service";
import { NoteEmail } from "@emails/Note.Email";
import type { Shop } from "@models/Shop";
import {
	EXTENSION_MAIL_SUBJECT_MAX,
	EXTENSION_MAIL_TEXT_MAX,
} from "@constants/Extension.Constant";

/**
 * A note an extension sends: a subject and plain text.
 */
export type ExtensionNote = { subject: string; text: string };

/**
 * Email from an extension (`ctx.mail`).
 * An extension can write only to a customer of its own shop, by id.
 * It never gets to pick an address.
 */
@Service()
export class ExtensionMail {
	constructor(
		private mail: MailService,
		private customers: CustomerRepository,
	) {}

	/**
	 * The `mail` handle of one shop.
	 * @param shop The shop.
	 * @returns `customer(id, note)`.
	 */
	for(shop: Shop) {
		return {
			customer: (id: number, note: ExtensionNote) =>
				this.#toCustomer(shop, Number(id), note),
		};
	}

	/**
	 * Send a note to one customer of the shop.
	 * It never throws.
	 * @param shop The shop that sends it.
	 * @param id The customer.
	 * @param note The subject and the text.
	 * @returns Null when it was sent, else why not.
	 */
	async #toCustomer(shop: Shop, id: number, note: ExtensionNote) {
		const subject = String(note?.subject ?? "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, EXTENSION_MAIL_SUBJECT_MAX);
		const text = String(note?.text ?? "")
			.trim()
			.slice(0, EXTENSION_MAIL_TEXT_MAX);
		if (!subject || !text) return t("server.ext_mail_empty");
		const customer = await this.customers.find(id, shop.id);
		if (!customer?.email) return t("server.ext_mail_no_email");
		// they asked the shop for no more email
		if (customer.unsubscribed) return t("server.ext_mail_unsubscribed");
		return this.mail.send(new NoteEmail(customer.email, shop, subject, text));
	}
}
