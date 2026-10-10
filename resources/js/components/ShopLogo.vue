<script setup lang="ts">
import { Store } from "@lucide/vue";
import type { Shop } from "@/types";
defineProps<{ shop: Shop | null | undefined }>();
</script>

<template>
  <img v-if="shop?.logo" :src="shop.logo" :alt="shop.name" class="rounded-md object-cover" />
  <span v-else class="flex items-center justify-center rounded-md bg-muted text-muted-foreground"><Store class="size-[60%]" /></span>
</template>
