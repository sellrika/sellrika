<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ChevronDown, Copy, Plus, Trash2, Wand2, X } from "@lucide/vue";
import ImagesUpload from "./ImagesUpload.vue";
import { t } from "@/lib/i18n";

type VariantRow = {
	id?: number;
	name: string;
	price: string;
	purchase_price?: string;
	attributes?: Record<string, string> | null;
	sku?: string;
	barcode?: string;
	images: string[];
};

const props = defineProps<{
	basePrice: string;
	errors: Record<string, string>;
	currencySymbol: string;
}>();
const variants = defineModel<VariantRow[]>({ required: true });

const wrap = ref<HTMLElement | null>(null);

async function focusName(i: number) {
	await nextTick();
	wrap.value
		?.querySelector<HTMLInputElement>(`[data-variant-name="${i}"]`)
		?.focus();
}

function addRow() {
	variants.value.push({
		name: "",
		price: props.basePrice,
		purchase_price: "",
		sku: "",
		barcode: "",
		images: [],
	});
	focusName(variants.value.length - 1);
}

/** Copy of row i right under it — same price/cost/attributes/SKU/images, new id; the barcode must stay unique so it's cleared. */
function duplicate(i: number) {
	const v = variants.value[i]!;
	variants.value.splice(i + 1, 0, {
		...v,
		id: undefined,
		name: t("products.copy_suffix", { name: v.name }),
		barcode: "",
		attributes: v.attributes ? { ...v.attributes } : v.attributes,
		images: [...v.images],
	});
	focusName(i + 1);
}

// "Quick generate": every combination of the option groups, e.g. Red / S, Red / M …
const showGenerator = ref(false);
const groups = ref<{ name: string; values: string }[]>([
	{ name: "", values: "" },
]);

const combos = computed(() => {
	const lists = groups.value
		.map((g, i) => ({
			name: g.name.trim() || t("products.option_n", { n: i + 1 }),
			values: g.values
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean),
		}))
		.filter((g) => g.values.length > 0);
	if (!lists.length)
		return [] as { name: string; attributes: Record<string, string> }[];
	let out: { name: string; attributes: Record<string, string> }[] = [
		{ name: "", attributes: {} },
	];
	for (const g of lists) {
		out = out.flatMap((c) =>
			g.values.map((v) => ({
				name: c.name ? `${c.name} / ${v}` : v,
				attributes: { ...c.attributes, [g.name]: v },
			})),
		);
	}
	return out;
});

const newCombos = computed(() => {
	const existing = new Set(
		variants.value.map((v) => v.name.trim().toLowerCase()),
	);
	return combos.value.filter((c) => !existing.has(c.name.toLowerCase()));
});

/** Group → values across all current variants (what gets saved as each variant's attributes). */
const savedGroups = computed(() => {
	const m = new Map<string, Set<string>>();
	for (const v of variants.value)
		for (const [k, val] of Object.entries(v.attributes ?? {}))
			(m.get(k) ?? m.set(k, new Set()).get(k)!).add(val);
	return [...m].map(([name, vals]) => ({ name, values: [...vals] }));
});

function generate() {
	for (const c of newCombos.value)
		variants.value.push({
			name: c.name,
			price: props.basePrice,
			purchase_price: "",
			attributes: c.attributes,
			sku: "",
			barcode: "",
			images: [],
		});
	groups.value = [{ name: "", values: "" }];
	showGenerator.value = false;
}

// Option groups: the product's groups + their values, managed in one panel above the table. Rows tag
// themselves by picking a value from a dropdown (no free text → no "red"/"Red" mismatches, so the
// storefront's guided picker always resolves). `declared` holds groups/values added here that no row
// uses yet; what renders is the union with what the rows already carry (`savedGroups`).
const declared = ref<{ name: string; values: string[] }[]>([]);
const optionGroups = computed(() => {
	const m = new Map<string, string[]>();
	for (const g of [...savedGroups.value, ...declared.value])
		m.set(g.name, [...new Set([...(m.get(g.name) ?? []), ...g.values])]);
	return [...m].map(([name, values]) => ({ name, values }));
});
const newGroup = ref("");
const addingGroup = ref(false);
const newValue = ref<Record<string, string>>({}); // group → value being typed
async function startGroup() {
	addingGroup.value = true;
	await nextTick();
	wrap.value?.querySelector<HTMLInputElement>("[data-new-group]")?.focus();
}
function addGroup() {
	const name = newGroup.value.trim();
	if (name && !optionGroups.value.some((g) => g.name === name))
		declared.value.push({ name, values: [] });
	newGroup.value = "";
	addingGroup.value = false;
}
function addValue(group: string) {
	const value = (newValue.value[group] ?? "").trim();
	const g =
		declared.value.find((d) => d.name === group) ??
		declared.value[declared.value.push({ name: group, values: [] }) - 1]!;
	if (value && !g.values.includes(value)) g.values.push(value);
	newValue.value[group] = "";
}
/** Drop a group from every row (and from the panel). */
function removeGroup(name: string) {
	declared.value = declared.value.filter((g) => g.name !== name);
	for (const v of variants.value) setAttr(v, name, "");
}
/** Drop one value: rows tagged with it lose the tag. */
function removeValue(group: string, value: string) {
	const g = declared.value.find((d) => d.name === group);
	if (g) g.values = g.values.filter((x) => x !== value);
	for (const v of variants.value)
		if (v.attributes?.[group] === value) setAttr(v, group, "");
}
const autoName = (a: Record<string, string> | null | undefined) =>
	Object.values(a ?? {}).join(" / ");
/** Tag a row; an empty value drops the key, no keys left → `attributes: null` (what the API stores).
 * A row that is unnamed, or still carries the name its tags made, is renamed from the new tags ("Red / M"). */
function setAttr(v: VariantRow, group: string, value: string) {
	const next = { ...(v.attributes ?? {}) };
	if (value.trim()) next[group] = value;
	else delete next[group];
	const keepName = v.name.trim() && v.name !== autoName(v.attributes);
	v.attributes = Object.keys(next).length ? next : null;
	if (!keepName) v.name = autoName(v.attributes);
}

/** "1 variant · leave empty…" / "4 variants · leave empty…". */
const variantsHint = computed(function hint() {
	const n = variants.value.length;
	return t(
		n === 1 ? "products.variants_count_one" : "products.variants_count_other",
		{ count: n },
	);
});

const bulkPrice = ref("");
function applyBulkPrice() {
	for (const v of variants.value) v.price = bulkPrice.value;
}
</script>

<template>
  <div ref="wrap" class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <p class="mr-auto text-sm text-muted-foreground">
        {{ variantsHint }}
        <span v-if="savedGroups.length" class="block text-xs">
          {{ t("products.groups_label") }} <span v-for="(g, gi) in savedGroups" :key="g.name"><span v-if="gi">, </span><b>{{ g.name }}</b> ({{ g.values.join(", ") }})</span>
        </span>
      </p>
      <!-- Option groups panel: each group = chips of its values (+ add / remove), rows pick from these -->
      <div class="basis-full space-y-2 rounded-lg border bg-muted/20 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">{{ t("products.option_groups") }}</span>
          <span class="text-xs text-muted-foreground">{{ t("products.option_groups_hint") }}</span>
          <Input v-if="addingGroup" v-model="newGroup" data-new-group class="ml-auto h-8 w-40" :placeholder="t('products.group_name')" :aria-label="t('products.new_group_name')" @keydown.enter.prevent="addGroup" @blur="addGroup" />
          <Button v-else type="button" variant="outline" size="sm" class="ml-auto" @click="startGroup"><Plus /> {{ t("products.add_group") }}</Button>
        </div>
        <div v-for="g in optionGroups" :key="g.name" class="flex flex-wrap items-center gap-1.5">
          <span class="w-20 truncate text-sm font-medium" :title="g.name">{{ g.name }}</span>
          <Badge v-for="val in g.values" :key="val" variant="secondary" class="gap-1 pr-1 font-normal">
            {{ val }}
            <button type="button" class="rounded-full p-0.5 hover:bg-foreground/10" :aria-label="t('products.remove_group_value', { group: g.name, value: val })" @click="removeValue(g.name, val)"><X class="size-3" /></button>
          </Badge>
          <Input v-model="newValue[g.name]" class="h-7 w-32 text-xs" :placeholder="t('products.add_value')" :aria-label="t('products.new_group_value', { group: g.name })" @keydown.enter.prevent="addValue(g.name)" @blur="addValue(g.name)" />
          <Button type="button" variant="ghost" size="icon-sm" class="ml-auto" :aria-label="t('products.remove_group', { group: g.name })" @click="removeGroup(g.name)"><X /></Button>
        </div>
        <p v-if="!optionGroups.length" class="text-xs text-muted-foreground">{{ t("products.no_groups") }}</p>
      </div>
      <Button type="button" variant="outline" size="sm" :aria-expanded="showGenerator" @click="showGenerator = !showGenerator">
        <Wand2 /> {{ t("products.quick_generate") }}
        <ChevronDown class="transition-transform" :class="showGenerator && 'rotate-180'" />
      </Button>
      <Button type="button" variant="outline" size="sm" @click="addRow"><Plus /> {{ t("products.add_variant") }}</Button>
    </div>

    <!-- Quick generate -->
    <div v-if="showGenerator" class="space-y-3 rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/40">
      <p class="text-xs text-muted-foreground">{{ t("products.generator_hint") }}</p>
      <div v-for="(g, gi) in groups" :key="gi" class="flex flex-wrap items-center gap-2">
        <Input v-model="g.name" class="w-full sm:w-36" :placeholder="t('products.color_placeholder')" :aria-label="t('products.option_group_name')" />
        <Input v-model="g.values" class="w-full flex-1 sm:w-auto" :placeholder="t('products.values_placeholder')" :aria-label="t('products.option_values')" />
        <Button
          v-if="groups.length > 1"
          type="button"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('products.remove_option_group')"
          @click="groups.splice(gi, 1)"
        >
          <Trash2 />
        </Button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" @click="groups.push({ name: '', values: '' })"><Plus /> {{ t("products.add_group") }}</Button>
        <Button type="button" size="sm" :disabled="!newCombos.length" @click="generate">
          {{ t(newCombos.length === 1 ? "products.generate_one" : "products.generate_other", { count: newCombos.length }) }}
        </Button>
        <span v-if="combos.length && !newCombos.length" class="text-xs text-muted-foreground">{{ t("products.all_exist") }}</span>
      </div>
    </div>

    <!-- Rows -->
    <!-- Table on md+; below that each row becomes a stacked card (CSS only) -->
    <div v-if="variants.length" class="rounded-lg border">
      <Table class="max-md:block">
        <TableHeader class="max-md:hidden">
          <TableRow>
            <TableHead>{{ t("common.name") }}</TableHead>
            <TableHead class="w-40">{{ t("common.price") }}</TableHead>
            <TableHead class="w-40">{{ t("products.purchase_price") }}</TableHead>
            <TableHead class="w-36">{{ t("products.sku") }}</TableHead>
            <TableHead class="w-48">{{ t("products.barcode") }}</TableHead>
            <TableHead class="w-52">{{ t("products.images") }}</TableHead>
            <TableHead class="w-20"><span class="sr-only">{{ t("common.actions") }}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody class="max-md:block">
          <TableRow v-for="(v, i) in variants" :key="i" class="align-top max-md:relative max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-3 max-md:p-3">
            <TableCell class="whitespace-normal max-md:col-span-2 max-md:p-0 max-md:pr-10">
              <Input
                v-model="v.name"
                :data-variant-name="i"
                :placeholder="t('products.variant_name_placeholder')"
                :aria-invalid="!!errors[`variants.${i}.name`]"
                :aria-label="t('products.variant_name')"
              />
              <p v-if="errors[`variants.${i}.name`]" class="mt-1 text-xs text-destructive">{{ errors[`variants.${i}.name`] }}</p>
              <!-- one dropdown per option group: the row's tag for that group (blank = untagged) -->
              <div v-if="optionGroups.length" class="mt-1.5 flex flex-wrap gap-1.5">
                <label v-for="g in optionGroups" :key="g.name" class="flex h-8 items-center gap-1 rounded-md border bg-transparent pl-2 text-xs">
                  <span class="text-muted-foreground">{{ g.name }}</span>
                  <select :value="v.attributes?.[g.name] ?? ''" :aria-label="t('products.variant_group', { group: g.name })" class="h-full rounded-r-md bg-transparent pr-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50" @change="setAttr(v, g.name, ($event.target as HTMLSelectElement).value)">
                    <option value="">—</option>
                    <option v-for="val in g.values" :key="val" :value="val">{{ val }}</option>
                  </select>
                </label>
              </div>
            </TableCell>
            <TableCell class="whitespace-normal max-md:p-0">
              <Label class="mb-1 text-xs text-muted-foreground md:hidden">{{ t("common.price") }}</Label>
              <InputGroup>
                <InputGroupAddon><InputGroupText>{{ currencySymbol }}</InputGroupText></InputGroupAddon>
                <InputGroupInput
                  v-model="v.price"
                  inputmode="decimal"
                  placeholder="0.00"
                  :aria-invalid="!!errors[`variants.${i}.price`]"
                  :aria-label="t('products.variant_price')"
                  @keydown.enter.prevent="i === variants.length - 1 && addRow()"
                />
              </InputGroup>
              <p v-if="errors[`variants.${i}.price`]" class="mt-1 text-xs text-destructive">{{ errors[`variants.${i}.price`] }}</p>
            </TableCell>
            <TableCell class="whitespace-normal max-md:p-0">
              <Label class="mb-1 text-xs text-muted-foreground md:hidden">{{ t("products.purchase_price") }}</Label>
              <InputGroup>
                <InputGroupAddon><InputGroupText>{{ currencySymbol }}</InputGroupText></InputGroupAddon>
                <InputGroupInput
                  v-model="v.purchase_price"
                  inputmode="decimal"
                  :placeholder="t('common.optional')"
                  :aria-invalid="!!errors[`variants.${i}.purchase_price`]"
                  :aria-label="t('products.variant_purchase_price')"
                />
              </InputGroup>
              <p v-if="errors[`variants.${i}.purchase_price`]" class="mt-1 text-xs text-destructive">{{ errors[`variants.${i}.purchase_price`] }}</p>
            </TableCell>
            <TableCell class="whitespace-normal max-md:p-0">
              <Label class="mb-1 text-xs text-muted-foreground md:hidden">{{ t("products.sku") }}</Label>
              <Input
                v-model="v.sku"
                autocomplete="off"
                :placeholder="t('common.optional')"
                :aria-invalid="!!errors[`variants.${i}.sku`]"
                :aria-label="t('products.variant_sku')"
                @keydown.enter.prevent
              />
              <p v-if="errors[`variants.${i}.sku`]" class="mt-1 text-xs text-destructive">{{ errors[`variants.${i}.sku`] }}</p>
            </TableCell>
            <TableCell class="whitespace-normal max-md:p-0">
              <Label class="mb-1 text-xs text-muted-foreground md:hidden">{{ t("products.barcode") }}</Label>
              <Input
                v-model="v.barcode"
                inputmode="numeric"
                autocomplete="off"
                :placeholder="t('products.scan_or_type')"
                :aria-invalid="!!errors[`variants.${i}.barcode`]"
                :aria-label="t('products.variant_barcode')"
                @keydown.enter.prevent
              />
              <p v-if="errors[`variants.${i}.barcode`]" class="mt-1 text-xs text-destructive">{{ errors[`variants.${i}.barcode`] }}</p>
            </TableCell>
            <TableCell class="min-w-52 whitespace-normal max-md:col-span-2 max-md:p-0">
              <Label class="mb-1 text-xs text-muted-foreground md:hidden">{{ t("products.images") }}</Label>
              <ImagesUpload v-model="v.images" compact />
              <p v-if="errors[`variants.${i}.images`]" class="mt-1 text-xs text-destructive">{{ errors[`variants.${i}.images`] }}</p>
            </TableCell>
            <TableCell class="max-md:absolute max-md:top-3 max-md:right-3 max-md:p-0">
              <div class="flex">
                <Button type="button" variant="ghost" size="icon-sm" :aria-label="t('products.duplicate_variant')" @click="duplicate(i)">
                  <Copy />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" :aria-label="t('products.remove_variant')" @click="variants.splice(i, 1)">
                  <Trash2 />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div class="flex flex-wrap items-center gap-2 border-t bg-muted/30 p-2">
        <Label class="text-xs text-muted-foreground" for="bulk-price">{{ t("products.bulk_price") }}</Label>
        <Input id="bulk-price" v-model="bulkPrice" class="h-7 w-24" inputmode="decimal" placeholder="0.00" />
        <Button type="button" variant="outline" size="sm" :disabled="!bulkPrice" @click="applyBulkPrice">{{ t("products.apply_to_all") }}</Button>
        <span class="ml-auto text-xs text-muted-foreground">{{ t("products.enter_hint") }}</span>
      </div>
    </div>

    <button
      v-else
      type="button"
      class="w-full rounded-lg border border-dashed border-input py-6 text-sm text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      @click="addRow"
    >
      {{ t("products.no_variants_cta") }}
    </button>
  </div>
</template>
