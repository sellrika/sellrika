<script setup lang="ts">
import { ref } from "vue";
import { ChevronDown } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import WithTooltip from "./WithTooltip.vue";
import {
	PAYMENT_ICONS,
	PAYMENT_ICON_NAMES,
	paymentIcon,
} from "@/lib/paymentIcons";
import { t } from "@/lib/i18n";

/** Pick one of the 25 predefined payment icons; v-model is the icon name ("Banknote", …). */
const model = defineModel<string>({ default: "Wallet" });
defineProps<{ size?: "sm" | "default" }>();
const open = ref(false);
const pick = (name: string) => {
	model.value = name;
	open.value = false;
};
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button type="button" variant="outline" :size="size ?? 'default'" class="gap-2 font-normal" :aria-label="t('shared.icon')">
        <component :is="paymentIcon(model)" class="size-4" />
        <span class="hidden sm:inline">{{ model }}</span>
        <ChevronDown class="size-4 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-64 p-3" align="start">
      <p class="mb-2 text-xs font-medium text-muted-foreground">{{ t("shared.pick_icon") }}</p>
      <div class="grid grid-cols-5 gap-1">
        <WithTooltip v-for="name in PAYMENT_ICON_NAMES" :key="name" :label="name">
          <button type="button" :aria-label="name" :aria-pressed="model === name"
            class="flex size-10 items-center justify-center rounded-md border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :class="model === name ? 'border-primary bg-primary/15' : 'border-transparent'" @click="pick(name)">
            <component :is="PAYMENT_ICONS[name]" class="size-5" />
          </button>
        </WithTooltip>
      </div>
    </PopoverContent>
  </Popover>
</template>
