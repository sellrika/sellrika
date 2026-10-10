import { t } from "@xcore/i18n/I18n";
import { edge } from "@xcore/view/Edge";
import { app } from "@config/app";
import type { OrderFull } from "@models/Order";
import type { Shop } from "@models/Shop";
import { mailMoney } from "./marketing";
import type { EmailContent, Mailable } from "./types";
// embedded at compile time, so it works inside the single binary too
import alertTemplate from "@resources/views/emails/order-alert.edge" with {
	type: "text",
};

edge.registerTemplate("emails/order-alert", { template: alertTemplate });

/**
 * Everything the alert shows.
 * The template and the plain text are both built from it.
 */
type AlertView = {
	heading: string;
	summary: string;
	items: string[];
	note: string | null;
	link: string | null;
	button: string;
};

/**
 * "You have a new order".
 * To the shop's alert address, right after an online checkout.
 * It goes to the shop's staff, so it comes from the app, not from the shop.
 * Its plain text is also the Telegram message (`text()`).
 */
export class OrderAlertEmail implements Mailable {
	fromShop = null;

	/**
	 * @param to The shop's alert address.
	 * @param shop The selling shop.
	 * @param order The order, with its lines.
	 * Its `note` already carries the delivery details.
	 */
	constructor(
		public to: string,
		private shop: Shop,
		private order: OrderFull,
	) {}

	/**
	 * The alert as plain text.
	 * It is the email's text part and the Telegram message.
	 * The first line doubles as the subject.
	 * @returns The message.
	 */
	text(): string {
		const v = this.#view();
		const lines = [v.heading, v.summary, "", ...v.items];
		if (v.note) lines.push("", v.note);
		if (v.link) lines.push("", v.link);
		return lines.join("\n");
	}

	/**
	 * Build the email.
	 * @returns Subject (the first line), text and html.
	 */
	async build(): Promise<EmailContent> {
		const view = this.#view();
		return {
			subject: view.heading,
			text: this.text(),
			html: await edge.render("emails/order-alert", { t, ...view }),
		};
	}

	/**
	 * What the alert shows, ready for the text and the template.
	 * @returns The view.
	 */
	#view(): AlertView {
		const shop = this.shop;
		const order = this.order;
		const code = order.reference ?? `#${order.id}`;
		const total = mailMoney(order.total, shop.currency);
		const method = order.payment_method;
		const paid =
			order.payment_status === "paid"
				? t("mail.paid_with", { method })
				: t("mail.alert_unpaid", { method });
		return {
			heading: t("mail.alert_new_order", { code, shop: shop.name }),
			summary: `${total} · ${paid}`,
			items: order.items.map(function line(i) {
				const line = `${i.qty} × ${i.name}`;
				return i.note ? `${line} — ${i.note}` : line;
			}),
			note: order.note || null,
			link: app.url ? `${app.url.replace(/\/$/, "")}/orders/${order.id}` : null,
			button: t("orders.open_order", { id: code }),
		};
	}
}
