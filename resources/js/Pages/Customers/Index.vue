<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, router, useForm, usePage } from "@inertiajs/vue3";
import { watchDebounced } from "@vueuse/core";
import { toast } from "vue-sonner";
import { ChevronRight, Plus, Search, UsersRound } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import Pager from "@/components/Pager.vue";
import { useFitPage } from "@/lib/fitPage";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ariaSort, dirOf, nextSort, type Sort } from "@/lib/sort";
import SortButton from "@/components/SortButton.vue";
import type { CustomerWithStats, Paged, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	customers: Paged<CustomerWithStats>;
	filters: { q: string; sort: Sort | null };
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");

// Search and sort are server-side (?q=&sort=&dir=&page=); search looks at name/phone/email
const search = ref(props.filters.q);
const sort = ref<Sort | null>(props.filters.sort);
const params = () => ({
	q: search.value.trim() || undefined,
	sort: sort.value?.by,
	dir: sort.value?.dir,
});
/** Reload the list with the current search and sort. */
function applyFilters() {
	router.get("/customers", params(), {
		preserveState: true,
		preserveScroll: true,
		replace: true,
	});
}
watchDebounced(search, applyFilters, { debounce: 300 });
watch(sort, applyFilters);
/**
 * A click on a column title: sort by it, flip it, or back to the newest first.
 * @param by - the column
 */
function sortBy(by: string) {
	sort.value = nextSort(sort.value, by);
}
// page size follows the screen height (header + table head + pager ≈ 230px around the rows)
useFitPage(
	"customers",
	"/customers",
	230,
	() => props.customers.per_page,
	params,
);

const initials = (name: string) =>
	name
		.split(" ")
		.map((p) => p[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
const open = (c: CustomerWithStats) => router.visit(`/customers/${c.id}`);
/** "2 matching customers" — one whole sentence, never glued from pieces. */
const headline = computed(function line() {
	const count = props.customers.total;
	if (props.filters.q)
		return t(
			count === 1 ? "customers.matching_one" : "customers.matching_other",
			{ count },
		);
	return t(count === 1 ? "customers.count_one" : "customers.count_other", {
		count,
	});
});

const creating = ref(false);
const form = useForm({ name: "", phone: "", email: "", note: "" });
function create() {
	form.post("/customers", {
		preserveScroll: true,
		onSuccess: () => {
			creating.value = false;
			form.reset();
			toast.success(t("customers.added"));
		},
	});
}
</script>

<template>
  <Head :title="t('customers.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ t("customers.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ headline }}</p>
      </div>
      <div class="relative w-full sm:w-64">
        <Search class="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground" />
        <Input v-model="search" class="pl-8" :placeholder="t('customers.search_placeholder')" type="search" :aria-label="t('customers.search_label')" />
      </div>
      <Button @click="creating = true"><Plus /> {{ t("customers.add") }}</Button>
    </div>

    <!-- Empty state -->
    <Card v-if="!customers.total && !filters.q">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><UsersRound class="size-5" /></span>
        <p class="font-medium">{{ t("customers.none") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("customers.none_body") }}</p>
        <Button class="mt-2" @click="creating = true"><Plus /> {{ t("customers.add") }}</Button>
      </CardContent>
    </Card>

    <!-- Table -->
    <Card v-else-if="customers.data.length" class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4" :aria-sort="ariaSort(sort, 'name')"><SortButton :label="t('common.customer')" :dir="dirOf(sort, 'name')" @click="sortBy('name')" /></TableHead>
            <TableHead class="hidden md:table-cell" :aria-sort="ariaSort(sort, 'email')"><SortButton :label="t('common.email')" :dir="dirOf(sort, 'email')" @click="sortBy('email')" /></TableHead>
            <TableHead class="w-24 text-right" :aria-sort="ariaSort(sort, 'orders')"><SortButton :label="t('customers.orders')" :dir="dirOf(sort, 'orders')" @click="sortBy('orders')" /></TableHead>
            <TableHead class="w-32 text-right" :aria-sort="ariaSort(sort, 'spent')"><SortButton :label="t('customers.total_spent')" :dir="dirOf(sort, 'spent')" @click="sortBy('spent')" /></TableHead>
            <TableHead class="hidden w-36 sm:table-cell" :aria-sort="ariaSort(sort, 'last_order')"><SortButton :label="t('customers.last_order')" :dir="dirOf(sort, 'last_order')" @click="sortBy('last_order')" /></TableHead>
            <TableHead class="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="c in customers.data"
            :key="c.id"
            class="cursor-pointer"
            tabindex="0"
            role="button"
            :aria-label="t('customers.open', { name: c.name })"
            @click="open(c)"
            @keydown.enter="open(c)"
            @keydown.space.prevent="open(c)"
          >
            <TableCell class="max-w-0 pl-4">
              <div class="flex items-center gap-3">
                <Avatar class="size-9 shrink-0"><AvatarFallback class="text-xs">{{ initials(c.name) }}</AvatarFallback></Avatar>
                <div class="min-w-0">
                  <div class="truncate font-medium">{{ c.name }} <Badge v-if="c.unsubscribed" variant="outline" class="ml-1 font-normal">{{ t("marketing.unsubscribed") }}</Badge></div>
                  <div class="truncate text-xs text-muted-foreground">{{ c.phone || c.email || "—" }}</div>
                </div>
              </div>
            </TableCell>
            <TableCell class="hidden max-w-0 truncate text-muted-foreground md:table-cell">{{ c.email || "—" }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ c.orders_count }}</TableCell>
            <TableCell class="text-right font-semibold tabular-nums">{{ money(c.total_spent, currency) }}</TableCell>
            <TableCell class="hidden text-sm text-muted-foreground sm:table-cell">
              {{ c.last_order_at ? fmtDate(c.last_order_at, { dateStyle: "medium" }) : "—" }}
            </TableCell>
            <TableCell class="pr-4 text-muted-foreground"><ChevronRight class="size-4" /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- No match -->
    <Card v-else>
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Search class="size-5" /></span>
        <p class="font-medium">{{ t("customers.no_matching") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("customers.no_matching_body", { q: filters.q }) }}</p>
      </CardContent>
    </Card>

    <Pager :page="customers" />

    <!-- Add -->
    <Dialog v-model:open="creating">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t("customers.add") }}</DialogTitle>
          <DialogDescription>{{ t("customers.only_name_required") }}</DialogDescription>
        </DialogHeader>
        <form id="customer-create" class="grid gap-4" @submit.prevent="create">
          <div class="grid gap-2">
            <Label for="c-name">{{ t("common.name") }}</Label>
            <Input id="c-name" v-model="form.name" autofocus :placeholder="t('customers.name_placeholder')" :aria-invalid="!!form.errors.name" />
            <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="c-phone">{{ t("common.phone") }}</Label>
              <Input id="c-phone" v-model="form.phone" type="tel" :placeholder="t('customers.optional')" :aria-invalid="!!form.errors.phone" />
              <p v-if="form.errors.phone" class="text-sm text-destructive">{{ form.errors.phone }}</p>
            </div>
            <div class="grid gap-2">
              <Label for="c-email">{{ t("common.email") }}</Label>
              <Input id="c-email" v-model="form.email" type="email" :placeholder="t('customers.optional')" :aria-invalid="!!form.errors.email" />
              <p v-if="form.errors.email" class="text-sm text-destructive">{{ form.errors.email }}</p>
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="c-note">{{ t("customers.note") }}</Label>
            <Textarea id="c-note" v-model="form.note" rows="3" :placeholder="t('customers.note_placeholder')" :aria-invalid="!!form.errors.note" />
            <p v-if="form.errors.note" class="text-sm text-destructive">{{ form.errors.note }}</p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" @click="creating = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" form="customer-create" :disabled="form.processing">{{ t("customers.add") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
