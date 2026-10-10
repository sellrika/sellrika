<script setup lang="ts">
import { ref } from "vue";
import { Head } from "@inertiajs/vue3";
import { Puzzle, Settings } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import ExtensionConfigDialog from "@/components/extensions/ExtensionConfigDialog.vue";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/lib/i18n";
import type { ExtensionRow } from "@/types";

defineOptions({ layout: AppLayout });
defineProps<{ extensions: ExtensionRow[] }>();

/** The extension whose Configure dialog is open (null = closed). */
const open = ref<string | null>(null);
const dialog = ref<InstanceType<typeof ExtensionConfigDialog> | null>(null);
/** "1 page and UI on product.form" — what the extension brings besides its listeners. */
function adds(e: ExtensionRow) {
	return [
		e.pages.length &&
			t(
				e.pages.length === 1 ? "extensions.page_one" : "extensions.page_other",
				{ count: e.pages.length },
			),
		e.slots.length &&
			t("extensions.ui_on", { slots: e.slots.map((s) => s.name).join(", ") }),
	]
		.filter(Boolean)
		.join(` ${t("extensions.and")} `);
}
</script>

<template>
  <Head :title="t('extensions.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Puzzle class="size-6" /> {{ t("extensions.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("extensions.subtitle") }}</p>
      </div>
    </div>

    <!-- one row per extension the platform offers; the switch runs it, the settings live in a dialog -->
    <Card class="py-0">
      <CardContent class="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="pl-6">{{ t("extensions.extension") }}</TableHead>
              <TableHead class="text-center">{{ t("common.status") }}</TableHead>
              <TableHead class="w-24 text-center">{{ t("extensions.enabled") }}</TableHead>
              <TableHead class="w-44 pr-6 text-right">{{ t("common.actions") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="!extensions.length">
              <TableCell colspan="4" class="py-8 text-center text-muted-foreground">{{ t("extensions.empty") }}</TableCell>
            </TableRow>
            <TableRow v-for="e in extensions" :key="e.key">
              <TableCell class="pl-6 align-top">
                <p class="flex flex-wrap items-center gap-2 font-medium">
                  <img v-if="e.icon" :src="e.icon" alt="" class="size-6 rounded-md object-contain" />
                  <Puzzle v-else class="size-6 rounded-md bg-muted p-1 text-muted-foreground" />
                  {{ e.name }}
                  <span class="text-xs font-normal text-muted-foreground">v{{ e.version }}</span>
                  <!-- a payment gateway: it is what the online store charges with -->
                  <Badge v-if="e.payment" variant="secondary" class="font-normal">{{ t("extensions.payments_badge") }}</Badge>
                </p>
                <!-- at most two lines; the whole text in the app's tooltip on hover -->
                <Tooltip>
                  <TooltipTrigger as-child>
                    <p class="line-clamp-2 max-w-md text-sm whitespace-normal text-muted-foreground">{{ e.description }}</p>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" class="max-w-md whitespace-normal">{{ e.description }}</TooltipContent>
                </Tooltip>
                <p v-if="adds(e)" class="text-xs text-muted-foreground">{{ t("extensions.adds", { what: adds(e) }) }}</p>
              </TableCell>
              <TableCell class="text-center align-middle">
                <template v-if="e.problem">
                  <Badge variant="outline" class="border-destructive/50 text-destructive">{{ t("extensions.keys_unreadable") }}</Badge>
                  <p class="mt-1 text-xs text-destructive">{{ e.problem }}</p>
                </template>
                <Badge v-else-if="e.ready" variant="outline" class="border-emerald-300 text-emerald-700 dark:text-emerald-400">{{ t("extensions.ready") }}</Badge>
                <Badge v-else variant="outline" class="border-amber-300 text-amber-700 dark:text-amber-400">{{ t("extensions.needs_setup") }}</Badge>
              </TableCell>
              <TableCell class="text-center align-middle">
                <Switch :model-value="e.enabled" :aria-label="t('extensions.enabled_aria', { name: e.name })" @update:model-value="(v: boolean) => dialog?.toggle(e, v)" />
              </TableCell>
              <TableCell class="pr-6 text-right align-middle whitespace-nowrap">
                <Button type="button" variant="ghost" size="sm" :aria-label="t('extensions.configure_aria', { name: e.name })" @click="open = e.key"><Settings /> {{ t("extensions.configure") }}</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <!-- settings: the first save installs the extension in this shop, later ones reconfigure it -->
    <ExtensionConfigDialog ref="dialog" v-model:open="open" :extensions="extensions" />
  </div>
</template>
