<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { router, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { useSortable } from "@vueuse/integrations/useSortable";
import {
	GripVertical,
	LoaderCircle,
	Plus,
	RotateCcw,
	Trash2,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import ColorPicker from "@/components/ColorPicker.vue";
import { t } from "@/lib/i18n";
import { defaultSteps, FULFILLMENT_NEW_COLOR } from "@constants/Order.Constant";
import { FULFILLMENT, LOCKED_STEPS, stepColor, stepLabel } from "@/lib/orders";
import type { FulfillmentStep, SharedProps } from "@/types";

/**
 * Edit the shop's delivery steps: rename, reorder (drag and drop), colour, add and remove.
 * New, Shipped and Delivered stay in the list; their place is free.
 */
const open = defineModel<boolean>("open", { required: true });

/** The most steps one shop may have (FULFILLMENT_STEPS_MAX on the server). */
const MAX = 12;

const page = usePage<SharedProps>();
const rows = ref<FulfillmentStep[]>([]);
const error = ref("");
const saving = ref(false);

watch(open, reset);

/**
 * Start from the shop's saved steps each time the dialog opens.
 * @param isOpen The dialog's new state.
 */
function reset(isOpen: boolean) {
	if (!isOpen) return;
	rows.value = (page.props.shop?.fulfillment_steps ?? []).map(copy);
	error.value = "";
}

/**
 * A copy of one step, so typing does not change the page before saving.
 * @param s The step.
 * @returns The copy.
 */
function copy(s: FulfillmentStep) {
	return { ...s, color: stepColor(s.key, [s]) };
}

// Reorder: drag a row by its grip (SortableJS, animated, mouse and touch), or focus the grip and press ↑ / ↓.
const list = ref<HTMLOListElement>();
useSortable(list, rows, {
	handle: "[data-grip]",
	animation: 150,
	ghostClass: "opacity-40",
	watchElement: true, // the list only exists while the dialog is open
});

/**
 * Move a step to another place.
 * @param from Its place now.
 * @param to Its new place.
 */
function moveTo(from: number, to: number) {
	const [step] = rows.value.splice(from, 1);
	rows.value.splice(to, 0, step);
}

/**
 * Move a row one place with the arrow keys; its grip keeps the focus.
 * @param i The row's place.
 * @param by -1 = up, 1 = down.
 */
async function nudge(i: number, by: number) {
	const to = i + by;
	if (to < 0 || to >= rows.value.length) return;
	const key = rows.value[i].key;
	moveTo(i, to);
	await nextTick();
	list.value?.querySelector<HTMLElement>(`[data-grip="${key}"]`)?.focus();
}

/**
 * Add an empty step at the end. Its key is random and never changes, so a rename keeps its orders.
 */
function add() {
	rows.value.push({
		key: crypto.randomUUID().slice(0, 8),
		label: "",
		color: FULFILLMENT_NEW_COLOR,
	});
}

/** The built-in list, in its order, with the built-in names and colours. */
const DEFAULTS = defaultSteps();

/** Is the list already the built-in one? */
const isDefault = computed(
	() =>
		rows.value.length === DEFAULTS.length &&
		rows.value.every(
			(s, i) =>
				s.key === DEFAULTS[i].key &&
				!s.label.trim() &&
				s.color === DEFAULTS[i].color,
		),
);

/**
 * Put the built-in list back (saved only on Save).
 */
function resetDefaults() {
	rows.value = defaultSteps();
	error.value = "";
}

/**
 * Take a step out of the list.
 * @param i The step's place.
 */
function remove(i: number) {
	rows.value.splice(i, 1);
}

/**
 * The name shown in a step's buttons.
 * @param s The step.
 * @returns Its typed name, else the built-in one.
 */
function nameOf(s: FulfillmentStep) {
	return s.label.trim() || stepLabel(s.key);
}

/**
 * Save the list; the order list reloads with the new steps.
 */
async function save() {
	saving.value = true;
	error.value = "";
	try {
		const res = await fetch("/orders/steps", {
			method: "PUT",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({ steps: rows.value }),
		});
		const data = await res.json();
		if (res.ok) {
			open.value = false;
			toast.success(t("orders.steps_saved"));
			router.reload();
		} else
			error.value =
				Object.values(data.errors ?? {})[0]?.toString() ??
				t("orders.steps_failed");
	} catch {
		error.value = t("orders.steps_failed");
	} finally {
		saving.value = false;
	}
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("orders.steps_title") }}</DialogTitle>
        <DialogDescription>{{ t("orders.steps_body") }}</DialogDescription>
      </DialogHeader>
      <!-- pt-1: the pinned dialog header would cover the first input's focus ring -->
      <form class="space-y-3 pt-1" @submit.prevent="save">
        <ol ref="list" class="space-y-2">
          <li v-for="(s, i) in rows" :key="s.key" class="flex items-center gap-2 rounded-lg bg-popover">
            <button
              type="button"
              :data-grip="s.key"
              class="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
              :aria-label="t('orders.steps_reorder', { name: nameOf(s) })"
              :title="t('orders.steps_reorder', { name: nameOf(s) })"
              @keydown.up.prevent="nudge(i, -1)"
              @keydown.down.prevent="nudge(i, 1)"
            >
              <GripVertical class="size-4" />
            </button>
            <span class="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{{ i + 1 }}</span>
            <Input
              v-model="s.label"
              maxlength="40"
              :placeholder="FULFILLMENT[s.key] ? t(FULFILLMENT[s.key].label) : t('orders.steps_name')"
              :aria-label="t('orders.steps_name')"
            />
            <ColorPicker v-model="s.color" size="icon" compact :aria-label="t('orders.steps_color', { name: nameOf(s) })" />
            <Button type="button" variant="ghost" size="icon" :class="LOCKED_STEPS.includes(s.key) && 'invisible'" :disabled="LOCKED_STEPS.includes(s.key)" :aria-label="t('orders.steps_remove', { name: nameOf(s) })" @click="remove(i)"><Trash2 /></Button>
          </li>
        </ol>
        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" :disabled="rows.length >= MAX" @click="add"><Plus /> {{ t("orders.steps_add") }}</Button>
          <Button type="button" variant="ghost" size="sm" :disabled="isDefault" @click="resetDefaults"><RotateCcw /> {{ t("orders.steps_reset") }}</Button>
        </div>
        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" :disabled="saving"><LoaderCircle v-if="saving" class="animate-spin" /> {{ t("common.save") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
