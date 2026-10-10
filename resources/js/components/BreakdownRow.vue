<script setup lang="ts">
import { Link } from "@inertiajs/vue3";

/**
 * One line of a report breakdown.
 * A mark on the left, the name and the amount, and a small line under them.
 * Slot `lead` = the mark, slot `sub` = the line under the name.
 */
defineProps<{
	name: string;
	/** Makes the name a link to this page. */
	href?: string;
	value: string;
	/** Shown under the amount, like "48%". */
	share?: string;
}>();
</script>

<template>
  <li class="flex items-center gap-3 px-4 py-3">
    <span class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
      <slot name="lead" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <Link v-if="href" :href="href" class="truncate text-sm font-medium hover:underline">{{ name }}</Link>
        <span v-else class="truncate text-sm font-medium">{{ name }}</span>
        <span class="ml-auto shrink-0 pl-3 text-sm font-semibold tabular-nums">{{ value }}</span>
      </div>
      <div v-if="$slots.sub || share" class="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span class="truncate"><slot name="sub" /></span>
        <span v-if="share" class="shrink-0 tabular-nums">{{ share }}</span>
      </div>
    </div>
  </li>
</template>
