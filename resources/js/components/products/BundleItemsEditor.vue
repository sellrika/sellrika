<script lang="ts">
/** One row of the recipe as the form holds it (`qty` stays a string while typing). */
export type BundleRow = {
	product_id: number;
	variant_ids: number[] | null;
	qty: string;
};
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import WithTooltip from "@/components/WithTooltip.vue";
import { ImageIcon, Package, Plus, Search, Trash2 } from "@lucide/vue";
import { money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PackageComponent } from "@/types";

const props = defineProps<{ components: PackageComponent[]; errors: Record<string, string>; currency: string; price: string }>();
const rows = defineModel<BundleRow[]>({ required: true });

const productOf = (id: number) => props.components.find((c) => c.id === id) ?? null;

// Search over the shop's ordinary products; already-added ones stay listed (a package may hold the same product twice with different variants).
const search = ref("");
const results = computed(() => {
  const q = search.value.trim().toLowerCase();
  return props.components.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 8);
});
function addRow(p: PackageComponent) {
  rows.value.push({ product_id: p.id, variant_ids: p.variants.length ? p.variants.map((v) => v.id) : null, qty: "1" });
  search.value = "";
}
function toggleVariant(row: BundleRow, id: number) {
  const ids = row.variant_ids ?? [];
  row.variant_ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** What one row is worth: qty × the first allowed variant's price (a choice slot is priced by its first option). */
function rowValue(row: BundleRow) {
  const p = productOf(row.product_id);
  if (!p) return 0;
  const v = p.variants.find((x) => (row.variant_ids ?? []).includes(x.id));
  return (v?.price ?? p.price) * (Number(row.qty) || 0);
}
const contentsValue = computed(() => rows.value.reduce((s, r) => s + rowValue(r), 0));
const packagePrice = computed(() => Math.round((Number(props.price.replace(/[^0-9.\-]/g, "")) || 0) * 100));
const saving = computed(() => contentsValue.value - packagePrice.value);
const savingPct = computed(() => (contentsValue.value > 0 ? Math.round((saving.value / contentsValue.value) * 100) : 0));
const totalQty = computed(() => rows.value.reduce((s, r) => s + (Number(r.qty) || 0), 0));
/** Only meaningful when the package is N of one product ("≈ $2.33 each"). */
const perUnit = computed(() =>
  rows.value.length && totalQty.value > 0 && new Set(rows.value.map((r) => r.product_id)).size === 1
    ? Math.round(packagePrice.value / totalQty.value)
    : null,
);
</script>

<template>
  <div class="space-y-3">
    <!-- Search → click to add -->
    <div class="relative">
      <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="search" class="pl-8" :placeholder="t('products.bundle_search_placeholder')" :aria-label="t('products.bundle_search_aria')" @keydown.enter.prevent="results[0] && addRow(results[0])" />
    </div>
    <div v-if="search.trim()" class="flex flex-wrap gap-1.5">
      <button
        v-for="c in results"
        :key="c.id"
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-4xl border px-3 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        :aria-label="t('products.add_name', { name: c.name })"
        @click="addRow(c)"
      >
        <Plus class="size-3.5" /> {{ c.name }}
        <span class="text-xs font-normal text-muted-foreground">{{ money(c.price, currency) }}</span>
      </button>
      <p v-if="!results.length" class="text-sm text-muted-foreground">{{ t("products.no_product_matches", { q: search.trim() }) }}</p>
    </div>

    <p v-if="errors.bundle_items" class="text-sm text-destructive">{{ errors.bundle_items }}</p>

    <!-- Rows -->
    <ul v-if="rows.length" class="divide-y rounded-lg border">
      <li v-for="(row, i) in rows" :key="i" class="flex flex-wrap items-start gap-3 p-3">
        <div class="flex items-center gap-2">
          <Input v-model="row.qty" inputmode="numeric" class="w-16 text-center tabular-nums" :aria-label="t('common.quantity')" :aria-invalid="!!errors[`bundle_items.${i}.qty`]" @keydown.enter.prevent />
          <span class="text-sm text-muted-foreground">×</span>
        </div>
        <!-- The product inside: its picture, its name (opens it in a new tab, so this form keeps its changes) -->
        <img v-if="productOf(row.product_id)?.images[0]" :src="productOf(row.product_id)!.images[0]" alt="" class="size-10 rounded-md border object-cover" :class="{ 'opacity-50 grayscale': productOf(row.product_id)?.active === false }" />
        <span v-else class="flex size-10 items-center justify-center rounded-md border bg-muted"><ImageIcon class="size-4 text-muted-foreground" /></span>
        <div class="min-w-40 flex-1 space-y-1.5">
          <p class="text-sm font-medium">
            <a v-if="productOf(row.product_id)" :href="`/products/${row.product_id}/edit`" target="_blank" class="hover:underline">{{ productOf(row.product_id)!.name }}</a>
            <template v-else>{{ t("products.product_hash", { id: row.product_id }) }}</template>
            <Badge v-if="productOf(row.product_id)?.active === false" variant="destructive" class="ml-1.5 align-middle">{{ t("products.inactive") }}</Badge>
          </p>
          <p v-if="productOf(row.product_id)?.active === false" class="text-xs text-destructive">{{ t("products.inactive_in_package") }}</p>
          <!-- Variant pills: the ones a customer may be given for this slot -->
          <div v-if="productOf(row.product_id)?.variants.length" class="flex flex-wrap gap-1.5">
            <button
              v-for="v in productOf(row.product_id)!.variants"
              :key="v.id"
              type="button"
              :aria-pressed="(row.variant_ids ?? []).includes(v.id)"
              :aria-label="v.name"
              class="inline-flex h-7 items-center rounded-4xl border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
              :class="(row.variant_ids ?? []).includes(v.id) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
              @click="toggleVariant(row, v.id)"
            >
              {{ v.name }}
            </button>
            <Badge v-if="(row.variant_ids ?? []).length > 1" variant="secondary" class="font-normal">{{ t("products.customer_picks_one") }}</Badge>
          </div>
          <p v-if="errors[`bundle_items.${i}.product_id`]" class="text-xs text-destructive">{{ errors[`bundle_items.${i}.product_id`] }}</p>
          <p v-if="errors[`bundle_items.${i}.variant_ids`]" class="text-xs text-destructive">{{ errors[`bundle_items.${i}.variant_ids`] }}</p>
          <p v-if="errors[`bundle_items.${i}.qty`]" class="text-xs text-destructive">{{ errors[`bundle_items.${i}.qty`] }}</p>
        </div>
        <span class="w-20 pt-2 text-right text-sm tabular-nums text-muted-foreground">{{ money(rowValue(row), currency) }}</span>
        <WithTooltip :label="t('products.remove_name', { name: productOf(row.product_id)?.name ?? t('common.product') })">
          <Button type="button" variant="ghost" size="icon-sm" :aria-label="t('products.remove_name', { name: productOf(row.product_id)?.name ?? t('common.product') })" @click="rows.splice(i, 1)">
            <Trash2 />
          </Button>
        </WithTooltip>
      </li>
    </ul>

    <div v-else class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <span class="flex size-10 items-center justify-center rounded-full bg-muted"><Package class="size-5 text-muted-foreground" /></span>
      <p class="text-sm text-muted-foreground">{{ t("products.bundle_empty") }}</p>
    </div>

    <!-- Summary -->
    <p v-if="rows.length" class="text-sm text-muted-foreground">
      {{ t("products.contents_value") }} <b class="text-foreground tabular-nums">{{ money(contentsValue, currency) }}</b>
      · {{ t("products.package_price") }} <b class="text-foreground tabular-nums">{{ money(packagePrice, currency) }}</b>
      <template v-if="saving > 0"> · {{ t("products.saving_label") }} <b class="text-foreground tabular-nums">{{ money(saving, currency) }}</b> ({{ savingPct }}%)</template>
      <template v-else-if="saving < 0"> · <span class="text-destructive">{{ t("products.more_than_separate", { amount: money(-saving, currency) }) }}</span></template>
      <template v-if="perUnit !== null"> · ≈ {{ money(perUnit, currency) }} {{ t("products.each") }}</template>
    </p>
  </div>
</template>
