<script setup lang="ts">
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";
import StoreImage from "@/components/store/StoreImage.vue";
import { money, packSize } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Product } from "@/types";

const props = defineProps<{ product: Product; currency: string }>();

const minPrice = computed(() =>
	props.product.variants.length
		? Math.min(...props.product.variants.map((v) => v.price))
		: props.product.price,
);
/** Stock state for the badge: null = not tracked; with variants, "out" only when every variant is out. */
const stock = computed(() => {
	const p = props.product;
	if (!p.track_stock) return null;
	if (!p.variants.length)
		return {
			out: p.stock <= 0,
			low: p.stock > 0 && p.stock <= p.low_stock_at,
			n: p.stock,
		};
	const total = p.variants.reduce((s, v) => s + v.stock, 0);
	return {
		out: total <= 0,
		low: total > 0 && p.variants.some((v) => v.stock <= p.low_stock_at),
		n: total,
	};
});
</script>

<template>
  <button
    type="button"
    class="group flex flex-col overflow-hidden rounded-xl border bg-background text-left transition-all hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]"
    :class="stock?.out && 'opacity-60 grayscale'"
  >
    <div class="relative aspect-square w-full overflow-hidden bg-muted">
      <StoreImage v-if="product.images[0]" :src="product.images[0]" :alt="product.name" class="transition-transform group-hover:scale-105" />
      <span
        v-else
        class="flex size-full items-center justify-center bg-gradient-to-br from-muted to-accent text-4xl font-semibold text-muted-foreground/60"
      >
        {{ product.name.trim().charAt(0).toUpperCase() || "?" }}
      </span>
      <Badge v-if="product.kind === 'bundle'" variant="secondary" class="absolute top-2 right-2 shadow-sm">{{ t("pos.package") }}</Badge>
      <Badge v-else-if="product.variants.length" variant="secondary" class="absolute top-2 right-2 shadow-sm">
        {{ t("pos.n_options", { count: product.variants.length }) }}
      </Badge>
      <Badge v-if="stock?.out" variant="destructive" class="absolute bottom-2 left-2 shadow-sm">{{ t("pos.out_of_stock") }}</Badge>
      <Badge v-else-if="stock?.low" class="absolute bottom-2 left-2 border-amber-300 bg-amber-100 text-amber-800 shadow-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        {{ product.variants.length ? t("pos.low_stock") : t("pos.n_left", { count: stock.n }) }}
      </Badge>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
      <span class="line-clamp-2 text-sm leading-snug font-medium">{{ product.name }}</span>
      <span v-if="packSize(product)" class="text-xs text-muted-foreground">{{ packSize(product) }}</span>
      <span class="mt-auto flex items-baseline justify-between gap-2 pt-1 text-sm font-semibold tabular-nums">
        <span><span v-if="product.variants.length" class="text-xs font-normal text-muted-foreground">{{ t("pos.from") }}</span> {{ money(minPrice, currency) }}</span>
        <span v-if="stock && !stock.out && !stock.low" class="text-xs font-normal text-muted-foreground">{{ t("pos.n_in_stock", { count: stock.n }) }}</span>
      </span>
    </div>
  </button>
</template>
