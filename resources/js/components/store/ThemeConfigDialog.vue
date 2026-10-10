<script setup lang="ts">
import { watch } from "vue";
import { useForm } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { LoaderCircle } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { t } from "@/lib/i18n";
import type { Key } from "@i18n";
import type { ThemeColors, ThemeLook } from "@/types";

/**
 * The shop's own look for one built-in store template:
 * its brand colours, the background and text of the page, the cards and
 * the footer, and a font. The options scroll; the buttons stay in view.
 * An empty value keeps the template's own.
 */
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{
	/** The template being changed. */
	template: { key: string; label: string };
	/** Its saved look, when it has one. */
	look?: ThemeLook;
	/** The template's own colours: what a box shows while it is empty. */
	own?: ThemeColors;
	/** The fonts to pick from (STORE_FONTS). */
	fonts: { key: string; label: string }[];
}>();

type ColorField =
	| "primary"
	| "secondary"
	| "background"
	| "text"
	| "muted"
	| "surface"
	| "surface_text"
	| "footer"
	| "footer_text";

/** The dialog's sections: a title and its colour boxes (field, label, hint). */
const SECTIONS: {
	title: Key;
	colors: { field: ColorField; label: Key; hint: Key }[];
}[] = [
	{
		title: "online_store.theme_section_brand",
		colors: [
			{
				field: "primary",
				label: "online_store.theme_primary",
				hint: "online_store.theme_primary_hint",
			},
			{
				field: "secondary",
				label: "online_store.theme_secondary",
				hint: "online_store.theme_secondary_hint",
			},
		],
	},
	{
		title: "online_store.theme_section_page",
		colors: [
			{
				field: "background",
				label: "online_store.theme_background",
				hint: "online_store.theme_background_hint",
			},
			{
				field: "text",
				label: "online_store.theme_text",
				hint: "online_store.theme_text_hint",
			},
			{
				field: "muted",
				label: "online_store.theme_muted",
				hint: "online_store.theme_muted_hint",
			},
		],
	},
	{
		title: "online_store.theme_section_cards",
		colors: [
			{
				field: "surface",
				label: "online_store.theme_surface",
				hint: "online_store.theme_surface_hint",
			},
			{
				field: "surface_text",
				label: "online_store.theme_surface_text",
				hint: "online_store.theme_surface_text_hint",
			},
		],
	},
	{
		title: "online_store.theme_section_footer",
		colors: [
			{
				field: "footer",
				label: "online_store.theme_footer",
				hint: "online_store.theme_footer_hint",
			},
			{
				field: "footer_text",
				label: "online_store.theme_footer_text",
				hint: "online_store.theme_footer_text_hint",
			},
		],
	},
];

/** Every colour field, for the loops that fill and empty the form. */
const FIELDS = SECTIONS.flatMap((section) =>
	section.colors.map((color) => color.field),
);

const form = useForm({
	template: "",
	primary: "",
	secondary: "",
	background: "",
	text: "",
	muted: "",
	surface: "",
	surface_text: "",
	footer: "",
	footer_text: "",
	font: "",
});

// the dialog is created already open the first time, so start right away too
watch(open, start, { immediate: true });

/**
 * Start from the saved look each time the dialog opens.
 * @param isOpen The dialog's new state.
 */
function start(isOpen: boolean) {
	if (!isOpen) return;
	form.clearErrors();
	form.template = props.template.key;
	for (const field of FIELDS) form[field] = props.look?.[field] ?? "";
	form.font = props.look?.font ?? "";
}

/**
 * Take a font from the list.
 * The list can't hold an empty value, so "own" stands for the template's own.
 * @param value The picked item.
 */
function pickFont(value: unknown) {
	form.font = value === "own" ? "" : String(value ?? "");
}

/**
 * Take a colour from the colour box.
 * @param field Which colour.
 * @param event The box's input event.
 */
function pick(field: ColorField, event: Event) {
	form[field] = (event.target as HTMLInputElement).value;
}

/**
 * Empty every value: the template's own look again (saved by Save).
 */
function reset() {
	for (const field of FIELDS) form[field] = "";
	form.font = "";
}

/**
 * Close the dialog and say it is saved.
 */
function saved() {
	open.value = false;
	toast.success(t("online_store.theme_saved"));
}

/**
 * Save the look; the page reloads with it.
 */
function save() {
	form.put("/online-store/theme", { preserveScroll: true, onSuccess: saved });
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[90vh] flex-col sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ t("online_store.theme_title", { name: template.label }) }}</DialogTitle>
        <DialogDescription>{{ t("online_store.theme_help") }}</DialogDescription>
      </DialogHeader>
      <form class="flex min-h-0 flex-col gap-4" @submit.prevent="save">
        <div class="-mx-1 grid min-h-0 gap-5 overflow-y-auto px-1 pt-1 pb-1">
        <fieldset v-for="section in SECTIONS" :key="section.title" class="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <legend class="float-left text-sm font-semibold sm:col-span-2">{{ t(section.title) }}</legend>
          <div v-for="{ field, label, hint } in section.colors" :key="field" class="grid content-start gap-1.5">
            <Label :for="`theme-${field}`">{{ t(label) }}</Label>
            <div class="flex items-center gap-2">
              <input :id="`theme-${field}`" type="color" :value="form[field] || own?.[field] || '#000000'" class="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5" @input="pick(field, $event)">
              <span class="text-sm" :class="form[field] ? 'font-mono' : 'text-muted-foreground'">{{ form[field] || t("online_store.theme_own") }}</span>
              <Button v-if="form[field]" type="button" variant="ghost" size="sm" class="ml-auto" :aria-label="`${t('online_store.theme_clear')}: ${t(label)}`" @click="form[field] = ''">{{ t("online_store.theme_clear") }}</Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ t(hint) }}</p>
            <p v-if="form.errors[field]" class="text-sm text-destructive">{{ form.errors[field] }}</p>
          </div>
        </fieldset>
        <div class="grid gap-3 border-t pt-4">
          <Label for="theme-font" class="font-semibold">{{ t("online_store.theme_font") }}</Label>
          <Select :model-value="form.font || 'own'" @update:model-value="pickFont">
            <SelectTrigger id="theme-font" class="w-full" :aria-label="t('online_store.theme_font')"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="own">{{ t("online_store.theme_own") }}</SelectItem>
              <SelectItem v-for="font in fonts" :key="font.key" :value="font.key">{{ font.label }}</SelectItem>
            </SelectContent>
          </Select>
          <p v-if="form.errors.font" class="text-sm text-destructive">{{ form.errors.font }}</p>
        </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" class="sm:mr-auto" @click="reset">{{ t("online_store.theme_reset") }}</Button>
          <Button type="button" variant="outline" @click="open = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" :disabled="form.processing">
            <LoaderCircle v-if="form.processing" class="size-4 animate-spin" />
            {{ t("common.save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
