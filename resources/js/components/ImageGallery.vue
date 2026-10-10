<script setup lang="ts">
import { ref, watch } from "vue";
import StoreImage from "@/components/store/StoreImage.vue";
import { t } from "@/lib/i18n";

/** Main image + a thumbnail strip when there is more than one (product page, store sheet, POS sheet).
 * `frame` styles the main image box, `thumbs` the strip (e.g. `hidden sm:flex` in the sheets' narrow
 * mobile layout). The slot is the placeholder when there is no image at all. The main photo goes
 * through `StoreImage`; the `key` remounts it per photo. */
const props = defineProps<{
	images: string[];
	alt: string;
	frame?: string;
	thumbs?: string;
	thumb?: string;
}>();
const i = ref(0);
watch(
	() => props.images,
	() => (i.value = 0),
); // a different unit (variant photos) → start at its cover
</script>

<template>
  <div class="min-w-0">
    <div class="overflow-hidden" :class="frame">
      <StoreImage v-if="images[i]" :key="images[i]" :src="images[i]" :alt="alt" />
      <slot v-else />
    </div>
    <div v-if="images.length > 1" class="mt-2 flex flex-wrap gap-1.5" :class="thumbs">
      <button v-for="(src, n) in images" :key="src" type="button" :aria-label="t('shared.photo_n', { n: n + 1 })" :aria-pressed="i === n"
        class="overflow-hidden rounded-lg border-2 transition-opacity" :class="[thumb ?? 'size-12', i === n ? 'border-current' : 'border-transparent opacity-60 hover:opacity-100']" @click="i = n">
        <img :src="src" alt="" class="size-full object-cover" />
      </button>
    </div>
  </div>
</template>
