<script setup lang="ts">
// An extension's own settings form (slot `extension.config`), drawn inside the Configure dialog in place of the
// manifest's fields. The script works also while the extension is still off (the extension guide › Slots).
import { onBeforeUnmount, onMounted, ref } from "vue";
import { extensionApi, mountExtension } from "@/lib/extensions";

const props = defineProps<{
	extKey: string;
	script: string;
	strings: Record<string, string>;
	context: unknown;
}>();

const root = ref<HTMLElement | null>(null);
let cleanup: (() => void) | undefined;
let gone = false;

/**
 * Mount the extension's script into this component's element.
 */
async function mount() {
	if (!root.value) return;
	const stop = await mountExtension(
		root.value,
		props.script,
		extensionApi(props.extKey, props.context, props.strings),
	);
	// the dialog closed while the script was loading
	if (gone) stop();
	else cleanup = stop;
}
onMounted(mount);
onBeforeUnmount(function unmount() {
	gone = true;
	cleanup?.();
});
</script>

<template>
  <div ref="root" data-slot="extension.config" :data-extension="extKey" />
</template>
