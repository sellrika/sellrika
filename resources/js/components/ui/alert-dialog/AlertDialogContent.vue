<script setup lang="ts">
import type { AlertDialogContentEmits, AlertDialogContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import {
	AlertDialogContent,
	AlertDialogOverlay,
	AlertDialogPortal,
	useForwardPropsEmits,
} from "reka-ui";
import { cn } from "@/lib/utils";

defineOptions({
	inheritAttrs: false,
});

const props = withDefaults(
	defineProps<
		AlertDialogContentProps & {
			class?: HTMLAttributes["class"];
			size?: "default" | "sm";
		}
	>(),
	{
		size: "default",
	},
);
const emits = defineEmits<AlertDialogContentEmits>();

const delegatedProps = reactiveOmit(props, "class", "size");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <AlertDialogPortal>
    <AlertDialogOverlay
      data-slot="alert-dialog-overlay"
      class="data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50"
    />
    <AlertDialogContent
      data-slot="alert-dialog-content"
      :data-size="size"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 bg-popover text-popover-foreground ring-foreground/10 flex max-h-[calc(100dvh-2rem)] flex-col rounded-xl ring-1 duration-100 data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm group/alert-dialog-content fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none',
          props.class,
        )
      "
    >
      <!-- same shape as DialogContent: only this box scrolls, header and footer stay pinned -->
      <div class="isolate flex min-h-0 flex-col overflow-hidden rounded-[inherit]">
      <div
        data-slot="alert-dialog-body"
        :class="cn(
          'grid min-h-0 gap-4 overflow-x-hidden overflow-y-auto px-4 pt-4 pb-4 has-[>[data-slot=alert-dialog-header]]:pt-0 has-[>[data-slot=alert-dialog-footer]]:pb-0',
          '[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]',
          '[&>[data-slot=alert-dialog-header]]:sticky [&>[data-slot=alert-dialog-header]]:top-0 [&>[data-slot=alert-dialog-header]]:z-10 [&>[data-slot=alert-dialog-header]]:bg-popover',
          '[&:not(.p-0)>[data-slot=alert-dialog-header]]:pt-4 [&:not(.p-0)>[data-slot=alert-dialog-header]]:pb-4 [&:not(.p-0)>[data-slot=alert-dialog-header]]:-mb-4',
          '[&>[data-slot=alert-dialog-footer]]:sticky [&>[data-slot=alert-dialog-footer]]:bottom-0 [&>[data-slot=alert-dialog-footer]]:z-10',
          props.class,
        )"
      >
        <slot />
      </div>
      </div>
    </AlertDialogContent>
  </AlertDialogPortal>
</template>
