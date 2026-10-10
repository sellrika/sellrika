<script setup lang="ts">
import { t } from "@/lib/i18n";
import type { ProductExtra } from "@/types";

/** A product's "Additional data" rows (Darreichungsform → Tabletten, Hersteller → Bayer) as a compact title/value list.
 *  Shown in every product detail right before the description; renders nothing when there are no rows. */
defineProps<{ rows: ProductExtra[]; muted?: string }>();
</script>

<template>
  <dl v-if="rows.length" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" :aria-label="t('shared.additional_data')">
    <template v-for="(r, i) in rows" :key="i">
      <dt class="font-medium">{{ r.title }}</dt>
      <dd class="min-w-0 break-words" :class="muted ?? 'text-muted-foreground'">{{ r.value }}</dd>
    </template>
  </dl>
</template>
