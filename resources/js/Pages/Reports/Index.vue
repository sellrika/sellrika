<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { useElementSize } from "@vueuse/core";
import { AlertTriangle, Boxes, PackageX, Settings } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard.vue";
import ChartTip, { type ChartTipRow } from "@/components/ChartTip.vue";
import ShareChart, { type ShareSlice } from "@/components/ShareChart.vue";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import BreakdownRow from "@/components/BreakdownRow.vue";
import OrderItemImage from "@/components/OrderItemImage.vue";
import DailyReportDialog from "@/components/reports/DailyReportDialog.vue";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { smoothPath } from "@/lib/curve";
import { money } from "@/lib/format";
import { locale, t } from "@/lib/i18n";
import type { ReportSchedule, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });

type Preset =
	| "today"
	| "yesterday"
	| "7d"
	| "last_week"
	| "this_month"
	| "last_month"
	| "this_year"
	| "custom";
type Bucket = "day" | "week" | "month";
type Summary = {
	orders: number;
	items: number;
	gross: number;
	discounts: number;
	sales: number;
	tax: number;
	refunds: number;
	revenue: number;
	cogs: number;
	profit: number;
	margin: number | null;
	avg_order: number;
	no_cost_lines: number;
};
type Report = {
	query: { preset: Preset; from: string; to: string; by: Bucket };
	summary: Summary;
	previous: Summary;
	series: {
		key: string;
		orders: number;
		sales: number;
		refunds: number;
		profit: number;
	}[];
	hours: { hour: number; orders: number; sales: number }[];
	top_products: {
		product_id: number;
		variant_id: number | null;
		name: string;
		image: string | null;
		qty: number;
		refunded_qty: number;
		revenue: number;
	}[];
	top_customers: {
		customer_id: number;
		name: string;
		orders: number;
		sales: number;
	}[];
	by_method: { method: string; orders: number; sales: number }[];
	by_cashier: {
		user_id: number;
		name: string;
		orders: number;
		sales: number;
	}[];
	by_category: {
		id: number | null;
		name: string;
		color: string | null;
		qty: number;
		revenue: number;
	}[];
	stock: { tracked: number; low: number; out: number };
	today: string;
};

const props = defineProps<{
	report: Report;
	schedule: ReportSchedule;
}>();
/** The daily report's settings dialog. */
const scheduleOpen = ref(false);
const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");

// Filters ---------------------------------------------------------------------
const PRESETS = computed<[Preset, string][]>(() => [
	["today", t("reports.preset_today")],
	["yesterday", t("reports.preset_yesterday")],
	["7d", t("reports.preset_7d")],
	["last_week", t("reports.preset_last_week")],
	["this_month", t("reports.preset_this_month")],
	["last_month", t("reports.preset_last_month")],
	["this_year", t("reports.preset_this_year")],
	["custom", t("reports.preset_custom")],
]);
const preset = ref<Preset>(props.report.query.preset);
const by = ref<Bucket>(props.report.query.by);
const from = ref(props.report.query.from);
const to = ref(props.report.query.to);

// the server may coerce the query (bad custom range, `by` picked from the span) — mirror it back without re-firing
let syncing = false;
watch(
	() => props.report.query,
	(q) => {
		syncing = true;
		preset.value = q.preset;
		by.value = q.by;
		from.value = q.from;
		to.value = q.to;
		nextTick(() => (syncing = false));
	},
);
const go = (params: Record<string, string>) =>
	router.get("/reports", params, {
		preserveState: true,
		preserveScroll: true,
		replace: true,
	});
// preset change omits `by` so the server re-picks a sensible bucket for the new span
watch(preset, (v) => {
	if (!syncing && v !== "custom") go({ preset: v });
});
watch(by, (v) => {
	if (!syncing)
		go(
			preset.value === "custom"
				? { preset: "custom", from: from.value, to: to.value, by: v }
				: { preset: preset.value, by: v },
		);
});
const applyCustom = () =>
	go({ preset: "custom", from: from.value, to: to.value, by: by.value });

// Formatting ------------------------------------------------------------------
const day = (ymd: string) => new Date(`${ymd}T00:00:00`); // local midnight: a plain "YYYY-MM-DD" would be parsed as UTC
const rangeLabel = computed(() => {
	const q = props.report.query,
		f = day(q.from),
		to = day(q.to);
	const long: Intl.DateTimeFormatOptions = {
		day: "numeric",
		month: "short",
		year: "numeric",
	};
	if (q.from === q.to) return to.toLocaleDateString(locale(), long);
	const sameYear = f.getFullYear() === to.getFullYear();
	return `${f.toLocaleDateString(locale(), sameYear ? { day: "numeric", month: "short" } : long)} – ${to.toLocaleDateString(locale(), long)}`;
});
/** Compact axis money, e.g. "$1.2K". */
const shortMoney = (cents: number) =>
	money(cents, currency.value, {
		notation: "compact",
		maximumFractionDigits: 1,
	});
const bucketLabel = (key: string) => {
	const d = day(key);
	if (props.report.query.by === "month")
		return d.toLocaleDateString(locale(), { month: "short", year: "numeric" });
	if (props.report.query.by === "week")
		return t("reports.week_of", {
			date: d.toLocaleDateString(locale(), { day: "numeric", month: "short" }),
		});
	return d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
};
/** An hour of the day, written the way the language does it (3pm, 15:00). */
const hourLabel = (h: number) =>
	t(h < 12 ? "reports.hour_am" : "reports.hour_pm", {
		h12: h % 12 === 0 ? 12 : h % 12,
		h24: h,
	});
// KPIs ------------------------------------------------------------------------
const pct = (cur: number, prev: number) =>
	prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100);
const kpis = computed(() => {
	const s = props.report.summary,
		p = props.report.previous,
		c = currency.value;
	return [
		{
			label: t("reports.net_revenue"),
			value: money(s.revenue, c),
			delta: pct(s.revenue, p.revenue),
			sub: null as string | null,
			note: null as string | null,
		},
		{
			label: t("reports.orders"),
			value: String(s.orders),
			delta: pct(s.orders, p.orders),
			sub: null,
			note: null,
		},
		{
			label: t("reports.avg_order"),
			value: money(s.avg_order, c),
			delta: pct(s.avg_order, p.avg_order),
			sub: null,
			note: null,
		},
		{
			label: t("reports.items_sold"),
			value: String(s.items),
			delta: pct(s.items, p.items),
			sub: null,
			note: null,
		},
		{
			label: t("reports.gross_profit"),
			value: money(s.profit, c),
			delta: pct(s.profit, p.profit),
			sub: s.margin === null ? null : t("reports.margin", { pct: s.margin }),
			note:
				s.no_cost_lines > 0
					? t(
							s.no_cost_lines === 1
								? "reports.no_cost_one"
								: "reports.no_cost_other",
							{ count: s.no_cost_lines },
						)
					: null,
		},
		{
			label: t("reports.discounts"),
			value: money(s.discounts, c),
			delta: pct(s.discounts, p.discounts),
			sub: null,
			note: null,
		},
		{
			label: t("reports.tax_collected"),
			value: money(s.tax, c),
			delta: pct(s.tax, p.tax),
			sub: null,
			note: null,
		},
		{
			label: t("reports.refunds"),
			value: money(s.refunds, c),
			delta: pct(s.refunds, p.refunds),
			sub: null,
			note: null,
		},
	];
});

// Charts ----------------------------------------------------------------------
/** Round up to a 1/2/5×10ⁿ gridline max so the y labels stay readable. */
function niceMax(v: number) {
	if (v <= 0) return 1;
	const p = 10 ** Math.floor(Math.log10(v));
	const n = v / p;
	return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const PAD = { l: 56, r: 8, t: 10, b: 22 };
const H = 240;

const salesEl = useTemplateRef<HTMLElement>("salesEl");
const { width: salesW } = useElementSize(salesEl);
const cw = computed(() => Math.max(salesW.value || 640, 320));
const plot = computed(() => ({
	w: cw.value - PAD.l - PAD.r,
	h: H - PAD.t - PAD.b,
}));
const hasSales = computed(() =>
	props.report.series.some((s) => s.sales || s.refunds),
);
const salesMax = computed(() =>
	niceMax(
		Math.max(
			...props.report.series.map((s) => Math.max(s.sales, s.refunds)),
			0,
		),
	),
);
const gridlines = computed(() =>
	[0, 0.25, 0.5, 0.75, 1].map((f) => ({
		v: salesMax.value * f,
		y: PAD.t + plot.value.h * (1 - f),
	})),
);
const bars = computed(() => {
	const { w, h } = plot.value,
		n = props.report.series.length || 1,
		slot = w / n,
		bw = Math.max(2, Math.min(slot - 2, slot * 0.72));
	return props.report.series.map((s, i) => {
		const sh = (s.sales / salesMax.value) * h,
			rh = (s.refunds / salesMax.value) * h;
		return {
			...s,
			x: PAD.l + slot * i + (slot - bw) / 2,
			bw,
			y: PAD.t + h - sh,
			sh: Math.max(s.sales ? 1 : 0, sh),
			ry: PAD.t + h - rh,
			rh: Math.max(s.refunds ? 1 : 0, rh),
			label: bucketLabel(s.key),
		};
	});
});
// thin x labels so they never collide (~72px each)
const labelStep = computed(() =>
	Math.max(
		1,
		Math.ceil(bars.value.length / Math.max(1, Math.floor(plot.value.w / 72))),
	),
);

const HH = H,
	HPAD = { l: 8, r: 8, t: 8, b: 18 };
const hoursEl = useTemplateRef<HTMLElement>("hoursEl");
const { width: hoursW } = useElementSize(hoursEl);
const hoursMax = computed(() =>
	Math.max(...props.report.hours.map((h) => h.sales), 1),
);
const hasHours = computed(() => props.report.hours.some((h) => h.orders));
/** One point per hour, in the middle of its slot. `sx`/`slot` = the hover area. */
const hourPoints = computed(() => {
	const w = Math.max(hoursW.value || 480, 240) - HPAD.l - HPAD.r,
		h = HH - HPAD.t - HPAD.b,
		slot = w / 24;
	return props.report.hours.map((p) => ({
		...p,
		sx: HPAD.l + slot * p.hour,
		slot,
		cx: HPAD.l + slot * p.hour + slot / 2,
		y: HPAD.t + h - (p.sales / hoursMax.value) * h,
	}));
});
/** The curve through every hour, and the same curve closed down to the baseline for the soft fill. */
const hourLine = computed(() =>
	smoothPath(hourPoints.value.map((p) => ({ x: p.cx, y: p.y }))),
);
const hourArea = computed(() => {
	const pts = hourPoints.value,
		base = HH - HPAD.b;
	if (!pts.length) return "";
	return `${hourLine.value} L${pts[pts.length - 1]!.cx},${base} L${pts[0]!.cx},${base} Z`;
});
const hoursWidth = computed(() => Math.max(hoursW.value || 480, 240));

// Tooltips --------------------------------------------------------------------
type Tip = {
	key: string;
	x: number;
	y: number;
	title: string;
	rows: ChartTipRow[];
};
const salesTip = ref<Tip | null>(null);
const hourTip = ref<Tip | null>(null);

/**
 * Show the tip over a sales bar.
 * @param b - the hovered bar
 */
function showSalesTip(b: (typeof bars.value)[number]) {
	const rows: ChartTipRow[] = [
		{
			label: t("reports.sales"),
			value: money(b.sales, currency.value),
			color: "var(--primary)",
		},
	];
	if (b.refunds)
		rows.push({
			label: t("reports.refunds"),
			value: money(b.refunds, currency.value),
			color: "var(--destructive)",
		});
	rows.push({ label: t("reports.orders"), value: String(b.orders) });
	salesTip.value = {
		key: b.key,
		x: b.x + b.bw / 2,
		y: Math.min(b.y, b.ry),
		title: b.label,
		rows,
	};
}

/**
 * Show the tip over an hour's point on the line.
 * @param b - the hovered hour
 */
function showHourTip(b: (typeof hourPoints.value)[number]) {
	hourTip.value = {
		key: String(b.hour),
		x: b.cx,
		y: b.y,
		title: hourLabel(b.hour),
		rows: [
			{
				label: t("reports.sales"),
				value: money(b.sales, currency.value),
				color: "var(--primary)",
			},
			{ label: t("reports.orders"), value: String(b.orders) },
		],
	};
}

/** Hide both tips when the pointer leaves a bar or an hour. */
function hideTips() {
	salesTip.value = null;
	hourTip.value = null;
}

// Table shares ----------------------------------------------------------------
const methodTotal = computed(() =>
	props.report.by_method.reduce((s, m) => s + m.sales, 0),
);
const cashierTotal = computed(() =>
	props.report.by_cashier.reduce((s, c) => s + c.sales, 0),
);
const categoryTotal = computed(() =>
	props.report.by_category.reduce((s, c) => s + c.revenue, 0),
);

/**
 * A part of a whole as a percent.
 * @param part - the row's amount
 * @param whole - the sum of all rows
 * @returns a label like "48%"
 */
function share(part: number, whole: number) {
	return `${whole ? Math.round((part / whole) * 100) : 0}%`;
}

/** Slice colours of the cashier pie and the payment and category doughnuts, used in turn. */
const SLICE_COLORS = [
	"#f9c13b",
	"#3b82f6",
	"#22c55e",
	"#a855f7",
	"#ef4444",
	"#14b8a6",
	"#f97316",
	"#ec4899",
];

/**
 * The colour of a slice.
 * @param i - the row's place in the list
 * @returns a hex colour
 */
function sliceColor(i: number) {
	return SLICE_COLORS[i % SLICE_COLORS.length]!;
}

/**
 * The rows of a breakdown as chart slices, one colour each.
 * @param rows - the rows, biggest first
 * @param title - the slice's name
 * @param amount - the slice's money (cents)
 * @param count - the slice's count line of the tip (orders, or units sold)
 * @param total - the sum of every row's money
 * @returns the slices for ShareChart
 */
function slicesOf<T>(
	rows: T[],
	title: (r: T) => string,
	amount: (r: T) => number,
	count: (r: T) => ChartTipRow,
	total: number,
): ShareSlice[] {
	return rows.map((r, i) => ({
		key: String(i),
		title: title(r),
		amount: amount(r),
		color: sliceColor(i),
		rows: [
			{
				label: t("reports.sales"),
				value: money(amount(r), currency.value),
				color: sliceColor(i),
			},
			count(r),
			{ label: t("reports.share"), value: share(amount(r), total) },
		],
	}));
}

const cashierSlices = computed(() =>
	slicesOf(
		props.report.by_cashier,
		(c) => c.name,
		(c) => c.sales,
		(c) => ({ label: t("reports.orders"), value: String(c.orders) }),
		cashierTotal.value,
	),
);
const methodSlices = computed(() =>
	slicesOf(
		props.report.by_method,
		(m) => m.method,
		(m) => m.sales,
		(m) => ({ label: t("reports.orders"), value: String(m.orders) }),
		methodTotal.value,
	),
);
const categorySlices = computed(() =>
	slicesOf(
		props.report.by_category,
		(c) => c.name,
		(c) => c.revenue,
		(c) => ({ label: t("common.qty"), value: String(c.qty) }),
		categoryTotal.value,
	),
);

/**
 * The first letters of the first two words of a name.
 * @param name - a person's or channel's name
 * @returns up to two capitals, like "ZK"
 */
function initials(name: string) {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0])
		.join("")
		.toUpperCase();
}
</script>

<template>
  <Head :title="t('reports.title')" />
  <DailyReportDialog v-model:open="scheduleOpen" :schedule="schedule" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header: the title, with the filters on its right (they wrap below on narrow screens) -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ t("reports.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ rangeLabel }}</p>
      </div>
      <Button variant="outline" size="icon" :aria-label="t('reports.daily_title')" :title="t('reports.daily_title')" @click="scheduleOpen = true"><Settings /></Button>
      <!-- phones: two select boxes instead of the tab rows -->
      <div class="flex w-full gap-2 sm:hidden">
        <Select v-model="preset">
          <SelectTrigger class="flex-1" :aria-label="t('reports.period')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="[v, label] in PRESETS" :key="v" :value="v">{{ label }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="by">
          <SelectTrigger :aria-label="t('reports.group_by')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="day">{{ t("reports.by_day") }}</SelectItem>
            <SelectItem value="week">{{ t("reports.by_week") }}</SelectItem>
            <SelectItem value="month">{{ t("reports.by_month") }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Tabs v-model="preset" class="min-w-0 max-sm:hidden">
        <TabsList class="flex-wrap">
          <TabsTrigger v-for="[v, label] in PRESETS" :key="v" :value="v">{{ label }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs v-model="by" class="max-sm:hidden">
        <TabsList>
          <TabsTrigger value="day">{{ t("reports.by_day") }}</TabsTrigger>
          <TabsTrigger value="week">{{ t("reports.by_week") }}</TabsTrigger>
          <TabsTrigger value="month">{{ t("reports.by_month") }}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <div v-if="preset === 'custom'" class="flex flex-wrap items-end gap-2">
      <div class="grid gap-1">
        <label class="text-xs text-muted-foreground" for="rp-from">{{ t("reports.from") }}</label>
        <Input id="rp-from" v-model="from" type="date" :max="report.today" class="w-40" />
      </div>
      <div class="grid gap-1">
        <label class="text-xs text-muted-foreground" for="rp-to">{{ t("reports.to") }}</label>
        <Input id="rp-to" v-model="to" type="date" :max="report.today" class="w-40" />
      </div>
      <Button :disabled="!from || !to || from > to" @click="applyCustom">{{ t("reports.apply") }}</Button>
    </div>

    <!-- KPIs -->
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value">
        <template #sub>
          <span class="flex flex-wrap items-center gap-x-1.5">
            <span v-if="k.delta === null">{{ t("reports.no_previous") }}</span>
            <span v-else :class="k.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'" class="font-medium tabular-nums">
              {{ k.delta >= 0 ? "▲" : "▼" }} {{ Math.abs(k.delta) }}%
            </span>
            <span v-if="k.delta !== null">{{ t("reports.vs_previous") }}</span>
            <span v-if="k.sub">· {{ k.sub }}</span>
          </span>
          <span v-if="k.note" class="mt-1 block text-amber-600 dark:text-amber-400">{{ k.note }}</span>
        </template>
      </StatCard>
    </div>

    <!-- Inventory -->
    <Card class="py-0">
      <CardContent class="flex flex-wrap items-center gap-6 p-4">
        <div class="flex items-center gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400"><Boxes class="size-5" /></span>
          <div><p class="text-xs text-muted-foreground">{{ t("reports.tracked") }}</p><p class="text-lg font-semibold tabular-nums">{{ report.stock.tracked }}</p></div>
        </div>
        <div class="flex items-center gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400"><AlertTriangle class="size-5" /></span>
          <div><p class="text-xs text-muted-foreground">{{ t("reports.low_stock") }}</p><p class="text-lg font-semibold tabular-nums">{{ report.stock.low }}</p></div>
        </div>
        <div class="flex items-center gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"><PackageX class="size-5" /></span>
          <div><p class="text-xs text-muted-foreground">{{ t("reports.out_of_stock") }}</p><p class="text-lg font-semibold tabular-nums">{{ report.stock.out }}</p></div>
        </div>
        <Button variant="outline" as-child class="ml-auto"><Link href="/stock?filter=low">{{ t("reports.open_stock") }}</Link></Button>
      </CardContent>
    </Card>

    <!-- Sales chart + busiest hours, side by side on wide screens -->
    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Sales chart -->
      <Card class="gap-3">
        <CardHeader class="pb-0">
          <CardTitle class="text-base">{{ t("reports.sales") }}</CardTitle>
          <p class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-[2px]" style="background: var(--primary)" />{{ t("reports.sales") }}</span>
            <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-[2px]" style="background: var(--destructive)" />{{ t("reports.refunds") }}</span>
          </p>
        </CardHeader>
        <CardContent>
          <div ref="salesEl" class="relative w-full">
            <p v-if="!hasSales" class="py-14 text-center text-sm text-muted-foreground">{{ t("reports.no_sales_range") }}</p>
            <svg v-else :width="cw" :height="H" :viewBox="`0 0 ${cw} ${H}`" class="max-w-full overflow-visible" role="img" :aria-label="t('reports.sales_chart_aria')">
              <!-- gridlines + y labels -->
              <g>
                <line v-for="g in gridlines" :key="g.y" :x1="PAD.l" :x2="cw - PAD.r" :y1="g.y" :y2="g.y" stroke="var(--border)" stroke-width="1" />
                <text v-for="g in gridlines" :key="`t${g.y}`" :x="PAD.l - 8" :y="g.y + 3.5" text-anchor="end" font-size="10" fill="var(--muted-foreground)">{{ shortMoney(g.v) }}</text>
              </g>
              <!-- bars: sales, with refunds overlaid from the baseline -->
              <g v-for="(b, i) in bars" :key="b.key">
                <rect :x="b.x" :y="b.y" :width="b.bw" :height="b.sh" rx="2" fill="var(--primary)" />
                <rect v-if="b.refunds" :x="b.x" :y="b.ry" :width="b.bw" :height="b.rh" rx="2" fill="var(--destructive)" opacity="0.8" />
                <rect :x="b.x" :y="PAD.t" :width="b.bw" :height="plot.h" rx="2" :fill="salesTip?.key === b.key ? 'var(--foreground)' : 'transparent'" fill-opacity="0.06" @mouseenter="showSalesTip(b)" @mouseleave="hideTips" />
                <text v-if="i % labelStep === 0" :x="b.x + b.bw / 2" :y="H - 6" text-anchor="middle" font-size="10" fill="var(--muted-foreground)">{{ b.label }}</text>
              </g>
              <line :x1="PAD.l" :x2="cw - PAD.r" :y1="PAD.t + plot.h" :y2="PAD.t + plot.h" stroke="var(--border)" stroke-width="1" />
            </svg>
            <ChartTip v-if="salesTip && hasSales" :x="salesTip.x" :y="salesTip.y" :width="cw" :title="salesTip.title" :rows="salesTip.rows" />
          </div>
        </CardContent>
      </Card>

      <!-- Busiest hours -->
      <Card class="gap-3">
        <CardHeader class="pb-0"><CardTitle class="text-base">{{ t("reports.busiest_hours") }}</CardTitle></CardHeader>
        <CardContent>
          <div ref="hoursEl" class="relative w-full">
            <p v-if="!hasHours" class="py-8 text-center text-sm text-muted-foreground">{{ t("reports.no_orders_range") }}</p>
            <svg v-else :width="hoursWidth" :height="HH" :viewBox="`0 0 ${hoursWidth} ${HH}`" class="max-w-full" role="img" :aria-label="t('reports.hours_chart_aria')">
              <path :d="hourArea" fill="var(--primary)" fill-opacity="0.15" />
              <path :d="hourLine" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              <g v-for="b in hourPoints" :key="b.hour">
                <template v-if="hourTip?.key === String(b.hour)">
                  <line :x1="b.cx" :x2="b.cx" :y1="HPAD.t" :y2="HH - HPAD.b" stroke="var(--border)" stroke-dasharray="3 3" />
                  <circle :cx="b.cx" :cy="b.y" r="4" fill="var(--primary)" stroke="var(--card)" stroke-width="2" />
                </template>
                <rect :x="b.sx" :y="HPAD.t" :width="b.slot" :height="HH - HPAD.t - HPAD.b" fill="transparent" @mouseenter="showHourTip(b)" @mouseleave="hideTips" />
                <text v-if="b.hour % 3 === 0" :x="b.cx" :y="HH - 4" text-anchor="middle" font-size="10" fill="var(--muted-foreground)">{{ hourLabel(b.hour) }}</text>
              </g>
              <line :x1="HPAD.l" :x2="hoursWidth - HPAD.r" :y1="HH - HPAD.b" :y2="HH - HPAD.b" stroke="var(--border)" stroke-width="1" />
            </svg>
            <ChartTip v-if="hourTip && hasHours" :x="hourTip.x" :y="hourTip.y" :width="hoursWidth" :title="hourTip.title" :rows="hourTip.rows" />
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Breakdowns: top products on the left; cashiers, payments, categories and top customers stacked on the right -->
    <div class="grid items-start gap-4 lg:grid-cols-2">
      <div class="grid gap-4">
        <!-- Top products -->
        <Card class="gap-0 py-0">
          <CardHeader class="px-4 pt-4 pb-1"><CardTitle class="text-base">{{ t("reports.top_products") }}</CardTitle></CardHeader>
          <CardContent class="px-0 pb-1">
            <p v-if="!report.top_products.length" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t("reports.nothing_sold") }}</p>
            <ul v-else class="divide-y divide-border/60">
              <BreakdownRow v-for="p in report.top_products" :key="`${p.product_id}-${p.variant_id ?? 0}`" :name="p.name" :value="money(p.revenue, currency)">
                <template #lead><OrderItemImage :src="p.image" :size="36" /></template>
                <template #sub>
                  {{ t("reports.sold_count", { count: p.qty }) }}
                  <span v-if="p.refunded_qty" class="text-red-600 dark:text-red-400"> · {{ t("reports.returned_count", { count: p.refunded_qty }) }}</span>
                </template>
              </BreakdownRow>
            </ul>
          </CardContent>
        </Card>
      </div>

      <div class="grid gap-4">
        <!-- Cashiers -->
        <Card class="gap-0 overflow-visible py-0">
          <CardHeader class="px-4 pt-4 pb-1">
            <CardTitle class="text-base">{{ t("reports.by_cashier") }}</CardTitle>
            <CardAction v-if="cashierTotal" class="text-sm font-semibold tabular-nums">{{ money(cashierTotal, currency) }}</CardAction>
          </CardHeader>
          <CardContent class="flex items-center px-0 pb-1">
            <p v-if="!report.by_cashier.length" class="w-full px-4 py-8 text-center text-sm text-muted-foreground">{{ t("reports.no_sales_range") }}</p>
            <template v-else>
              <ShareChart v-if="cashierTotal" class="ml-4" :slices="cashierSlices" :label="t('reports.by_cashier')" />
              <ul class="min-w-0 flex-1 divide-y divide-border/60">
                <li v-for="(c, i) in report.by_cashier" :key="c.user_id" class="flex items-baseline gap-2 px-4 py-2.5 text-sm">
                  <span class="size-2.5 shrink-0 self-center rounded-full" :style="{ background: sliceColor(i) }" aria-hidden="true" />
                  <span class="truncate font-medium">{{ c.name }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{ t(c.orders === 1 ? "reports.order_count_one" : "reports.order_count_other", { count: c.orders }) }}</span>
                  <span class="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">{{ share(c.sales, cashierTotal) }}</span>
                  <span class="shrink-0 font-semibold tabular-nums">{{ money(c.sales, currency) }}</span>
                </li>
              </ul>
            </template>
          </CardContent>
        </Card>

        <!-- Payment methods -->
        <Card class="gap-0 overflow-visible py-0">
          <CardHeader class="px-4 pt-4 pb-1">
            <CardTitle class="text-base">{{ t("reports.by_method") }}</CardTitle>
            <CardAction v-if="methodTotal" class="text-sm font-semibold tabular-nums">{{ money(methodTotal, currency) }}</CardAction>
          </CardHeader>
          <CardContent class="flex items-center px-0 pb-1">
            <p v-if="!report.by_method.length" class="w-full px-4 py-8 text-center text-sm text-muted-foreground">{{ t("reports.no_payments") }}</p>
            <template v-else>
              <ShareChart v-if="methodTotal" class="ml-4" donut :slices="methodSlices" :label="t('reports.by_method')" />
              <ul class="min-w-0 flex-1 divide-y divide-border/60">
                <li v-for="(m, i) in report.by_method" :key="m.method" class="flex items-baseline gap-2 px-4 py-2.5 text-sm">
                  <span class="size-2.5 shrink-0 self-center rounded-full" :style="{ background: sliceColor(i) }" aria-hidden="true" />
                  <span class="truncate font-medium">{{ m.method }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{ t(m.orders === 1 ? "reports.order_count_one" : "reports.order_count_other", { count: m.orders }) }}</span>
                  <span class="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">{{ share(m.sales, methodTotal) }}</span>
                  <span class="shrink-0 font-semibold tabular-nums">{{ money(m.sales, currency) }}</span>
                </li>
              </ul>
            </template>
          </CardContent>
        </Card>

        <!-- Categories -->
        <Card class="gap-0 overflow-visible py-0">
          <CardHeader class="px-4 pt-4 pb-1">
            <CardTitle class="text-base">{{ t("reports.by_category") }}</CardTitle>
            <CardAction v-if="categoryTotal" class="text-sm font-semibold tabular-nums">{{ money(categoryTotal, currency) }}</CardAction>
          </CardHeader>
          <CardContent class="flex items-center px-0 pb-1">
            <p v-if="!report.by_category.length" class="w-full px-4 py-8 text-center text-sm text-muted-foreground">{{ t("reports.nothing_sold") }}</p>
            <template v-else>
              <ShareChart v-if="categoryTotal" class="ml-4" donut :slices="categorySlices" :label="t('reports.by_category')" />
              <ul class="min-w-0 flex-1 divide-y divide-border/60">
                <li v-for="(c, i) in report.by_category" :key="c.id ?? 'none'" class="flex items-baseline gap-2 px-4 py-2.5 text-sm">
                  <span class="size-2.5 shrink-0 self-center rounded-full" :style="{ background: sliceColor(i) }" aria-hidden="true" />
                  <span class="truncate font-medium">{{ c.name }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{ t("reports.sold_count", { count: c.qty }) }}</span>
                  <span class="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">{{ share(c.revenue, categoryTotal) }}</span>
                  <span class="shrink-0 font-semibold tabular-nums">{{ money(c.revenue, currency) }}</span>
                </li>
              </ul>
            </template>
          </CardContent>
        </Card>

        <!-- Top customers -->
        <Card class="gap-0 py-0">
          <CardHeader class="px-4 pt-4 pb-1"><CardTitle class="text-base">{{ t("reports.top_customers") }}</CardTitle></CardHeader>
          <CardContent class="px-0 pb-1">
            <p v-if="!report.top_customers.length" class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t("reports.no_customers") }}</p>
            <ul v-else class="divide-y divide-border/60">
              <BreakdownRow v-for="c in report.top_customers" :key="c.customer_id" :name="c.name" :href="`/customers/${c.customer_id}`" :value="money(c.sales, currency)">
                <template #lead>{{ initials(c.name) }}</template>
                <template #sub>{{ t(c.orders === 1 ? "reports.order_count_one" : "reports.order_count_other", { count: c.orders }) }}</template>
              </BreakdownRow>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
