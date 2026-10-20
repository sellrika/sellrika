<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, router, useForm } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Coins, Loader2, RefreshCw, Settings } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Card } from "@/components/ui/card";
import Pager from "@/components/Pager.vue";
import WithTooltip from "@/components/WithTooltip.vue";
import { fmtDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ExchangeRates, RateSchedule } from "@/types";

defineOptions({ layout: AppLayout });

// The automatic exchange rates of the whole platform: how often they are fetched, and the table the last fetch
// left. Every store's currency switcher uses them unless the shop typed a rate of its own.
const props = defineProps<{
	schedule: RateSchedule;
	schedules: RateSchedule[];
	rates: ExchangeRates;
}>();

/** The settings dialog (schedule + Refresh now + the last fetch). */
const settingsOpen = ref(false);

const form = useForm({ schedule: props.schedule });
/** Save how often the rates are fetched. */
function save() {
	form.put("/exchange-rates", {
		preserveScroll: true,
		preserveState: true,
		onSuccess: function saved() {
			toast.success(t("exchange_rates.saved"));
		},
	});
}

const refreshing = ref(false);
/** Fetch the rates now; the page comes back with the new table (or why it failed). */
function refresh() {
	const before = props.rates.tried_at;
	router.post(
		"/exchange-rates/refresh",
		{},
		{
			preserveScroll: true,
			preserveState: true,
			onStart: function started() {
				refreshing.value = true;
			},
			onSuccess: function done() {
				// a new failed try leaves its reason on the table
				if (props.rates.error && props.rates.tried_at !== before)
					toast.error(
						t("exchange_rates.refresh_failed", { error: props.rates.error }),
					);
				else toast.success(t("exchange_rates.refreshed"));
			},
			onFinish: function finished() {
				refreshing.value = false;
			},
		},
	);
}

/** Filter for the table: a code, or part of one. */
const q = ref("");
const rows = computed(() => {
	const f = q.value.trim().toUpperCase();
	return Object.entries(props.rates.rates)
		.filter(([code]) => !f || code.includes(f))
		.sort(([a], [b]) => a.localeCompare(b));
});

/** Rows per page; the table is paged in the browser (every rate is already here). */
const PER_PAGE = 20;
const pageNo = ref(1);
/** The current page of `rows`, shaped like a server page for `<Pager>`. */
const paged = computed(() => {
	const last = Math.max(1, Math.ceil(rows.value.length / PER_PAGE));
	const page = Math.min(pageNo.value, last);
	return {
		data: rows.value.slice((page - 1) * PER_PAGE, page * PER_PAGE),
		total: rows.value.length,
		page,
		per_page: PER_PAGE,
		last_page: last,
	};
});
/**
 * Show another page of the table.
 * @param n The page number.
 */
function goTo(n: number) {
	pageNo.value = n;
}
// a new filter starts again from page 1
watch(q, function resetPage() {
	pageNo.value = 1;
});
</script>

<template>
  <Head :title="t('exchange_rates.title')" />
  <div class="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-center gap-3">
      <header class="mr-auto space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("exchange_rates.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("exchange_rates.desc") }}</p>
      </header>
      <Input v-if="Object.keys(rates.rates).length" v-model="q" class="w-48" :placeholder="t('exchange_rates.filter')" :aria-label="t('exchange_rates.filter')" />
      <WithTooltip :label="t('nav.settings')"><Button variant="outline" size="icon" :aria-label="t('nav.settings')" @click="settingsOpen = true"><Settings /></Button></WithTooltip>
    </div>

    <Card v-if="Object.keys(rates.rates).length" class="py-0">
      <Table :aria-label="t('exchange_rates.table', { base: rates.base })">
        <TableHeader>
          <TableRow><TableHead class="pl-4">{{ t("exchange_rates.currency") }}</TableHead><TableHead class="pr-4 text-right">{{ t("exchange_rates.rate", { base: rates.base }) }}</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="[code, rate] in paged.data" :key="code">
            <TableCell class="pl-4 font-mono font-medium">{{ code }}</TableCell>
            <TableCell class="pr-4 text-right tabular-nums">{{ rate.toLocaleString(undefined, { maximumSignificantDigits: 8 }) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <Pager v-if="Object.keys(rates.rates).length" :page="paged" local @go="goTo" />
    <p v-else class="text-sm text-muted-foreground">{{ t("exchange_rates.never") }}</p>

    <Dialog v-model:open="settingsOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><Coins class="size-5" /> {{ t("exchange_rates.title") }}</DialogTitle>
          <DialogDescription>{{ t("exchange_rates.desc") }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-5">
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="save">
            <div class="grid min-w-56 gap-2">
              <Label for="rate-schedule">{{ t("exchange_rates.schedule") }}</Label>
              <Select v-model="form.schedule">
                <SelectTrigger id="rate-schedule" class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="s in schedules" :key="s" :value="s">{{ t(`exchange_rates.every_${s}`) }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" :disabled="form.processing || form.schedule === schedule">
              <Loader2 v-if="form.processing" class="animate-spin" /> {{ t("common.save") }}
            </Button>
            <Button type="button" variant="outline" class="ml-auto" :disabled="refreshing" @click="refresh">
              <RefreshCw :class="refreshing && 'animate-spin'" /> {{ t(refreshing ? "exchange_rates.refreshing" : "exchange_rates.refresh") }}
            </Button>
          </form>
          <p v-if="form.errors.schedule" class="text-sm text-destructive">{{ form.errors.schedule }}</p>
          <div class="space-y-1 text-sm" data-rates-status>
            <p v-if="rates.fetched_at" class="text-muted-foreground">{{ t("exchange_rates.updated", { date: fmtDate(rates.fetched_at), base: rates.base }) }}</p>
            <p v-else class="text-muted-foreground">{{ t("exchange_rates.never") }}</p>
            <p v-if="rates.error" class="text-destructive">{{ t("exchange_rates.failed", { date: fmtDate(rates.tried_at!), error: rates.error }) }}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
