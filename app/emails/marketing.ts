import { Url } from "@xcore/http/Url";
import { I18n, t } from "@xcore/i18n/I18n";
import { edge } from "@xcore/view/Edge";
import type { Shop } from "@models/Shop";
import { unsubscribeToken } from "@helpers/crypto";
import { stripTags } from "@helpers/html";
import { formatMoney } from "@helpers/currency";
import type { EmailContent } from "./types";
// embedded at compile time, so it works inside the single binary too
import marketingTemplate from "@resources/views/emails/marketing.edge" with {
	type: "text",
};

edge.registerTemplate("emails/marketing", { template: marketingTemplate });

/**
 * One line of the abandoned cart.
 * "2 × Mug", its amount, its `cid:` picture.
 */
export type MarketingItem = {
	title: string;
	amount: string;
	image: string | null;
};

/** One product card of a campaign. */
export type MarketingProduct = {
	name: string;
	price: string;
	image: string | null;
	url: string;
};

/**
 * Everything a marketing email shows.
 * Parts a kind does not use are empty.
 */
export type MarketingView = {
	subject: string;
	shop: { name: string; logo: string | null };
	heading: string;
	intro: string;
	/** The owner's rich text (campaigns); null = none. */
	html: string | null;
	items: MarketingItem[];
	total: string | null;
	button: { label: string; url: string } | null;
	products: MarketingProduct[];
	/** The link that stops the shop's marketing emails to this address. */
	unsubscribe: string;
};

/**
 * The absolute address of a shop's store, for links in an email.
 * Its own domain, else `<slug>.<STORE_DOMAIN>` (`Url.storeOrigin`).
 * @param shop The shop.
 * @returns The URL, without a trailing slash.
 */
export function storeUrl(shop: Pick<Shop, "domain" | "slug">) {
	return Url.storeOrigin(shop);
}

/**
 * The unsubscribe link of one address at one shop.
 * @param shop The shop.
 * @param email The recipient.
 * @returns The absolute URL of the store's unsubscribe page.
 */
export function unsubscribeUrl(
	shop: Pick<Shop, "id" | "domain" | "slug">,
	email: string,
) {
	return `${storeUrl(shop)}/unsubscribe/${unsubscribeToken(shop.id, email)}`;
}

/**
 * An amount in the shop's currency, in the current language.
 * @param cents The amount in cents.
 * @param currency The ISO currency code.
 * @returns For example "$18" or "$18.23".
 */
export function mailMoney(cents: number, currency: string) {
	return formatMoney(cents, currency, I18n.current());
}

/**
 * The plain-text part.
 * The same content as the HTML, one block per paragraph.
 * @param v The email's view.
 * @returns The text.
 */
function plainText(v: MarketingView) {
	const lines: string[] = [];
	if (v.heading) lines.push(v.heading, "");
	if (v.intro) lines.push(v.intro, "");
	if (v.html) lines.push(stripTags(v.html).trim(), "");
	for (const i of v.items) lines.push(`${i.title}   ${i.amount}`);
	if (v.total) lines.push(`${t("mail.total")}: ${v.total}`, "");
	for (const p of v.products) lines.push(`${p.name} — ${p.price}`, p.url, "");
	if (v.button) lines.push(`${v.button.label}: ${v.button.url}`, "");
	lines.push(
		`${t("marketing.why_you_get_this", { shop: v.shop.name })} ${t("marketing.unsubscribe")}: ${v.unsubscribe}`,
		`— ${v.shop.name}`,
	);
	return lines.join("\n");
}

/**
 * Render a marketing email: text, HTML and the one-click unsubscribe headers.
 * @param v The email's view.
 * @returns Subject, text, html and headers (the caller adds the pictures).
 */
export async function marketingEmail(v: MarketingView): Promise<EmailContent> {
	return {
		subject: v.subject,
		text: plainText(v),
		html: await edge.render("emails/marketing", { t, ...v }),
		headers: {
			"List-Unsubscribe": `<${v.unsubscribe}>`,
			// RFC 8058: the mail app may POST to the link itself, no page needed
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	};
}
