<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, ChevronsUpDown } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { t } from "@/lib/i18n";

/** Sale-unit picker: predefined list + free-typed custom units (max 20 chars, matches the validator). */
const UNITS = [
	"pcs",
	"box",
	"pack",
	"set",
	"pair",
	"dozen",
	"kg",
	"g",
	"lb",
	"oz",
	"l",
	"ml",
	"m",
	"cm",
	"mm",
	"ft",
	"in",
];

const model = defineModel<string>({ default: "" });
defineProps<{ id?: string; invalid?: boolean }>();
const open = ref(false);
// ponytail: own filter over 17 items — Command's built-in search can't drive the "Use …" row
const query = ref("");
const custom = computed(() => query.value.trim().slice(0, 20));
const matches = computed(() =>
	UNITS.filter((u) => u.includes(custom.value.toLowerCase())),
);
watch(open, () => (query.value = ""));

function pick(u: string) {
	model.value = u;
	open.value = false;
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button :id="id" variant="outline" role="combobox" :aria-expanded="open" :aria-invalid="invalid" class="w-full justify-between font-normal">
        <span v-if="model" class="truncate">{{ model }}</span>
        <span v-else class="text-muted-foreground">{{ t("products.no_unit") }}</span>
        <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-(--reka-popover-trigger-width) p-0" align="start">
      <Command>
        <div class="p-1 pb-0">
          <Input v-model="query" :placeholder="t('products.unit_search')" class="h-8" autocomplete="off" @keydown.enter.prevent="custom && pick(custom)" />
        </div>
        <CommandList class="max-h-64">
          <CommandGroup>
            <CommandItem v-if="model && !custom" value="no unit" @select="pick('')">
              <Check class="size-4 opacity-0" />
              <span class="text-muted-foreground">{{ t("products.no_unit") }}</span>
            </CommandItem>
            <CommandItem v-for="u in matches" :key="u" :value="u" @select="pick(u)">
              <Check class="size-4" :class="u === model ? 'opacity-100' : 'opacity-0'" />
              {{ u }}
            </CommandItem>
            <CommandItem v-if="custom && !UNITS.includes(custom)" :value="custom" @select="pick(custom)">
              <Check class="size-4" :class="custom === model ? 'opacity-100' : 'opacity-0'" />
              {{ t("products.use_custom", { value: custom }) }}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
