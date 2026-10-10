<script setup lang="ts">
import { ArrowDown, ArrowUp, ArrowUpDown } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * A table column title you click to sort by it.
 * The arrow shows the direction; a faint double arrow = not sorted by this column.
 * Put `aria-sort` on the header cell (`ariaSort()` from `@/lib/sort`).
 */
defineProps<{
	label: string;
	dir: "asc" | "desc" | null;
}>();
defineEmits<{ click: [] }>();
</script>

<template>
  <Button variant="ghost" size="sm" class="-mx-2 h-7 gap-1 px-2 font-medium" :aria-label="t('common.sort_by', { label })" @click="$emit('click')">
    {{ label }}
    <ArrowUp v-if="dir === 'asc'" class="size-3.5" />
    <ArrowDown v-else-if="dir === 'desc'" class="size-3.5" />
    <ArrowUpDown v-else class="size-3.5 opacity-40" />
  </Button>
</template>
