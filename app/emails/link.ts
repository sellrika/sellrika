import { t } from "@xcore/i18n/I18n";
import { edge } from "@xcore/view/Edge";
// embedded at compile time, so it works inside the single binary too
import linkTemplate from "@resources/views/emails/link.edge" with {
	type: "text",
};

edge.registerTemplate("emails/link", { template: linkTemplate });

/**
 * The texts of an email with one link button.
 * The plain-text part has them in the same order.
 */
export type LinkTexts = {
	link: string;
	heading: string;
	intro: string;
	button: string;
	expires: string;
};

/**
 * Render an email with one link button.
 * The invitation, the sign-up confirmation, "forgot password".
 * @param texts The link and the texts around it.
 * @returns The plain-text and HTML parts.
 */
export async function linkEmail(texts: LinkTexts) {
	const text = [
		texts.heading,
		"",
		texts.intro,
		"",
		texts.link,
		"",
		texts.expires,
		t("mail.no_reply"),
	].join("\n");
	const html = await edge.render("emails/link", { t, ...texts });
	return { text, html };
}
