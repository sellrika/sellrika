<script setup lang="ts">
import { computed, watch } from "vue";
import { router, useForm } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { ExternalLink, LoaderCircle } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import ExtensionConfigForm from "@/components/extensions/ExtensionConfigForm.vue";
import ExtensionFieldInput from "@/components/extensions/ExtensionFieldInput.vue";
import { t } from "@/lib/i18n";
import type { ExtensionConfigValue, ExtensionRow } from "@/types";

/**
 * The Configure dialog of one extension in the active shop: its settings and the shop's switch.
 * Used on /extensions and on /online-store › Payments.
 * Secret fields arrive blank; blank on save = keep the stored one.
 */
const props = defineProps<{ extensions: ExtensionRow[] }>();
/** The key of the extension whose dialog is open (null = closed). */
const open = defineModel<string | null>("open", { required: true });

const current = computed(
	() => props.extensions.find((e) => e.key === open.value) ?? null,
);
const form = useForm({
	enabled: true,
	config: {} as Record<string, ExtensionConfigValue>,
});
let wantOn = false; // the row's switch was flipped on but the extension needs its settings first: the dialog opens with Enabled on
watch(current, fill);

/**
 * Loads the extension's stored values into the form when its dialog opens.
 * @param e The extension now open, or null.
 */
function fill(e: ExtensionRow | null) {
	if (!e) return;
	form.clearErrors();
	form.enabled = wantOn || (e.installed ? e.enabled : true);
	form.config = { ...e.config };
	wantOn = false;
}

/**
 * What an extension's own settings form gets (slot `extension.config`,
 * `SlotContexts` in extensions/types.ts). It reads and fills the same form
 * the dialog saves, so Save and Cancel stay the dialog's own.
 */
const errorListeners = new Set<() => void>();
const configSlot = {
	values: () => ({ ...form.config }),
	set(patch: Record<string, ExtensionConfigValue>) {
		// only the settings the manifest names
		for (const f of current.value?.fields ?? [])
			if (f.name in patch) form.config[f.name] = patch[f.name]!;
	},
	enabled: () => form.enabled,
	setEnabled(on: boolean) {
		form.enabled = !!on;
	},
	errors: fieldErrors,
	onErrors(fn: () => void) {
		errorListeners.add(fn);
		return () => errorListeners.delete(fn);
	},
};
/**
 * The errors of the last save, by setting name.
 * @returns `{ name: message }`, empty when the save was good.
 */
function fieldErrors() {
	const out: Record<string, string> = {};
	for (const [key, message] of Object.entries(form.errors))
		if (key.startsWith("config.") && message)
			out[key.slice("config.".length)] = message;
	return out;
}
watch(
	() => form.errors,
	function tellForm() {
		for (const fn of errorListeners) fn();
	},
	{ deep: true },
);

/**
 * Saves the settings; the first save installs the extension in this shop.
 */
function save() {
	form.put(`/extensions/${current.value?.key}`, {
		preserveScroll: true,
		preserveState: true,
		onSuccess: closeDialog,
	});
}

/**
 * Closes the dialog after a good save.
 */
function closeDialog() {
	toast.success(t("extensions.saved_toast"));
	open.value = null;
}

/**
 * The row's switch. Switching on an extension that still misses required settings opens the dialog instead.
 * @param e The extension on that row.
 * @param on The new switch value.
 */
function toggle(e: ExtensionRow, on: boolean) {
	if (on && !e.ready) {
		wantOn = true;
		open.value = e.key;
		return;
	}
	router.put(
		`/extensions/${e.key}`,
		{ enabled: on },
		{
			preserveScroll: true,
			preserveState: true,
			onSuccess: () =>
				toast.success(
					t(on ? "extensions.enabled_toast" : "extensions.disabled_toast", {
						name: e.name,
					}),
				),
		},
	);
}

defineExpose({ toggle });
</script>

<template>
  <Dialog :open="!!current" @update:open="(o: boolean) => !o && (open = null)">
    <DialogContent v-if="current" :class="current.config_script ? 'sm:max-w-5xl' : 'sm:max-w-lg'">
      <!-- its own form: the logo joins the title, like a small page heading -->
      <DialogHeader :class="current.config_script && 'grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1'">
        <img v-if="current.config_script && current.icon" :src="current.icon" alt="" class="row-span-2 size-11 rounded-lg bg-muted object-contain p-2" />
        <DialogTitle>{{ current.name }} <span class="text-sm font-normal text-muted-foreground">v{{ current.version }}</span></DialogTitle>
        <DialogDescription>
          {{ current.description }}
          <template v-if="current.help_url">
            <a :href="current.help_url" target="_blank" rel="noopener" class="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:opacity-80">{{ t("extensions.read_more") }} <ExternalLink class="size-3" /></a>
          </template>
        </DialogDescription>
      </DialogHeader>
      <!-- novalidate: the server checks the URL and the test expects its message, not the browser bubble -->
      <!-- 8 columns: each field takes its manifest `grid` (default all 8), so two `4`s share a row -->
      <form class="grid gap-4 sm:grid-cols-8" novalidate @submit.prevent="save">
        <p v-if="form.errors.key" class="col-span-full text-sm text-destructive">{{ form.errors.key }}</p>
        <!-- the extension draws its settings and the switch itself; full bleed, between the header and the footer -->
        <ExtensionConfigForm v-if="current.config_script" :key="current.key" class="col-span-full -mx-4 -mb-4 border-t" :ext-key="current.key" :script="current.config_script" :strings="current.strings" :context="configSlot" />
        <template v-else>
        <p v-if="!current.fields.length" class="col-span-full text-sm text-muted-foreground">{{ t("extensions.nothing_to_set_up") }}</p>
        <ExtensionFieldInput v-for="f in current.fields" :key="f.name" v-model="form.config[f.name]" :field="f" :path="f.name" :errors="form.errors" :secret-saved="current.secret_set[f.name]" />
        </template>
        <div v-if="!current.config_script" class="col-span-full flex items-center justify-between gap-4">
          <Label :for="`${current.key}-enabled`">{{ t("extensions.enabled") }}</Label>
          <Switch :id="`${current.key}-enabled`" v-model="form.enabled" :aria-label="t('extensions.enabled_aria', { name: current.name })" />
        </div>
        <DialogFooter class="col-span-full">
          <Button type="button" variant="outline" @click="open = null">{{ t("common.cancel") }}</Button>
          <Button type="submit" :disabled="form.processing"><LoaderCircle v-if="form.processing" class="animate-spin" /> {{ t("common.save") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
