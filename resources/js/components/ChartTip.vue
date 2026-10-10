<script setup lang="ts">
import { computed } from "vue";

/** One line of the tip: a colour swatch (optional), a label and a value. */
export type ChartTipRow = { label: string; value: string; color?: string };

/**
 * The box that floats over a hovered chart bar.
 * Place it inside a `relative` box that is as wide as the chart.
 * `x` / `y` = the top centre of the bar, in pixels from that box's corner.
 */
const props = defineProps<{
	x: number;
	y: number;
	/** The chart width, so the tip never hangs off the side. */
	width: number;
	title: string;
	rows: ChartTipRow[];
}>();

/** Centred over the bar, but pushed inwards near the left and right edges. */
const shift = computed(() => {
	if (props.x < 80) return "0%";
	if (props.x > props.width - 80) return "-100%";
	return "-50%";
});
</script>

<template>
  <div class="pointer-events-none absolute z-10 min-w-32 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md" :style="{ left: `${x}px`, top: `${y}px`, transform: `translate(${shift}, calc(-100% - 8px))` }" role="tooltip">
    <p class="mb-1 font-medium">{{ title }}</p>
    <p v-for="r in rows" :key="r.label" class="flex items-center gap-1.5">
      <span v-if="r.color" class="size-2 shrink-0 rounded-[2px]" :style="{ background: r.color }" />
      <span class="text-muted-foreground">{{ r.label }}</span>
      <span class="ml-auto pl-3 font-semibold tabular-nums">{{ r.value }}</span>
    </p>
  </div>
</template>
