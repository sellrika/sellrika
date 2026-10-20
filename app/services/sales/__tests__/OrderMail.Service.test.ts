import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`; // before any app import
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { OrderMailService } = await import("../OrderMail.Service");
const mailer = Container.get(OrderMailService);
const { OrderEmail } = await import("@emails/Order.Email");
const { OrderShippedEmail } = await import("@emails/OrderShipped.Email");

await migrate(true);

/** Intl puts a non-breaking space after "THB" — normalise it so the expectations stay readable. */
const plain = (s: string) => s.replace(/\u00a0/g, " ");
const shop = (support: string | null = null): any => ({
	id: 1,
	name: "Rattan & Co",
	currency: "THB",
	timezone: "Asia/Bangkok",
	logo: null,
	support_email: support,
});
const order = (over: Record<string, unknown> = {}): any => ({
	id: 1042,
	reference: "P8J4-MJSQ-4Z8T",
	subtotal: 285000,
	discount: 0,
	delivery_fee: 5000,
	total: 290000,
	payment_method: "Stripe",
	payment_status: "paid",
	fulfillment: "new",
	tracking: "",
	created_at: "2026-08-26 04:15:00",
	note: "Deliver to: Zin · 099\n12 Sukhumvit", // shop tz is +7 → 11:15
	items: [
		{ name: "Rattan Basket", price: 95000, qty: 2 },
		{ name: "Teak Board", price: 50000, qty: 1 },
	],
	...over,
});

/**
 * Build the confirmation, with the shop's own support address.
 * @param shop The shop.
 * @param order The order.
 * @param buyer The buyer's name.
 * @param instructions How to pay, for an unpaid order.
 * @returns Subject, text and html.
 */
async function orderConfirmation(
	shop: any,
	order: any,
	buyer: string | null,
	instructions?: string,
) {
	const support = shop.support_email;
	const m = await new OrderEmail("buyer@x.io", shop, order, {
		buyer,
		support,
		instructions,
	}).build();
	return { subject: m.subject, text: m.text, html: m.html! };
}

/**
 * Build the "on its way" notice.
 * @param shop The shop.
 * @param order The order.
 * @param buyer The buyer's name.
 * @returns Subject, text and html.
 */
async function shippedNotice(shop: any, order: any, buyer: string | null) {
	const m = await new OrderShippedEmail("buyer@x.io", shop, order, {
		buyer,
	}).build();
	return { subject: m.subject, text: m.text, html: m.html! };
}

test("order confirmation: quantity first, unit price only above 1, totals, date in the shop's zone", async () => {
	const raw = await orderConfirmation(
		shop("help@rattan.co"),
		order(),
		"Zin Kyaw",
	);
	const m = {
		subject: raw.subject,
		text: plain(raw.text),
		html: plain(raw.html),
	};
	expect(m.subject).toBe("Order P8J4-MJSQ-4Z8T — Rattan & Co"); // the public code, never the id
	expect(m.text).not.toContain("#1042");
	expect(
		(await orderConfirmation(shop(), order({ reference: null }), null)).subject,
	).toBe("Order #1042 — Rattan & Co"); // pre-0036 rows
	expect(m.text).toContain("Thanks for your order, Zin Kyaw!");
	expect(m.text).toContain("2 × Rattan Basket   ฿1,900 (฿950 each)");
	expect(m.text).toContain("1 × Teak Board   ฿500"); // a single unit doesn't repeat the price
	expect(m.text).toContain("Delivery: ฿50");
	expect(m.text).toContain("Total: ฿2,900");
	expect(m.text).toContain("11:15 AM"); // Asia/Bangkok, not UTC
	expect(m.html).toContain("2 × Rattan Basket");
	expect(m.html).toContain("Rattan &amp; Co"); // Edge escapes the shop name
	expect(m.html).toContain("12 Sukhumvit"); // the delivery note rides along
	// no buyer name → a neutral greeting, and a discount line only when there is one
	const noName = await orderConfirmation(
		shop(),
		order({ discount: 15000, total: 275000 }),
		null,
	);
	expect(noName.text).toContain("Thanks for your order!");
	expect(plain(noName.text)).toContain("Discount: − ฿150");
	// the shop's tax line, worded from what the order froze ("Incl." when the prices already hold it)
	const taxed = await orderConfirmation(
		shop(),
		order({ tax: 18645, tax_rate: 700, tax_label: "VAT", tax_included: true }),
		null,
	);
	expect(plain(taxed.text)).toContain("Incl. VAT 7%: ฿186.45");
	expect(plain(taxed.text)).toContain("Total: ฿2,900"); // included → unchanged
});

test("order confirmation: support address falls back to the owner, and it always says not to reply", async () => {
	const mine = await orderConfirmation(shop("help@rattan.co"), order(), null);
	expect(mine.text).toContain(
		"Questions about this order? Contact us at help@rattan.co.",
	);
	expect(mine.html).toContain('href="mailto:help@rattan.co"');
	expect(mine.text).toContain(
		"This is an automated email — please do not reply to this message.",
	);

	// no support address on the shop → the shop owner's account email
	const [{ id }] = await Db.insert(
		sql,
		"users",
		sql`insert into users (name, email, password_hash, role, active) values ('Owner', 'owner@mail-test.io', 'x', 'admin', ${true})`,
		sql`id`,
	);
	const owner = "owner@mail-test.io";
	expect(await mailer.supportEmail({ ...shop(), owner_id: id })).toBe(owner);
	expect(await mailer.supportEmail(shop("help@rattan.co"))).toBe(
		"help@rattan.co",
	);
	const fallback = await orderConfirmation(shop(owner), order(), null);
	expect(fallback.text).toContain(`Contact us at ${owner}.`);
	expect(fallback.html).toContain(`mailto:${owner}`);
	expect(fallback.text).toContain("please do not reply");
});

test("unpaid confirmation says how to pay and carries the instructions; the shipped notice carries the tracking number", async () => {
	const cod = await orderConfirmation(
		shop(),
		order({ payment_method: "Bank transfer", payment_status: "unpaid" }),
		"Zin",
		"KBank 123-4-56789-0\nRattan & Co",
	);
	expect(cod.text).toContain("We received your order. Payment: Bank transfer");
	expect(cod.text).toContain("To pay by Bank transfer");
	expect(cod.text).toContain("KBank 123-4-56789-0");
	expect(cod.text).not.toContain("Paid with");
	expect(cod.html).toContain("KBank 123-4-56789-0");
	// a paid order never shows payment instructions, even when handed some
	expect(
		(await orderConfirmation(shop(), order(), null, "KBank 123")).text,
	).not.toContain("KBank 123");

	const shipped = await shippedNotice(
		shop(),
		order({ fulfillment: "shipped", tracking: "TH123456789" }),
		"Zin",
	);
	expect(shipped.subject).toBe(
		"Order P8J4-MJSQ-4Z8T is on its way — Rattan & Co",
	);
	expect(shipped.text).toContain("Good news, Zin!");
	expect(shipped.text).toContain("Tracking number: TH123456789");
	expect(shipped.text).toContain("2 × Rattan Basket"); // the recap rides along
	expect(shipped.html).toContain("Tracking: TH123456789");
	expect(
		(await shippedNotice(shop(), order({ fulfillment: "shipped" }), null)).text,
	).toContain("Your order has shipped and is on its way to you.");
});

test("line pictures and the shop logo travel inside the email by cid, shrunk; only a missing file is left out", async () => {
	const { UPLOAD_DIR } = await import("@constants/Storage.Constant");
	// a real 1×1 PNG, blown up to a big picture
	const dot = Uint8Array.fromBase64(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	);
	const big = new Bun.Image(dot).resize(600, 300, { fit: "fill" });
	/**
	 * Save bytes as a new upload.
	 * @param ext The file extension.
	 * @param bytes The file.
	 * @returns Its `/uploads/…` path.
	 */
	async function upload(ext: string, bytes: Uint8Array) {
		const name = `${Bun.randomUUIDv7()}.${ext}`;
		await Bun.write(`${UPLOAD_DIR}/uploads/${name}`, bytes);
		return `/uploads/${name}`;
	}
	const png = await upload("png", await big.png().bytes());
	const jpg = await upload("jpg", await big.jpeg().bytes());
	const odd = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]); // says GIF, can't be decoded
	const gif = await upload("gif", odd);
	const m = await new OrderEmail(
		"buyer@x.io",
		{ ...shop(), logo: png },
		order({
			items: [
				{ name: "Rattan Basket", price: 95000, qty: 2, image: png },
				{ name: "Teak Board", price: 50000, qty: 1, image: null },
				{
					name: "Lost Lamp",
					price: 1000,
					qty: 1,
					image: "/uploads/gone-0.png",
				},
				{ name: "Photo", price: 1000, qty: 1, image: jpg },
				{ name: "Old Gif", price: 1000, qty: 1, image: gif },
			],
		}),
	).build();
	expect(m.inline!.map((i) => [i.cid, i.filename, i.contentType])).toEqual([
		["logo@pos", "logo.png", "image/png"],
		["item-0@pos", "item-0.png", "image/png"], // a PNG stays a PNG
		["item-3@pos", "item-3.jpg", "image/jpeg"],
		["item-4@pos", "item-4.gif", "image/gif"],
	]);
	const [logo, item0, item3, item4] = m.inline!;
	/**
	 * The size of an attached picture.
	 * @param bytes The picture.
	 * @returns Its width and height.
	 */
	async function size(bytes: Uint8Array) {
		const { width, height } = await new Bun.Image(bytes).metadata();
		return [width, height];
	}
	expect(await size(logo!.content)).toEqual([80, 40]);
	expect(await size(item0!.content)).toEqual([112, 56]);
	expect(await size(item3!.content)).toEqual([112, 56]);
	expect(item4!.content).toEqual(odd); // can't be shrunk → sent as it is, never dropped
	expect(m.html).toContain('src="cid:logo@pos"');
	expect(m.html).toContain('src="cid:item-0@pos"');
	expect(m.html!.match(/<img /g)).toHaveLength(4); // none for the line without a picture, nor for the missing file
	expect(m.html).not.toContain("cid:item-1@pos");
	expect(m.html).not.toContain("cid:item-2@pos");
});
