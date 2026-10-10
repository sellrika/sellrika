<script setup lang="ts">
import { computed, ref } from "vue";
import { Head, Link, router, useForm } from "@inertiajs/vue3";
import { watchDebounced } from "@vueuse/core";
import { toast } from "vue-sonner";
import {
	Boxes,
	History,
	ImageIcon,
	Minus,
	Package,
	PackageX,
	Pencil,
	Plus,
	Search,
	SlidersHorizontal,
	TriangleAlert,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard.vue";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Pager from "@/components/Pager.vue";
import { useFitPage } from "@/lib/fitPage";
import { fmtDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Paged, StockItem, StockMovement } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	items: Paged<StockItem>;
	summary: { tracked: number; low: number; out: number };
	filters: { q: string; filter: "all" | "low" | "out" };
}>();

// Filters (server-side: ?filter=&q=&page=) ------------------------------------
const search = ref(props.filters.q);
const filter = ref<"all" | "low" | "out">(props.filters.filter);
const filtering = computed(
	() => !!props.filters.q || props.filters.filter !== "all",
);
const params = () => ({
	filter: filter.value === "all" ? undefined : filter.value,
	q: search.value.trim() || undefined,
});
const apply = () =>
	router.get("/stock", params(), {
		preserveState: true,
		preserveScroll: true,
		replace: true,
	});
watchDebounced(search, apply, { debounce: 300 });
const setFilter = (v: "all" | "low" | "out") => {
	filter.value = v;
	apply();
};
const clearFilters = () => {
	search.value = "";
	filter.value = "all";
	router.get("/stock", {}, { preserveState: true, replace: true });
};
// page size follows the screen height (header + stats + tabs + table head + pager ≈ 420px around the rows)
useFitPage("stock", "/stock", 420, () => props.items.per_page, params);

const unitName = (i: StockItem) =>
	i.variant_name ? `${i.name} — ${i.variant_name}` : i.name;
const stockClass = (i: StockItem) =>
	i.stock <= 0
		? "text-destructive"
		: i.stock <= i.low_stock_at
			? "text-amber-600 dark:text-amber-400"
			: "";

// Adjust ----------------------------------------------------------------------
const adjusting = ref<StockItem | null>(null);
const mode = ref<"add" | "remove" | "set">("add");
const qty = ref(1);
const form = useForm({
	product_id: 0,
	variant_id: null as number | null,
	delta: null as number | null,
	set: null as number | null,
	reason: "received" as "received" | "count" | "damaged" | "other",
	note: "",
});
const REASONS = [
	["received", "stock.reason_received"],
	["count", "stock.reason_count"],
	["damaged", "stock.reason_damaged"],
	["other", "stock.reason_other"],
] as const;

function startAdjust(i: StockItem) {
	adjusting.value = i;
	mode.value = "add";
	qty.value = 1;
	form.clearErrors();
	form.defaults({
		product_id: i.product_id,
		variant_id: i.variant_id,
		delta: null,
		set: null,
		reason: "received",
		note: "",
	});
	form.reset();
}
const nextStock = computed(() => {
	const n = Number(qty.value) || 0;
	const cur = adjusting.value?.stock ?? 0;
	return mode.value === "set" ? n : mode.value === "remove" ? cur - n : cur + n;
});
function submitAdjust() {
	const n = Number(qty.value) || 0;
	form.delta = mode.value === "set" ? null : mode.value === "remove" ? -n : n;
	form.set = mode.value === "set" ? n : null;
	form.post("/stock/adjust", {
		preserveScroll: true,
		onSuccess: () => {
			toast.success(
				t("stock.updated_toast", { name: unitName(adjusting.value!) }),
			);
			adjusting.value = null;
		},
	});
}

// History ---------------------------------------------------------------------
const MOVE_STYLE: Record<StockMovement["type"], string> = {
	sale: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
	refund:
		"border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
	void: "border-muted-foreground/30 bg-muted text-muted-foreground",
	adjustment:
		"border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};
/** The movement type badge, in the page's language. */
const MOVE_LABEL = {
	sale: "stock.type_sale",
	refund: "stock.type_refund",
	void: "stock.type_void",
	adjustment: "stock.type_adjustment",
} as const;
const history = ref<StockItem | null>(null);
const moves = ref<StockMovement[]>([]);
const movePage = ref(1);
const lastPage = ref(1);
const loading = ref(false);

async function loadMoves(i: StockItem, page: number) {
	loading.value = true;
	try {
		const q = new URLSearchParams({
			product_id: String(i.product_id),
			page: String(page),
		});
		if (i.variant_id !== null) q.set("variant_id", String(i.variant_id));
		const res = await fetch(`/stock/movements?${q}`, {
			credentials: "same-origin",
		});
		const p: Paged<StockMovement> = await res.json();
		moves.value = page === 1 ? p.data : [...moves.value, ...p.data];
		movePage.value = p.page;
		lastPage.value = p.last_page;
	} catch {
		toast.error(t("stock.history_error"));
	} finally {
		loading.value = false;
	}
}
function startHistory(i: StockItem) {
	history.value = i;
	moves.value = [];
	movePage.value = 1;
	lastPage.value = 1;
	loadMoves(i, 1);
}
</script>

<template>
  <Head :title="t('stock.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ t("stock.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("stock.subtitle") }}</p>
      </div>
      <div class="relative w-full sm:w-64">
        <Search class="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground" />
        <Input v-model="search" class="pl-8" :placeholder="t('stock.search_placeholder')" type="search" :aria-label="t('stock.search_aria')" />
      </div>
    </div>

    <!-- Stats (each one doubles as a filter shortcut) -->
    <div class="grid gap-3 sm:grid-cols-3">
      <StatCard :label="t('stock.tracked_units')" :icon="Boxes" :value="summary.tracked" class="cursor-pointer transition-colors hover:ring-foreground/25" role="button" tabindex="0" @click="setFilter('all')" @keydown.enter="setFilter('all')" @keydown.space.prevent="setFilter('all')" />
      <StatCard :label="t('stock.low_stock')" :icon="TriangleAlert" :value="summary.low" class="cursor-pointer transition-colors hover:ring-foreground/25" role="button" tabindex="0" @click="setFilter('low')" @keydown.enter="setFilter('low')" @keydown.space.prevent="setFilter('low')" />
      <StatCard :label="t('stock.out_of_stock')" :icon="PackageX" :value="summary.out" class="cursor-pointer transition-colors hover:ring-foreground/25" role="button" tabindex="0" @click="setFilter('out')" @keydown.enter="setFilter('out')" @keydown.space.prevent="setFilter('out')" />
    </div>

    <!-- Filter -->
    <Tabs v-if="summary.tracked" :model-value="filter" @update:model-value="(v) => setFilter(v as 'all' | 'low' | 'out')">
      <TabsList>
        <TabsTrigger value="all">{{ t("common.all") }}</TabsTrigger>
        <TabsTrigger value="low">{{ t("stock.low") }}</TabsTrigger>
        <TabsTrigger value="out">{{ t("stock.out") }}</TabsTrigger>
      </TabsList>
    </Tabs>

    <!-- Table -->
    <div v-if="items.data.length" class="overflow-hidden rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-14"><span class="sr-only">{{ t("stock.image") }}</span></TableHead>
            <TableHead>{{ t("stock.item") }}</TableHead>
            <TableHead class="w-28 text-right">{{ t("stock.in_stock") }}</TableHead>
            <TableHead class="hidden w-24 text-right sm:table-cell">{{ t("stock.alert_at") }}</TableHead>
            <TableHead class="w-56 text-right"><span class="sr-only">{{ t("common.actions") }}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="i in items.data" :key="`${i.product_id}-${i.variant_id ?? 0}`">
            <TableCell>
              <img v-if="i.image" :src="i.image" :alt="i.name" loading="lazy" decoding="async" class="size-10 rounded-md border object-cover" />
              <span v-else class="flex size-10 items-center justify-center rounded-md border bg-muted">
                <ImageIcon class="size-4 text-muted-foreground" />
              </span>
            </TableCell>
            <TableCell class="max-w-xs whitespace-normal">
              <Link :href="`/products/${i.product_id}/edit`" class="font-medium hover:underline">{{ i.name }}</Link>
              <p v-if="i.variant_name" class="text-xs text-muted-foreground">{{ i.variant_name }}</p>
              <p v-if="i.barcode" class="font-mono text-xs text-muted-foreground">{{ i.barcode }}</p>
            </TableCell>
            <TableCell class="text-right">
              <div class="text-lg font-semibold tabular-nums" :class="stockClass(i)">{{ i.stock }}</div>
              <Badge v-if="i.stock <= 0" variant="outline" class="border-destructive/40 bg-destructive/10 text-destructive">{{ t("stock.out_of_stock") }}</Badge>
              <Badge v-else-if="i.stock <= i.low_stock_at" variant="outline" class="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">{{ t("stock.low") }}</Badge>
            </TableCell>
            <TableCell class="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{{ i.low_stock_at }}</TableCell>
            <TableCell class="text-right">
              <div class="flex flex-wrap justify-end gap-1">
                <Button variant="outline" size="sm" @click="startAdjust(i)"><SlidersHorizontal /> {{ t("stock.adjust") }}</Button>
                <Button variant="ghost" size="sm" @click="startHistory(i)"><History /> {{ t("stock.history") }}</Button>
                <Button as-child variant="ghost" size="icon-sm" :aria-label="t('stock.edit_aria', { name: i.name })">
                  <Link :href="`/products/${i.product_id}/edit`"><Pencil /></Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <Pager :page="items" />

    <!-- Empty states -->
    <Card v-if="!items.data.length && filtering">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Search class="size-5" /></span>
        <p class="font-medium">{{ t("stock.nothing_matches") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("stock.nothing_matches_hint") }}</p>
        <Button variant="outline" class="mt-2" @click="clearFilters">{{ t("stock.clear_filters") }}</Button>
      </CardContent>
    </Card>
    <Card v-else-if="!items.data.length">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Package class="size-5" /></span>
        <p class="font-medium">{{ t("stock.nothing_tracked") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("stock.nothing_tracked_hint") }}</p>
        <Button as-child class="mt-2"><Link href="/products">{{ t("stock.go_to_products") }}</Link></Button>
      </CardContent>
    </Card>
  </div>

  <!-- Adjust -->
  <Dialog :open="!!adjusting" @update:open="(o: boolean) => !o && (adjusting = null)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("stock.adjust_title") }}</DialogTitle>
        <DialogDescription v-if="adjusting">{{ t("stock.in_stock_desc", { name: unitName(adjusting), count: adjusting.stock }) }}</DialogDescription>
      </DialogHeader>
      <form id="stock-adjust" class="grid gap-4" @submit.prevent="submitAdjust">
        <Tabs :model-value="mode" @update:model-value="(v) => (mode = v as 'add' | 'remove' | 'set')">
          <TabsList class="w-full">
            <TabsTrigger value="add"><Plus /> {{ t("common.add") }}</TabsTrigger>
            <TabsTrigger value="remove"><Minus /> {{ t("common.remove") }}</TabsTrigger>
            <TabsTrigger value="set">{{ t("stock.set_count") }}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div class="grid gap-2">
          <Label for="stock-qty">{{ mode === "set" ? t("stock.new_count") : t("common.quantity") }}</Label>
          <Input id="stock-qty" v-model="qty" type="number" inputmode="numeric" :min="mode === 'set' ? 0 : 1" step="1" autofocus class="tabular-nums" />
          <p v-if="adjusting" class="text-sm text-muted-foreground tabular-nums">{{ adjusting.stock }} → {{ nextStock }}</p>
          <p v-if="form.errors.delta" class="text-sm text-destructive">{{ form.errors.delta }}</p>
          <p v-if="form.errors.set" class="text-sm text-destructive">{{ form.errors.set }}</p>
          <p v-if="form.errors.product_id" class="text-sm text-destructive">{{ form.errors.product_id }}</p>
        </div>

        <div class="grid gap-2">
          <Label for="stock-reason">{{ t("stock.reason") }}</Label>
          <Select v-model="form.reason">
            <SelectTrigger id="stock-reason" class="w-full"><SelectValue :placeholder="t('stock.pick_reason')" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="[v, label] in REASONS" :key="v" :value="v">{{ t(label) }}</SelectItem>
            </SelectContent>
          </Select>
          <p v-if="form.errors.reason" class="text-sm text-destructive">{{ form.errors.reason }}</p>
        </div>

        <div class="grid gap-2">
          <Label for="stock-note">{{ t("stock.note") }} <span class="text-muted-foreground">{{ t("stock.optional_paren") }}</span></Label>
          <Textarea id="stock-note" v-model="form.note" rows="2" :placeholder="t('stock.note_placeholder')" />
        </div>
      </form>
      <DialogFooter>
        <Button variant="outline" type="button" @click="adjusting = null">{{ t("common.cancel") }}</Button>
        <Button type="submit" form="stock-adjust" :disabled="form.processing">{{ t("stock.save_adjustment") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- History -->
  <Sheet :open="!!history" @update:open="(o: boolean) => !o && (history = null)">
    <SheetContent class="w-full sm:max-w-md">
      <SheetHeader>
        <SheetTitle>{{ t("stock.history_title") }}</SheetTitle>
        <SheetDescription v-if="history">{{ t("stock.in_stock_desc", { name: unitName(history), count: history.stock }) }}</SheetDescription>
      </SheetHeader>

      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <ul v-if="moves.length" class="divide-y">
          <li v-for="m in moves" :key="m.id" class="flex items-start gap-3 py-3">
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-center gap-2">
                <Badge variant="outline" :class="MOVE_STYLE[m.type]">{{ t(MOVE_LABEL[m.type]) }}</Badge>
                <span class="text-xs text-muted-foreground">{{ fmtDate(m.created_at, { dateStyle: "medium", timeStyle: "short" }) }}</span>
              </div>
              <p class="text-sm">{{ m.reason }}</p>
              <p class="text-xs text-muted-foreground">
                <Link v-if="m.order_id" :href="`/orders/${m.order_id}`" class="hover:underline">{{ t("stock.order_hash", { id: m.order_id }) }}</Link>
                <span v-if="m.order_id && m.by"> · </span>
                <span v-if="m.by">{{ m.by }}</span>
              </p>
            </div>
            <span class="shrink-0 font-semibold tabular-nums" :class="m.qty < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'">
              {{ m.qty > 0 ? "+" : "" }}{{ m.qty }}
            </span>
          </li>
        </ul>
        <p v-else-if="loading" class="py-10 text-center text-sm text-muted-foreground">{{ t("common.loading") }}</p>
        <p v-else class="py-10 text-center text-sm text-muted-foreground">{{ t("stock.no_movements") }}</p>

        <Button
          v-if="movePage < lastPage"
          variant="outline"
          class="mt-3 w-full"
          :disabled="loading"
          @click="history && loadMoves(history, movePage + 1)"
        >
          {{ loading ? t("common.loading") : t("stock.load_more") }}
        </Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
