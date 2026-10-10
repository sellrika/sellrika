<script setup lang="ts">
defineProps<{ color: string | null | undefined }>();
</script>

<template>
  <span v-if="color" class="inline-block size-2.5 shrink-0 rounded-full border border-black/10" :style="{ background: color }" aria-hidden="true" />
</template>
