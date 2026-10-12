<script setup lang="ts">
// The payment method buttons of every pay dialog: the Sell screen's checkout, Record payment on the
// order page, and extensions through `api.paymentPicker()` (the Restaurant's Pay). One place to change.
// While it is on screen it also tells the customer's screen which method is picked and for how much,
// and draws what that screen shows for the method (a QR code to pay) itself: PaymentShow.vue.
// It also holds the one rule for a method its extension must approve first (a card reader, manifest
// `payment_method.confirm`): `blocked` is true until the extension calls `approve(ref)`, and the
// approval goes away when the method or the amount changes. Every dialog binds both models.
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useElementBounding } from "@vueuse/core";
import { usePage } from "@inertiajs/vue3";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { usePaymentApproval } from "@/lib/approval";
import { showPayment } from "@/lib/display";
import { t } from "@/lib/i18n";
import { paymentIcon } from "@/lib/paymentIcons";
import type { PickerMethod, SharedProps } from "@/types";
import PaymentShow, { paymentShows } from "./PaymentShow.vue";

const props = defineProps<{
	/** The methods on offer. */
	methods: PickerMethod[];
	/** The cents the customer is asked for now. */
	amount: number;
}>();
/** The picked method, or null for none. */
const model = defineModel<PickerMethod | null>({ required: true });
/** True while the picked method waits for its extension's approval: the dialog keeps its confirm button off. */
const blocked = defineModel<boolean>("blocked", { default: false });
/** The approval's reference, or null. The dialog confirms by itself when it comes and sends it as `payment_ref`. */
const reference = defineModel<string | null>("reference", { default: null });

const page = usePage<SharedProps>();
const shopId = page.props.shop?.id ?? 0;

// What the customer's screen shows for the picked method is drawn here too, for a shop with no second monitor.
// With room next to the dialog it is a card of its own on the dialog's left, so the dialog stays as it is.
// With no room (a phone, a tablet held upright) it sits under the method buttons.
/** The least room the card needs on the dialog's left, in px. */
const SIDE_MIN = 272;
/** The card's widest, in px. */
const SIDE_MAX = 384;
const root = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
const { left } = useElementBounding(host);
const shows = computed(() =>
	paymentShows(model.value, page.props.extension_ui ?? []),
);
const beside = computed(() => !!host.value && left.value >= SIDE_MIN);
/**
 * Find the dialog these buttons are in.
 * An extension's buttons are put into its dialog after they are made, so this is asked again on every pick.
 */
function findHost() {
	host.value =
		root.value?.closest<HTMLElement>("dialog, [role=dialog]") ?? null;
}
onMounted(function lookAfterPaint() {
	requestAnimationFrame(findHost);
});

// The rule itself is lib/approval.ts. Here it is handed to the dialog through the two models.
const approval = usePaymentApproval(
	() => model.value,
	() => props.amount,
	() => page.props.extension_ui ?? [],
);
watch(
	approval.blocked,
	function tellBlocked(on) {
		blocked.value = on;
	},
	{ immediate: true },
);
// a dialog that opens again starts with nothing approved
reference.value = null;
watch(approval.reference, function tellReference(ref) {
	reference.value = ref;
});

/**
 * Tell the customer's screen the picked method and the amount.
 */
function tell() {
	const m = model.value;
	showPayment(
		shopId,
		m && {
			name: m.name,
			image: m.image ?? null,
			extension: m.extension ?? null,
			amount: props.amount,
		},
	);
}
watch([model, () => props.amount], tell, { immediate: true });
watch(model, findHost, { flush: "post" });
// the dialog closed, or the sale is done: the customer's screen stops showing it
onUnmounted(function forget() {
	showPayment(shopId, null);
});
</script>

<template>
  <div ref="root" class="space-y-2">
    <Label>{{ t("pos.payment_method") }}</Label>
    <div class="grid grid-cols-3 gap-2" data-pay-methods>
      <Button v-for="m in methods" :key="m.id" type="button" :variant="model?.id === m.id ? 'default' : 'outline'"
        class="h-11 min-w-0" :aria-pressed="model?.id === m.id" @click="model = m">
        <component :is="paymentIcon(m.icon)" class="shrink-0" /> <span class="truncate">{{ m.name }}</span>
      </Button>
      <p v-if="!methods.length" class="col-span-3 text-sm text-destructive">{{ t("pos.no_payment_methods") }}</p>
    </div>
    <Teleport :to="host ?? 'body'" :disabled="!beside">
      <PaymentShow v-show="shows" :method="model" :amount="amount" @approve="approval.approve"
        :class="beside ? 'absolute top-1/2 right-full mr-4 max-h-[calc(100dvh-2rem)] -translate-y-1/2 overflow-y-auto rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10' : 'rounded-lg bg-muted'"
        :style="beside ? { width: `${Math.min(SIDE_MAX, left - 32)}px` } : undefined" />
    </Teleport>
  </div>
</template>
