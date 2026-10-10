<script setup lang="ts">
import { computed, ref } from "vue";
import ChartTip, { type ChartTipRow } from "@/components/ChartTip.vue";

/** One slice: its size (any unit, e.g. cents), its colour and the lines of its tip. */
export type ShareSlice = {
	key: string;
	title: string;
	amount: number;
	color: string;
	rows: ChartTipRow[];
};

/**
 * A small pie (or doughnut) of shares, drawn with one CSS conic gradient.
 * Hovering a slice shows its tip.
 */
const props = defineProps<{
	slices: ShareSlice[];
	/** Read out by screen readers. */
	label: string;
	/** Cut a hole in the middle. */
	donut?: boolean;
}>();

/** The inner edge of the doughnut, as a part of the radius. */
const HOLE = 0.6;

/** Each slice with where it starts and ends, in percent of the circle. */
const parts = computed(() => {
	const total = props.slices.reduce((s, x) => s + x.amount, 0);
	let at = 0;
	return props.slices.map((x) => {
		const from = at;
		at += total ? (x.amount / total) * 100 : 0;
		return { ...x, from, to: at };
	});
});

const background = computed(
	() =>
		`conic-gradient(${parts.value.map((x) => `${x.color} ${x.from}% ${x.to}%`).join(", ")})`,
);
const mask = computed(() =>
	props.donut
		? `radial-gradient(farthest-side, transparent ${HOLE * 100}%, #000 ${HOLE * 100 + 1}%)`
		: undefined,
);

const tip = ref<{
	x: number;
	y: number;
	title: string;
	rows: ChartTipRow[];
} | null>(null);

/**
 * Show the tip of the slice under the pointer.
 * The slice is found from the pointer's angle around the centre (0 = top, clockwise, like the gradient).
 * @param e - the mouse move over the chart
 */
function show(e: MouseEvent) {
	const r = (e.currentTarget as HTMLElement).getBoundingClientRect(),
		dx = e.clientX - (r.left + r.width / 2),
		dy = e.clientY - (r.top + r.height / 2),
		dist = Math.hypot(dx, dy),
		radius = r.width / 2;
	if (dist > radius || (props.donut && dist < radius * HOLE)) {
		tip.value = null;
		return;
	}
	const at = (((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360) / 3.6;
	const part =
		parts.value.find((x) => at >= x.from && at < x.to) ?? parts.value.at(-1);
	if (!part) return;
	tip.value = {
		x: e.clientX - r.left,
		y: e.clientY - r.top,
		title: part.title,
		rows: part.rows,
	};
}

/** Hide the tip when the pointer leaves the chart. */
function hide() {
	tip.value = null;
}
</script>

<template>
  <div class="relative size-28 shrink-0">
    <div class="size-full cursor-default rounded-full" :style="{ background, mask }" role="img" :aria-label="label" @mousemove="show" @mouseleave="hide" />
    <!-- ponytail: no right edge, so the tip is centred or runs to the right over the list -->
    <ChartTip v-if="tip" :x="tip.x" :y="tip.y" :width="Number.POSITIVE_INFINITY" :title="tip.title" :rows="tip.rows" />
  </div>
</template>
