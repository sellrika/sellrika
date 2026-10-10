import { expect, test } from "bun:test";
import { pointsFor, rewardLabel } from "./utils.ts";

const paid = {
	status: "completed",
	payment_status: "paid",
	total: 2590,
	refunded: 0,
};

test("pointsFor: whole points of the money kept, none while unpaid or voided", () => {
	expect(pointsFor(paid, 1)).toBe(25);
	expect(pointsFor(paid, 10)).toBe(2);
	expect(pointsFor(paid, 0.5)).toBe(51);
	// a refund takes the points of the money given back
	expect(pointsFor({ ...paid, refunded: 1000 }, 1)).toBe(15);
	expect(pointsFor({ ...paid, refunded: 2590 }, 1)).toBe(0);
	expect(pointsFor({ ...paid, payment_status: "partial" }, 1)).toBe(0);
	expect(pointsFor({ ...paid, status: "voided" }, 1)).toBe(0);
	// a setting that is not a positive number gives nothing
	expect(pointsFor(paid, 0)).toBe(0);
	expect(pointsFor(paid, Number.NaN)).toBe(0);
});

test("rewardLabel: a percent, or money with no .00 on a whole amount", () => {
	const t = (key: string, params?: Record<string, string | number>) =>
		`${key}:${Object.values(params ?? {}).join(",")}`;
	expect(rewardLabel(t, { type: "percent", value: 5 }, "USD", "en")).toBe(
		"reward.percent:5",
	);
	expect(rewardLabel(t, { type: "fixed", value: 500 }, "USD", "en")).toBe(
		"reward.fixed:$5",
	);
	expect(rewardLabel(t, { type: "fixed", value: 550 }, "USD", "en")).toBe(
		"reward.fixed:$5.50",
	);
});
