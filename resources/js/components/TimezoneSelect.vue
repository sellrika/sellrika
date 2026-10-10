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
import { t } from "@/lib/i18n";

const model = defineModel<string>({ default: "UTC" });
const props = defineProps<{
	zones: string[];
	id?: string;
	invalid?: boolean;
}>();
const open = ref(false);

/** Current UTC offset of a zone, e.g. "UTC+07:00". */
function offsetOf(zone: string) {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			timeZoneName: "longOffset",
		}).formatToParts(new Date());
		const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
		return name === "GMT" ? "UTC+00:00" : name.replace("GMT", "UTC");
	} catch {
		return "UTC+00:00";
	}
}

// ponytail: offsets are read once — a DST change shows on the next page load, which is fine for a picker.
const options = computed(() =>
	props.zones.map((zone) => ({ zone, offset: offsetOf(zone) })),
);
const selected = computed(() =>
	options.value.find((o) => o.zone === model.value),
);
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button :id="id" variant="outline" role="combobox" :aria-expanded="open" :aria-invalid="invalid" class="w-full min-w-0 justify-between font-normal">
        <span v-if="selected" class="truncate"><span class="font-medium">{{ selected.zone }}</span> · {{ selected.offset }}</span>
        <span v-else class="text-muted-foreground">{{ t("shared.select_timezone") }}</span>
        <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-(--reka-popover-trigger-width) p-0" align="start">
      <Command>
        <CommandInput :placeholder="t('shared.search_timezone')" />
        <CommandList class="max-h-64">
          <CommandEmpty>{{ t("shared.no_timezone") }}</CommandEmpty>
          <CommandGroup>
            <CommandItem v-for="o in options" :key="o.zone" :value="`${o.zone} ${o.zone.replace(/[_/]/g, ' ')} ${o.offset}`" @select="model = o.zone; open = false">
              <Check class="size-4" :class="o.zone === model ? 'opacity-100' : 'opacity-0'" />
              <span class="truncate">{{ o.zone }}</span>
              <span class="ml-auto pl-2 tabular-nums text-muted-foreground">{{ o.offset }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
