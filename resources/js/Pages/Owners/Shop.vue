<script setup lang="ts">
import { computed } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import { ExternalLink, Package } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard.vue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import ShopLogo from "@/components/ShopLogo.vue";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { OwnerRow, OwnerShopReport, Shop, ShopTotals } from "@/types";

defineOptions({ layout: AppLayout });
/** One shop for the platform admin: its settings, all-time totals and the sales of a period. */
const props = defineProps<{
	owner: OwnerRow;
	shop: Shop;
	totals: ShopTotals;
	report: OwnerShopReport;
	/** The shop's online store address: its own domain, else its subdomain. */
	store_link: string;
}>();

const c = computed(() => props.shop.currency);
// the same periods as the shop's own /reports page (a custom range is left to that page)
const PRESETS = ["today", "7d", "this_month", "last_month", "this_year"];

/**
 * Show the report of another period.
 * @param preset The period key.
 */
function period(preset: string | number) {
	router.get(
		`/owners/${props.owner.id}/shops/${props.shop.id}`,
		{ preset: String(preset) },
		{ preserveScroll: true, replace: true },
	);
}

/**
 * The change against the previous period, in percent.
 * @param cur This period.
 * @param prev The period before.
 * @returns The percent, or null when there was nothing before.
 */
function pct(cur: number, prev: number) {
	return prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

const allTime = computed(() => [
	{
		label: t("owners.products"),
		value: String(props.totals.products),
		sub: t("owners.active_count", { count: props.totals.active_products }),
	},
	{
		label: t("owners.categories"),
		value: String(props.totals.categories),
		sub: "",
	},
	{
		label: t("owners.customers"),
		value: String(props.totals.customers),
		sub: "",
	},
	{
		label: t("owners.orders"),
		value: String(props.totals.orders),
		sub: t("owners.online_count", { count: props.totals.online_orders }),
	},
	{
		label: t("owners.sales"),
		value: money(props.totals.sales, c.value),
		sub: "",
	},
	{
		label: t("reports.refunds"),
		value: money(props.totals.refunds, c.value),
		sub: "",
	},
]);

const kpis = computed(() => {
	const s = props.report.summary;
	const p = props.report.previous;
	return [
		{
			label: t("reports.net_revenue"),
			value: money(s.revenue, c.value),
			delta: pct(s.revenue, p.revenue),
		},
		{
			label: t("reports.orders"),
			value: String(s.orders),
			delta: pct(s.orders, p.orders),
		},
		{
			label: t("reports.avg_order"),
			value: money(s.avg_order, c.value),
			delta: pct(s.avg_order, p.avg_order),
		},
		{
			label: t("reports.gross_profit"),
			value: money(s.profit, c.value),
			delta: pct(s.profit, p.profit),
		},
	];
});
// the tallest bar fills the chart; an empty period keeps flat bars
const peak = computed(() =>
	Math.max(1, ...props.report.series.map((b) => b.sales)),
);

/**
 * The date as a short day, or a dash.
 * @param s The date, or null.
 * @returns What to show.
 */
function day(s: string | null) {
	return s ? fmtDate(s, { dateStyle: "medium" }) : "—";
}
</script>

<template>
  <Head :title="shop.name" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header class="flex items-start gap-3">
      <BackButton :href="`/owners/${owner.id}`" :label="t('owners.back_to', { name: owner.name })" />
      <ShopLogo :shop="shop" class="size-12" />
      <div class="min-w-0 flex-1 space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ shop.name }}</h1>
        <p class="text-sm text-muted-foreground">
          <Link :href="`/owners/${owner.id}`" class="hover:underline">{{ owner.name }}</Link>
          · {{ shop.currency }} · {{ shop.timezone }} · {{ t("owners.created_on", { date: day(shop.created_at) }) }}
        </p>
        <div class="flex flex-wrap gap-2 pt-1">
          <Badge v-if="shop.online_enabled" variant="secondary" as-child>
            <a :href="store_link" target="_blank" rel="noopener">{{ t("owners.online_store") }} <ExternalLink /></a>
          </Badge>
          <Badge v-else variant="outline">{{ t("owners.store_off") }}</Badge>
          <Badge variant="outline">{{ t("owners.first_last", { first: day(totals.first_order_at), last: day(totals.last_order_at) }) }}</Badge>
        </div>
      </div>
    </header>

    <section class="space-y-3" :aria-label="t('owners.all_time')">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">{{ t("owners.all_time") }}</h2>
        <Button as-child variant="outline" size="sm"><Link :href="`/owners/${owner.id}/shops/${shop.id}/products`"><Package /> {{ t("owners.view_products") }}</Link></Button>
      </div>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard v-for="k in allTime" :key="k.label" :label="k.label" :value="k.value" :sub="k.sub" />
      </div>
    </section>

    <section class="space-y-3" :aria-label="t('owners.period')">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">{{ t("owners.period") }}</h2>
        <Tabs :model-value="report.query.preset" @update:model-value="period">
          <TabsList class="flex-wrap">
            <TabsTrigger v-for="p in PRESETS" :key="p" :value="p">{{ t(`reports.preset_${p}`) }}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value">
          <template v-if="k.delta !== null" #sub>
            <span :class="k.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'">{{ k.delta >= 0 ? "+" : "" }}{{ k.delta }}% {{ t("reports.vs_previous") }}</span>
          </template>
        </StatCard>
      </div>

      <Card>
        <CardHeader><CardTitle>{{ t("reports.sales") }}</CardTitle></CardHeader>
        <CardContent>
          <div class="flex h-40 items-end gap-1" role="img" :aria-label="t('reports.sales_chart_aria')">
            <div v-for="b in report.series" :key="b.key" class="flex-1 rounded-t bg-primary/80" :style="{ height: `${Math.max(2, (b.sales / peak) * 100)}%` }" :title="`${b.key}: ${money(b.sales, c)}`" />
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card class="py-0">
          <CardHeader class="pt-6"><CardTitle>{{ t("reports.top_products") }}</CardTitle></CardHeader>
          <Table :aria-label="t('reports.top_products')">
            <TableHeader>
              <TableRow>
                <TableHead>{{ t("owners.product") }}</TableHead>
                <TableHead class="text-right">{{ t("owners.qty") }}</TableHead>
                <TableHead class="text-right">{{ t("reports.revenue") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="p in report.top_products" :key="`${p.product_id}-${p.variant_id}-${p.name}`">
                <TableCell class="font-medium">{{ p.name }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ p.qty }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ money(p.revenue, c) }}</TableCell>
              </TableRow>
              <TableRow v-if="!report.top_products.length">
                <TableCell colspan="3" class="py-6 text-center text-muted-foreground">{{ t("reports.nothing_sold") }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
        <Card class="py-0">
          <CardHeader class="pt-6"><CardTitle>{{ t("reports.by_method") }}</CardTitle></CardHeader>
          <Table :aria-label="t('reports.by_method')">
            <TableHeader>
              <TableRow>
                <TableHead>{{ t("reports.method") }}</TableHead>
                <TableHead class="text-right">{{ t("reports.orders") }}</TableHead>
                <TableHead class="text-right">{{ t("reports.sales") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="m in report.by_method" :key="m.method">
                <TableCell class="font-medium">{{ m.method }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ m.orders }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ money(m.sales, c) }}</TableCell>
              </TableRow>
              <TableRow v-if="!report.by_method.length">
                <TableCell colspan="3" class="py-6 text-center text-muted-foreground">{{ t("reports.no_payments") }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    </section>
  </div>
</template>
