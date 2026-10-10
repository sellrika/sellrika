import { Url } from "@xcore/http/Url";
import { I18n, t } from "@xcore/i18n/I18n";
import { edge } from "@xcore/view/Edge";
import { mailMoney } from "./marketing";
import type { OrderFull } from "@models/Order";
import type { Shop } from "@models/Shop";
import { dbDate } from "@helpers/time";
import { taxLabel } from "@helpers/tax";
import { inlineLogo, inlinePicture } from "./pictures";
import { MAIL_ITEM_IMAGE_PX } from "@constants/Mail.Constant";
import type { InlineImage } from "@mail/types";
import type { EmailContent, Mailable } from "./types";
// embedded at compile time, so it works inside the single binary too
import orderTemplate from "@resources/views/emails/order.edge" with {
	type: "text",
};

edge.registerTemplate("emails/order", { template: orderTemplate });

/**
 * The emails an online order sends to the buyer, in the shop's name.
 * The confirmation right after checkout: paid, or "please pay by …"
 * for cash on delivery / bank transfer.
 * And the "on its way" notice (OrderShipped.Email.ts).
 * One template (resources/views/emails/order.edge) renders both.
 * The plain text is built from the same view.
 */

/**
 * What varies between the order emails.
 * Everything else (items, totals, address, footer) is the same.
 */
export type OrderParts = {
	subject: string;
	hello: string;
	intro: string;
	payment: string;
	instructions?: string | null;
	tracking?: string | null;
};

/** What else an order email needs besides the shop and the order. */
export type OrderEmailOptions = {
	/** The buyer's name, for the greeting. */
	buyer?: string | null;
	/**
	 * Where the buyer should write.
	 * The shop's support address or its owner's email.
	 * Null = no line.
	 */
	support?: string | null;
	/** How to pay (bank details…), for an unpaid order. */
	instructions?: string | null;
	/**
	 * True when the buyer picks the order up in store.
	 * Nothing is on its way then.
	 */
	pickup?: boolean;
};

/**
 * One order line, ready to show.
 * "2 × Rattan Basket", the unit price when above 1, the line total.
 * And its picture (a `cid:` link, or null).
 */
type ItemRow = {
	title: string;
	each: string;
	/** "Your request: …" — the buyer's custom request, "" = none. */
	note: string;
	amount: string;
	image: string | null;
};

/**
 * The pictures the email carries inside itself.
 * And the `cid:` links the template shows them by.
 */
type Pictures = {
	logo: string | null;
	items: (string | null)[];
	inline: InlineImage[];
};

/** One line of the totals block; `strong` = the grand total. */
type TotalRow = { label: string; amount: string; strong: boolean };

/**
 * Everything the email shows.
 * The template and the plain text are both built from it.
 */
type OrderView = OrderParts & {
	shop: { name: string; logo: string | null };
	code: string;
	number: string;
	date: string;
	items: ItemRow[];
	totals: TotalRow[];
	paid: boolean;
	note: string | null;
	track: string | null;
	support: string | null;
};

/**
 * The order confirmation sent right after checkout.
 * A paid order is a receipt.
 * A manual one (cash on delivery, bank transfer) says how to pay.
 * It carries the shop's instructions.
 */
export class OrderEmail implements Mailable {
	fromShop: Shop;

	/**
	 * @param to The buyer's email.
	 * @param shop The selling shop (its name, currency, timezone and logo).
	 * @param order The order, with its lines.
	 * @param options The buyer's name, the support address
	 * and the payment instructions.
	 */
	constructor(
		public to: string,
		protected shop: Shop,
		protected order: OrderFull,
		protected options: OrderEmailOptions = {},
	) {
		this.fromShop = shop;
	}

	/**
	 * Build the email.
	 * @returns Subject, text, html and the pictures the html shows by `cid:`.
	 */
	async build(): Promise<EmailContent> {
		const pictures = await this.#pictures();
		const view = this.#view(pictures);
		return {
			subject: view.subject,
			text: OrderEmail.#plainText(view),
			html: await edge.render("emails/order", { t, ...view }),
			inline: pictures.inline,
		};
	}

	/**
	 * The parts that differ per email. `OrderShippedEmail` gives its own.
	 * @returns Subject, greeting, intro, payment line and instructions.
	 */
	protected parts(): OrderParts {
		const { order } = this;
		const buyer = this.buyer();
		const paid = order.payment_status === "paid";
		return {
			subject: t("mail.subject_order", {
				code: this.code(),
				shop: this.shop.name,
			}),
			hello: buyer ? t("mail.hello_named", { name: buyer }) : t("mail.hello"),
			intro: paid
				? t("mail.intro_paid")
				: t(
						this.options.pickup
							? "mail.intro_unpaid_pickup"
							: "mail.intro_unpaid",
						{ method: order.payment_method },
					),
			payment: this.paymentLine(),
			instructions: paid ? null : this.options.instructions,
		};
	}

	/**
	 * The buyer's name, for the greeting.
	 * @returns The trimmed name, or "" when there is none.
	 */
	protected buyer() {
		return this.options.buyer?.trim() ?? "";
	}

	/**
	 * What the buyer calls the order: its public code.
	 * Rows older than migration 0036 fall back to the number.
	 * @returns For example "P8J4-MJSQ-4Z8T".
	 */
	protected code() {
		return this.order.reference ?? `#${this.order.id}`;
	}

	/**
	 * The payment line: "Paid with …", or "To pay by …" for an unpaid order.
	 * @returns The line.
	 */
	protected paymentLine() {
		const method = this.order.payment_method;
		return this.order.payment_status === "paid"
			? t("mail.paid_with", { method })
			: t("mail.to_pay_by", { method });
	}

	/**
	 * An amount in the shop's currency, in the current language.
	 * @param cents The amount in cents.
	 * @returns For example "THB 1,900" or "THB 12.50".
	 * A whole amount has no ".00".
	 */
	#money(cents: number) {
		return mailMoney(cents, this.shop.currency);
	}

	/**
	 * When the order was placed, in the shop's time zone.
	 * @returns For example "Aug 26, 2026, 11:15 AM".
	 */
	#date() {
		return new Intl.DateTimeFormat(I18n.current(), {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: this.shop.timezone,
		}).format(dbDate(this.order.created_at));
	}

	/**
	 * Read the shop logo and each line's picture, to send inside the email (CID).
	 * The line pictures were saved on the order when it was placed.
	 * So a later change to the product does not change them.
	 * @returns The `cid:` links and the files to attach.
	 */
	async #pictures(): Promise<Pictures> {
		const inline: InlineImage[] = [];
		const logo = await inlineLogo(inline, this.shop);
		const items: (string | null)[] = [];
		for (const [i, line] of this.order.items.entries())
			items.push(
				await inlinePicture(
					inline,
					line.image,
					`item-${i}`,
					MAIL_ITEM_IMAGE_PX,
				),
			);
		return { logo, items, inline };
	}

	/**
	 * The link to the store's "Track your order" page.
	 * The store is at its own domain, else at `<slug>.<STORE_DOMAIN>`.
	 * @returns The URL, or null when the store's address or the code is unknown.
	 */
	#trackUrl() {
		const { shop, order } = this;
		if (!order.reference || (!shop.domain && !shop.slug)) return null;
		return `${Url.storeOrigin(shop)}/track?code=${order.reference}`;
	}

	/**
	 * The order lines.
	 * Quantity first: "2 × Rattan Basket" reads like the receipt.
	 * The unit price only matters above 1.
	 * @param images Each line's `cid:` link (or null), in order.
	 * @returns One row per line.
	 */
	#itemRows(images: (string | null)[]): ItemRow[] {
		const rows: ItemRow[] = [];
		for (const [n, i] of this.order.items.entries())
			rows.push({
				title: `${i.qty} × ${i.name}`,
				each: i.qty > 1 ? t("mail.each", { amount: this.#money(i.price) }) : "",
				note: i.note ? `${t("store_ui.custom_request")}: ${i.note}` : "",
				amount: this.#money(i.price * i.qty),
				image: images[n] ?? null,
			});
		return rows;
	}

	/**
	 * The totals block.
	 * Subtotal, then discount, tax and delivery when there are any.
	 * Then the total.
	 * A free-delivery code shows as a "free" delivery line.
	 * @returns The rows, in order.
	 */
	#totalRows(): TotalRow[] {
		const { order } = this;
		const code = order.coupon_code;
		const rows: TotalRow[] = [];
		/**
		 * Add one row.
		 * @param label The row's name.
		 * @param amount The shown amount.
		 * @param strong True for the grand total.
		 */
		function add(label: string, amount: string, strong = false) {
			rows.push({ label, amount, strong });
		}
		add(t("mail.subtotal"), this.#money(order.subtotal));
		if (order.discount)
			add(
				code ? t("mail.discount_code", { code }) : t("mail.discount"),
				`− ${this.#money(order.discount)}`,
			);
		if (order.tax)
			add(
				taxLabel(order, t("common.tax_included_prefix")),
				this.#money(order.tax),
			);
		if (order.delivery_fee)
			add(t("mail.delivery"), this.#money(order.delivery_fee));
		else if (code && !order.discount)
			add(t("mail.delivery_code", { code }), t("mail.free"));
		add(t("mail.total"), this.#money(order.total), true);
		return rows;
	}

	/**
	 * Everything the email shows: the parts around the order recap.
	 * @param pictures The logo and line pictures, as `cid:` links.
	 * @returns The view.
	 */
	#view(pictures: Pictures): OrderView {
		const code = this.code();
		const parts = this.parts();
		return {
			...parts,
			instructions: parts.instructions ?? null,
			tracking: parts.tracking ?? null,
			shop: { name: this.shop.name, logo: pictures.logo },
			code,
			number: t("mail.order_number", { code }),
			date: this.#date(),
			items: this.#itemRows(pictures.items),
			totals: this.#totalRows(),
			paid: this.order.payment_status === "paid",
			note: this.order.note,
			track: this.#trackUrl(),
			support: this.options.support ?? null,
		};
	}

	/**
	 * The plain-text part.
	 * The same content as the template, one block per paragraph.
	 * @param v The email's view.
	 * @returns The text.
	 */
	static #plainText(v: OrderView) {
		const lines = [v.hello, "", v.intro, ""];
		lines.push(
			t("mail.order_line", { code: v.code, shop: v.shop.name, date: v.date }),
			"",
		);
		for (const i of v.items) {
			lines.push(`${i.title}   ${i.amount}${i.each ? ` (${i.each})` : ""}`);
			if (i.note) lines.push(`  ${i.note}`);
		}
		lines.push("");
		for (const row of v.totals) lines.push(`${row.label}: ${row.amount}`);
		lines.push(v.payment);
		if (v.instructions) lines.push("", v.instructions);
		if (v.tracking)
			lines.push("", t("mail.tracking", { tracking: v.tracking }));
		if (v.note) lines.push("", v.note);
		if (v.track) lines.push("", t("mail.track_text", { url: v.track }));
		lines.push("");
		if (v.support) lines.push(t("mail.support_text", { email: v.support }));
		lines.push(t("mail.no_reply"), `— ${v.shop.name}`);
		return lines.join("\n");
	}
}
