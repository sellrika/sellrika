import { expect, test } from "bun:test";
import { couponLabel } from "../coupons";
import { campaignStatus } from "../marketing";

// The test preload hands in the English dictionary.

test("couponLabel: each coupon type picks its own text", () => {
	expect(
		couponLabel({ type: "free_delivery", value: 0, max_discount: null }, "USD"),
	).toBe("Free delivery");
	expect(
		couponLabel({ type: "fixed", value: 500, max_discount: null }, "USD"),
	).toBe("$5 off");
	expect(
		couponLabel({ type: "percent", value: 10, max_discount: null }, "USD"),
	).toBe("10% off");
	expect(
		couponLabel({ type: "percent", value: 10, max_discount: 500 }, "USD"),
	).toBe("10% off (up to $5)");
});

test("campaignStatus: the label and badge of each status", () => {
	expect(campaignStatus("sent")).toEqual({
		label: "Sent",
		variant: "default",
	});
	expect(campaignStatus("sending")).toEqual({
		label: "Sending",
		variant: "secondary",
	});
	expect(campaignStatus("scheduled")).toEqual({
		label: "Scheduled",
		variant: "secondary",
	});
	expect(campaignStatus("draft")).toEqual({
		label: "Draft",
		variant: "outline",
	});
});
