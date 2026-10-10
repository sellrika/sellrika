<script setup lang="ts">
import { computed, watch } from "vue";
import { usePage } from "@inertiajs/vue3";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import ExtensionSlot from "@/components/ExtensionSlot.vue";
import {
	addReceiptExtras,
	type ReceiptExtra,
	receiptExtras,
	slipNote,
} from "@/lib/rawbt";
import { taxLabel } from "@helpers/tax";
import type { Order, SharedProps } from "@/types";

/**
 * Print slip for an order. Teleported to <body> and hidden on screen; under @media print it is the
 * only thing on the page (see #receipt in app.css). Render it, then call window.print().
 */
const props = defineProps<{ order: Order; currency: string }>();
const shop = computed(() => usePage<SharedProps>().props.shop);

/**
 * The order as the slot's scripts last saw it.
 * A payment, a refund or a void changes it, so the scripts run again.
 */
const seen = computed(function stamp() {
	const o = props.order;
	return `${o.id}:${o.status}:${o.payment_status}:${o.paid}:${o.refunded}`;
});
// before the scripts run again: start from no extra lines
watch(seen, () => delete receiptExtras[props.order.id], { immediate: true });
const extras = computed(() => receiptExtras[props.order.id] ?? []);

/**
 * The `order.receipt` extension slot (the extension guide › Slots).
 * A script draws nothing: it adds lines of text to the receipt.
 */
const receiptSlot = {
	order: () => props.order,
	add: (lines: ReceiptExtra[]) => addReceiptExtras(props.order.id, lines),
};
</script>

<template>
  <Teleport to="body">
    <div id="receipt" class="hidden">
      <p class="shop">{{ shop?.name }}</p>
      <p class="meta">{{ t("pos.receipt_order", { id: order.reference ?? order.id, date: fmtDate(order.created_at) }) }}</p>
      <p class="meta">{{ t("pos.receipt_payment", { method: order.payment_method }) }}</p>
      <!-- the note already opens with "Deliver to: <name> · <phone>", so it replaces the Customer line -->
      <p v-if="order.note" class="meta note">{{ slipNote(order.note) }}</p>
      <p v-else-if="order.customer" class="meta">{{ order.customer.phone ? t("pos.receipt_customer_phone", { name: order.customer.name, phone: order.customer.phone }) : t("pos.receipt_customer", { name: order.customer.name }) }}</p>
      <p v-if="order.status === 'voided'" class="bold center">{{ t("pos.receipt_voided") }}</p>
      <hr />
      <template v-for="(it, i) in order.items" :key="i">
        <p class="row"><span>{{ it.qty }} × {{ it.name }}</span><span>{{ money(it.price * it.qty, currency) }}</span></p>
        <p v-if="it.note" class="meta note">  {{ it.note }}</p>
      </template>
      <hr />
      <template v-if="order.discount || order.delivery_fee || order.tax">
        <p class="row"><span>{{ t("common.subtotal") }}</span><span>{{ money(order.subtotal, currency) }}</span></p>
        <p v-if="order.discount" class="row"><span>{{ order.discount_type === "percent" ? t("pos.discount_percent", { value: order.discount_value }) : t("common.discount") }}<template v-if="order.coupon_code"> {{ order.coupon_code }}</template></span><span>−{{ money(order.discount, currency) }}</span></p>
      </template>
      <p v-if="order.tax" class="row"><span>{{ taxLabel(order, t("common.tax_included_prefix")) }}</span><span>{{ money(order.tax, currency) }}</span></p>
      <p v-if="order.delivery_fee" class="row"><span>{{ t("pos.delivery") }}</span><span>{{ money(order.delivery_fee, currency) }}</span></p>
      <p class="row bold"><span>{{ t("common.total") }}</span><span>{{ money(order.total, currency) }}</span></p>
      <p class="row"><span>{{ t("pos.paid") }}</span><span>{{ money(order.paid, currency) }}</span></p>
      <!-- an unpaid / partly paid online order (cash on delivery, bank transfer) prints what is still due, not change -->
      <p v-if="order.payment_status && order.payment_status !== 'paid'" class="row bold"><span>{{ t("pos.due") }}</span><span>{{ money(order.total - order.paid, currency) }}</span></p>
      <p v-else class="row bold"><span>{{ t("pos.change") }}</span><span>{{ money(order.change, currency) }}</span></p>
      <p v-if="order.refunded" class="row"><span>{{ t("pos.refunded") }}</span><span>−{{ money(order.refunded, currency) }}</span></p>
      <hr />
      <template v-if="extras.length">
        <p v-for="(line, i) in extras" :key="i" :class="[line.right ? 'row' : 'meta', line.bold && 'bold', line.center && 'center']" data-receipt-extra>
          <template v-if="line.right"><span>{{ line.text }}</span><span>{{ line.right }}</span></template>
          <template v-else>{{ line.text }}</template>
        </p>
        <hr />
      </template>
      <p class="meta center">{{ t("pos.thank_you") }}</p>
    </div>
  </Teleport>
  <!-- outside the slip: the scripts add text lines, their elements are never printed -->
  <ExtensionSlot :key="seen" name="order.receipt" :context="receiptSlot" class="hidden" />
</template>
