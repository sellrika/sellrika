<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	BadgePercent,
	HandCoins,
	ReceiptText,
	ShoppingBag,
	TrendingUp,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import StatCard from "@/components/StatCard.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SalesCommission, SalesStaff, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });

type Preset =
	| "today"
	| "yesterday"
	| "7d"
	| "last_week"
	| "this_month"
	| "last_month"
	| "this_year"
	| "custom";

const props = defineProps<{
	person: SalesStaff;
	/** What they sold in the period; `commission` = those sales at today's rate. */
	totals: { orders: number; sold: number; commission: number };
	payments: SalesCommission[]; // their commission payments, newest first
	query: { preset: Preset; from: string; to: string };
	today: string; // the shop's today, YYYY-MM-DD
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");
const url = computed(() => `/sales-staff/${props.person.id}`);
const rate = computed(() => `${props.person.commission / 100}%`);

// Period (server-side: ?preset=&from=&to=), the same periods as /reports ------
const PRESETS = computed<[Preset, string][]>(() => [
	["today", t("reports.preset_today")],
	["yesterday", t("reports.preset_yesterday")],
	["7d", t("reports.preset_7d")],
	["last_week", t("reports.preset_last_week")],
	["this_month", t("reports.preset_this_month")],
	["last_month", t("reports.preset_last_month")],
	["this_year", t("reports.preset_this_year")],
	["custom", t("reports.preset_custom")],
]);
const preset = ref<Preset>(props.query.preset);
const from = ref(props.query.from);
const to = ref(props.query.to);

// the server may change the query (a bad custom range): copy it back without asking again
let syncing = false;
watch(
	() => props.query,
	function mirror(q) {
		syncing = true;
		preset.value = q.preset;
		from.value = q.from;
		to.value = q.to;
		nextTick(function done() {
			syncing = false;
		});
	},
);

/**
 * Load the page for another period.
 * @param params The query string.
 */
function go(params: Record<string, string>) {
	router.get(url.value, params, {
		preserveState: true,
		preserveScroll: true,
		replace: true,
	});
}
watch(preset, function pick(v) {
	if (!syncing && v !== "custom") go({ preset: v });
});

/**
 * Load the page for the custom From / To days.
 */
function applyCustom() {
	go({ preset: "custom", from: from.value, to: to.value });
}

/**
 * A plain day as a date at local midnight (a bare "YYYY-MM-DD" would be read as UTC).
 * @param ymd The day.
 * @returns The date.
 */
function day(ymd: string) {
	return new Date(`${ymd}T00:00:00`);
}
/** "Sep 1, 2026 – Sep 30, 2026", or one day when the period is one day. */
const rangeLabel = computed(function label() {
	const opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
	const a = day(props.query.from).toLocaleDateString(undefined, opts);
	const b = day(props.query.to).toLocaleDateString(undefined, opts);
	return a === b ? a : `${a} – ${b}`;
});
/** What the "Commission due" card says under the amount. */
const dueSince = computed(function since() {
	const at = props.person.last_paid_at;
	return at
		? t("users.sales_due_since", { date: fmtDate(at, { dateStyle: "medium" }) })
		: t("users.sales_due_never");
});

/**
 * Pay the commission due.
 * The server works out the amount and saves it to the history, shown below.
 */
function pay() {
	router.post(
		`${url.value}/pay`,
		{},
		{
			preserveScroll: true,
			onSuccess: function done() {
				toast.success(t("users.sales_paid_toast", { name: props.person.name }));
			},
		},
	);
}
</script>

<template>
  <Head :title="person.name" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-start gap-3">
      <BackButton href="/users?tab=sales" :label="t('users.sales_back')" />
      <div class="mr-auto min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-xl font-semibold tracking-tight">{{ person.name }}</h1>
          <Badge variant="outline">{{ t("users.sales_rate", { rate }) }}</Badge>
          <Badge v-if="!person.active" variant="secondary">{{ t("users.sales_inactive") }}</Badge>
        </div>
        <p class="text-sm text-muted-foreground">{{ rangeLabel }}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger as-child>
          <Button :disabled="!person.due" :aria-label="t('users.sales_pay_aria', { name: person.name })"><HandCoins /> {{ t("users.sales_pay") }}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t("users.sales_pay_title", { name: person.name }) }}</AlertDialogTitle>
            <AlertDialogDescription>{{ t("users.sales_pay_desc", { amount: money(person.due, currency), sold: money(person.unpaid_sales, currency), rate, count: person.unpaid_orders }) }}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
            <AlertDialogAction @click="pay">{{ t("users.sales_pay_confirm") }}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button as-child variant="outline"><Link :href="`/orders?sales=${person.id}`"><ReceiptText /> {{ t("users.sales_view_orders") }}</Link></Button>
    </div>

    <!-- Period: a select box on phones, tabs on wider screens -->
    <Select v-model="preset">
      <SelectTrigger class="w-full sm:hidden" :aria-label="t('reports.period')"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="[v, label] in PRESETS" :key="v" :value="v">{{ label }}</SelectItem>
      </SelectContent>
    </Select>
    <Tabs v-model="preset" class="min-w-0 max-sm:hidden">
      <TabsList class="flex-wrap">
        <TabsTrigger v-for="[v, label] in PRESETS" :key="v" :value="v">{{ label }}</TabsTrigger>
      </TabsList>
    </Tabs>
    <div v-if="preset === 'custom'" class="flex flex-wrap items-end gap-2">
      <div class="grid gap-1">
        <label class="text-xs text-muted-foreground" for="ss-from">{{ t("reports.from") }}</label>
        <Input id="ss-from" v-model="from" type="date" :max="today" class="w-40" />
      </div>
      <div class="grid gap-1">
        <label class="text-xs text-muted-foreground" for="ss-to">{{ t("reports.to") }}</label>
        <Input id="ss-to" v-model="to" type="date" :max="today" class="w-40" />
      </div>
      <Button :disabled="!from || !to || from > to" @click="applyCustom">{{ t("reports.apply") }}</Button>
    </div>

    <!-- The period's numbers, then what is not paid yet (that one ignores the period) -->
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-sales-totals>
      <StatCard :label="t('users.sales_stat_sold')" :icon="TrendingUp" :value="money(totals.sold, currency)" :sub="t('users.sales_stat_sold_sub')" />
      <StatCard :label="t('users.sales_stat_commission')" :icon="BadgePercent" :value="money(totals.commission, currency)" :sub="t('users.sales_stat_commission_sub', { rate })" />
      <StatCard :label="t('users.sales_stat_count')" :icon="ShoppingBag" :value="totals.orders" :sub="t('users.sales_stat_count_sub')" />
      <StatCard :label="t('users.sales_stat_due')" :icon="HandCoins" :value="money(person.due, currency)" :sub="dueSince" />
    </div>

    <!-- Payment history -->
    <section class="space-y-3" :aria-label="t('users.sales_history')">
      <h2 class="text-lg font-semibold tracking-tight">{{ t("users.sales_history") }}</h2>
      <Card v-if="payments.length" class="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="pl-4">{{ t("common.date") }}</TableHead>
              <TableHead class="text-right">{{ t("users.sales_history_amount") }}</TableHead>
              <TableHead class="text-right">{{ t("users.sales_history_orders") }}</TableHead>
              <TableHead class="text-right">{{ t("users.sales_history_sales") }}</TableHead>
              <TableHead class="pr-4 text-right">{{ t("users.sales_commission") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="p in payments" :key="p.id">
              <TableCell class="whitespace-nowrap pl-4">{{ fmtDate(p.created_at) }}</TableCell>
              <TableCell class="text-right font-medium tabular-nums">{{ money(p.amount, currency) }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ p.orders }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ money(p.sales, currency) }}</TableCell>
              <TableCell class="pr-4 text-right tabular-nums">{{ p.commission / 100 }}%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
      <Card v-else>
        <CardContent class="py-8 text-center text-sm text-muted-foreground">{{ t("users.sales_history_empty") }}</CardContent>
      </Card>
    </section>
  </div>
</template>
