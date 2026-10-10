<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui";

import type { HTMLAttributes } from "vue";
import { XIcon } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import {
	DialogClose,
	DialogContent,
	DialogPortal,
	useForwardPropsEmits,
} from "reka-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import DialogOverlay from "./DialogOverlay.vue";

defineOptions({
	inheritAttrs: false,
});

const props = withDefaults(
	defineProps<
		DialogContentProps & {
			class?: HTMLAttributes["class"];
			showCloseButton?: boolean;
		}
	>(),
	{
		showCloseButton: true,
	},
);
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn('bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col rounded-xl text-sm ring-1 duration-100 sm:max-w-sm fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none', props.class)"
    >
      <!-- Only this inner box scrolls (never sideways), so the close button hanging off the corner is never clipped.
           The header and footer are sticky: a long body scrolls under them. `class` is applied here as well as
           on the box above — a caller's `p-0` / `gap-0` must reach the scroll area (its `max-w-*` is a no-op here). -->
      <!-- the clip: a classic (always-on) scrollbar has square corners, this wrapper rounds them off; `isolate` keeps the
           pinned header's z-index inside it, so it can't paint over the close button hanging off the corner -->
      <div class="isolate flex min-h-0 flex-col overflow-hidden rounded-[inherit]">
      <div
        data-slot="dialog-body"
        :class="cn(
          // a sticky child can't cover its scroll container's padding, so the vertical padding sits on the header /
          // footer themselves (the box only pads top/bottom when there is no header / footer to do it)
          // a grid, not a flex column: grid items get a definite height, which a full-bleed body (the product dialogs)
          // relies on to size its own scroll column
          'grid min-h-0 gap-4 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-4 has-[>[data-slot=dialog-header]:not(.sr-only)]:pt-0 has-[>[data-slot=dialog-footer]]:pb-0 has-[>form>[data-slot=dialog-footer]]:pb-0',
          // a thin thumb on an invisible track, so the pinned header / footer don't stop short of a visible gutter
          '[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]',
          '[&>[data-slot=dialog-header]:not(.sr-only)]:sticky [&>[data-slot=dialog-header]:not(.sr-only)]:top-0 [&>[data-slot=dialog-header]:not(.sr-only)]:z-10 [&>[data-slot=dialog-header]:not(.sr-only)]:bg-popover',
          // …and the header also owns the gap below it, so nothing shows through while it is pinned
          '[&:not(.p-0)>[data-slot=dialog-header]:not(.sr-only)]:pt-4 [&:not(.p-0)>[data-slot=dialog-header]:not(.sr-only)]:pb-4 [&:not(.p-0)>[data-slot=dialog-header]:not(.sr-only)]:-mb-4',
          '[&>[data-slot=dialog-footer]]:sticky [&>[data-slot=dialog-footer]]:bottom-0 [&>[data-slot=dialog-footer]]:z-10',
          // a footer inside a <form> that fills the dialog also sits flush with the bottom edge
          '[&>form>[data-slot=dialog-footer]]:sticky [&>form>[data-slot=dialog-footer]]:bottom-0 [&>form>[data-slot=dialog-footer]]:z-10',
          props.class,
        )"
      >
        <slot />
      </div>
      </div>

      <DialogClose
        v-if="showCloseButton"
        data-slot="dialog-close"
        as-child
      >
        <Button variant="secondary" class="absolute -top-3 -right-3 z-20 size-8 rounded-full shadow-md ring-1 ring-foreground/10" size="icon-sm">
          <XIcon />
          <span class="sr-only">Close</span>
        </Button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
