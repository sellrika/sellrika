<script setup lang="ts">
import type { Component } from "vue";

/**
 * One number on a stats row: the label and an icon on top,
 * the value and a short line under it in an inner panel.
 * Extra attributes (click, role, data-*) land on the outer box.
 */
defineProps<{
	label: string;
	value?: string | number;
	icon?: Component;
	sub?: string | null;
}>();
</script>

<template>
  <div class="flex flex-col rounded-2xl bg-muted p-1 ring-1 ring-foreground/8 dark:bg-card">
    <div class="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-2.5">
      <p class="truncate text-sm text-muted-foreground">{{ label }}</p>
      <component :is="icon" v-if="icon" class="size-4 shrink-0 text-muted-foreground" />
    </div>
    <div class="flex-1 rounded-xl bg-background px-3.5 py-3.5 shadow-xs ring-1 ring-foreground/5 dark:bg-black/25 dark:shadow-none">
      <div class="truncate text-3xl font-medium tracking-tight tabular-nums"><slot name="value">{{ value }}</slot></div>
      <div v-if="$slots.sub || sub" class="mt-1.5 text-sm text-muted-foreground"><slot name="sub">{{ sub }}</slot></div>
    </div>
  </div>
</template>
