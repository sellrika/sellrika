<script setup lang="ts">
import { computed } from "vue";
import { Head, router, usePage } from "@inertiajs/vue3";
import {
	CalendarClock,
	ChevronRight,
	Hash,
	PiggyBank,
	ReceiptText,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Badge } from "@/components/ui/badge";
import StatCard from "@/components/StatCard.vue";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import Pager from "@/components/Pager.vue";
import { useFitPage } from "@/lib/fitPage";
import { couponLabel } from "@/lib/coupons";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ORDER_STATUS } from "@/lib/orders";
import type {
	CouponRedemption,
	CouponWithStats,
	Paged,
	SharedProps,
} from "@/types";

/** /coupons/:id — a code's history: how often it was used, what it gave away, and every order that used it
 *  (a voided order gives its use back, so it isn't here). Rows open the order. */
defineOptions({ layout: AppLayout });
const props = defineProps<{
	coupon: CouponWithStats;
	history: Paged<CouponRedemption>;
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");
useFitPage(
	"coupon_history",
	`/coupons/${props.coupon.id}`,
	330,
	() => props.history.per_page,
);

const lastUsed = computed(() => props.history.data[0]?.created_at ?? null); // newest first, so the first row of page 1 is the last use
const open = (r: CouponRedemption) => router.visit(`/orders/${r.order_id}`);
</script>

<template>
  <Head :title="t('coupons.show_title', { code: coupon.code })" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <BackButton href="/coupons" :label="t('coupons.back_aria')" size="icon-sm" />
      <div class="mr-auto min-w-0">
        <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <span class="font-mono" data-coupon-code>{{ coupon.code }}</span>
          <Badge :variant="coupon.active ? 'default' : 'outline'">{{ coupon.active ? t("coupons.status_active") : t("coupons.status_off") }}</Badge>
        </h1>
        <p class="text-sm text-muted-foreground">{{ couponLabel(coupon, currency) }}<template v-if="coupon.description"> · {{ coupon.description }}</template></p>
      </div>
    </div>

    <!-- Totals -->
    <div class="grid gap-4 sm:grid-cols-3">
      <StatCard :label="t('coupons.times_used')" :icon="Hash">
        <template #value><span data-used-count>{{ coupon.used_count }}<span v-if="coupon.usage_limit !== null" class="text-base font-normal text-muted-foreground"> / {{ coupon.usage_limit }}</span></span></template>
      </StatCard>
      <StatCard :label="t('coupons.total_given')" :icon="PiggyBank">
        <template #value><span data-saved-total>{{ money(coupon.saved_total, currency) }}</span></template>
      </StatCard>
      <StatCard :label="t('coupons.last_used')" :icon="CalendarClock" :value="lastUsed ? fmtDate(lastUsed, { dateStyle: 'medium' }) : '—'" />
    </div>

    <!-- Orders that used it -->
    <Card v-if="history.data.length" class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t("common.date") }}</TableHead>
            <TableHead>{{ t("coupons.order") }}</TableHead>
            <TableHead class="hidden sm:table-cell">{{ t("common.customer") }}</TableHead>
            <TableHead class="hidden w-32 text-right md:table-cell">{{ t("coupons.order_total") }}</TableHead>
            <TableHead class="w-32 text-right">{{ t("common.discount") }}</TableHead>
            <TableHead class="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in history.data" :key="r.id" class="cursor-pointer" tabindex="0" role="button" :aria-label="t('coupons.open_order_aria', { id: r.order_id })" @click="open(r)" @keydown.enter="open(r)" @keydown.space.prevent="open(r)">
            <TableCell class="pl-4 text-sm whitespace-nowrap">{{ fmtDate(r.created_at) }}</TableCell>
            <TableCell>
              <div class="font-mono text-sm">{{ r.reference ?? `#${r.order_id}` }}</div>
              <Badge v-if="r.order_status && r.order_status !== 'completed'" variant="outline" class="mt-0.5" :class="ORDER_STATUS[r.order_status]?.class">{{ ORDER_STATUS[r.order_status] ? t(ORDER_STATUS[r.order_status].label) : r.order_status }}</Badge>
            </TableCell>
            <TableCell class="hidden max-w-0 sm:table-cell">
              <div class="truncate">{{ r.customer_name || "—" }}</div>
              <div class="truncate text-xs text-muted-foreground">{{ r.email }}</div>
            </TableCell>
            <TableCell class="hidden text-right tabular-nums text-muted-foreground md:table-cell">{{ r.order_total === null ? "—" : money(r.order_total, currency) }}</TableCell>
            <TableCell class="text-right font-semibold tabular-nums">−{{ money(r.amount, currency) }}</TableCell>
            <TableCell class="pr-4 text-muted-foreground"><ChevronRight class="size-4" /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <Card v-else>
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><ReceiptText class="size-5" /></span>
        <p class="font-medium">{{ t("coupons.not_used_title") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("coupons.not_used_text", { code: coupon.code }) }}</p>
      </CardContent>
    </Card>

    <Pager :page="history" />
  </div>
</template>
