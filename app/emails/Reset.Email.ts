import { t } from "@xcore/i18n/I18n";
import { RESET_TTL_HOURS } from "@constants/Auth.Constant";
import { LinkEmail } from "./Link.Email";
import type { LinkTexts } from "./link";

/**
 * "Forgot password": a link to pick a new password.
 */
export class ResetEmail extends LinkEmail {
	/**
	 * @param to The email of the account.
	 * @param name The person's name, for the greeting.
	 * @param link The link to the page with the new password.
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
	 * @returns "Choose a new password".
	 */
	protected subject(): string {
		return t("mail.reset_subject");
	}

	/**
	 * The texts around the link.
	 * @returns Heading, intro, button label and the "expires" line.
	 */
	protected texts(): Omit<LinkTexts, "link"> {
		return {
			heading: t("mail.reset_hello", { name: this.name }),
			intro: t("mail.reset_intro"),
			button: t("mail.reset_button"),
			expires: t("mail.reset_expires", { minutes: RESET_TTL_HOURS * 60 }),
		};
	}
}
