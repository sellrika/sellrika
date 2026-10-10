<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, ChevronsUpDown } from "@lucide/vue";
import { Button } from "@/components/ui/button";
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
import { currencySymbol } from "@/lib/format";
import { locale, t } from "@/lib/i18n";

const model = defineModel<string>({ default: "USD" });
defineProps<{ id?: string; invalid?: boolean }>();
const open = ref(false);

// Native ISO-4217 list + names in the page's language — no dependency needed.
const currencies = computed(function list() {
	const names = new Intl.DisplayNames([locale()], { type: "currency" });
	return (Intl.supportedValuesOf("currency") as string[]).map(
		function row(code) {
			return {
				code,
				name: names.of(code) ?? code,
				symbol: currencySymbol(code),
			};
		},
	);
});
const selected = computed(() =>
	currencies.value.find((c) => c.code === model.value),
);
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button :id="id" variant="outline" role="combobox" :aria-expanded="open" :aria-invalid="invalid" class="w-full min-w-0 justify-between font-normal">
        <span v-if="selected" class="truncate"><span class="font-medium">{{ selected.code }}</span> · {{ selected.name }}</span>
        <span v-else class="text-muted-foreground">{{ t("shared.select_currency") }}</span>
        <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-(--reka-popover-trigger-width) p-0" align="start">
      <Command>
        <CommandInput :placeholder="t('shared.search_currency')" />
        <CommandList class="max-h-64">
          <CommandEmpty>{{ t("shared.no_currency") }}</CommandEmpty>
          <CommandGroup>
            <CommandItem v-for="c in currencies" :key="c.code" :value="`${c.code} ${c.name}`" @select="model = c.code; open = false">
              <Check class="size-4" :class="c.code === model ? 'opacity-100' : 'opacity-0'" />
              <span class="w-12 font-medium">{{ c.code }}</span>
              <span class="truncate text-muted-foreground">{{ c.name }}</span>
              <span class="ml-auto pl-2 text-muted-foreground">{{ c.symbol }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
