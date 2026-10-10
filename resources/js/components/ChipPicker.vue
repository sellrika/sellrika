<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, ChevronsUpDown, Plus, Search, X } from "@lucide/vue";
import { ListboxFilter } from "reka-ui";
import {
	Command,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";

/**
 * Several picks in one field, shown as removable badges. The list is either `options` (filtered here as you type —
 * the zone's countries) or `find`, asked on open (the first page, A–Z) and again with what was typed, debounced (a
 * zone's cities from the downloaded GeoNames places — `more` = there are others, keep typing); with `custom` on, a
 * typed value that isn't on the list is offered as "Add “…”" (a city with no list).
 */
const model = defineModel<string[]>({ required: true });
const props = defineProps<{
	label: string;
	placeholder: string;
	searchPlaceholder: string;
	hint: string;
	options?: string[];
	find?: (q: string) => Promise<{ places: string[]; more: boolean }>;
	custom?: boolean;
	id?: string;
	invalid?: boolean;
}>();
const open = ref(false);
const q = ref("");
const found = ref<string[]>([]);
const more = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
/** What the box says → the rows to show. The box is reka's own filter input rather than CommandInput: the Command wrapper
 * filters rows by the text it knows and would hide rows that arrive later from the server — with the wrapper's search left
 * empty, every row we render is shown (they are the matches already). */
function search(term: string) {
	q.value = term;
	clearTimeout(timer);
	const t = term.trim().toLowerCase();
	if (props.options)
		return (found.value = t
			? props.options.filter((o) => o.toLowerCase().includes(t)).slice(0, 50)
			: props.options);
	if (!props.find) return (found.value = []);
	timer = setTimeout(
		async () => {
			try {
				({ places: found.value, more: more.value } = await props.find!(
					term.trim(),
				));
			} catch {
				found.value = [];
				more.value = false;
			}
		},
		t ? 150 : 0,
	);
}
const has = (c: string) =>
	model.value.some((m) => m.toLowerCase() === c.toLowerCase());
function toggle(c: string) {
	model.value = has(c)
		? model.value.filter((m) => m.toLowerCase() !== c.toLowerCase())
		: [...model.value, c];
}
/** The typed value when it isn't on the list (nor chosen already) — offered as "Add" when `custom` is on. */
const extra = computed(() => {
	const t = q.value.trim();
	return props.custom &&
		t &&
		!found.value.some((f) => f.toLowerCase() === t.toLowerCase()) &&
		!has(t)
		? t
		: "";
});
</script>

<template>
  <Popover v-model:open="open" @update:open="(o: boolean) => o && search('')">
    <PopoverTrigger as-child>
      <button
        :id="id"
        type="button"
        role="combobox"
        :aria-expanded="open"
        :aria-label="label"
        :aria-invalid="invalid"
        class="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
      >
        <Badge v-for="c in model" :key="c" variant="secondary" class="gap-1 bg-foreground/10 pr-1">
          {{ c }}
          <span role="button" tabindex="-1" :aria-label="t('shared.remove_x', { name: c })" class="rounded-sm p-0.5 hover:bg-foreground/10" @click.stop="toggle(c)"><X class="size-3" /></span>
        </Badge>
        <span v-if="!model.length" class="text-muted-foreground">{{ placeholder }}</span>
        <ChevronsUpDown class="ml-auto size-4 shrink-0 opacity-50" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-(--reka-popover-trigger-width) p-0" align="start">
      <Command>
        <div class="p-1 pb-0">
          <InputGroup class="bg-input/30 border-input/30 h-8! rounded-lg! shadow-none! *:data-[slot=input-group-addon]:pl-2!">
            <ListboxFilter :model-value="q" :placeholder="searchPlaceholder" auto-focus class="w-full text-sm outline-hidden" @update:model-value="search" />
            <InputGroupAddon><Search class="size-4 text-muted-foreground" /></InputGroupAddon>
          </InputGroup>
        </div>
        <CommandList class="max-h-64">
          <p v-if="!found.length && !extra" class="px-3 py-4 text-center text-sm text-muted-foreground">{{ hint }}</p>
          <CommandGroup>
            <CommandItem v-for="c in found" :key="c" :value="c" @select="toggle(c)">
              <Check class="size-4" :class="has(c) ? 'opacity-100' : 'opacity-0'" />
              <span class="truncate">{{ c }}</span>
            </CommandItem>
            <CommandItem v-if="extra" :value="extra" @select="toggle(extra)"><Plus class="size-4" /> {{ t("shared.add_x", { name: extra }) }}</CommandItem>
          </CommandGroup>
          <p v-if="more" class="border-t px-3 py-2 text-xs text-muted-foreground">{{ t("shared.showing_first", { count: found.length }) }}</p>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
