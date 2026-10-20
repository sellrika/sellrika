<script setup lang="ts">
import { computed, ref } from "vue";
import { Head, router, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Monitor, Plus, Pencil, Puzzle, Trash2 } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import ColorPicker from "@/components/ColorPicker.vue";
import IconPicker from "@/components/IconPicker.vue";
import PaymentImage from "@/components/PaymentImage.vue";
import { Card } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import WithTooltip from "@/components/WithTooltip.vue";
import { methodStyle, paymentIcon } from "@/lib/paymentIcons";
import { t } from "@/lib/i18n";
import type { PaymentMethod, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });
defineProps<{ methods: PaymentMethod[] }>();

// From the Pencil designs "Payments · List" and "Payments · Edit dialog".
const page = usePage<SharedProps>();

/** What the add and edit dialog starts from. */
const BLANK = {
	name: "",
	icon: "Wallet",
	color: null as string | null,
	image: null as string | null,
	tendered: false,
	enabled: true,
};
const form = useForm({ ...BLANK });
const open = ref(false);
/** The method the dialog edits, null while it adds one. */
const editing = ref<PaymentMethod | null>(null);
/** The badge in the dialog's title: how the method will look. */
const preview = computed(() => form.name.trim() || t("payment_methods.title"));

/**
 * Open the dialog for a new method.
 */
function startAdd() {
	editing.value = null;
	form.defaults({ ...BLANK });
	form.reset();
	form.clearErrors();
	open.value = true;
}

/**
 * Open the dialog for a method of the list.
 * @param m The method.
 */
function startEdit(m: PaymentMethod) {
	editing.value = m;
	form.defaults({
		name: m.name,
		icon: m.icon,
		color: m.color,
		image: m.image,
		tendered: m.tendered,
		enabled: m.enabled,
	});
	form.reset();
	form.clearErrors();
	open.value = true;
}

/**
 * The dialog saved: close it and say so.
 */
function saved() {
	open.value = false;
	toast.success(
		t(editing.value ? "payment_methods.updated" : "payment_methods.added"),
	);
}

/**
 * Send the dialog: a new method, or the edited one.
 */
function submit() {
	if (!form.name.trim()) return;
	const options = { preserveScroll: true, onSuccess: saved };
	if (editing.value) form.put(`/payment-methods/${editing.value.id}`, options);
	else form.post("/payment-methods", options);
}

/**
 * The switch said so.
 * @param m The method.
 * @param enabled Its new state.
 */
function toggled(m: PaymentMethod, enabled: boolean) {
	toast.success(
		t(
			enabled
				? "payment_methods.enabled_toast"
				: "payment_methods.disabled_toast",
			{ name: m.name },
		),
	);
}

/**
 * Enable or disable straight from the list (disabled = hidden from checkout, kept on past orders).
 * The update takes the whole record, so the other fields go along unchanged.
 * @param m The method.
 * @param enabled Its new state.
 */
function toggle(m: PaymentMethod, enabled: boolean) {
	router.put(
		`/payment-methods/${m.id}`,
		{
			name: m.name,
			icon: m.icon,
			color: m.color,
			image: m.image,
			tendered: m.tendered,
			enabled,
		},
		{
			preserveScroll: true,
			onSuccess: function done() {
				toggled(m, enabled);
			},
		},
	);
}

/**
 * Delete a method.
 * @param m The method.
 */
function remove(m: PaymentMethod) {
	router.delete(`/payment-methods/${m.id}`, {
		onSuccess: function done() {
			toast.success(t("payment_methods.deleted", { name: m.name }));
		},
	});
}

/**
 * The tinted square behind a method's icon.
 * @param color The method's colour, or null.
 * @returns Inline styles, or nothing for the default look.
 */
function chipStyle(color: string | null) {
	return color ? { color, backgroundColor: `${color}26` } : undefined;
}
</script>

<template>
  <Head :title="t('payment_methods.title')" />

  <div class="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1 space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("payment_methods.title") }}</h1>
        <p class="max-w-2xl text-sm text-muted-foreground">{{ t("payment_methods.subtitle", { shop: page.props.shop?.name ?? t("payment_methods.your_shop") }) }}</p>
      </div>
      <Button @click="startAdd"><Plus /> {{ t("payment_methods.add") }}</Button>
    </header>

    <p v-if="page.props.errors.delete" class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ page.props.errors.delete }}</p>

    <Card class="py-0">
      <Table>
        <TableHeader class="sr-only">
          <TableRow>
            <TableHead>{{ t("payment_methods.method") }}</TableHead>
            <TableHead>{{ t("payment_methods.image") }}</TableHead>
            <TableHead>{{ t("payment_methods.enabled") }}</TableHead>
            <TableHead>{{ t("common.actions") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="m in methods" :key="m.id">
            <TableCell class="py-4 pl-5">
              <div class="flex items-center gap-4" :class="!m.enabled && 'opacity-55'">
                <span class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" :style="chipStyle(m.color)">
                  <component :is="paymentIcon(m.icon)" class="size-5" />
                </span>
                <div class="min-w-0">
                  <p class="truncate text-base font-semibold">{{ m.name }}</p>
                  <p class="text-sm font-normal whitespace-normal text-muted-foreground">{{ m.tendered ? t("payment_methods.row_tendered") : t("payment_methods.row_exact") }}</p>
                </div>
              </div>
            </TableCell>
            <TableCell class="hidden sm:table-cell">
              <span v-if="m.extension" class="mr-2 inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-sm text-muted-foreground" data-method-extension><Puzzle class="size-4" /> {{ t("payment_methods.by_extension") }}</span>
              <span v-if="m.image" class="inline-flex items-center gap-2 rounded-lg bg-muted py-1 pr-2.5 pl-1 text-sm text-muted-foreground" data-method-image>
                <img :src="m.image" alt="" class="size-7 rounded-md bg-white object-contain" />
                {{ t("payment_methods.on_display") }}
              </span>
            </TableCell>
            <TableCell class="w-16"><Switch :model-value="m.enabled" :aria-label="t('payment_methods.enabled_aria', { name: m.name })" @update:model-value="(v: boolean) => toggle(m, v)" /></TableCell>
            <TableCell class="w-24 pr-4 text-right">
              <div class="flex justify-end gap-1">
                <WithTooltip :label="t('payment_methods.edit_aria', { name: m.name })"><Button size="icon-sm" variant="ghost" :aria-label="t('payment_methods.edit_aria', { name: m.name })" @click="startEdit(m)"><Pencil /></Button></WithTooltip>
                <AlertDialog>
                  <WithTooltip :label="t('payment_methods.delete_aria', { name: m.name })">
                    <AlertDialogTrigger as-child>
                      <Button size="icon-sm" variant="ghost" :aria-label="t('payment_methods.delete_aria', { name: m.name })"><Trash2 class="text-destructive" /></Button>
                    </AlertDialogTrigger>
                  </WithTooltip>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{{ t("payment_methods.delete_title", { name: m.name }) }}</AlertDialogTitle>
                      <AlertDialogDescription>{{ t("payment_methods.delete_desc") }}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" @click="remove(m)">{{ t("common.delete") }}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <p class="flex items-center gap-2 text-sm text-muted-foreground"><Monitor class="size-4 shrink-0" /> {{ t("payment_methods.display_note") }}</p>
  </div>

  <!-- Add / edit -->
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex flex-wrap items-center gap-3 pr-8">
          {{ t(editing ? "payment_methods.edit_title" : "payment_methods.add") }}
          <Badge variant="outline" class="gap-1.5 px-2.5 py-1 text-sm" :style="methodStyle(form.color)" data-preview>
            <component :is="paymentIcon(form.icon)" class="size-4" /> {{ preview }}
          </Badge>
        </DialogTitle>
        <DialogDescription class="sr-only">{{ t("payment_methods.title") }}</DialogDescription>
      </DialogHeader>
      <!-- the footer sits inside the form, so the dialog pins it to the bottom edge -->
      <form class="grid gap-5" @submit.prevent="submit">
        <div class="grid gap-5">
          <div class="grid gap-2">
            <Label for="method-name">{{ t("common.name") }}</Label>
            <Input id="method-name" v-model="form.name" autofocus :placeholder="t('payment_methods.new_placeholder')" :aria-invalid="!!form.errors.name" />
            <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
          </div>

          <div class="flex flex-wrap gap-5">
            <div class="grid gap-2">
              <Label>{{ t("shared.icon") }}</Label>
              <IconPicker v-model="form.icon" />
              <p v-if="form.errors.icon" class="text-sm text-destructive">{{ form.errors.icon }}</p>
            </div>
            <div class="grid gap-2">
              <Label>{{ t("payment_methods.color") }}</Label>
              <ColorPicker v-model="form.color" :aria-label="t('payment_methods.color')" />
            </div>
          </div>

          <div class="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div class="grid gap-1">
              <Label for="method-tendered">{{ t("payment_methods.ask_tendered") }}</Label>
              <p class="text-sm text-muted-foreground">{{ t("payment_methods.ask_tendered_hint") }}</p>
            </div>
            <Switch id="method-tendered" v-model="form.tendered" />
          </div>

          <div class="grid gap-2">
            <Label>{{ t("payment_methods.image") }}</Label>
            <PaymentImage v-model="form.image" />
            <p v-if="form.errors.image" class="text-sm text-destructive">{{ form.errors.image }}</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" :disabled="form.processing || !form.name.trim()">{{ t(editing ? "common.save" : "common.add") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
