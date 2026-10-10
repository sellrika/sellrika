import { t } from "@xcore/i18n/I18n";
import { OrderEmail, type OrderParts } from "./Order.Email";

/**
 * The "on its way" notice, sent once when the shop marks the order shipped.
 * The same recap as the confirmation, with the tracking number.
 */
export class OrderShippedEmail extends OrderEmail {
	/**
	 * The parts that differ from the confirmation.
	 * @returns Subject, greeting, intro, payment line and tracking.
	 */
	protected override parts(): OrderParts {
		const { order } = this;
		const buyer = this.buyer();
		return {
			subject: t("mail.subject_shipped", {
				code: this.code(),
				shop: this.shop.name,
			}),
			hello: buyer
				? t("mail.shipped_hello_named", { name: buyer })
				: t("mail.shipped_hello"),
			intro: order.tracking
				? t("mail.intro_shipped_tracking", { tracking: order.tracking })
				: t("mail.intro_shipped"),
			payment: this.paymentLine(),
			tracking: order.tracking || null,
		};
	}
}
