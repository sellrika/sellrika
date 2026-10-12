import { expect, test } from "bun:test";
import { ref } from "vue";
import { usePaymentApproval } from "../approval";
import type { PickerMethod } from "@/types";

const CASH: PickerMethod = { id: 1, name: "Cash" };
const READER: PickerMethod = {
	id: 2,
	name: "Card reader",
	extension: "reader",
};
const QR: PickerMethod = { id: 3, name: "QR", extension: "qr" };
/** Two running extensions: only the reader's method must be approved. */
const EXTENSIONS = [
	{ key: "reader", payment_confirm: true },
	{ key: "qr", payment_confirm: false },
];

/**
 * A pay dialog's picker state, with the rule on top.
 * @param first The method picked first.
 * @returns The method, the amount and the rule's values.
 */
function dialog(first: PickerMethod) {
	const method = ref<PickerMethod | null>(first);
	const amount = ref(1250);
	const rule = usePaymentApproval(
		() => method.value,
		() => amount.value,
		() => EXTENSIONS,
	);
	return { method, amount, ...rule };
}

test("a method with confirm keeps the dialog blocked until its extension approves", () => {
	const d = dialog(READER);
	expect(d.blocked.value).toBe(true);
	d.approve("pi_123");
	expect(d.blocked.value).toBe(false);
	expect(d.reference.value).toBe("pi_123");
});

test("other methods are never blocked, and nobody can approve them", () => {
	for (const method of [CASH, QR]) {
		const d = dialog(method);
		expect(d.blocked.value).toBe(false);
		d.approve("pi_123");
		expect(d.reference.value).toBeNull();
	}
});

test("another amount takes the approval away: the dialog is blocked again", () => {
	const d = dialog(READER);
	d.approve("pi_123");
	d.amount.value = 900;
	expect(d.reference.value).toBeNull();
	expect(d.blocked.value).toBe(true);
});

test("another method takes the approval away, and coming back needs a new one", () => {
	const d = dialog(READER);
	d.approve("pi_123");
	d.method.value = CASH;
	expect(d.reference.value).toBeNull();
	expect(d.blocked.value).toBe(false);
	d.method.value = READER;
	expect(d.blocked.value).toBe(true);
});

test("an empty or far too long reference does not approve", () => {
	const d = dialog(READER);
	d.approve("  ");
	d.approve("x".repeat(201));
	expect(d.blocked.value).toBe(true);
	d.approve("  pi_9  ");
	expect(d.reference.value).toBe("pi_9");
});
