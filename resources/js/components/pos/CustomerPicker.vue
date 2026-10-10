<script setup lang="ts">
import { ref, watch } from "vue";
import { watchDebounced } from "@vueuse/core";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderCircle, Phone, Search, UserPlus, UserRound } from "@lucide/vue";
import { t } from "@/lib/i18n";
import type { Customer } from "@/types";

/**
 * Attach a customer to the sale: search by name/phone (GET /customers/search) or add one on the spot
 * (POST /customers with Accept: application/json). Emits the chosen customer.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
	(e: "update:open", v: boolean): void;
	(e: "select", c: Customer): void;
}>();

const q = ref("");
const results = ref<Customer[]>([]);
const searching = ref(false);
const creating = ref(false);
const form = ref({ name: "", phone: "" });
const errors = ref<Record<string, string>>({});
const saving = ref(false);

async function search() {
	searching.value = true;
	try {
		const res = await fetch(
			`/customers/search?q=${encodeURIComponent(q.value.trim())}`,
			{ credentials: "same-origin", headers: { Accept: "application/json" } },
		);
		results.value = res.ok ? (await res.json()).customers : [];
	} catch {
		results.value = [];
	} finally {
		searching.value = false;
	}
}
watchDebounced(q, search, { debounce: 200 });
watch(
	() => props.open,
	(o) => {
		if (o) {
			q.value = "";
			creating.value = false;
			errors.value = {};
			form.value = { name: "", phone: "" };
			search();
		}
	},
);

function startCreate() {
	creating.value = true;
	// a typed phone number / name seeds the form
	if (/^[\d\s+\-()]+$/.test(q.value.trim()) && q.value.trim())
		form.value = { name: "", phone: q.value.trim() };
	else form.value = { name: q.value.trim(), phone: "" };
}
async function create() {
	saving.value = true;
	errors.value = {};
	try {
		const res = await fetch("/customers", {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				name: form.value.name,
				phone: form.value.phone || null,
			}),
		});
		const data = await res.json();
		if (res.status === 201) {
			toast.success(t("pos.customer_added", { name: data.customer.name }));
			pick(data.customer);
		} else errors.value = data.errors ?? { name: t("pos.could_not_save") };
	} catch {
		errors.value = { name: t("pos.server_unreachable_short") };
	} finally {
		saving.value = false;
	}
}
function pick(c: Customer) {
	emit("select", c);
	emit("update:open", false);
}
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="gap-0 p-0 sm:max-w-md">
      <DialogHeader class="border-b p-4">
        <DialogTitle>{{ t("pos.customer_picker_title") }}</DialogTitle>
        <DialogDescription>{{ t("pos.customer_picker_desc") }}</DialogDescription>
      </DialogHeader>

      <!-- Add new -->
      <form v-if="creating" class="space-y-3 p-4" @submit.prevent="create">
        <div class="space-y-1.5">
          <Label for="cust-name">{{ t("common.name") }}</Label>
          <Input id="cust-name" v-model="form.name" autofocus :placeholder="t('pos.name_placeholder')" :aria-invalid="!!errors.name" />
          <p v-if="errors.name" class="text-sm text-destructive">{{ errors.name }}</p>
        </div>
        <div class="space-y-1.5">
          <Label for="cust-phone">{{ t("common.phone") }} <span class="font-normal text-muted-foreground">{{ t("pos.optional") }}</span></Label>
          <Input id="cust-phone" v-model="form.phone" inputmode="tel" placeholder="09…" :aria-invalid="!!errors.phone" />
          <p v-if="errors.phone" class="text-sm text-destructive">{{ errors.phone }}</p>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" @click="creating = false">{{ t("common.back") }}</Button>
          <Button type="submit" :disabled="saving || !form.name.trim()"><LoaderCircle v-if="saving" class="animate-spin" /> {{ t("pos.add_and_attach") }}</Button>
        </div>
      </form>

      <!-- Search -->
      <template v-else>
        <div class="p-4 pb-2">
          <!-- the icon is centred on the box itself, not on the padded row around it -->
          <div class="relative">
            <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="q" autofocus :placeholder="t('pos.search_customer')" class="h-10 pl-9" />
          </div>
        </div>
        <ul class="max-h-72 overflow-y-auto px-2 pb-2">
          <li v-for="c in results" :key="c.id">
            <button type="button" class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" @click="pick(c)">
              <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><UserRound class="size-4 text-muted-foreground" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ c.name }}</span>
                <span v-if="c.phone" class="flex items-center gap-1 text-xs text-muted-foreground"><Phone class="size-3" /> {{ c.phone }}</span>
              </span>
            </button>
          </li>
          <li v-if="!results.length && !searching" class="px-3 py-6 text-center text-sm text-muted-foreground">{{ q ? t("pos.no_customer_matches") : t("pos.no_customers") }}</li>
          <li v-else-if="searching && !results.length" class="flex justify-center py-6"><LoaderCircle class="size-4 animate-spin text-muted-foreground" /></li>
        </ul>
        <div class="border-t p-3">
          <Button variant="outline" class="w-full" @click="startCreate"><UserPlus /> {{ q.trim() ? t("pos.new_customer_named", { q: q.trim() }) : t("pos.new_customer") }}</Button>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>
