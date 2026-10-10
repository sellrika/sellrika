<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, router, useForm, usePage } from "@inertiajs/vue3";
import { watchDebounced } from "@vueuse/core";
import { toast } from "vue-sonner";
import {
	ArrowDown,
	Copy,
	Hash,
	History,
	PiggyBank,
	Receipt,
	Scale,
	Plus,
	Search,
	Sparkles,
	TicketPercent,
	Trash2,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard.vue";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import CategoryPicker from "@/components/products/CategoryPicker.vue";
import Pager from "@/components/Pager.vue";
import { useFitPage } from "@/lib/fitPage";
import { couponLabel } from "@/lib/coupons";
import {
	currencySymbol,
	fmtDate,
	fromCents,
	money,
	toCents,
} from "@/lib/format";
import { t } from "@/lib/i18n";
import type {
	Category,
	CouponSummary,
	CouponType,
	CouponWithStats,
	Paged,
	SharedProps,
} from "@/types";

/** /coupons (admin): the shop's discount codes for the online checkout — one table, one dialog for add/edit.
 *  Money is typed as decimals and posted as cents; dates are the shop's days (YYYY-MM-DD). */
defineOptions({ layout: AppLayout });
const props = defineProps<{
	coupons: Paged<CouponWithStats>;
	summary: CouponSummary;
	filters: { q: string; sort: "" | "used" };
	products: { id: number; name: string }[];
	categories: Category[];
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");
const symbol = computed(() => currencySymbol(currency.value));

/** The cards on top: totals over every code of the shop, not just this page. */
const stats = computed(() => {
	const { uses, saved, sales } = props.summary;
	return [
		{ icon: Hash, label: t("coupons.times_used"), value: String(uses) },
		{
			icon: PiggyBank,
			label: t("coupons.total_given"),
			value: money(saved, currency.value),
		},
		{
			icon: Receipt,
			label: t("coupons.sales_with_code"),
			value: money(sales, currency.value),
		},
		{
			icon: Scale,
			label: t("coupons.avg_discount"),
			value: uses ? money(Math.round(saved / uses), currency.value) : "—",
		},
	];
});

// Search (?q=) over code / description and the sort (?sort=used) are server-side
const search = ref(props.filters.q);

/**
 * Reload the list with these filters, back on page 1.
 * @param q Search text.
 * @param sort "used" = most used first, "" = newest first.
 */
function reload(q: string, sort: string) {
	router.get(
		"/coupons",
		{ q: q.trim() || undefined, sort: sort || undefined },
		{ preserveState: true, preserveScroll: true, replace: true },
	);
}

/**
 * Search after a pause in typing.
 * @param q The new search text.
 */
function onSearch(q: string) {
	reload(q, props.filters.sort);
}
watchDebounced(search, onSearch, { debounce: 300 });

/** The Used header: switch between most used first and newest first. */
function toggleSort() {
	reload(search.value, props.filters.sort === "used" ? "" : "used");
}
useFitPage(
	"coupons",
	"/coupons",
	230,
	() => props.coupons.per_page,
	() => ({
		q: props.filters.q || undefined,
		sort: props.filters.sort || undefined,
	}),
);

// ---- table helpers -------------------------------------------------------------------------------------
const TYPES = computed<{ value: CouponType; label: string; hint: string }[]>(
	() => [
		{
			value: "percent",
			label: t("coupons.type_percent"),
			hint: t("coupons.type_percent_hint"),
		},
		{
			value: "fixed",
			label: t("coupons.type_fixed"),
			hint: t("coupons.type_fixed_hint"),
		},
		{
			value: "free_delivery",
			label: t("coupons.type_free_delivery"),
			hint: t("coupons.type_free_delivery_hint"),
		},
	],
);
const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const discountLabel = (c: CouponWithStats) => couponLabel(c, currency.value);
/** The conditions attached, in words ("" = none). */
function conditions(c: CouponWithStats) {
	const out: string[] = [];
	if (c.min_subtotal)
		out.push(
			t("coupons.cond_min", { amount: money(c.min_subtotal, currency.value) }),
		);
	if (c.product_ids.length || c.category_ids.length) {
		const parts = [
			c.product_ids.length &&
				t(
					c.product_ids.length === 1
						? "coupons.cond_products_one"
						: "coupons.cond_products_other",
					{ count: c.product_ids.length },
				),
			c.category_ids.length &&
				t(
					c.category_ids.length === 1
						? "coupons.cond_categories_one"
						: "coupons.cond_categories_other",
					{ count: c.category_ids.length },
				),
		].filter(Boolean);
		out.push(parts.join(" + "));
	}
	if (c.emails.length)
		out.push(
			t(
				c.emails.length === 1
					? "coupons.cond_emails_one"
					: "coupons.cond_emails_other",
				{ count: c.emails.length },
			),
		);
	if (c.per_customer_limit)
		out.push(t("coupons.cond_per_customer", { count: c.per_customer_limit }));
	return out.join(" · ");
}
function validity(c: CouponWithStats) {
	const d = (s: string) => fmtDate(`${s}T00:00:00`, { dateStyle: "medium" });
	if (c.starts_at && c.ends_at)
		return t("coupons.valid_range", {
			from: d(c.starts_at),
			to: d(c.ends_at),
		});
	if (c.starts_at) return t("coupons.valid_from", { date: d(c.starts_at) });
	if (c.ends_at) return t("coupons.valid_until", { date: d(c.ends_at) });
	return t("coupons.no_end");
}
function status(c: CouponWithStats): {
	label: string;
	variant: "default" | "secondary" | "destructive" | "outline";
} {
	if (!c.active) return { label: t("coupons.status_off"), variant: "outline" };
	const now = today();
	if (c.starts_at && now < c.starts_at)
		return { label: t("coupons.status_scheduled"), variant: "secondary" };
	if (c.ends_at && now > c.ends_at)
		return { label: t("coupons.status_expired"), variant: "destructive" };
	if (c.usage_limit !== null && c.used_count >= c.usage_limit)
		return { label: t("coupons.status_used_up"), variant: "destructive" };
	return { label: t("coupons.status_active"), variant: "default" };
}

// ---- add / edit dialog ----------------------------------------------------------------------------------
const blank = () => ({
	code: "",
	description: "",
	type: "percent" as CouponType,
	value: "",
	min_subtotal: "",
	max_discount: "",
	starts_at: "",
	ends_at: "",
	usage_limit: "",
	per_customer_limit: "",
	scope: "all" as "all" | "some",
	product_ids: [] as number[],
	category_ids: [] as number[],
	emails: "",
	active: true,
});
const form = useForm(blank());
form.transform((d) => ({
	code: d.code,
	description: d.description,
	type: d.type,
	value:
		d.type === "percent" ? Math.round(Number(d.value)) || 0 : toCents(d.value),
	min_subtotal: toCents(d.min_subtotal),
	max_discount:
		d.type === "percent" && d.max_discount ? toCents(d.max_discount) : null,
	starts_at: d.starts_at,
	ends_at: d.ends_at,
	usage_limit: d.usage_limit ? Math.round(Number(d.usage_limit)) : null,
	per_customer_limit: d.per_customer_limit
		? Math.round(Number(d.per_customer_limit))
		: null,
	product_ids: d.scope === "some" ? d.product_ids : [],
	category_ids: d.scope === "some" ? d.category_ids : [],
	emails: d.emails
		.split(/[\n,;]+/)
		.map((s) => s.trim())
		.filter(Boolean),
	active: d.active,
}));
const open = ref(false);
const editing = ref<CouponWithStats | null>(null);
const confirmDelete = ref(false);
function add() {
	editing.value = null;
	form.defaults(blank()).reset();
	form.clearErrors();
	open.value = true;
}
function edit(c: CouponWithStats) {
	editing.value = c;
	form
		.defaults({
			code: c.code,
			description: c.description,
			type: c.type,
			value:
				c.type === "percent"
					? String(c.value)
					: c.type === "fixed"
						? fromCents(c.value)
						: "",
			min_subtotal: c.min_subtotal ? fromCents(c.min_subtotal) : "",
			max_discount: c.max_discount ? fromCents(c.max_discount) : "",
			starts_at: c.starts_at ?? "",
			ends_at: c.ends_at ?? "",
			usage_limit: c.usage_limit ? String(c.usage_limit) : "",
			per_customer_limit: c.per_customer_limit
				? String(c.per_customer_limit)
				: "",
			scope: c.product_ids.length || c.category_ids.length ? "some" : "all",
			product_ids: [...c.product_ids],
			category_ids: [...c.category_ids],
			emails: c.emails.join("\n"),
			active: c.active,
		})
		.reset();
	form.clearErrors();
	open.value = true;
}
/** A random 8-letter code without look-alike characters (no O/0, I/1). */
function generate() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	form.code = Array.from(
		crypto.getRandomValues(new Uint8Array(8)),
		(b) => alphabet[b % alphabet.length],
	).join("");
}
function save() {
	const done = {
		preserveScroll: true,
		onSuccess: () => {
			open.value = false;
			toast.success(t(editing.value ? "coupons.updated" : "coupons.added"));
		},
	};
	if (editing.value) form.put(`/coupons/${editing.value.id}`, done);
	else form.post("/coupons", done);
}
/** Copy the code so the owner can paste it into a message to the customer. */
const copyCode = (code: string) =>
	navigator.clipboard.writeText(code).then(
		() => toast.success(t("coupons.copied", { code })),
		() => toast.error(t("coupons.copy_failed")),
	);

function destroy() {
	const c = editing.value!;
	router.delete(`/coupons/${c.id}`, {
		preserveScroll: true,
		onSuccess: () => {
			confirmDelete.value = false;
			open.value = false;
			toast.success(t("coupons.deleted", { code: c.code }));
		},
	});
}

// product scope: a searchable checklist (the whole catalog is already on the page)
const productQuery = ref("");
const shownProducts = computed(() => {
	const q = productQuery.value.trim().toLowerCase();
	const hits = q
		? props.products.filter((p) => p.name.toLowerCase().includes(q))
		: props.products;
	return hits.slice(0, 50); // ponytail: the first 50 matches — search narrows it; the chosen ones are listed separately
});
const chosenProducts = computed(() =>
	props.products.filter((p) => form.product_ids.includes(p.id)),
);
function toggleProduct(id: number) {
	const i = form.product_ids.indexOf(id);
	if (i === -1) form.product_ids.push(id);
	else form.product_ids.splice(i, 1);
}
watch(open, (v) => !v && (productQuery.value = ""));
</script>

<template>
  <Head :title="t('coupons.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ t("coupons.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t(filters.q ? (coupons.total === 1 ? "coupons.count_match_one" : "coupons.count_match_other") : (coupons.total === 1 ? "coupons.count_one" : "coupons.count_other"), { count: coupons.total }) }}</p>
      </div>
      <div class="relative w-full sm:w-64">
        <Search class="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground" />
        <Input v-model="search" class="pl-8" :placeholder="t('coupons.search_placeholder')" type="search" :aria-label="t('coupons.search_aria')" />
      </div>
      <Button @click="add"><Plus /> {{ t("coupons.add") }}</Button>
    </div>

    <!-- Totals over every code -->
    <div v-if="coupons.total || filters.q" class="grid grid-cols-2 gap-4 lg:grid-cols-4" data-coupon-stats>
      <StatCard v-for="s in stats" :key="s.label" :label="s.label" :icon="s.icon" :value="s.value" />
    </div>

    <!-- Empty state -->
    <Card v-if="!coupons.total && !filters.q">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><TicketPercent class="size-5" /></span>
        <p class="font-medium">{{ t("coupons.empty_title") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("coupons.empty_text") }}</p>
        <Button class="mt-2" @click="add"><Plus /> {{ t("coupons.add") }}</Button>
      </CardContent>
    </Card>

    <!-- Table -->
    <Card v-else-if="coupons.data.length" class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t("coupons.code") }}</TableHead>
            <TableHead>{{ t("coupons.discount") }}</TableHead>
            <TableHead class="hidden lg:table-cell">{{ t("coupons.conditions") }}</TableHead>
            <TableHead class="hidden md:table-cell">{{ t("coupons.valid") }}</TableHead>
            <TableHead class="hidden w-28 text-right sm:table-cell" :aria-sort="filters.sort === 'used' ? 'descending' : 'none'">
              <Button variant="ghost" size="sm" class="-mr-2" :title="t('coupons.sort_used')" @click="toggleSort">{{ t("coupons.used") }}<ArrowDown :class="filters.sort === 'used' ? '' : 'opacity-30'" /></Button>
            </TableHead>
            <TableHead class="w-24">{{ t("common.status") }}</TableHead>
            <TableHead class="w-12 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in coupons.data" :key="c.id" class="cursor-pointer" tabindex="0" role="button" :aria-label="t('coupons.edit_aria', { code: c.code })" @click="edit(c)" @keydown.enter="edit(c)" @keydown.space.prevent="edit(c)">
            <TableCell class="max-w-0 pl-4">
              <div class="flex items-center gap-1">
                <span class="truncate font-mono font-semibold">{{ c.code }}</span>
                <Button variant="ghost" size="icon-sm" class="size-6 shrink-0 text-muted-foreground" :aria-label="t('coupons.copy_aria', { code: c.code })" :title="t('coupons.copy_aria', { code: c.code })" @click.stop="copyCode(c.code)" @keydown.enter.stop @keydown.space.stop><Copy class="size-3.5" /></Button>
              </div>
              <div v-if="c.description" class="truncate text-xs text-muted-foreground">{{ c.description }}</div>
            </TableCell>
            <TableCell class="whitespace-nowrap">{{ discountLabel(c) }}</TableCell>
            <TableCell class="hidden max-w-0 truncate text-sm text-muted-foreground lg:table-cell">{{ conditions(c) || "—" }}</TableCell>
            <TableCell class="hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell">{{ validity(c) }}</TableCell>
            <TableCell class="hidden text-right tabular-nums sm:table-cell">
              <div>{{ c.used_count }}<span v-if="c.usage_limit !== null" class="text-muted-foreground"> / {{ c.usage_limit }}</span></div>
              <div v-if="c.saved_total" class="text-xs text-muted-foreground">−{{ money(c.saved_total, currency) }}</div>
            </TableCell>
            <TableCell><Badge :variant="status(c).variant">{{ status(c).label }}</Badge></TableCell>
            <TableCell class="pr-4">
              <!-- the row itself opens the editor; this goes to the history (stop so the click doesn't do both) -->
              <Button variant="ghost" size="icon-sm" :aria-label="t('coupons.history_aria', { code: c.code })" :title="t('coupons.history_aria', { code: c.code })" @click.stop="router.visit(`/coupons/${c.id}`)" @keydown.enter.stop @keydown.space.stop><History /></Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- No match -->
    <Card v-else>
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Search class="size-5" /></span>
        <p class="font-medium">{{ t("coupons.no_match_title") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("coupons.no_match_text", { q: filters.q }) }}</p>
      </CardContent>
    </Card>

    <Pager :page="coupons" />

    <!-- Add / edit -->
    <Dialog v-model:open="open">
      <DialogContent class="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ editing ? t("coupons.edit_title", { code: editing.code }) : t("coupons.add") }}</DialogTitle>
          <DialogDescription>{{ t("coupons.dialog_desc") }}</DialogDescription>
        </DialogHeader>
        <!-- the form scrolls, not the dialog — a scrolling dialog clips its own close button in the corner -->
        <form id="coupon-form" class="-mx-4 grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-1" @submit.prevent="save">
          <!-- code + description -->
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid content-start gap-2">
              <Label for="cp-code">{{ t("coupons.code") }}</Label>
              <InputGroup>
                <InputGroupInput id="cp-code" v-model="form.code" class="font-mono uppercase" :placeholder="t('coupons.code_placeholder')" autocomplete="off" :aria-invalid="!!form.errors.code" />
                <InputGroupAddon align="inline-end"><Button type="button" variant="ghost" size="icon-sm" :aria-label="t('coupons.generate_aria')" :title="t('coupons.generate_title')" @click="generate"><Sparkles /></Button></InputGroupAddon>
              </InputGroup>
              <p v-if="form.errors.code" class="text-sm text-destructive">{{ form.errors.code }}</p>
            </div>
            <div class="grid content-start gap-2">
              <Label for="cp-description">{{ t("coupons.description") }}</Label>
              <Input id="cp-description" v-model="form.description" :placeholder="t('coupons.description_placeholder')" :aria-invalid="!!form.errors.description" />
              <p v-if="form.errors.description" class="text-sm text-destructive">{{ form.errors.description }}</p>
            </div>
          </div>

          <!-- what it takes off -->
          <fieldset class="grid gap-2">
            <legend class="mb-2 text-sm font-medium">{{ t("coupons.discount") }}</legend>
            <div class="grid gap-2 sm:grid-cols-3">
              <label v-for="ty in TYPES" :key="ty.value" class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm" :class="form.type === ty.value && 'border-primary ring-1 ring-primary'">
                <input v-model="form.type" type="radio" name="type" :value="ty.value" class="mt-0.5 accent-primary" />
                <span><span class="block font-medium">{{ ty.label }}</span><span class="block text-xs text-muted-foreground">{{ ty.hint }}</span></span>
              </label>
            </div>
            <div v-if="form.type !== 'free_delivery'" class="mt-2 grid gap-4 sm:grid-cols-2">
              <div class="grid content-start gap-2">
                <Label for="cp-value">{{ form.type === "percent" ? t("coupons.percentage") : t("coupons.amount_off") }}</Label>
                <InputGroup>
                  <InputGroupAddon v-if="form.type === 'fixed'"><InputGroupText>{{ symbol }}</InputGroupText></InputGroupAddon>
                  <InputGroupInput id="cp-value" v-model="form.value" inputmode="decimal" :placeholder="form.type === 'percent' ? '10' : '5.00'" :aria-invalid="!!form.errors.value" />
                  <InputGroupAddon v-if="form.type === 'percent'" align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
                </InputGroup>
                <p v-if="form.errors.value" class="text-sm text-destructive">{{ form.errors.value }}</p>
              </div>
              <div v-if="form.type === 'percent'" class="grid content-start gap-2">
                <Label for="cp-max">{{ t("coupons.max_discount") }} <span class="font-normal text-muted-foreground">({{ t("common.optional") }})</span></Label>
                <InputGroup>
                  <InputGroupAddon><InputGroupText>{{ symbol }}</InputGroupText></InputGroupAddon>
                  <InputGroupInput id="cp-max" v-model="form.max_discount" inputmode="decimal" :placeholder="t('coupons.no_cap')" :aria-invalid="!!form.errors.max_discount" />
                </InputGroup>
                <p v-if="form.errors.max_discount" class="text-sm text-destructive">{{ form.errors.max_discount }}</p>
              </div>
            </div>
          </fieldset>

          <!-- when + how often -->
          <fieldset class="grid gap-4 sm:grid-cols-2">
            <legend class="mb-2 text-sm font-medium">{{ t("coupons.validity_legend") }}</legend>
            <div class="grid content-start gap-2">
              <Label for="cp-starts">{{ t("coupons.starts_on") }}</Label>
              <Input id="cp-starts" v-model="form.starts_at" type="date" :aria-invalid="!!form.errors.starts_at" />
              <p v-if="form.errors.starts_at" class="text-sm text-destructive">{{ form.errors.starts_at }}</p>
            </div>
            <div class="grid content-start gap-2">
              <Label for="cp-ends">{{ t("coupons.ends_on") }}</Label>
              <Input id="cp-ends" v-model="form.ends_at" type="date" :aria-invalid="!!form.errors.ends_at" />
              <p v-if="form.errors.ends_at" class="text-sm text-destructive">{{ form.errors.ends_at }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("coupons.ends_help") }}</p>
            </div>
            <div class="grid content-start gap-2">
              <Label for="cp-min">{{ t("coupons.min_order") }}</Label>
              <InputGroup>
                <InputGroupAddon><InputGroupText>{{ symbol }}</InputGroupText></InputGroupAddon>
                <InputGroupInput id="cp-min" v-model="form.min_subtotal" inputmode="decimal" placeholder="0.00" :aria-invalid="!!form.errors.min_subtotal" />
              </InputGroup>
              <p v-if="form.errors.min_subtotal" class="text-sm text-destructive">{{ form.errors.min_subtotal }}</p>
              <p v-else class="text-xs text-muted-foreground">{{ t("coupons.min_help") }}</p>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid content-start gap-2">
                <Label for="cp-limit">{{ t("coupons.total_uses") }}</Label>
                <Input id="cp-limit" v-model="form.usage_limit" type="number" min="1" step="1" :placeholder="t('coupons.unlimited')" :aria-invalid="!!form.errors.usage_limit" />
                <p v-if="form.errors.usage_limit" class="text-sm text-destructive">{{ form.errors.usage_limit }}</p>
              </div>
              <div class="grid content-start gap-2">
                <Label for="cp-per">{{ t("coupons.per_customer") }}</Label>
                <Input id="cp-per" v-model="form.per_customer_limit" type="number" min="1" step="1" :placeholder="t('coupons.unlimited')" :aria-invalid="!!form.errors.per_customer_limit" />
                <p v-if="form.errors.per_customer_limit" class="text-sm text-destructive">{{ form.errors.per_customer_limit }}</p>
              </div>
            </div>
          </fieldset>

          <!-- which products -->
          <fieldset class="grid gap-2">
            <legend class="mb-2 text-sm font-medium">{{ t("coupons.applies_legend") }}</legend>
            <div class="flex flex-wrap gap-4 text-sm">
              <label class="flex cursor-pointer items-center gap-2"><input v-model="form.scope" type="radio" name="scope" value="all" class="accent-primary" /> {{ t("coupons.all_products") }}</label>
              <label class="flex cursor-pointer items-center gap-2"><input v-model="form.scope" type="radio" name="scope" value="some" class="accent-primary" /> {{ t("coupons.some_products") }}</label>
            </div>
            <div v-if="form.scope === 'some'" class="mt-2 grid gap-4">
              <div class="grid gap-2">
                <Label>{{ t("coupons.categories") }}</Label>
                <CategoryPicker v-model="form.category_ids" :categories="categories" />
                <p v-if="form.errors.category_ids" class="text-sm text-destructive">{{ form.errors.category_ids }}</p>
              </div>
              <div class="grid gap-2">
                <Label for="cp-product-search">{{ t("coupons.products") }}</Label>
                <div v-if="chosenProducts.length" class="flex flex-wrap gap-1.5">
                  <button v-for="p in chosenProducts" :key="p.id" type="button" class="inline-flex h-7 items-center gap-1 rounded-4xl border border-primary bg-primary px-2.5 text-xs font-medium text-primary-foreground" :aria-label="t('coupons.remove_aria', { name: p.name })" @click="toggleProduct(p.id)">{{ p.name }} ×</button>
                </div>
                <Input id="cp-product-search" v-model="productQuery" type="search" :placeholder="t('coupons.product_search')" />
                <div class="max-h-40 overflow-y-auto rounded-md border text-sm">
                  <label v-for="p in shownProducts" :key="p.id" class="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted">
                    <input type="checkbox" class="accent-primary" :checked="form.product_ids.includes(p.id)" :aria-label="p.name" @change="toggleProduct(p.id)" />
                    <span class="truncate">{{ p.name }}</span>
                  </label>
                  <p v-if="!shownProducts.length" class="px-3 py-2 text-muted-foreground">{{ t("coupons.no_products_match") }}</p>
                </div>
                <p v-if="form.errors.product_ids" class="text-sm text-destructive">{{ form.errors.product_ids }}</p>
                <!-- one sentence with an <em> inside it — fixed text, no user data -->
                <p class="text-xs text-muted-foreground" v-html="t('coupons.scope_help')" />
              </div>
            </div>
          </fieldset>

          <!-- which customers -->
          <div class="grid gap-2">
            <Label for="cp-emails">{{ t("coupons.emails_label") }} <span class="font-normal text-muted-foreground">({{ t("common.optional") }})</span></Label>
            <Textarea id="cp-emails" v-model="form.emails" rows="3" placeholder="ann@example.com&#10;bob@example.com" :aria-invalid="!!form.errors.emails" />
            <p v-if="form.errors.emails" class="text-sm text-destructive">{{ form.errors.emails }}</p>
            <p v-else class="text-xs text-muted-foreground">{{ t("coupons.emails_help") }}</p>
          </div>

          <div class="flex items-center justify-between rounded-lg border p-3">
            <div><p class="text-sm font-medium">{{ t("coupons.active") }}</p><p class="text-xs text-muted-foreground">{{ t("coupons.active_help") }}</p></div>
            <Switch v-model="form.active" :aria-label="t('coupons.active')" />
          </div>
        </form>
        <DialogFooter class="sm:justify-between">
          <Button v-if="editing" type="button" variant="ghost" class="text-destructive hover:text-destructive" @click="confirmDelete = true"><Trash2 /> {{ t("common.delete") }}</Button>
          <span v-else />
          <div class="flex gap-2">
            <Button variant="outline" type="button" @click="open = false">{{ t("common.cancel") }}</Button>
            <Button type="submit" form="coupon-form" :disabled="form.processing">{{ editing ? t("common.save") : t("coupons.add") }}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="confirmDelete">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("coupons.delete_title", { code: editing?.code ?? "" }) }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t("coupons.delete_desc") }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="destroy">{{ t("common.delete") }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
