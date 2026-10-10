<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, ChevronDown, Palette } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { t } from "@/lib/i18n";

const model = defineModel<string | null>({ default: null });
/**
 * `ariaLabel` names the button (default "Category color");
 * `compact` shows only the swatch, for tight rows.
 */
defineProps<{
	size?: "sm" | "default" | "icon";
	ariaLabel?: string;
	compact?: boolean;
}>();
const open = ref(false);

const PALETTE = [
	{ name: "shared.color_red", hex: "#ef4444" },
	{ name: "shared.color_orange", hex: "#f97316" },
	{ name: "shared.color_amber", hex: "#f59e0b" },
	{ name: "shared.color_yellow", hex: "#eab308" },
	{ name: "shared.color_lime", hex: "#84cc16" },
	{ name: "shared.color_green", hex: "#22c55e" },
	{ name: "shared.color_emerald", hex: "#10b981" },
	{ name: "shared.color_teal", hex: "#14b8a6" },
	{ name: "shared.color_cyan", hex: "#06b6d4" },
	{ name: "shared.color_sky", hex: "#0ea5e9" },
	{ name: "shared.color_blue", hex: "#3b82f6" },
	{ name: "shared.color_indigo", hex: "#6366f1" },
	{ name: "shared.color_violet", hex: "#8b5cf6" },
	{ name: "shared.color_purple", hex: "#a855f7" },
	{ name: "shared.color_pink", hex: "#ec4899" },
	{ name: "shared.color_rose", hex: "#f43f5e" },
	{ name: "shared.color_brown", hex: "#92400e" },
	{ name: "shared.color_slate", hex: "#64748b" },
	{ name: "shared.color_gray", hex: "#9ca3af" },
	{ name: "shared.color_black", hex: "#171717" },
] as const;
const current = computed(() =>
	PALETTE.find((p) => p.hex === model.value?.toLowerCase()),
);
const label = computed(function name() {
	if (!model.value) return t("shared.no_color");
	return current.value ? t(current.value.name) : model.value.toUpperCase();
});
const custom = ref("");
const applyCustom = () => {
	const v = custom.value.trim();
	if (/^#[0-9a-fA-F]{6}$/.test(v)) {
		model.value = v.toLowerCase();
		open.value = false;
	}
};
const pick = (hex: string | null) => {
	model.value = hex;
	open.value = false;
};
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button type="button" variant="outline" :size="size ?? 'default'" class="gap-2 font-normal" :aria-label="ariaLabel ?? t('shared.category_color')" :title="compact ? label : undefined">
        <span class="size-4 rounded-full border border-black/10" :style="model ? { background: model } : undefined"
          :class="!model && 'bg-[repeating-linear-gradient(45deg,transparent_0_4px,var(--color-muted)_4px_8px)]'" />
        <template v-if="!compact">
          {{ label }}
          <ChevronDown class="size-4 opacity-60" />
        </template>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 p-3" align="start">
      <p class="mb-2 text-xs font-medium text-muted-foreground">{{ t("shared.pick_color") }}</p>
      <div class="grid grid-cols-5 gap-2">
        <button v-for="p in PALETTE" :key="p.hex" type="button" :title="t(p.name)" :aria-label="t(p.name)"
          class="group flex flex-col items-center gap-1 rounded-md p-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" @click="pick(p.hex)">
          <span class="flex size-8 items-center justify-center rounded-full border border-black/10 transition-transform group-hover:scale-110" :style="{ background: p.hex }">
            <Check v-if="model?.toLowerCase() === p.hex" class="size-4 text-white drop-shadow" />
          </span>
          <span class="text-[10px] leading-none text-muted-foreground">{{ t(p.name) }}</span>
        </button>
      </div>
      <div class="mt-3 flex items-center gap-2 border-t pt-3">
        <label class="relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border hover:bg-muted" :title="t('shared.custom_color')">
          <Palette class="size-4 text-muted-foreground" />
          <input type="color" class="absolute inset-0 size-full cursor-pointer opacity-0" :value="model ?? '#888888'" :aria-label="t('shared.custom_color')" @input="pick(($event.target as HTMLInputElement).value)" />
        </label>
        <Input v-model="custom" :placeholder="t('shared.hex_placeholder')" class="h-9 font-mono text-xs" maxlength="7" @keydown.enter.prevent="applyCustom" />
        <Button type="button" variant="ghost" size="sm" class="shrink-0" @click="pick(null)">{{ t("common.none") }}</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
