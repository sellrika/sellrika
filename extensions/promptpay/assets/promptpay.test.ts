import { expect, test } from "bun:test";
import { promptpayId, promptpayPayload } from "./promptpay.ts";

test("promptpayId keeps a phone number, a national ID or an e-wallet ID as digits", () => {
	expect(promptpayId("080-123-4567")).toBe("0801234567");
	expect(promptpayId("1 2345 67890 12 3")).toBe("1234567890123");
	expect(promptpayId("123456789012345")).toBe("123456789012345");
	expect(promptpayId("12345")).toBeNull();
	expect(promptpayId("08012345ab")).toBeNull();
	expect(promptpayId("")).toBeNull();
});

test("promptpayPayload builds the code for one exact amount", () => {
	// a phone number: 0066 instead of the first 0, the amount with two decimals, then the checksum
	expect(promptpayPayload("0801234567", 422)).toBe(
		"00020101021229370016A000000677010111011300668012345675802TH530376454044.22630444FE",
	);
	// a national ID goes in as it is, under field 02
	expect(promptpayPayload("1234567890123", 150000)).toContain(
		"021312345678901235802TH530376454071500.00",
	);
	// an e-wallet ID under field 03
	expect(promptpayPayload("123456789012345", 100)).toContain(
		"0315123456789012345",
	);
});
