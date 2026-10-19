import { expect, test } from "bun:test";
import { stepColor, stepLabel, stepStyle } from "../orders";
import type { FulfillmentStep } from "@/types";

/** A shop that renamed and recoloured "packing" and added its own step. */
const STEPS: FulfillmentStep[] = [
	{ key: "packing", label: "Boxing", color: "#ff0000" },
	{ key: "pickup", label: "Ready for pickup", color: "" },
];

test("stepLabel: the shop's own name, else the built-in one, else the key", () => {
	expect(stepLabel("packing", STEPS)).toBe("Boxing");
	expect(stepLabel("pickup", STEPS)).toBe("Ready for pickup");
	expect(stepLabel("shipped", STEPS)).toBe("Shipped");
	expect(stepLabel("unknown", STEPS)).toBe("unknown");
});

test("stepColor: the shop's pick, else the built-in colour, else grey", () => {
	expect(stepColor("packing", STEPS)).toBe("#ff0000");
	expect(stepColor("shipped", STEPS)).toBe("#3b82f6");
	expect(stepColor("pickup", STEPS)).toBe("#64748b"); // empty colour falls back
	expect(stepColor("unknown")).toBe("#64748b");
});

test("stepStyle: text in the colour, a tinted border and fill", () => {
	expect(stepStyle("#10b981")).toEqual({
		color: "#10b981",
		borderColor: "color-mix(in srgb, #10b981 45%, transparent)",
		backgroundColor: "color-mix(in srgb, #10b981 12%, transparent)",
	});
});
