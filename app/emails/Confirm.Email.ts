import { t } from "@xcore/i18n/I18n";
import { INVITE_TTL_DAYS } from "@constants/Auth.Constant";
import { LinkEmail } from "./Link.Email";
import type { LinkTexts } from "./link";

/**
 * The sign-up confirmation.
 * A new owner opens the link to start using the app.
 */
export class ConfirmEmail extends LinkEmail {
	/**
	 * @param to The new owner's email.
	 * @param name Their name, for the greeting.
	 * @param link The confirmation link.
	 */
	constructor(
		to: string,
		private name: string,
		link: string,
	) {
		super(to, link);
	}

	/**
	 * The subject line.
	 * @returns "Confirm your email".
	 */
	protected subject(): string {
		return t("mail.confirm_subject");
	}

	/**
	 * The texts around the link.
	 * @returns Heading, intro, button label and the "expires" line.
	 */
	protected texts(): Omit<LinkTexts, "link"> {
		return {
			heading: t("mail.confirm_hello", { name: this.name }),
			intro: t("mail.confirm_intro"),
			button: t("mail.confirm_button"),
			expires: t("mail.invite_expires", { days: INVITE_TTL_DAYS }),
		};
	}
}
