<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { watchDebounced } from "@vueuse/core";
import { toast } from "vue-sonner";
import AppLayout from "@/layouts/AppLayout.vue";
import { Badge } from "@/components/ui/badge";
import CategoryDot from "@/components/CategoryDot.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Pager from "@/components/Pager.vue";
import { useFitPage } from "@/lib/fitPage";
import {
	Download,
	ImageIcon,
	Package,
	Pencil,
	Plus,
	Search,
	Share2,
	Trash2,
	Upload,
	Star,
	Tags,
} from "@lucide/vue";
import { money, packSize, plain } from "@/lib/format";
import { ariaSort, dirOf, nextSort, type Sort } from "@/lib/sort";
import SortButton from "@/components/SortButton.vue";
import ShareDialog from "@/components/products/ShareDialog.vue";
import { contentsOf } from "@/lib/bundleLabels";
import { t } from "@/lib/i18n";
import type { Category, Paged, Product, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	products: Paged<Product>;
	filters: { q: string; category: number; sort: Sort | null };
	categories: Category[];
	import_result?: { created: number; errors: string[] };
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");

// Search and the category filter are server-side (?q=&category=&page=); "0" = every category
const search = ref(props.filters.q);
const category = ref(String(props.filters.category || 0));
const sort = ref<Sort | null>(props.filters.sort);
const params = () => ({
	q: search.value.trim() || undefined,
	category: category.value === "0" ? undefined : category.value,
	sort: sort.value?.by,
	dir: sort.value?.dir,
});
const applyFilters = () =>
	router.get("/products", params(), {
		preserveState: true,
		preserveScroll: true,
		replace: true,
	});
watchDebounced(search, applyFilters, { debounce: 300 });
watch([category, sort], applyFilters);
/**
 * A click on a column title: sort by it, flip it, or back to the normal order.
 * @param by - the column
 */
function sortBy(by: string) {
	sort.value = nextSort(sort.value, by);
}
// Bulk "Add to categories": the picked rows (kept while paging), then the categories to add
const selected = ref<number[]>([]);
const pageIds = computed(() => props.products.data.map((p) => p.id));
const pickedOnPage = computed(
	() => pageIds.value.filter((id) => selected.value.includes(id)).length,
);
const addOpen = ref(false);
const addCategoryIds = ref<number[]>([]);
const adding = ref(false);

/**
 * Tick or untick one product.
 * @param id - the product
 * @param on - ticked or not
 */
function pick(id: number, on: boolean | "indeterminate") {
	selected.value = on
		? [...new Set([...selected.value, id])]
		: selected.value.filter((x) => x !== id);
}

/**
 * The header box: tick or untick every product on this page.
 * @param on - ticked or not
 */
function pickPage(on: boolean | "indeterminate") {
	selected.value = on
		? [...new Set([...selected.value, ...pageIds.value])]
		: selected.value.filter((x) => !pageIds.value.includes(x));
}

/**
 * Tick or untick a category in the dialog.
 * @param id - the category
 * @param on - ticked or not
 */
function pickCategory(id: number, on: boolean | "indeterminate") {
	addCategoryIds.value = on
		? [...addCategoryIds.value, id]
		: addCategoryIds.value.filter((x) => x !== id);
}

/** Open the dialog with nothing ticked. */
function openAdd() {
	addCategoryIds.value = [];
	addOpen.value = true;
}

/** Add the ticked categories to the ticked products, then clear the ticks. */
function addCategories() {
	const count = selected.value.length;
	adding.value = true;
	router.post(
		"/products/categories",
		{ product_ids: selected.value, category_ids: addCategoryIds.value },
		{
			preserveScroll: true,
			onSuccess() {
				addOpen.value = false;
				selected.value = [];
				toast.success(
					t(
						count === 1
							? "products.categories_added_one"
							: "products.categories_added_other",
						{ count },
					),
				);
			},
			onFinish() {
				adding.value = false;
			},
		},
	);
}

const filtering = computed(() => !!props.filters.q || !!props.filters.category);
/** "12 products" / "3 matching products" under the heading. */
const countLabel = computed(function label() {
	const n = props.products.total;
	if (filtering.value)
		return t(
			n === 1 ? "products.count_matching_one" : "products.count_matching_other",
			{ count: n },
		);
	return t(n === 1 ? "products.count_one" : "products.count_other", {
		count: n,
	});
});
/** "1 variant" / "4 variants". */
function variantsLabel(n: number) {
	return t(n === 1 ? "products.variant_one" : "products.variant_other", {
		count: n,
	});
}
// page size follows the screen height (header + table head + pager ≈ 230px around the rows)
useFitPage("products", "/products", 230, () => props.products.per_page, params);

// Featured products head every list (admin, Sell screen, storefront); the rest follow, most recently edited first.
const toggleFeatured = (p: Product, featured: boolean) =>
	router.post(
		`/products/${p.id}/featured`,
		{ featured },
		{
			preserveScroll: true,
			onSuccess: () =>
				toast.success(
					t(featured ? "products.featured_on" : "products.featured_off", {
						name: p.name,
					}),
				),
		},
	);

/**
 * Switch a product on or off — off hides it from the POS and the online store.
 * @param p The product row.
 * @param active The new state.
 */
function toggleActive(p: Product, active: boolean) {
	router.post(
		`/products/${p.id}/active`,
		{ active },
		{
			preserveScroll: true,
			onSuccess() {
				toast.success(
					t(active ? "products.active_on" : "products.active_off", {
						name: p.name,
					}),
				);
			},
		},
	);
}

/**
 * Whether a package is off sale because a product inside it is switched off.
 * @param p The product row.
 * @returns True for such a package; false for anything else.
 */
function blockedPackage(p: Product) {
	return p.bundle_items.some((i) => !i.active);
}

const fromPrice = (p: Product) =>
	p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : p.price;
/** Stock cell: total on hand across variants (or the product's own count); null when not tracked. */
const stockOf = (p: Product) =>
	p.track_stock
		? p.variants.length
			? p.variants.reduce((s, v) => s + v.stock, 0)
			: p.stock
		: null;
const lowCount = (p: Product) =>
	p.variants.length
		? p.variants.filter((v) => v.stock <= p.low_stock_at).length
		: p.stock <= p.low_stock_at
			? 1
			: 0;
const stockClass = (p: Product) => {
	const n = stockOf(p);
	if (n === null) return "text-muted-foreground";
	if (n <= 0) return "text-destructive font-medium";
	return lowCount(p) ? "text-amber-600 font-medium dark:text-amber-400" : "";
};

// CSV import/export (Universal POS Product CSV v1)
const csvInput = ref<HTMLInputElement | null>(null);
const importErrors = ref<string[]>([]);
function importCsv(e: Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;
	router.post(
		"/products/import",
		{ file },
		{
			forceFormData: true,
			preserveScroll: true,
			onSuccess: () => {
				const r = props.import_result;
				if (!r) return;
				importErrors.value = r.errors;
				if (r.created)
					toast.success(
						t(
							r.created === 1
								? "products.imported_one"
								: "products.imported_other",
							{ count: r.created },
						),
					);
				else if (!r.errors.length) toast.info(t("products.nothing_to_import"));
			},
		},
	);
}

const pending = ref<Product | null>(null);
/** The product whose Share dialog is open. */
const sharing = ref<Product | null>(null);
/** Sharing needs the online store on: the link opens the product's store page. */
const storeOn = computed(
	() => !!page.props.shop?.online_enabled && !!page.props.shop.slug,
);
function destroy() {
	const target = pending.value;
	pending.value = null;
	if (!target) return;
	// the server re-renders this page with errors.product when the product is still inside a package
	router.delete(`/products/${target.id}`, {
		onSuccess: (pg) =>
			!(pg.props as unknown as SharedProps).errors?.product &&
			toast.success(t("products.deleted", { name: target.name })),
	});
}
watch(
	() => page.props.errors?.product,
	(msg) => msg && toast.error(msg),
	{ immediate: true },
);
</script>

<template>
  <Head :title="t('products.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ t("products.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ countLabel }}</p>
      </div>
      <div class="relative w-full sm:w-64">
        <Search class="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground" />
        <Input v-model="search" class="pl-8" :placeholder="t('products.search_placeholder')" type="search" :aria-label="t('products.search_aria')" />
      </div>
      <Select v-model="category">
        <SelectTrigger class="w-full sm:w-48" :aria-label="t('common.category')"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0">{{ t("products.all_categories") }}</SelectItem>
          <SelectItem v-for="c in categories" :key="c.id" :value="String(c.id)"><CategoryDot :color="c.color" /> {{ c.name }}</SelectItem>
        </SelectContent>
      </Select>
      <input ref="csvInput" type="file" accept=".csv,text/csv" class="hidden" :aria-label="t('products.csv_file')" @change="importCsv" />
      <Button variant="outline" @click="csvInput?.click()"><Upload /> {{ t("products.import") }}</Button>
      <Button variant="outline" as-child>
        <a href="/products/export"><Download /> {{ t("products.export") }}</a>
      </Button>
      <Button as-child>
        <Link href="/products/create"><Plus /> {{ t("products.add") }}</Link>
      </Button>
    </div>

    <!-- CSV import row errors (valid rows were still imported) -->
    <div v-if="importErrors.length" role="alert" class="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <div class="flex items-center justify-between gap-2">
        <p class="font-medium text-destructive">{{ t(importErrors.length === 1 ? "products.rows_not_imported_one" : "products.rows_not_imported_other", { count: importErrors.length }) }}</p>
        <Button variant="ghost" size="sm" @click="importErrors = []">{{ t("products.dismiss") }}</Button>
      </div>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li v-for="(err, i) in importErrors.slice(0, 20)" :key="i">{{ err }}</li>
      </ul>
      <p v-if="importErrors.length > 20" class="mt-1 text-muted-foreground">{{ t("products.and_more", { count: importErrors.length - 20 }) }}</p>
    </div>

    <!-- Bulk actions for the ticked products -->
    <div v-if="selected.length" class="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-4 py-2 text-sm">
      <span class="mr-auto font-medium">{{ t(selected.length === 1 ? "products.selected_one" : "products.selected_other", { count: selected.length }) }}</span>
      <Button size="sm" @click="openAdd"><Tags /> {{ t("products.add_to_categories") }}</Button>
      <Button variant="ghost" size="sm" @click="selected = []">{{ t("common.clear") }}</Button>
    </div>

    <!-- Empty state -->
    <div v-if="!products.total && !filtering" class="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background p-12 text-center">
      <span class="flex size-11 items-center justify-center rounded-full bg-muted"><Package class="size-5 text-muted-foreground" /></span>
      <div>
        <p class="font-medium">{{ t("products.empty_title") }}</p>
        <p class="text-sm text-muted-foreground">{{ t("products.empty_hint") }}</p>
      </div>
      <Button as-child><Link href="/products/create"><Plus /> {{ t("products.add") }}</Link></Button>
    </div>

    <!-- Table -->
    <div v-else class="overflow-hidden rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="hidden w-12 px-0 sm:table-cell">
              <Checkbox class="mx-auto" :model-value="pickedOnPage && pickedOnPage === pageIds.length ? true : pickedOnPage ? 'indeterminate' : false" :aria-label="t('products.select_page_aria')" @update:model-value="pickPage" />
            </TableHead>
            <TableHead class="hidden w-10 sm:table-cell"><span class="sr-only">{{ t("products.featured") }}</span></TableHead>
            <TableHead class="w-14"><span class="sr-only">{{ t("products.image") }}</span></TableHead>
            <TableHead :aria-sort="ariaSort(sort, 'name')"><SortButton :label="t('common.product')" :dir="dirOf(sort, 'name')" @click="sortBy('name')" /></TableHead>
            <TableHead class="hidden md:table-cell" :aria-sort="ariaSort(sort, 'category')"><SortButton :label="t('products.categories')" :dir="dirOf(sort, 'category')" @click="sortBy('category')" /></TableHead>
            <TableHead class="hidden w-24 text-center sm:table-cell" :aria-sort="ariaSort(sort, 'active')"><SortButton :label="t('products.active')" :dir="dirOf(sort, 'active')" @click="sortBy('active')" /></TableHead>
            <TableHead class="hidden w-24 text-right sm:table-cell" :aria-sort="ariaSort(sort, 'stock')"><SortButton :label="t('products.stock')" :dir="dirOf(sort, 'stock')" @click="sortBy('stock')" /></TableHead>
            <TableHead class="hidden w-24 text-right sm:table-cell" :aria-sort="ariaSort(sort, 'sold')"><SortButton :label="t('products.sold')" :dir="dirOf(sort, 'sold')" @click="sortBy('sold')" /></TableHead>
            <TableHead class="text-right" :aria-sort="ariaSort(sort, 'price')"><SortButton :label="t('common.price')" :dir="dirOf(sort, 'price')" @click="sortBy('price')" /></TableHead>
            <TableHead class="w-24 text-right"><span class="sr-only">{{ t("common.actions") }}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in products.data" :key="p.id" :class="{ 'bg-muted/40 text-muted-foreground [&_img]:grayscale [&_img]:opacity-50': !p.active || blockedPackage(p) }">
            <TableCell class="hidden w-12 px-0 sm:table-cell">
              <Checkbox class="mx-auto" :model-value="selected.includes(p.id)" :aria-label="t('products.select_aria', { name: p.name })" @update:model-value="(on) => pick(p.id, on)" />
            </TableCell>
            <TableCell class="hidden pr-0 sm:table-cell">
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="t('products.feature_aria', { name: p.name })"
                :aria-pressed="p.featured"
                @click="toggleFeatured(p, !p.featured)"
              >
                <Star :class="p.featured ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'" />
              </Button>
            </TableCell>
            <TableCell>
              <img v-if="p.images[0]" :src="p.images[0]" :alt="p.name" loading="lazy" decoding="async" class="size-10 rounded-md border object-cover" />
              <span v-else class="flex size-10 items-center justify-center rounded-md border bg-muted">
                <ImageIcon class="size-4 text-muted-foreground" />
              </span>
            </TableCell>
            <TableCell class="max-w-xs whitespace-normal">
              <Link :href="`/products/${p.id}/edit`" class="font-medium hover:underline">{{ p.name }}</Link>
              <span v-if="packSize(p)" class="ml-1.5 text-xs text-muted-foreground">{{ packSize(p) }}</span>
              <Badge v-if="p.kind === 'bundle'" variant="secondary" class="ml-1.5 align-middle">{{ t("products.package") }}</Badge>
              <p v-if="p.kind === 'bundle'" class="line-clamp-1 text-xs text-muted-foreground">{{ contentsOf(p) }}</p>
              <p v-if="blockedPackage(p)" class="text-xs text-destructive">{{ t("products.package_blocked") }}</p>
              <p v-else-if="p.description" class="line-clamp-1 text-xs text-muted-foreground">{{ plain(p.description) }}</p>
              <p v-if="p.sku || p.barcode" class="font-mono text-xs text-muted-foreground">{{ [p.sku, p.barcode].filter(Boolean).join(" · ") }}</p>
            </TableCell>
            <TableCell class="hidden max-w-xs whitespace-normal md:table-cell">
              <div v-if="p.categories.length" class="flex flex-wrap gap-1">
                <Badge v-for="c in p.categories" :key="c.id" variant="secondary"><CategoryDot :color="c.color" />{{ c.name }}</Badge>
              </div>
              <span v-else class="text-xs text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="hidden text-center sm:table-cell">
              <Switch :model-value="p.active" :aria-label="t('products.active_aria', { name: p.name })" @update:model-value="(v) => toggleActive(p, v)" />
            </TableCell>
            <TableCell class="hidden text-right tabular-nums sm:table-cell" :class="stockClass(p)">
              <template v-if="stockOf(p) !== null">
                {{ stockOf(p) }}<span v-if="p.unit" class="ml-1 text-xs font-normal text-muted-foreground">{{ p.unit }}</span>
                <p v-if="p.variants.length && lowCount(p)" class="text-xs font-normal">{{ t("products.low_count", { count: lowCount(p) }) }}</p>
              </template>
              <span v-else>—</span>
            </TableCell>
            <TableCell class="hidden text-right tabular-nums sm:table-cell">{{ p.sold ?? 0 }}</TableCell>
            <TableCell class="text-right tabular-nums">
              <div class="font-medium">
                <span v-if="p.variants.length" class="text-muted-foreground">{{ t("products.from") }}</span> {{ money(fromPrice(p), currency) }}
              </div>
              <p v-if="p.variants.length" class="text-xs text-muted-foreground">{{ variantsLabel(p.variants.length) }}</p>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button as-child variant="ghost" size="icon-sm">
                  <Link :href="`/products/${p.id}/edit`" :aria-label="t('products.edit_aria', { name: p.name })"><Pencil /></Link>
                </Button>
                <Button v-if="storeOn && p.active" variant="ghost" size="icon-sm" :aria-label="t('products.share_aria', { name: p.name })" @click="sharing = p"><Share2 /></Button>
                <Button variant="ghost" size="icon-sm" :aria-label="t('products.delete_aria', { name: p.name })" @click="pending = p"><Trash2 class="text-destructive" /></Button>
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-if="!products.data.length">
            <TableCell colspan="10" class="p-10 text-center text-sm text-muted-foreground">
              {{ filters.q ? t("products.no_match_query", { q: filters.q }) : t("products.no_match_category") }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <Pager :page="products" />
  </div>

  <AlertDialog :open="!!pending" @update:open="(v: boolean) => !v && (pending = null)">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("products.delete_title") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("products.delete_desc", { name: pending?.name ?? "" }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <Button variant="destructive" @click="destroy">{{ t("common.delete") }}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <ShareDialog :product="sharing" @close="sharing = null" />

  <!-- Bulk: add categories to the ticked products -->
  <Dialog v-model:open="addOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("products.add_to_categories") }}</DialogTitle>
        <DialogDescription>{{ t(selected.length === 1 ? "products.add_categories_body_one" : "products.add_categories_body_other", { count: selected.length }) }}</DialogDescription>
      </DialogHeader>
      <p v-if="!categories.length" class="text-sm text-muted-foreground">
        {{ t("products.no_categories_yet") }} <Link href="/categories" class="underline">{{ t("products.open_categories") }}</Link>
      </p>
      <div v-else class="max-h-72 space-y-1 overflow-y-auto" role="group" :aria-label="t('products.categories')">
        <Label v-for="c in categories" :key="c.id" class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-muted">
          <Checkbox :model-value="addCategoryIds.includes(c.id)" @update:model-value="(on) => pickCategory(c.id, on)" />
          <CategoryDot :color="c.color" />
          <span class="truncate">{{ c.name }}</span>
        </Label>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="addOpen = false">{{ t("common.cancel") }}</Button>
        <Button :disabled="!addCategoryIds.length || adding" @click="addCategories">{{ t("common.add") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
