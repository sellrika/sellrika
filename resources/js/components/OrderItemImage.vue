<script setup lang="ts">
import { Package } from "@lucide/vue";

/**
 * The small square picture of an order line (the one saved on the order).
 * A line with no picture gets a plain box with a package icon, so the rows stay aligned.
 * `size` = the side in pixels (default 40). The colours follow the text colour, so it fits every store template and dark mode.
 */
withDefaults(defineProps<{ src: string | null; size?: number }>(), {
	size: 40,
});
</script>

<template>
  <img v-if="src" :src="src" alt="" loading="lazy" :width="size" :height="size" :style="{ width: `${size}px`, height: `${size}px` }" class="shrink-0 rounded-md bg-current/10 object-cover" data-line-image />
  <span v-else aria-hidden="true" :style="{ width: `${size}px`, height: `${size}px` }" class="flex shrink-0 items-center justify-center rounded-md bg-current/10" data-line-placeholder>
    <Package class="size-1/2 opacity-40" />
  </span>
</template>
