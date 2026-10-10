<script setup lang="ts">
/**
 * A product picture that fills its frame.
 * Uploads are cropped to a square in `products/ImageEditor.vue`,
 * so the square POS and store tiles need no fitting of their own.
 */
const props = defineProps<{ src: string; alt: string }>();
</script>

<template>
  <img :src="props.src" :alt="props.alt" loading="lazy" decoding="async" class="size-full object-cover" />
</template>
