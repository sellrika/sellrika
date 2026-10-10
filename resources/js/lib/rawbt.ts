import { useLocalStorage } from "@vueuse/core";
import { reactive } from "vue";
import { fmtDate, money } from "./format";
import { t } from "./i18n";
import { taxLabel } from "@helpers/tax";
import type { Order } from "@/types";

/**
 * Direct receipt printing through RawBT (Android).
 * The receipt is drawn as a picture in the browser, so every script prints right (Thai, Myanmar…).
 * The picture goes to the app as ESC/POS bytes over the `rawbt:` URL scheme.
 * RawBT sends them to the paired Bluetooth/USB/network thermal printer.
 * Off by default, per device (it needs the app installed): Account → Receipt printing.
 * Off = plain `window.print()` of the #receipt slip.
 */
export const RAWBT_APP =
	"https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter";

export const rawbtOn = useLocalStorage("rawbt", false);
export const rawbtCols = useLocalStorage("rawbt-cols", 32); // 32 = 58 mm paper, 48 = 80 mm

/** Printer dots per text column: 32 columns = 384 dots (58 mm), 48 = 576 dots (80 mm). */
const DOTS_PER_COL = 12;
/** Text size and line height on the picture, in printer dots. */
const FONT_PX = 24;
const LINE_PX = 34;
/** Rows of dots sent in one image command. Small printers have a small buffer. */
const STRIP_ROWS = 200;

/**
 * One line of a slip.
 * `"rule"` is a dashed line across the paper.
 * `right` is the amount, drawn at the right edge.
 */
export type SlipLine =
	| "rule"
	| {
			text: string;
			right?: string;
			bold?: boolean;
			center?: boolean;
			big?: boolean;
	  };

/**
 * One line an extension adds to a receipt (slot `order.receipt`).
 * `right` is drawn at the right edge, like an amount.
 */
export type ReceiptExtra = {
	text: string;
	right?: string;
	bold?: boolean;
	center?: boolean;
};

/** The most lines the extensions may add to one receipt. */
const RECEIPT_EXTRAS_MAX = 12;
/** The longest text of one such line. */
const RECEIPT_EXTRA_CHARS = 200;

/**
 * The lines the extensions added to each receipt, by order id.
 * ReceiptSlip.vue and `receiptLines` both print them, over "Thank you".
 */
export const receiptExtras = reactive<Record<number, ReceiptExtra[]>>({});

/**
 * Add an extension's lines to an order's receipt.
 * Only text is kept, cut to a safe length. Lines past the limit are dropped.
 * @param orderId The order.
 * @param lines The lines to add.
 */
export function addReceiptExtras(orderId: number, lines: ReceiptExtra[]) {
	const list = receiptExtras[orderId] ?? [];
	for (const line of Array.isArray(lines) ? lines : []) {
		const text = String(line?.text ?? "").slice(0, RECEIPT_EXTRA_CHARS);
		if (!text.trim() || list.length >= RECEIPT_EXTRAS_MAX) continue;
		list.push({
			text,
			right: line.right
				? String(line.right).slice(0, RECEIPT_EXTRA_CHARS)
				: undefined,
			bold: !!line.bold,
			center: !!line.center,
		});
	}
	receiptExtras[orderId] = list;
}

/**
 * The order note as the slip prints it.
 * The first line stays alone ("Deliver to: <name> · <phone>").
 * The address lines after it are joined with commas, to save paper.
 * @param note The order note.
 * @returns The first line, then the address on one line.
 */
export function slipNote(note: string) {
	const [first, ...rest] = note.split("\n");
	return [first, rest.join(", ")].filter(Boolean).join("\n");
}

/**
 * The receipt as slip lines, the same content as ReceiptSlip.vue.
 * @param order The order to print.
 * @param currency The shop's currency code.
 * @param shopName The shop's name, printed on top.
 * @returns The lines, top to bottom.
 */
export function receiptLines(
	order: Order,
	currency: string,
	shopName: string,
): SlipLine[] {
	const out: SlipLine[] = [];
	function amt(cents: number) {
		return money(cents, currency);
	}
	function row(text: string, right: string, bold = false) {
		out.push({ text, right, bold });
	}

	out.push({ text: shopName, bold: true, center: true, big: true });
	out.push({
		text: t("pos.receipt_order", {
			id: order.reference ?? order.id,
			date: fmtDate(order.created_at),
		}),
	});
	out.push({
		text: t("pos.receipt_payment", { method: order.payment_method }),
	});
	// the note already opens with "Deliver to: <name> · <phone>", so it replaces the Customer line
	if (order.note)
		for (const text of slipNote(order.note).split("\n")) out.push({ text });
	else if (order.customer)
		out.push({
			text: order.customer.phone
				? t("pos.receipt_customer_phone", {
						name: order.customer.name,
						phone: order.customer.phone,
					})
				: t("pos.receipt_customer", { name: order.customer.name }),
		});
	if (order.status === "voided")
		out.push({ text: t("pos.receipt_voided_stars"), bold: true, center: true });
	out.push("rule");
	for (const it of order.items) {
		row(`${it.qty} x ${it.name}`, amt(it.price * it.qty));
		if (it.note) out.push({ text: `  ${it.note}` });
	}
	out.push("rule");
	if (order.discount || order.delivery_fee || order.tax) {
		row(t("common.subtotal"), amt(order.subtotal));
		if (order.discount)
			row(
				(order.discount_type === "percent"
					? t("pos.discount_percent", { value: order.discount_value })
					: t("common.discount")) +
					(order.coupon_code ? ` ${order.coupon_code}` : ""),
				`-${amt(order.discount)}`,
			);
		if (order.tax)
			row(taxLabel(order, t("common.tax_included_prefix")), amt(order.tax));
		if (order.delivery_fee) row(t("pos.delivery"), amt(order.delivery_fee));
	}
	row(t("pos.receipt_total_caps"), amt(order.total), true);
	row(t("pos.paid"), amt(order.paid));
	// an unpaid / partly paid order prints what is still due, not change
	if (order.payment_status && order.payment_status !== "paid")
		row(t("pos.due"), amt(order.total - order.paid), true);
	else row(t("pos.change"), amt(order.change), true);
	if (order.refunded) row(t("pos.refunded"), `-${amt(order.refunded)}`);
	out.push("rule");
	const extras = receiptExtras[order.id] ?? [];
	for (const line of extras) out.push({ ...line });
	if (extras.length) out.push("rule");
	out.push({ text: t("pos.thank_you"), center: true });
	return out;
}

/**
 * Break a text into rows that fit a width.
 * It breaks between words. `Intl.Segmenter` also finds the words of Thai and Myanmar,
 * which have no spaces.
 * @param ctx The canvas, with the font already set.
 * @param text The text to break.
 * @param max The widest a row may be, in dots.
 * @returns The rows, at least one.
 */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
	const rows: string[] = [];
	let row = "";
	// ponytail: one word wider than the paper is cut at the edge. Break by letter if that ever shows.
	for (const { segment } of new Intl.Segmenter(undefined, {
		granularity: "word",
	}).segment(text)) {
		if (row.trim() && ctx.measureText(row + segment).width > max) {
			rows.push(row.trimEnd());
			row = segment.trimStart();
		} else row += segment;
	}
	rows.push(row.trimEnd());
	return rows;
}

/**
 * Draw slip lines as a black and white picture, as wide as the paper.
 * The browser draws the letters, so every script it can show prints right.
 * @param lines The lines, top to bottom.
 * @param cols The paper width in text columns (32 or 48).
 * @returns The picture as RGBA pixels.
 */
function drawSlip(lines: SlipLine[], cols = rawbtCols.value) {
	const width = cols * DOTS_PER_COL;
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	function font(line: Exclude<SlipLine, "rule">) {
		const px = line.big ? FONT_PX * 1.4 : FONT_PX;
		return `${line.bold ? "bold " : ""}${px}px sans-serif`;
	}

	// first pass: measure, so the canvas gets its height
	const rows: { line: SlipLine; text: string; first: boolean }[] = [];
	for (const line of lines) {
		if (line === "rule") {
			rows.push({ line, text: "", first: true });
			continue;
		}
		ctx.font = font(line);
		const taken = line.right ? ctx.measureText(line.right).width + 16 : 0;
		wrap(ctx, line.text, width - taken).forEach(function add(text, i) {
			rows.push({ line, text, first: i === 0 });
		});
	}

	canvas.width = width;
	canvas.height = rows.length * LINE_PX;
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, width, canvas.height);
	ctx.fillStyle = "#000";
	ctx.textBaseline = "middle";
	rows.forEach(function draw({ line, text, first }, i) {
		const y = i * LINE_PX + LINE_PX / 2;
		if (line === "rule") {
			ctx.setLineDash([8, 6]);
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
			return;
		}
		ctx.font = font(line);
		ctx.textAlign = line.center ? "center" : "left";
		ctx.fillText(text, line.center ? width / 2 : 0, y);
		if (line.right && first) {
			ctx.textAlign = "right";
			ctx.fillText(line.right, width, y);
		}
	});
	return ctx.getImageData(0, 0, width, canvas.height);
}

/**
 * Turn a picture into the printer's image commands (ESC/POS `GS v 0`), one bit per dot.
 * A dark pixel is a printed dot. The picture is sent in short strips.
 * @param image RGBA pixels. The width must be a multiple of 8.
 * @returns The command bytes.
 */
export function rasterBytes(image: {
	data: ArrayLike<number>;
	width: number;
	height: number;
}): number[] {
	const { data, width, height } = image;
	const perRow = width / 8;
	const out: number[] = [];
	for (let top = 0; top < height; top += STRIP_ROWS) {
		const rows = Math.min(STRIP_ROWS, height - top);
		out.push(
			0x1d,
			0x76,
			0x30,
			0,
			perRow % 256,
			perRow >> 8,
			rows % 256,
			rows >> 8,
		);
		for (let y = top; y < top + rows; y++)
			for (let x = 0; x < width; x += 8) {
				let byte = 0;
				for (let bit = 0; bit < 8; bit++) {
					const i = (y * width + x + bit) * 4;
					// the green channel is enough: the picture is black on white
					if ((data[i + 1] ?? 255) < 128) byte |= 0x80 >> bit;
				}
				out.push(byte);
			}
	}
	return out;
}

/**
 * Hand printer bytes to the RawBT app.
 * ponytail: the whole slip rides in one link, about 100 KB for a long receipt.
 * If very long receipts fail to open the app, send the picture as a file share instead.
 * @param bytes ESC/POS bytes: reset first, feed and cut last.
 */
function send(bytes: number[]) {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	location.href = `rawbt:base64,${btoa(binary)}`;
}

const RESET = [0x1b, 0x40];
/** Four empty lines, then cut (ignored without a cutter). */
const FEED_CUT = [10, 10, 10, 10, 0x1d, 0x56, 0];

/**
 * Print `order`: through RawBT when this device has it switched on, else the browser print dialog.
 * @param order The order to print.
 * @param currency The shop's currency code.
 * @param shopName The shop's name.
 */
export function printReceipt(order: Order, currency: string, shopName: string) {
	if (!rawbtOn.value) return window.print();
	const image = drawSlip(receiptLines(order, currency, shopName));
	send([...RESET, ...rasterBytes(image), ...FEED_CUT]);
}

/** A slip an extension prints (`api.print`): a big title, short lines, and a QR code under them. */
export type Slip = { title: string; lines?: string[]; qr?: string };

/**
 * The printer's own QR code command (ESC/POS `GS ( k`): model 2, level M, square size 6.
 * @param text What the code holds (a link: plain ASCII).
 * @returns The command bytes.
 */
function escPosQr(text: string): number[] {
	const data = [...new TextEncoder().encode(text)];
	const len = data.length + 3;
	const k = (...bytes: number[]) => [0x1d, 0x28, 0x6b, ...bytes];
	return [
		...k(4, 0, 49, 65, 50, 0), // model 2
		...k(3, 0, 49, 67, 6), // square size
		...k(3, 0, 49, 69, 49), // level M
		...k(len % 256, Math.floor(len / 256), 49, 80, 48, ...data), // store
		...k(3, 0, 49, 81, 48), // print
	];
}

/**
 * Print a slip: through RawBT when this device has it switched on, else the browser print dialog.
 * The browser prints it as `#receipt`, the same paper width and look as a receipt.
 * @param slip What the slip says.
 * @param qrSvg Draws the QR code for the browser print (`qrSvg` from `@helpers/qr`).
 */
export function printSlip(slip: Slip, qrSvg: (text: string) => string) {
	if (rawbtOn.value) {
		const lines: SlipLine[] = [
			{ text: slip.title, bold: true, center: true, big: true },
			...(slip.lines ?? []).map(function line(text): SlipLine {
				return { text, center: true };
			}),
		];
		send([
			...RESET,
			...rasterBytes(drawSlip(lines)),
			...[0x1b, 0x61, 1], // centre the QR code
			...(slip.qr ? escPosQr(slip.qr) : []),
			...[0x1b, 0x61, 0],
			...FEED_CUT,
		]);
		return;
	}
	const box = document.createElement("div");
	box.id = "receipt";
	box.className = "hidden";
	const title = document.createElement("p");
	title.className = "shop";
	title.textContent = slip.title;
	box.append(title);
	for (const line of slip.lines ?? []) {
		const p = document.createElement("p");
		p.className = "center";
		p.textContent = line;
		box.append(p);
	}
	if (slip.qr) {
		const code = document.createElement("div");
		code.className = "qr";
		code.innerHTML = qrSvg(slip.qr);
		box.append(code);
	}
	// a receipt still on the page would print too
	const other = document.getElementById("receipt");
	other?.removeAttribute("id");
	document.body.append(box);
	window.print();
	box.remove();
	other?.setAttribute("id", "receipt");
}
