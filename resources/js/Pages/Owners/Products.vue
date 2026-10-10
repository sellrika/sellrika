<script setup lang="ts">
import { ref, watch } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import { ImageIcon, Search, Star } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import CategoryDot from "@/components/CategoryDot.vue";
import Pager from "@/components/Pager.vue";
import { money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { OwnerRow, Paged, Product, Shop } from "@/types";

defineOptions({ layout: AppLayout });
/** Every product of one shop, for the platform admin: read-only, server-paged and searched. */
const props = defineProps<{
	owner: OwnerRow;
	shop: Shop;
	products: Paged<Product>;
	filters: { q: string };
}>();

const base = `/owners/${props.owner.id}/shops/${props.shop.id}`;
const search = ref(props.filters.q);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, function find(q) {
	clearTimeout(timer);
	timer = setTimeout(function visit() {
		router.get(
			`${base}/products`,
			{ q: q.trim() || undefined },
			{ preserveState: true, replace: true },
		);
	}, 300);
});

/**
 * The lowest price: a product with variants sells from its cheapest one.
 * @param p The product.
 * @returns The price in cents.
 */
function fromPrice(p: Product) {
	return p.variants.length
		? Math.min(...p.variants.map((v) => v.price))
		: p.price;
}

/**
 * Units on hand, across variants.
 * @param p The product.
 * @returns The count, or null when stock is not tracked.
 */
function stockOf(p: Product) {
	if (!p.track_stock) return null;
	return p.variants.length
		? p.variants.reduce((sum, v) => sum + v.stock, 0)
		: p.stock;
}
</script>

<template>
  <Head :title="t('owners.products_of', { shop: shop.name })" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header class="flex items-start gap-3">
      <BackButton :href="base" :label="t('owners.back_to', { name: shop.name })" />
      <div class="min-w-0 space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("owners.products_of", { shop: shop.name }) }}</h1>
        <p class="text-sm text-muted-foreground">
          <Link :href="`/owners/${owner.id}`" class="hover:underline">{{ owner.name }}</Link>
          · {{ t("owners.product_count", { count: products.total }) }}
        </p>
      </div>
    </header>

    <div class="relative max-w-sm">
      <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="search" type="search" class="pl-8" :aria-label="t('owners.search_products')" :placeholder="t('owners.search_products')" />
    </div>

    <Card class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-14" />
            <TableHead>{{ t("owners.product") }}</TableHead>
            <TableHead class="hidden md:table-cell">{{ t("owners.categories") }}</TableHead>
            <TableHead class="hidden text-right sm:table-cell">{{ t("products.stock") }}</TableHead>
            <TableHead class="text-right">{{ t("owners.price") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in products.data" :key="p.id" :class="!p.active && 'opacity-60'">
            <TableCell>
              <img v-if="p.images[0]" :src="p.images[0]" :alt="p.name" class="size-10 rounded-md border object-cover" />
              <span v-else class="flex size-10 items-center justify-center rounded-md border bg-muted"><ImageIcon class="size-4 text-muted-foreground" /></span>
            </TableCell>
            <TableCell class="max-w-xs whitespace-normal">
              <span class="font-medium">{{ p.name }}</span>
              <Star v-if="p.featured" class="ml-1 inline size-3.5 fill-amber-400 text-amber-400" :aria-label="t('products.featured')" />
              <Badge v-if="p.kind === 'bundle'" variant="secondary" class="ml-1.5">{{ t("products.package") }}</Badge>
              <Badge v-if="!p.active" variant="outline" class="ml-1.5">{{ t("products.inactive") }}</Badge>
              <p v-if="p.sku || p.barcode" class="font-mono text-xs text-muted-foreground">{{ [p.sku, p.barcode].filter(Boolean).join(" · ") }}</p>
            </TableCell>
            <TableCell class="hidden max-w-xs whitespace-normal md:table-cell">
              <div v-if="p.categories.length" class="flex flex-wrap gap-1">
                <Badge v-for="c in p.categories" :key="c.id" variant="secondary"><CategoryDot :color="c.color" />{{ c.name }}</Badge>
              </div>
              <span v-else class="text-xs text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="hidden text-right tabular-nums sm:table-cell">{{ stockOf(p) ?? "—" }}</TableCell>
            <TableCell class="text-right tabular-nums">
              <span v-if="p.variants.length" class="text-muted-foreground">{{ t("products.from") }}</span> {{ money(fromPrice(p), shop.currency) }}
            </TableCell>
          </TableRow>
          <TableRow v-if="!products.data.length">
            <TableCell colspan="5" class="py-10 text-center text-muted-foreground">{{ t("owners.no_products") }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <Pager :page="products" />
  </div>
</template>
