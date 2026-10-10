<script setup lang="ts">
// A place in the app where extensions may add their own UI. Every running extension that names this slot in its
// manifest gets an element here and its script mounted into it (the extension guide › Slots).
import { computed, onBeforeUnmount, onMounted } from "vue";
import { usePage } from "@inertiajs/vue3";
import { extensionApi, mountExtension } from "@/lib/extensions";
import type { SharedProps } from "@/types";

const props = defineProps<{ name: string; context?: unknown }>();
const page = usePage<SharedProps>();
const extensions = computed(() =>
	(page.props.extension_ui ?? []).filter((e) => e.slots[props.name]),
);

const roots: Record<string, HTMLElement> = {};
const cleanups: (() => void)[] = [];
onMounted(async () => {
	for (const e of extensions.value) {
		const el = roots[e.key];
		if (el)
			cleanups.push(
				await mountExtension(
					el,
					e.slots[props.name]!,
					extensionApi(e.key, props.context, e.strings),
				),
			);
	}
});
onBeforeUnmount(() => {
	for (const fn of cleanups.splice(0)) fn();
});
</script>

<template>
  <div v-if="extensions.length" class="grid gap-4" :data-slot="name">
    <div v-for="e in extensions" :key="e.key" :ref="(el) => { if (el) roots[e.key] = el as HTMLElement; }" :data-extension="e.key" />
  </div>
</template>
