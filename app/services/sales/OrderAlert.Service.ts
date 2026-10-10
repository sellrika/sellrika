import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import type { OrderFull } from "@models/Order";
import type { Shop } from "@models/Shop";
import { decrypt } from "@helpers/crypto";
import { ShopRepository } from "@repositories/Shop.Repository";
import { MailService } from "@services/settings/Mail.Service";
import { TELEGRAM_API } from "@constants/Store.Constant";
import { OrderAlertEmail } from "@emails/OrderAlert.Email";

/**
 * "You have a new order".
 * Sent to the shop owner by email and/or Telegram,
 * right after an online checkout.
 */
@Service()
export class OrderAlertService {
	constructor(
		private shops: ShopRepository,
		private mail: MailService,
	) {}

	/**
	 * Send the alert on every channel the shop switched on.
	 * Best effort: never throws, and the checkout never awaits it.
	 * A slow mail server or a Telegram outage must not hold up the
	 * buyer's "thank you" page.
	 * @param shop The selling shop.
	 *   Its `alert_email` / `telegram_chat_id` say where.
	 * @param order The order, with its lines.
	 */
	async notify(shop: Shop, order: OrderFull): Promise<void> {
		const alert = new OrderAlertEmail(shop.alert_email ?? "", shop, order);
		await Promise.all([
			shop.alert_email && this.#email(order, alert),
			shop.telegram_chat_id && this.#telegram(shop, order, alert.text()),
		]);
	}

	/**
	 * Send the alert email, and log why when it did not go out.
	 * Email that is simply off is not worth a log line.
	 * @param order The order (for the log line).
	 * @param alert The email.
	 */
	async #email(order: OrderFull, alert: OrderAlertEmail) {
		const err = await this.mail.send(alert);
		if (err && err !== t("server.mail_not_set_up"))
			console.warn(`[alert] order #${order.id} email: ${err}`);
	}

	/**
	 * One Bot API `sendMessage` call.
	 * It uses the shop's stored (encrypted) bot token.
	 * @param shop The selling shop.
	 * @param order The order (for the log line).
	 * @param text The message.
	 */
	async #telegram(shop: Shop, order: OrderFull, text: string) {
		try {
			const box = await this.shops.alertToken(shop.id);
			if (!box) return;
			const res = await fetch(
				`${TELEGRAM_API}/bot${decrypt(box)}/sendMessage`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ chat_id: shop.telegram_chat_id, text }),
				},
			);
			if (!res.ok)
				console.warn(
					`[alert] order #${order.id} telegram: HTTP ${res.status} ${await res.text()}`,
				);
		} catch (e) {
			console.warn(`[alert] order #${order.id} telegram:`, e);
		}
	}
}
