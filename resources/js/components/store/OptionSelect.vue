<script setup lang="ts">
import { t } from "@/lib/i18n";
import { ref } from "vue";
import { Check, ChevronsUpDown, Search } from "@lucide/vue";
import { ListboxFilter } from "reka-ui";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// the exact class list of components/ui/input/Input.vue, so the trigger is indistinguishable from the other fields
const INPUT =
	"dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:ring-3 aria-invalid:ring-3 md:text-sm";

/** Searchable pick-one list over plain strings — the checkout's guided address (State, then City), the same
 * Popover + Command combobox as CountrySelect. `fieldClass` / `menuClass` = the template's themes.
 * `remote` = the parent searches (a state can hold hundreds of cities): `options` are the first page or the matches of
 * what was typed, sent up as `search` (debounced) instead of being filtered here; `more` says there are others. */
const model = defineModel<string>({ default: "" });
defineProps<{
	id?: string;
	options: string[];
	placeholder?: string;
	searchPlaceholder?: string;
	empty?: string;
	invalid?: boolean;
	disabled?: boolean;
	fieldClass?: string;
	menuClass?: string;
	remote?: boolean;
	more?: boolean;
}>();
const emit = defineEmits<{ search: [q: string] }>();
const open = ref(false);
const q = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
// remote mode uses reka's own filter input, not CommandInput: the Command wrapper would filter the rows by the text it
// knows and hide matches that arrive from the server; with its search left empty every rendered row is shown
function search(term: string) {
	q.value = term;
	clearTimeout(timer);
	timer = setTimeout(() => emit("search", term.trim()), 150);
}
function toggle(o: boolean) {
	open.value = o;
	if (o && q.value) search(""); // reopening starts from the first page again
}
</script>

<template>
  <Popover :open="open" @update:open="toggle">
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
        <span v-if="model" class="truncate">{{ model }}</span>
        <span v-else class="opacity-60">{{ placeholder ?? t("store_ui.choose") }}</span>
        <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-(--reka-popover-trigger-width) p-0" :class="menuClass" align="start">
      <Command :class="menuClass">
        <div v-if="remote" class="p-1 pb-0">
          <InputGroup class="bg-input/30 border-input/30 h-8! rounded-lg! shadow-none! *:data-[slot=input-group-addon]:pl-2!">
            <ListboxFilter :model-value="q" :placeholder="searchPlaceholder ?? t('store_ui.search_dots')" auto-focus class="w-full text-sm outline-hidden" @update:model-value="search" />
            <InputGroupAddon><Search class="size-4 text-muted-foreground" /></InputGroupAddon>
          </InputGroup>
        </div>
        <CommandInput v-else :placeholder="searchPlaceholder ?? t('store_ui.search_dots')" />
        <CommandList class="max-h-64">
          <p v-if="remote && !options.length" class="px-3 py-4 text-center text-sm text-muted-foreground">{{ empty ?? t("store_ui.nothing_found") }}</p>
          <CommandEmpty v-else-if="!remote">{{ empty ?? t("store_ui.nothing_found") }}</CommandEmpty>
          <CommandGroup>
            <CommandItem v-for="o in options" :key="o" :value="o" @select="model = o; open = false">
              <Check class="size-4" :class="o === model ? 'opacity-100' : 'opacity-0'" />
              <span class="truncate">{{ o }}</span>
            </CommandItem>
          </CommandGroup>
          <p v-if="remote && more" class="border-t px-3 py-2 text-xs opacity-70">{{ t("shared.showing_first", { count: options.length }) }}</p>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
