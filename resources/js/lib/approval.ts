// The one rule for a payment method its extension must approve first (a card reader, manifest
// `payment_method.confirm`). PaymentMethodPicker.vue uses it, so every pay dialog follows it.
import { computed, ref, watch } from "vue";
import { PAYMENT_REF_MAX } from "@constants/Order.Constant";
import type { ExtensionUi, PickerMethod } from "@/types";

/**
 * Follow the picked method and the amount of a pay dialog.
 * While the method needs its extension's approval, the dialog is blocked until `approve(ref)` is called.
 * Another method or another amount takes the approval away again.
 * @param method Gives the picked method, or null.
 * @param amount Gives the cents asked for.
 * @param extensions Gives the running extensions (shared prop `extension_ui`).
 * @returns `blocked` = keep the confirm button off, `reference` = what was approved (or null), and `approve`.
 */
export function usePaymentApproval(
	method: () => PickerMethod | null,
	amount: () => number,
	extensions: () => Pick<ExtensionUi, "key" | "payment_confirm">[],
) {
	const reference = ref<string | null>(null);
	const needed = computed(function asksApproval() {
		const key = method()?.extension;
		return (
			!!key &&
			extensions().some(function confirms(e) {
				return e.key === key && e.payment_confirm;
			})
		);
	});
	const blocked = computed(() => needed.value && !reference.value);
	/**
	 * The picked method's extension says the money is taken.
	 * It counts only for a method that asks for it, and only with a short text.
	 * @param ref Its reference for the payment (a charge id).
	 */
	function approve(ref: string) {
		const text = String(ref ?? "").trim();
		if (!needed.value || !text || text.length > PAYMENT_REF_MAX) return;
		reference.value = text;
	}
	// sync: the approval is gone before anything else sees the new method or amount
	watch(
		[method, amount],
		function unapprove() {
			reference.value = null;
		},
		{ flush: "sync" },
	);
	return { blocked, reference, approve };
}
