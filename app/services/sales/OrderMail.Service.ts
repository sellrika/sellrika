import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { OrderFull } from "@models/Order";
import type { Shop } from "@models/Shop";
import { UserRepository } from "@repositories/User.Repository";
import { MailService } from "@services/settings/Mail.Service";
import { OrderEmail } from "@emails/Order.Email";
import { OrderShippedEmail } from "@emails/OrderShipped.Email";
import type { Mailable } from "@emails/types";

/**
 * Order emails to the buyer.
 * Sends them without ever breaking the checkout or the order page.
 * The wording is in app/emails.
 */
@Service()
export class OrderMailService {
	constructor(
		private users: UserRepository,
		private mail: MailService,
	) {}

	/**
	 * Where customers should write.
	 * The shop's own support address, else its owner's account email.
	 * @param shop The selling shop.
	 * @returns The address, or null when there is none.
	 *   A missing owner never breaks the confirmation.
	 */
	async supportEmail(shop: Shop) {
		if (shop.support_email?.trim()) return shop.support_email.trim();
		try {
			return (await this.users.find(shop.owner_id))?.email ?? null;
		} catch {
			// a missing owner is no reason to drop the whole confirmation
			return null;
		}
	}

	/**
	 * Send the order confirmation (`OrderEmail`).
	 * @param shop The selling shop.
	 * @param order The order, with its lines.
	 * @param to The buyer's email address.
	 * @param buyer The buyer's name, for the greeting.
	 * @param instructions Payment instructions for an unpaid order.
	 * @param pickup True when the buyer picks the order up in store.
	 * @returns The reason it didn't go out, or null on success.
	 */
	async sendOrderConfirmation(
		shop: Shop,
		order: OrderFull,
		to: string,
		buyer?: string | null,
		instructions?: string | null,
		pickup = false,
	) {
		const support = await this.supportEmail(shop);
		return this.#deliver(
			order,
			new OrderEmail(to, shop, order, {
				buyer,
				support,
				instructions,
				pickup,
			}),
		);
	}

	/**
	 * Send the "on its way" notice (`OrderShippedEmail`).
	 * @param shop The selling shop.
	 * @param order The order, with its lines and tracking.
	 * @param to The buyer's email address.
	 * @param buyer The buyer's name, for the greeting.
	 * @returns The reason it didn't go out, or null on success.
	 */
	async sendShipped(
		shop: Shop,
		order: OrderFull,
		to: string,
		buyer?: string | null,
	) {
		const support = await this.supportEmail(shop);
		return this.#deliver(
			order,
			new OrderShippedEmail(to, shop, order, { buyer, support }),
		);
	}

	/**
	 * Send one order email.
	 * Best effort: never throws.
	 * So a mail problem can't break the customer's "thank you" page
	 * or the order screen.
	 * Silent no-op when email isn't set up.
	 * @param order The order (for the log line).
	 * @param email The email to send.
	 * @returns The reason it didn't go out, or null on success.
	 */
	async #deliver(order: OrderFull, email: Mailable) {
		const to = email.to;
		try {
			const error = await this.mail.send(email);
			if (error && error !== t("server.mail_not_set_up"))
				console.warn(`[mail] order #${order.id} to ${to}: ${error}`);
			return error;
		} catch (e) {
			console.warn(`[mail] order #${order.id} to ${to}:`, e);
			return e instanceof Error ? e.message : t("server.mail_send_failed");
		}
	}
}
