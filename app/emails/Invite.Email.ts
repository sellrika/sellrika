import { t } from "@xcore/i18n/I18n";
import { INVITE_TTL_DAYS } from "@constants/Auth.Constant";
import { LinkEmail } from "./Link.Email";
import type { LinkTexts } from "./link";

/**
 * The invitation to a new shop owner.
 * A link to pick their own name and password.
 */
export class InviteEmail extends LinkEmail {
	/**
	 * @param to The new owner's email.
	 * @param shop The name of the shop made for them.
	 * @param link The invitation link.
	 */
	constructor(
		to: string,
		private shop: string,
		link: string,
	) {
		super(to, link);
	}

	/**
	 * The subject line.
	 * @returns The subject, with the shop's name.
	 */
	protected subject(): string {
		return t("mail.invite_subject", { shop: this.shop });
	}

	/**
	 * The texts around the link.
	 * @returns Heading, intro, button label and the "expires" line.
	 */
	protected texts(): Omit<LinkTexts, "link"> {
		return {
			heading: t("mail.invite_hello"),
			intro: t("mail.invite_intro", { shop: this.shop }),
			button: t("mail.invite_button"),
			expires: t("mail.invite_expires", { days: INVITE_TTL_DAYS }),
		};
	}
}
