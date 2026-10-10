<script setup lang="ts">
// One of an extension's own pages (`/extensions/<key>/<path>`): our layout and heading, the extension's script owns the rest.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Head } from "@inertiajs/vue3";
import { Maximize, Minimize } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { maximized, toggleMaximized } from "@/lib/fullscreen";
import { t } from "@/lib/i18n";
import AppLayout from "@/layouts/AppLayout.vue";
import { extensionApi, mountExtension } from "@/lib/extensions";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	extension: { key: string; name: string; version: string };
	page: {
		path: string;
		title: string;
		icon: string | null;
		fullscreen: boolean;
		breadcrumb: boolean;
		fill: boolean;
	};
	script: string;
	strings: Record<string, string>;
}>();

const root = ref<HTMLElement | null>(null);
/** The right side of the heading: the page script may put its own buttons there (`api.actions`). */
const actions = ref<HTMLElement | null>(null);
/** A full-height column on the right of the page (a details panel): `api.aside`, hidden while empty. */
const aside = ref<HTMLElement | null>(null);
let cleanup = () => {};
onMounted(async () => {
	if (root.value)
		cleanup = await mountExtension(root.value, props.script, {
			...extensionApi(props.extension.key, undefined, props.strings),
			actions: actions.value ?? undefined,
			aside: aside.value ?? undefined,
		});
});
onBeforeUnmount(() => cleanup());
</script>

<template>
  <Head :title="page.title" />
  <!-- `fill`: as tall as the screen from md up, so the title stays and the script's own lists scroll -->
  <div class="flex min-h-full flex-col lg:flex-row" :class="page.fill && 'md:h-full'">
    <div class="min-w-0 flex-1 space-y-7 p-4 md:px-10 md:py-8" :class="page.fill && 'md:flex md:min-h-0 md:flex-col'">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight"><img v-if="page.icon" :src="page.icon" alt="" class="size-7 rounded-md object-contain" /> {{ page.title }}</h1>
          <p class="text-sm text-muted-foreground">{{ extension.name }} <span class="text-xs">v{{ extension.version }}</span></p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div ref="actions" class="flex flex-wrap items-center gap-2 empty:hidden" data-page-actions />
          <Button v-if="page.fullscreen" variant="outline" size="icon" class="size-9 shrink-0" :aria-label="t(maximized ? 'nav.fullscreen_exit' : 'nav.fullscreen')" :title="t(maximized ? 'nav.fullscreen_exit' : 'nav.fullscreen')" data-fullscreen-toggle @click="toggleMaximized"><Minimize v-if="maximized" /><Maximize v-else /></Button>
        </div>
      </div>
      <div ref="root" :class="page.fill && 'md:min-h-0 md:flex-1'" :data-extension="extension.key" :data-page="page.path" />
    </div>
    <!-- below the top bar (h-12; none with `breadcrumb: false`), it stays in view while the page scrolls -->
    <aside ref="aside" class="shrink-0 border-t bg-card empty:hidden lg:sticky lg:top-0 lg:w-[400px] lg:overflow-y-auto lg:border-t-0 lg:border-l" :class="page.breadcrumb ? 'lg:h-[calc(100dvh-3rem)]' : 'lg:h-dvh'" data-page-aside />
  </div>
</template>
