<script setup lang="ts">
// A tooltip around one control, mostly an icon-only button. Use it instead of a `title` attribute.
// The slot is the trigger: it gets the tooltip's handlers, so it must render one element.
// It brings its own provider, so it also works on a page without the app layout.
// A disabled button gets no pointer events: wrap a <span> around it to keep its tooltip.
// Never wrap a popover or menu trigger: its menu would anchor to the tooltip. Put this inside the trigger.
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

defineProps<{
	label?: string | null;
	side?: "top" | "right" | "bottom" | "left";
}>();
</script>

<template>
  <TooltipProvider v-if="label" :delay-duration="300" disable-hoverable-content>
    <Tooltip>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipContent :side="side">{{ label }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <slot v-else />
</template>
