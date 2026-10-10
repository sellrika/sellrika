import type { Shop } from "@models/Shop";
import type { Campaign } from "@models/Campaign";
import type { InlineImage } from "@mail/types";
import { MAIL_ITEM_IMAGE_PX } from "@constants/Mail.Constant";
import { inlineHtmlPictures, inlineLogo, inlinePicture } from "./pictures";
import {
	type MarketingProduct,
	mailMoney,
	marketingEmail,
	storeUrl,
} from "./marketing";
import type { EmailContent, Mailable } from "./types";

/** A product card as the campaign email needs it. */
export type CampaignProduct = {
	name: string;
	price: number;
	slug: string;
	image: string | null;
};

/**
 * The parts of a campaign email that are the same for every recipient,
 * with every picture already inside the email (CID).
 */
export type CampaignParts = {
	subject: string;
	logo: string | null;
	html: string | null;
	products: MarketingProduct[];
	inline: InlineImage[];
};

/**
 * One campaign email: the owner's subject and text, the product cards,
 * the shop logo and the unsubscribe footer. Comes from the shop's name.
 * The frame texts are in the language the caller runs it in
 * (the shop's default store language).
 */
export class CampaignEmail implements Mailable {
	fromShop: Shop;

	/**
	 * @param to The recipient.
	 * @param shop The shop sending it.
	 * @param parts The shared parts from `CampaignEmail.parts()`.
	 * @param unsubscribe The recipient's unsubscribe link.
	 */
	constructor(
		public to: string,
		shop: Shop,
		private parts: CampaignParts,
		private unsubscribe: string,
	) {
		this.fromShop = shop;
	}

	/**
	 * Build the email.
	 * @returns Subject, text, html, headers and the pictures.
	 */
	async build(): Promise<EmailContent> {
		const parts = this.parts;
		const content = await marketingEmail({
			subject: parts.subject,
			shop: { name: this.fromShop.name, logo: parts.logo },
			heading: "",
			intro: "",
			html: parts.html,
			items: [],
			total: null,
			button: null,
			products: parts.products,
			unsubscribe: this.unsubscribe,
		});
		return { ...content, inline: parts.inline };
	}

	/**
	 * Read, shrink and inline every picture of a campaign once:
	 * the shop logo, the product cards and the pictures in the owner's text.
	 * The email carries its own copies.
	 * So a picture deleted later never shows broken.
	 * Call it once per send, not once per recipient.
	 * @param shop The shop sending it.
	 * @param campaign The campaign (subject and sanitised body).
	 * @param cards The product cards, in order.
	 * @returns The parts every recipient's email shares.
	 */
	static async parts(
		shop: Shop,
		campaign: Pick<Campaign, "subject" | "body">,
		cards: CampaignProduct[],
	): Promise<CampaignParts> {
		const inline: InlineImage[] = [];
		const logo = await inlineLogo(inline, shop);
		const store = storeUrl(shop);
		const products: MarketingProduct[] = [];
		for (const [i, p] of cards.entries())
			products.push({
				name: p.name,
				price: mailMoney(p.price, shop.currency),
				url: `${store}/p/${p.slug}`,
				image: await inlinePicture(
					inline,
					p.image,
					`product-${i}`,
					MAIL_ITEM_IMAGE_PX,
				),
			});
		const html = campaign.body
			? await inlineHtmlPictures(campaign.body, inline, MAIL_ITEM_IMAGE_PX)
			: null;
		return { subject: campaign.subject, logo, html, products, inline };
	}
}
