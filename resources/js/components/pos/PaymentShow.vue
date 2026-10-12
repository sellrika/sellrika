<script lang="ts">
import type { ExtensionUi, PickerMethod } from "@/types";

/**
 * Does the customer's screen have something to show for this method?
 * Either the method's own picture, or the `pos.display` slot of the extension that added it.
 * @param method The picked method, or null.
 * @param extensions The running extensions (shared prop `extension_ui`).
 * @returns True when there is something to show.
 */
export function paymentShows(
	method: PickerMethod | null,
	extensions: ExtensionUi[],
) {
	if (!method) return false;
	if (method.image) return true;
	return extensions.some(function adds(e) {
		return e.key === method.extension && !!e.slots["pos.display"];
	});
}
</script>

<script setup lang="ts">
// What the customer's screen shows for the picked payment method (a QR code to pay), inside a pay dialog.
// For a shop with no second monitor: the cashier turns the tablet or phone to the customer.
// Drawn by PaymentMethodPicker.vue, so every pay dialog has it.
import { ref, watch } from "vue";
import { usePage } from "@inertiajs/vue3";
import ExtensionSlot from "@/components/ExtensionSlot.vue";
import { saleTotals, type SavedCart } from "@/components/pos/CartPanel.vue";
import { displayContext, displaySale, parseCart } from "@/lib/display";
import { money } from "@/lib/format";
import type { SharedProps } from "@/types";

const props = defineProps<{
	/** The picked method, or null. */
	method: PickerMethod | null;
	/** The cents the customer is asked for now. */
	amount: number;
}>();
const emit = defineEmits<{
	/** The picked method's extension says the money is taken, with its reference. */
	(e: "approve", ref: string): void;
}>();

const shop = usePage<SharedProps>().props.shop;
const currency = shop?.currency ?? "USD";

/**
 * The Sell screen's cart, the same one the customer's screen shows.
 * @returns The saved cart, or null when there is none or storage is blocked.
 */
function readCart() {
	try {
		return parseCart<SavedCart>(localStorage.getItem(`cart:${shop?.id ?? 0}`));
	} catch {
		return null;
	}
}
// ponytail: read once, the cart does not change while a pay dialog is open
const saved = readCart();
const sale = displaySale(
	saved?.cart ?? [],
	saleTotals(saved?.cart ?? [], saved?.discount ?? null, shop),
	saved?.customer?.name ?? null,
	currency,
);

/**
 * The picked payment method as an extension gets it.
 * @returns The method's name, the extension that added it and the cents asked for, or null.
 */
function slotPayment() {
	const m = props.method;
	return (
		m && { method: m.name, extension: m.extension ?? null, amount: props.amount }
	);
}
const context = displayContext(
	() => sale,
	slotPayment,
	"dialog",
	function approve(ref) {
		emit("approve", ref);
	},
);

// Only the extension that added the picked method draws here.
// Another one (advertisements for the customer's screen) has no place in a pay dialog.
const slot = ref<HTMLElement | null>(null);
/**
 * Hide every extension's element but the picked method's.
 */
function onlyOwn() {
	const all = slot.value?.querySelectorAll<HTMLElement>("[data-extension]");
	for (const el of all ?? [])
		el.hidden = el.dataset.extension !== props.method?.extension;
}
watch(() => props.method, onlyOwn, { immediate: true, flush: "post" });
</script>

<template>
  <!-- `--display-height`: an extension's drawing fills the customer's screen, here it is only as tall as it needs -->
  <div class="flex flex-col items-center justify-center gap-3 p-4 text-center" style="--display-height: auto" data-pay-show>
    <template v-if="method?.image">
      <img :src="method.image" :alt="method.name" class="max-h-[60dvh] w-full rounded-lg object-contain" />
      <p class="text-lg font-semibold">{{ method.name }} · <span class="tabular-nums">{{ money(amount, currency) }}</span></p>
    </template>
    <!-- v-show: an extension stays mounted under the picture -->
    <div v-show="!method?.image" ref="slot" class="w-full"><ExtensionSlot name="pos.display" :context="context" /></div>
  </div>
</template>
