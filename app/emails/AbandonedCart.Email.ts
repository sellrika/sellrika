import { t } from "@xcore/i18n/I18n";
import type { Shop } from "@models/Shop";
import type { StoreCart } from "@repositories/StoreCart.Repository";
import type { InlineImage } from "@mail/types";
import { MAIL_ITEM_IMAGE_PX } from "@constants/Mail.Constant";
import { inlineLogo, inlinePicture } from "./pictures";
import { mailMoney, marketingEmail } from "./marketing";
import type { EmailContent, Mailable } from "./types";

/**
 * "You left something in your cart": sent once, some hours after a checkout
 * that never became an order. Lists the items and the total, and links back
 * to the store with the cart filled in again. Comes from the shop's name.
 */
export class AbandonedCartEmail implements Mailable {
	fromShop: Shop;

	/**
	 * @param to The buyer's email.
	 * @param shop The shop they were buying from.
	 * @param cart The cart snapshot taken at the checkout.
	 * @param links The "Complete your order" link and the unsubscribe link.
	 */
	constructor(
		public to: string,
		private shop: Shop,
		private cart: StoreCart,
		private links: { restore: string; unsubscribe: string },
	) {
		this.fromShop = shop;
	}

	/**
	 * Build the email, in the language of the current request.
	 * @returns Subject, text, html, headers and the pictures.
	 */
	async build(): Promise<EmailContent> {
		const shop = this.shop;
		const cart = this.cart;
		const inline: InlineImage[] = [];
		const logo = await inlineLogo(inline, shop);
		const items = [];
		for (const [i, line] of cart.payload.items.entries())
			items.push({
				title: `${line.qty} × ${line.name}`,
				amount: mailMoney(line.price * line.qty, shop.currency),
				image: await inlinePicture(
					inline,
					line.image,
					`item-${i}`,
					MAIL_ITEM_IMAGE_PX,
				),
			});
		const name = cart.payload.customer?.name?.trim();
		const content = await marketingEmail({
			subject: t("marketing.abandoned_subject", { shop: shop.name }),
			shop: { name: shop.name, logo },
			heading: name
				? t("marketing.abandoned_heading_named", { name })
				: t("marketing.abandoned_heading"),
			intro: t("marketing.abandoned_intro"),
			html: null,
			items,
			total: mailMoney(cart.payload.total, shop.currency),
			button: { label: t("marketing.complete_order"), url: this.links.restore },
			products: [],
			unsubscribe: this.links.unsubscribe,
		});
		return { ...content, inline };
	}
}
