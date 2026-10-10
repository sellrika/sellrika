<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import { CheckCircle2, Clock, PackageCheck, XCircle } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import OrderItemImage from "@/components/OrderItemImage.vue";
import { fmtDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { taxLabel } from "@helpers/tax";
import type { StoreInfo, StoreOrder } from "@/types";

/**
 * The page the buyer lands on after paying (a client-only island inside
 * `store/done.edge`).
 * `order` set = paid and recorded.
 * `pending` = not paid yet; `qr` = a QR method whose code is still to scan.
 * `failed` = it never will be paid, with the provider's `reason` if any.
 * While nothing is decided, the page asks the server again every 4 s.
 */
type DoneState = {
	order: StoreOrder | null;
	instructions: string | null;
	pending: boolean;
	qr: string | null;
	failed: boolean;
	reason: string | null;
};
const props = defineProps<DoneState & { store: StoreInfo }>();
const state = reactive<DoneState>({
	order: props.order,
	instructions: props.instructions,
	pending: props.pending,
	qr: props.qr,
	failed: props.failed,
	reason: props.reason,
});
const Store = window.Store;
const currency = props.store.currency;

/**
 * Money in the shop's own currency: orders keep it.
 * @param cents The amount.
 * @returns The formatted amount.
 */
function money(cents: number) {
	return Store.moneyIn(cents, currency);
}

// a manual option (cash on delivery, bank transfer): recorded, not paid yet
const unpaid = computed(
	() => !!state.order && state.order.payment_status !== "paid",
);

// a store with no payment option: the order came straight from the cart,
// so there is no "you'll pay by …" to tell
const direct = !props.store.payments?.length;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Stop asking the server, if it still runs.
 */
function stop() {
	if (!timer) return;
	clearInterval(timer);
	timer = null;
}

/**
 * The sale went through: the saved cart must not come back.
 */
function clearCart() {
	try {
		Store.cart.clear();
	} catch {
		// blocked storage
	}
}

/**
 * Stop once the page knows the end: an order, or a failure.
 */
function settle() {
	if (state.order) {
		stop();
		clearCart();
	} else if (state.failed) stop();
}

/**
 * Ask the server again: the buyer often lands here a moment before
 * the gateway marks the charge paid. The server answers the same props as JSON.
 */
async function poll() {
	try {
		const res = await fetch(location.href, {
			headers: { Accept: "application/json" },
		});
		if (!res.ok) return;
		const next = (await res.json()) as Partial<DoneState>;
		state.order = next.order ?? null;
		state.instructions = next.instructions ?? null;
		state.pending = !!next.pending;
		state.qr = next.qr ?? null;
		state.failed = !!next.failed;
		state.reason = next.reason ?? null;
		settle();
	} catch {
		// offline for a moment — the next tick tries again
	}
}

onMounted(function mounted() {
	if (state.order) return clearCart();
	// a declined payment never turns into an order — waiting is pointless
	if (state.failed) return;
	timer = setInterval(poll, 4000);
});
onBeforeUnmount(stop);
</script>

<template>
  <div class="mx-auto w-full max-w-md space-y-6 rounded-lg border bg-card p-6 text-center text-card-foreground sm:p-8">
    <template v-if="state.order">
      <div class="space-y-1">
        <PackageCheck v-if="unpaid" class="mx-auto size-12 text-emerald-500" />
        <CheckCircle2 v-else class="mx-auto size-12 text-emerald-500" />
        <h1 class="island-heading text-2xl font-semibold">{{ t(unpaid ? "store.order_received_bang" : "store.thank_you_bang") }}</h1>
        <p class="text-sm text-muted-foreground">{{ unpaid ? (direct ? "" : t("store.pay_by_dot", { method: state.order.payment_method.toLowerCase() })) : t("store.payment_went_through") }} {{ t("store.order_word") }} <span class="font-medium text-foreground" data-order-code>{{ state.order.reference }}</span> · {{ fmtDate(state.order.created_at) }}</p>
      </div>
      <div v-if="state.instructions" class="rounded-lg border p-4 text-left text-sm whitespace-pre-line" data-payment-instructions>{{ state.instructions }}</div>
      <div class="space-y-2 rounded-lg border p-4 text-left text-sm">
        <div v-for="(it, i) in state.order.items" :key="i" class="flex items-center justify-between gap-3">
          <OrderItemImage :src="it.image" />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ it.qty }} × {{ it.name }}</span>
            <span v-if="it.note" class="block text-xs whitespace-pre-line break-words text-muted-foreground" data-line-note>{{ t("store_ui.custom_request") }}: {{ it.note }}</span>
          </span>
          <span class="tabular-nums">{{ money(it.price * it.qty) }}</span>
        </div>
        <div v-if="state.order.discount" class="flex justify-between gap-3">
          <span>{{ t("common.discount") }} <span class="font-mono text-xs" data-coupon-code>{{ state.order.coupon_code }}</span></span>
          <span class="tabular-nums">−{{ money(state.order.discount) }}</span>
        </div>
        <div v-if="state.order.tax" class="flex justify-between gap-3">
          <span>{{ taxLabel(state.order, t("common.tax_included_prefix")) }}</span>
          <span class="tabular-nums" data-tax>{{ money(state.order.tax) }}</span>
        </div>
        <div v-if="state.order.delivery_fee" class="flex justify-between gap-3">
          <span>{{ t("store.delivery") }}</span>
          <span class="tabular-nums">{{ money(state.order.delivery_fee) }}</span>
        </div>
        <div v-else-if="state.order.coupon_code && !state.order.discount" class="flex justify-between gap-3">
          <span>{{ t("store.delivery") }} <span class="font-mono text-xs" data-coupon-code>{{ state.order.coupon_code }}</span></span>
          <span>{{ t("store.free") }}</span>
        </div>
        <div class="flex justify-between border-t pt-2 font-semibold">
          <span>{{ t(unpaid ? "store.total_to_pay" : "store.total_paid") }}</span>
          <span class="tabular-nums">{{ money(state.order.total) }}</span>
        </div>
      </div>
      <p class="text-sm text-muted-foreground">{{ t("store.done_keep_code") }} <a :href="`${store.base}/track?code=${state.order.reference}`" class="underline">{{ t("store.done_track_link") }}</a> {{ t("store.done_keep_code_end") }}</p>
    </template>

    <template v-else-if="state.failed">
      <div class="space-y-1">
        <XCircle class="mx-auto size-12 text-destructive" />
        <h1 class="island-heading text-2xl font-semibold">{{ t("store.done_failed") }}</h1>
        <p class="text-sm text-muted-foreground">{{ state.reason || t("store.payment_failed_body") }}</p>
      </div>
      <Button as-child class="island-primary w-full"><a :href="`${store.base}/checkout`">{{ t("common.try_again") }}</a></Button>
    </template>

    <div v-else-if="state.qr" class="space-y-3">
      <h1 class="island-heading text-2xl font-semibold">{{ t("store.done_scan") }}</h1>
      <img :src="state.qr" :alt="t('store.done_scan')" width="240" height="240" class="mx-auto size-60 max-w-full" />
      <p class="text-sm text-muted-foreground">{{ t("store.scan_hint") }}</p>
    </div>

    <div v-else class="space-y-1">
      <Clock class="mx-auto size-12 text-amber-500" />
      <h1 class="island-heading text-2xl font-semibold">{{ t("store.done_pending") }}</h1>
      <p class="text-sm text-muted-foreground">{{ t("store.pending_body") }}</p>
    </div>

    <Button as-child class="w-full" :variant="state.failed ? 'outline' : undefined" :class="!state.failed && 'island-primary'"><a :href="store.base || '/'">{{ t("store.back_to_store", { name: store.name }) }}</a></Button>
  </div>
</template>
