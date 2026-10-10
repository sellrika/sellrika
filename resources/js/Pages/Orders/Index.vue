<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { watchDebounced } from "@vueuse/core";
import {
	ChevronRight,
	ReceiptText,
	Search,
	Settings,
	ShoppingBag,
	TrendingUp,
	UserRound,
	X,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard.vue";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import Pager from "@/components/Pager.vue";
import PaymentState from "@/components/PaymentState.vue";
import StepsDialog from "@/components/orders/StepsDialog.vue";
import { useAuth } from "@/lib/auth";
import { useFitPage } from "@/lib/fitPage";
import { money, fmtDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { methodStyle, paymentIcon } from "@/lib/paymentIcons";
import { deliveryHidden, stepLabel, statusBadges } from "@/lib/orders";
import type { Order, Paged, PaymentMethod, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	orders: Paged<Order>;
	stats: { today_revenue: number; today_orders: number; avg_order: number };
	payment_methods: PaymentMethod[];
	order_methods: string[]; // every payment name on this shop's orders (online gateways, deleted methods too)
	cashiers: { id: number; name: string }[]; // the staff who made sales here
	sales_staff: { id: number; name: string }[]; // the shop's sales people
	filters: {
		q: string;
		method: string;
		cashier: number | null;
		sales: number | null;
		status: string;
		customer: number | null;
		source: string;
		fulfillment: string;
	};
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");
const { isAdmin } = useAuth();
/** The shop's delivery steps, in its order (the Online filter + badges); admins edit them in `StepsDialog`. */
const steps = computed(() => page.props.shop?.fulfillment_steps ?? []);
const stepsOpen = ref(false);
/** A running extension took the delivery steps off this list (`orders.delivery`, e.g. a restaurant: nothing is shipped). */
const noDelivery = computed(deliveryHidden);

// Filters (server-side: ?q=&method=&status=&customer=&page=) -------------------
const search = ref(props.filters.q);
const method = ref(props.filters.method);
const cashier = ref(
	props.filters.cashier ? String(props.filters.cashier) : "all",
);
const sales = ref(props.filters.sales ? String(props.filters.sales) : "all");
const status = ref(props.filters.status);
const source = ref(props.filters.source);
const fulfillment = ref(props.filters.fulfillment);
const filtering = computed(
	() =>
		!!props.filters.q ||
		props.filters.method !== "all" ||
		!!props.filters.cashier ||
		!!props.filters.sales ||
		props.filters.status !== "all" ||
		props.filters.source !== "all" ||
		props.filters.fulfillment !== "all" ||
		!!props.filters.customer,
);
const params = () => ({
	q: search.value.trim() || undefined,
	method: method.value === "all" ? undefined : method.value,
	cashier: cashier.value === "all" ? undefined : cashier.value,
	sales: sales.value === "all" ? undefined : sales.value,
	status: status.value === "all" ? undefined : status.value,
	source: source.value === "all" ? undefined : source.value,
	fulfillment:
		source.value !== "pos" && fulfillment.value !== "all"
			? fulfillment.value
			: undefined,
	customer: props.filters.customer || undefined,
});
const applyFilters = () =>
	router.get("/orders", params(), {
		preserveState: true,
		preserveScroll: true,
		replace: true,
	});
watchDebounced(search, applyFilters, { debounce: 300 });
watch([method, cashier, sales, status, source, fulfillment], applyFilters);
const clearFilters = () => {
	search.value = "";
	method.value = "all";
	cashier.value = "all";
	sales.value = "all";
	status.value = "all";
	source.value = "all";
	fulfillment.value = "all";
	router.get("/orders", {}, { preserveState: true, replace: true });
};
// page size follows the screen height (header + stats + tabs + table head + pager ≈ 420px around the rows)
useFitPage("orders", "/orders", 420, () => props.orders.per_page, params);
// filter options: the value goes to the server, the label is a dictionary key translated at render
const STATUS_TABS = [
	["all", "common.all"],
	["completed", "orders.completed"],
	["unpaid", "orders.unpaid"],
	["refunded_any", "orders.refunded"],
	["voided", "orders.voided"],
] as const;
const SOURCE_TABS = [
	["all", "orders.any_source"],
	["pos", "orders.pos"],
	["online", "orders.online"],
] as const;
/** "2 matching sales for Ada's shop" — one whole sentence, never glued from pieces. */
const headline = computed(function line() {
	const count = props.orders.total;
	const shop = page.props.shop?.name ?? t("orders.your_shop");
	if (filtering.value)
		return t(count === 1 ? "orders.matching_one" : "orders.matching_other", {
			count,
			shop,
		});
	return t(count === 1 ? "orders.count_one" : "orders.count_other", {
		count,
		shop,
	});
});
// the customer filter comes from a customer page link; show who it is from the first row
const customerName = computed(() =>
	props.filters.customer
		? (props.orders.data[0]?.customer?.name ?? `#${props.filters.customer}`)
		: null,
);

// Helpers ---------------------------------------------------------------------
const itemCount = (o: Order) => o.items.reduce((s, i) => s + i.qty, 0);
const summary = (o: Order) =>
	o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
// orders store the method *name*; icon/color come from the shop's current methods (deleted ones fall back to a plain badge)
const methodByName = computed(
	() => new Map(props.payment_methods.map((m) => [m.name, m])),
);
const methodIcon = (name: string) =>
	paymentIcon(methodByName.value.get(name)?.icon);
const methodStyleOf = (name: string) =>
	methodStyle(methodByName.value.get(name)?.color);
// filter options: the shop's methods (with icons) + the other names orders carry (Stripe, Cash on delivery, deleted methods)
const otherMethods = computed(() =>
	props.order_methods.filter((n) => !methodByName.value.has(n)),
);

const open = (o: Order) => router.visit(`/orders/${o.id}`);
</script>

<template>
  <Head :title="t('orders.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ t("orders.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ headline }}</p>
      </div>
      <div class="relative w-full sm:w-64">
        <Search class="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground" />
        <Input v-model="search" class="pl-8" :placeholder="t('orders.search_placeholder')" type="search" :aria-label="t('orders.search_label')" />
      </div>
      <Button v-if="isAdmin && !noDelivery" variant="outline" size="icon" :aria-label="t('orders.steps_open')" :title="t('orders.steps_open')" @click="stepsOpen = true"><Settings /></Button>
    </div>
    <StepsDialog v-if="isAdmin && !noDelivery" v-model:open="stepsOpen" />

    <!-- Stats -->
    <div v-if="orders.total || filtering" class="grid gap-3 sm:grid-cols-3">
      <StatCard :label="t('orders.today_revenue')" :icon="TrendingUp" :value="money(stats.today_revenue, currency)" />
      <StatCard :label="t('orders.today_orders')" :icon="ShoppingBag" :value="stats.today_orders" />
      <StatCard :label="t('orders.avg_order')" :icon="ReceiptText" :value="money(stats.avg_order, currency)" />
    </div>

    <!-- Filters: status + payment method + cashier (+ customer chip when coming from a customer page) -->
    <div v-if="orders.total || filtering" class="flex flex-wrap items-center gap-3">
      <Tabs v-model="source">
        <TabsList>
          <TabsTrigger v-for="[v, label] in SOURCE_TABS" :key="v" :value="v">{{ t(label) }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Select v-model="status">
        <SelectTrigger :aria-label="t('orders.order_status')"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="[v, label] in STATUS_TABS" :key="v" :value="v">{{ t(label) }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="method">
        <SelectTrigger :aria-label="t('orders.payment_method')"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t("orders.any_payment") }}</SelectItem>
          <SelectItem v-for="m in payment_methods" :key="m.id" :value="m.name"><component :is="paymentIcon(m.icon)" /> {{ m.name }}</SelectItem>
          <SelectItem v-for="n in otherMethods" :key="n" :value="n"><component :is="paymentIcon(null)" /> {{ n }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-if="cashiers.length" v-model="cashier">
        <SelectTrigger :aria-label="t('orders.cashier')"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t("orders.any_cashier") }}</SelectItem>
          <SelectItem v-for="c in cashiers" :key="c.id" :value="String(c.id)"><UserRound /> {{ c.name }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-if="sales_staff.length" v-model="sales">
        <SelectTrigger :aria-label="t('orders.sales_staff')"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t("orders.any_sales_staff") }}</SelectItem>
          <SelectItem v-for="s in sales_staff" :key="s.id" :value="String(s.id)"><UserRound /> {{ s.name }}</SelectItem>
        </SelectContent>
      </Select>
      <!-- the shop's delivery steps: only online orders have one, so hidden under POS -->
      <Tabs v-if="source !== 'pos' && !noDelivery" v-model="fulfillment">
        <TabsList>
          <TabsTrigger value="all">{{ t("orders.any_stage") }}</TabsTrigger>
          <TabsTrigger v-for="f in steps" :key="f.key" :value="f.key">{{ stepLabel(f.key, steps) }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Badge v-if="customerName" variant="secondary" class="h-8 gap-1.5 px-2.5 text-sm">
        <UserRound class="size-3.5" /> {{ customerName }}
        <button type="button" class="-mr-1 rounded-full p-0.5 hover:bg-background" :aria-label="t('orders.clear_customer_filter')" @click="clearFilters"><X class="size-3.5" /></button>
      </Badge>
    </div>

    <!-- Table -->
    <Card v-if="orders.data.length" class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-44 pl-4">{{ t("orders.order") }}</TableHead>
            <TableHead class="hidden min-w-48 md:table-cell">{{ t("orders.items") }}</TableHead>
            <TableHead class="hidden w-36 xl:table-cell">{{ t("common.customer") }}</TableHead>
            <TableHead class="w-36">{{ t("orders.payment") }}</TableHead>
            <TableHead class="hidden w-44 md:table-cell">{{ t("common.status") }}</TableHead>
            <TableHead class="w-36">{{ t("common.date") }}</TableHead>
            <TableHead class="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="o in orders.data"
            :key="o.id"
            class="cursor-pointer"
            tabindex="0"
            role="button"
            :aria-label="t('orders.open_order', { id: o.id })"
            :class="o.status === 'voided' && 'text-muted-foreground'"
            @click="open(o)"
            @keydown.enter="open(o)"
            @keydown.space.prevent="open(o)"
          >
            <TableCell class="pl-4">
              <span class="whitespace-nowrap font-mono text-[13px] font-medium"><span class="text-muted-foreground">#</span> {{ o.reference ?? o.id }}</span>
            </TableCell>
            <TableCell class="hidden max-w-0 md:table-cell">
              <div class="flex items-center gap-2">
                <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{{ itemCount(o) }}</span>
                <span class="truncate">{{ summary(o) }}</span>
              </div>
            </TableCell>
            <TableCell class="hidden max-w-0 truncate text-muted-foreground xl:table-cell">{{ o.customer?.name ?? "—" }}</TableCell>
            <TableCell>
              <p class="font-semibold tabular-nums" :class="o.status === 'voided' && 'line-through'">{{ money(o.total, currency) }}</p>
              <p class="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                <span class="flex size-4 items-center justify-center rounded [&_svg]:size-3" :style="methodStyleOf(o.payment_method)"><component :is="methodIcon(o.payment_method)" /></span>
                {{ o.payment_method }}
                <span v-if="o.refunded && o.status !== 'voided'" class="text-amber-600 dark:text-amber-400">· −{{ money(o.refunded, currency) }}</span>
              </p>
            </TableCell>
            <TableCell class="hidden md:table-cell">
              <div class="flex flex-nowrap gap-1">
                <Badge v-for="b in statusBadges(o, steps)" :key="b.label" variant="outline" class="rounded-full" :class="b.class" :style="b.style">{{ b.label }}</Badge>
              </div>
              <PaymentState :order="o" class="mt-1" />
            </TableCell>
            <TableCell class="whitespace-nowrap">
              <div class="text-sm">{{ fmtDate(o.created_at, { dateStyle: "medium" }) }}</div>
              <div class="text-xs text-muted-foreground">{{ fmtDate(o.created_at, { timeStyle: "short" }) }}</div>
            </TableCell>
            <TableCell class="pr-4 text-muted-foreground"><ChevronRight class="size-4" /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <Pager :page="orders" />

    <!-- Empty states -->
    <Card v-if="!orders.data.length && filtering">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Search class="size-5" /></span>
        <p class="font-medium">{{ t("orders.no_matching") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("orders.no_matching_body") }}</p>
        <Button variant="outline" class="mt-2" @click="clearFilters">{{ t("orders.clear_filters") }}</Button>
      </CardContent>
    </Card>
    <Card v-else-if="!orders.data.length">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><ReceiptText class="size-5" /></span>
        <p class="font-medium">{{ t("orders.no_sales") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("orders.no_sales_body") }}</p>
        <Button as-child class="mt-2"><Link href="/pos">{{ t("orders.go_to_sell") }}</Link></Button>
      </CardContent>
    </Card>

  </div>
</template>
