<script setup lang="ts">
import { Link } from "@inertiajs/vue3";
import { Check, Plus } from "@lucide/vue";
import CategoryDot from "@/components/CategoryDot.vue";
import { t } from "@/lib/i18n";
import type { Category } from "@/types";

defineProps<{ categories: Category[] }>();
const selected = defineModel<number[]>({ required: true });

function toggle(id: number) {
	const i = selected.value.indexOf(id);
	if (i === -1) selected.value.push(id);
	else selected.value.splice(i, 1);
}
</script>

<template>
  <div v-if="categories.length" class="flex flex-wrap gap-1.5">
    <button
      v-for="c in categories"
      :key="c.id"
      type="button"
      :aria-pressed="selected.includes(c.id)"
      class="inline-flex h-7 items-center gap-1 rounded-4xl border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
      :class="selected.includes(c.id)
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'"
      @click="toggle(c.id)"
    >
      <Check v-if="selected.includes(c.id)" class="size-3" />
      <CategoryDot v-else :color="c.color" />
      {{ c.name }}
    </button>
  </div>

  <p v-else class="text-sm text-muted-foreground">
    {{ t("products.no_categories") }}
    <Link href="/categories" class="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
      <Plus class="size-3" /> {{ t("products.create_one") }}
    </Link>
    {{ t("products.to_group") }}
  </p>
</template>
