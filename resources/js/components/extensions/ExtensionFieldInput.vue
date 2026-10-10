<script setup lang="ts">
// One setting of an extension on the /extensions dialog: its label, the control for its type, its error.
// A `list` field renders its rows with this same component (one box per row, Add / Remove buttons).
import { Plus, Trash2 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import ChipPicker from "@/components/ChipPicker.vue";
import ImageUpload from "@/components/products/ImageUpload.vue";
import { t } from "@/lib/i18n";
import type {
	ExtensionConfigPrimitive,
	ExtensionConfigValue,
	ExtensionField,
} from "@/types";

const props = defineProps<{
	field: ExtensionField;
	/** Where the value sits in the config: `hooks`, or `hooks.0.url` inside a list — also the error key after `config.`. */
	path: string;
	errors: Partial<Record<string, string>>;
	/** A secret field that has a stored value (shown as "Saved", blank keeps it). */
	secretSaved?: boolean;
}>();
const model = defineModel<ExtensionConfigValue>();

const id = `ext-${props.path}`;
// the field's width on the 8-column form (manifest `grid`, 1–8) — spelled out so Tailwind ships the classes
const SPAN: Record<number, string> = {
	1: "sm:col-span-1",
	2: "sm:col-span-2",
	3: "sm:col-span-3",
	4: "sm:col-span-4",
	5: "sm:col-span-5",
	6: "sm:col-span-6",
	7: "sm:col-span-7",
	8: "sm:col-span-8",
};
const error = () => props.errors[`config.${props.path}`];

// multiselect: the same tag picker as the delivery zones, which works on plain strings — the option labels are shown,
// the values are stored (ponytail: labels must be unique within a field, which every sane manifest has)
const labels = () => (props.field.options ?? []).map((o) => o.label);
const picked = () =>
	(props.field.options ?? [])
		.filter(
			(o) =>
				Array.isArray(model.value) &&
				(model.value as string[]).includes(o.value),
		)
		.map((o) => o.label);
const pick = (names: string[]) =>
	(model.value = (props.field.options ?? [])
		.filter((o) => names.includes(o.label))
		.map((o) => o.value));

// list: the rows, each keyed by the sub-field names
type Row = Record<string, ExtensionConfigPrimitive>;
const rows = () => (Array.isArray(model.value) ? (model.value as Row[]) : []);
const blank = (f: ExtensionField): ExtensionConfigPrimitive =>
	f.type === "switch" || f.type === "checkbox"
		? false
		: f.type === "multiselect"
			? []
			: "";
const addRow = () =>
	(model.value = [
		...rows(),
		Object.fromEntries(
			(props.field.fields ?? []).map((f) => [f.name, blank(f)]),
		),
	]);
const removeRow = (i: number) =>
	(model.value = rows().filter((_, j) => j !== i));
const setCell = (i: number, name: string, v: ExtensionConfigValue) =>
	(model.value = rows().map((r, j) =>
		j === i ? { ...r, [name]: v as ExtensionConfigPrimitive } : r,
	));
</script>

<template>
  <!-- content-start: a field shares its row with others, so it must pack to the top — without it the box
       stretches to the tallest field in the row and its label / input drift apart when a neighbour has a hint -->
  <div class="grid content-start gap-2" :class="SPAN[field.grid] ?? SPAN[8]">
    <div class="flex items-center gap-2">
      <Label :for="id">{{ field.label }}</Label>
      <Badge v-if="field.secret && secretSaved" variant="outline" class="border-emerald-300 text-emerald-700 dark:text-emerald-400">{{ t("extensions.saved_badge") }}</Badge>
    </div>
    <!-- one control per field type (the extension guide › fields) -->
    <Switch v-if="field.type === 'switch'" :id="id" :model-value="model === true" :aria-label="field.label" @update:model-value="(v: boolean) => (model = v)" />
    <Checkbox v-else-if="field.type === 'checkbox'" :id="id" :model-value="model === true" :aria-label="field.label" @update:model-value="(v) => (model = v === true)" />
    <Select v-else-if="field.type === 'select'" :model-value="(model as string) || undefined" @update:model-value="(v) => (model = String(v ?? ''))">
      <SelectTrigger :id="id" class="w-full" :aria-label="field.label" :aria-invalid="!!error()"><SelectValue :placeholder="field.placeholder ?? t('extensions.choose')" /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
      </SelectContent>
    </Select>
    <ChipPicker v-else-if="field.type === 'multiselect'" :id="id" :model-value="picked()" :label="field.label" :options="labels()" :placeholder="field.placeholder ?? t('extensions.choose')" :search-placeholder="t('extensions.search')" :hint="t('extensions.nothing_found')" :invalid="!!error()" @update:model-value="pick" />
    <div v-else-if="field.type === 'list'" class="grid gap-3" role="group" :aria-label="field.label">
      <p v-if="!rows().length" class="text-sm text-muted-foreground">{{ t("extensions.none_yet") }}</p>
      <div v-for="(row, i) in rows()" :key="i" class="grid gap-3 rounded-md border p-3 sm:grid-cols-8" role="group" :aria-label="t('extensions.row_aria', { label: field.label, n: i + 1 })">
        <ExtensionFieldInput v-for="s in field.fields" :key="s.name" :field="s" :path="`${path}.${i}.${s.name}`" :errors="errors" :model-value="row[s.name]" @update:model-value="(v) => setCell(i, s.name, v)" />
        <Button type="button" variant="ghost" size="sm" class="col-span-full justify-self-end text-destructive" :aria-label="t('extensions.remove_row_aria', { label: field.label, n: i + 1 })" @click="removeRow(i)"><Trash2 /> {{ t("common.remove") }}</Button>
      </div>
      <Button type="button" variant="outline" size="sm" class="justify-self-start" @click="addRow"><Plus /> {{ field.add_label ?? t("common.add") }}</Button>
    </div>
    <!-- a swatch the owner clicks, not a hex code they have to know; the text box next to it accepts one all the same -->
    <div v-else-if="field.type === 'color'" class="flex items-center gap-2">
      <input :id="id" type="color" :value="(model as string) || '#000000'" :aria-label="field.label" class="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        @input="(e) => (model = (e.target as HTMLInputElement).value)" />
      <Input :model-value="model as string" placeholder="#5b6cff" autocomplete="off" :aria-invalid="!!error()" :aria-label="field.label"
        @update:model-value="(v) => (model = String(v ?? ''))" />
      <Button v-if="model" type="button" variant="ghost" size="sm" @click="model = ''">{{ t("common.clear") }}</Button>
    </div>
    <!-- the same uploader as the product form: pick or drop a file, no link to paste -->
    <ImageUpload v-else-if="field.type === 'image'" :model-value="(model as string) || null" @update:model-value="(v) => (model = v ?? '')" />
    <Input v-else-if="field.type === 'number'" :id="id" v-model="model as string | number" type="number" inputmode="decimal" :min="field.min" :max="field.max" :step="field.step ?? 'any'"
      :placeholder="field.placeholder" autocomplete="off" :aria-invalid="!!error()" />
    <Textarea v-else-if="field.multiline" :id="id" v-model="model as string" rows="4" :placeholder="field.placeholder" :aria-invalid="!!error()" />
    <Input v-else :id="id" v-model="model as string" :type="field.secret ? 'password' : field.type === 'url' ? 'url' : 'text'"
      :placeholder="field.secret && secretSaved ? t('extensions.keep_blank') : field.placeholder"
      autocomplete="off" :aria-invalid="!!error()" />
    <p v-if="field.hint" class="text-sm text-muted-foreground">{{ field.hint }}</p>
    <p v-if="error()" class="text-sm text-destructive">{{ error() }}</p>
  </div>
</template>
