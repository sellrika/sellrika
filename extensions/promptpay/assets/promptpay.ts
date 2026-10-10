/**
 * PromptPay QR codes (Thailand), made from the shop's own PromptPay ID.
 * No provider and no package: the code is plain text in the EMVCo format
 * that every Thai bank app reads.
 * Nobody tells the app when the money arrives. The shop checks its bank app.
 */

/** PromptPay moves Thai baht only. */
export const PROMPTPAY_CURRENCY = "THB";
/** The id of the PromptPay application inside the code. */
const PROMPTPAY_AID = "A000000677010111";

/**
 * Clean a PromptPay ID as a person types it.
 * @param raw The typed text, with spaces or dashes.
 * @returns The digits when it is a phone number (10), a national or tax ID (13)
 * or an e-wallet ID (15), else null.
 */
export function promptpayId(raw: string) {
	const digits = raw.replace(/[\s-]/g, "");
	return /^(\d{10}|\d{13}|\d{15})$/.test(digits) ? digits : null;
}

/**
 * One field of the code: its two-digit id, its two-digit length, its value.
 * @param id The field id.
 * @param value The value.
 * @returns The field as text.
 */
function field(id: string, value: string) {
	return id + String(value.length).padStart(2, "0") + value;
}

/**
 * The checksum at the end of the code (CRC-16/CCITT-FALSE).
 * @param text The code up to and including "6304".
 * @returns Four upper-case hex digits.
 */
function crc16(text: string) {
	let crc = 0xffff;
	for (let i = 0; i < text.length; i++) {
		crc ^= text.charCodeAt(i) << 8;
		for (let bit = 0; bit < 8; bit++)
			crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
	}
	return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * The text of a PromptPay QR code that asks for one exact amount.
 * @param id The PromptPay ID, digits only (see `promptpayId`).
 * @param cents The amount in satang (integer cents of a baht).
 * @returns The text to draw as a QR code.
 */
export function promptpayPayload(id: string, cents: number) {
	// a phone number goes in with the country code instead of its first 0
	const target =
		id.length === 10
			? field("01", `0066${id.slice(1)}`)
			: field(id.length === 13 ? "02" : "03", id);
	const body =
		field("00", "01") +
		// 12 = a code for one payment (it carries the amount)
		field("01", "12") +
		field("29", field("00", PROMPTPAY_AID) + target) +
		field("58", "TH") +
		field("53", "764") +
		field("54", (cents / 100).toFixed(2)) +
		"6304";
	return body + crc16(body);
}
