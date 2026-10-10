<script setup lang="ts">
import { t } from "@/lib/i18n";
import { computed, ref } from "vue";
import { Check, ChevronsUpDown } from "@lucide/vue";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

// the exact class list of components/ui/input/Input.vue, so the trigger is indistinguishable from the other fields
const INPUT =
	"dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:ring-3 aria-invalid:ring-3 md:text-sm";

/** Searchable country picker for the checkout page (same Popover + Command combobox as CurrencySelect).
 * The model is the country *name* — what `customer.country` stores and the server validates. `fieldClass`
 * = the template's `input` theme so the trigger looks like the other fields; `menuClass` themes the list.
 * `only` = the names to offer (the countries the shop delivers to); null/undefined = every country. */
const model = defineModel<string>({ default: "" });
const props = defineProps<{
	id?: string;
	invalid?: boolean;
	disabled?: boolean;
	fieldClass?: string;
	menuClass?: string;
	only?: string[] | null;
}>();
const open = ref(false);
const list = computed(() =>
	props.only
		? COUNTRIES.filter((c) => props.only!.includes(c.name))
		: COUNTRIES,
);
const selected = computed(() => COUNTRIES.find((c) => c.name === model.value));
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        :id="id"
        type="button"
        role="combobox"
        :aria-expanded="open"
        :aria-invalid="invalid"
        :disabled="disabled"
        :class="cn(INPUT, 'flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-70', fieldClass)"
      >
        <span v-if="selected" class="truncate">{{ selected.flag }} {{ selected.name }}</span>
        <span v-else class="opacity-60">{{ t("store_ui.choose_country") }}</span>
        <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-(--reka-popover-trigger-width) p-0" :class="menuClass" align="start">
      <Command :class="menuClass">
        <CommandInput :placeholder="t('store_ui.search_country')" />
        <CommandList class="max-h-64">
          <CommandEmpty>{{ t("store_ui.no_country") }}</CommandEmpty>
          <CommandGroup>
            <CommandItem v-for="c in list" :key="c.code" :value="`${c.name} ${c.code}`" @select="model = c.name; open = false">
              <Check class="size-4" :class="c.name === model ? 'opacity-100' : 'opacity-0'" />
              <span class="w-6">{{ c.flag }}</span>
              <span class="truncate">{{ c.name }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
