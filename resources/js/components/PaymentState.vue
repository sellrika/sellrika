<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/lib/i18n";
import { PAYMENT_STATUS } from "@/lib/orders";
import type { Order } from "@/types";

/**
 * Unpaid / partly paid only: a small pie filled by the share already paid. Nothing when fully paid or voided.
 * `pieOnly` = no label, for a place that already says it in words.
 */
const props = defineProps<{
	order: Pick<Order, "status" | "payment_status" | "paid" | "total">;
	pieOnly?: boolean;
}>();
const share = computed(() =>
	props.order.total > 0
		? Math.min(100, Math.round((props.order.paid / props.order.total) * 100))
		: 0,
);
</script>

<template>
  <span v-if="order.payment_status !== 'paid' && order.status !== 'voided'" class="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium"
    :class="order.payment_status === 'unpaid' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'">
    <span class="size-3 shrink-0 rounded-full border border-current" :style="{ background: `conic-gradient(currentColor ${share}%, transparent 0)` }" aria-hidden="true" />
    <template v-if="!pieOnly">{{ t(PAYMENT_STATUS[order.payment_status].label) }}</template>
  </span>
</template>
