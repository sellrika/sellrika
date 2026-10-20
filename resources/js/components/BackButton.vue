<script setup lang="ts">
// The arrow at the top left of a page. It goes back in the browser's history (lib/back.ts),
// so the list it came from keeps its search, filters and page.
// `href` is where it goes when there is no page to go back to, and what a new-tab click opens.
import { ArrowLeft } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import WithTooltip from "./WithTooltip.vue";
import { goBack } from "@/lib/back";

const props = defineProps<{
	href: string;
	label: string;
	size?: "icon" | "icon-sm";
}>();

/**
 * Go back on a plain click. A click for a new tab or window keeps the link.
 * @param e The click.
 */
function back(e: MouseEvent) {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
	e.preventDefault();
	goBack(props.href);
}
</script>

<template>
  <WithTooltip :label="label">
    <Button as-child variant="ghost" :size="size ?? 'icon'">
      <a :href="href" :aria-label="label" @click="back"><ArrowLeft /></a>
    </Button>
  </WithTooltip>
</template>
