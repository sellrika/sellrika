<script setup lang="ts">
import { ref, watch } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import { ChevronRight, Search, Settings } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import Pager from "@/components/Pager.vue";
import SignupSwitch from "@/components/SignupSwitch.vue";
import SortButton from "@/components/SortButton.vue";
import WithTooltip from "@/components/WithTooltip.vue";
import { fmtDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ariaSort, dirOf, nextSort, type Sort } from "@/lib/sort";
import type { OwnerRow, Paged } from "@/types";

defineOptions({ layout: AppLayout });
/** The platform admin's list of shop owners (`/owners`, server-paged and searched). */
const props = defineProps<{
	owners: Paged<OwnerRow>;
	filters: { q: string; sort: Sort | null };
	signup: boolean; // people may create their own account on /register
}>();

/** The settings dialog (the sign-up switch). */
const settingsOpen = ref(false);

// search and sort are server-side (?q=&sort=&dir=&page=)
const search = ref(props.filters.q);
const sort = ref<Sort | null>(props.filters.sort);

/** Reload the list with the current search and sort. */
function applyFilters() {
	router.get(
		"/owners",
		{
			q: search.value.trim() || undefined,
			sort: sort.value?.by,
			dir: sort.value?.dir,
		},
		{ preserveState: true, preserveScroll: true, replace: true },
	);
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, function find() {
	clearTimeout(timer);
	timer = setTimeout(applyFilters, 300);
});
watch(sort, applyFilters);

/**
 * A click on a column title: sort by it, flip it, or back to the newest first.
 * @param by The column.
 */
function sortBy(by: string) {
	sort.value = nextSort(sort.value, by);
}

/**
 * The date as a short day, or a dash.
 * @param s The date, or null.
 * @returns What to show.
 */
function day(s: string | null) {
	return s ? fmtDate(s, { dateStyle: "medium" }) : "—";
}

/**
 * The date and time, or a dash.
 * @param s The moment, or null.
 * @returns What to show.
 */
function moment(s: string | null) {
	return s ? fmtDate(s) : "—";
}
</script>

<template>
  <Head :title="t('owners.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-center gap-3">
      <header class="mr-auto space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("owners.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("owners.subtitle") }}</p>
      </header>
      <div class="relative w-64">
        <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="search" type="search" class="pl-8" :aria-label="t('owners.search')" :placeholder="t('owners.search')" />
      </div>
      <WithTooltip :label="t('nav.settings')"><Button variant="outline" size="icon" :aria-label="t('nav.settings')" @click="settingsOpen = true"><Settings /></Button></WithTooltip>
    </div>

    <Dialog v-model:open="settingsOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ t("nav.settings") }}</DialogTitle>
          <DialogDescription class="sr-only">{{ t("register.signup_help") }}</DialogDescription>
        </DialogHeader>
        <SignupSwitch :enabled="signup" />
      </DialogContent>
    </Dialog>

    <Card class="py-0">
      <Table :aria-label="t('owners.title')">
        <TableHeader>
          <TableRow>
            <TableHead :aria-sort="ariaSort(sort, 'name')"><SortButton :label="t('owners.owner')" :dir="dirOf(sort, 'name')" @click="sortBy('name')" /></TableHead>
            <TableHead class="text-right" :aria-sort="ariaSort(sort, 'shops')"><SortButton :label="t('owners.shops')" :dir="dirOf(sort, 'shops')" @click="sortBy('shops')" /></TableHead>
            <TableHead class="hidden text-right sm:table-cell" :aria-sort="ariaSort(sort, 'staff')"><SortButton :label="t('owners.staff')" :dir="dirOf(sort, 'staff')" @click="sortBy('staff')" /></TableHead>
            <TableHead class="hidden md:table-cell" :aria-sort="ariaSort(sort, 'last_active')"><SortButton :label="t('owners.last_active')" :dir="dirOf(sort, 'last_active')" @click="sortBy('last_active')" /></TableHead>
            <TableHead class="hidden md:table-cell" :aria-sort="ariaSort(sort, 'last_order')"><SortButton :label="t('owners.last_order')" :dir="dirOf(sort, 'last_order')" @click="sortBy('last_order')" /></TableHead>
            <TableHead class="hidden md:table-cell" :aria-sort="ariaSort(sort, 'joined')"><SortButton :label="t('owners.joined')" :dir="dirOf(sort, 'joined')" @click="sortBy('joined')" /></TableHead>
            <TableHead class="w-px" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="o in owners.data" :key="o.id" class="cursor-pointer" @click="router.visit(`/owners/${o.id}`)">
            <TableCell>
              <Link :href="`/owners/${o.id}`" class="font-medium hover:underline" @click.stop>{{ o.name }}</Link>
              <Badge v-if="o.invited" variant="secondary" class="ml-2">{{ t("owners.invited") }}</Badge>
              <Badge v-else-if="!o.active" variant="outline" class="ml-2">{{ t("owners.inactive") }}</Badge>
              <div class="text-xs text-muted-foreground">{{ o.email }}</div>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ o.shops }}</TableCell>
            <TableCell class="hidden text-right tabular-nums sm:table-cell">{{ o.staff }}</TableCell>
            <TableCell class="hidden text-muted-foreground md:table-cell">{{ moment(o.last_active_at) }}</TableCell>
            <TableCell class="hidden text-muted-foreground md:table-cell">{{ day(o.last_order_at) }}</TableCell>
            <TableCell class="hidden text-muted-foreground md:table-cell">{{ day(o.created_at) }}</TableCell>
            <TableCell><ChevronRight class="size-4 text-muted-foreground" /></TableCell>
          </TableRow>
          <TableRow v-if="!owners.data.length">
            <TableCell colspan="7" class="py-10 text-center text-muted-foreground">{{ t("owners.none") }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <Pager :page="owners" />
  </div>
</template>
