<script setup lang="ts">
import { computed } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { Paged } from "@/types";

/**
 * `local` = the list is paged in the browser: the buttons emit `go`
 * with the new page number instead of linking to `?page=`.
 */
const props = defineProps<{ page: Paged<unknown>; local?: boolean }>();
const emit = defineEmits<{ go: [page: number] }>();
const inertiaPage = usePage();

// keep the current filters (?q=, ?method=) and only swap the page number
const href = (n: number) => {
	const u = new URL(inertiaPage.url, "http://x");
	u.searchParams.set("page", String(n));
	return u.pathname + u.search;
};
const from = computed(() =>
	props.page.total ? (props.page.page - 1) * props.page.per_page + 1 : 0,
);
const to = computed(() =>
	Math.min(props.page.page * props.page.per_page, props.page.total),
);
</script>

<template>
  <div v-if="page.total" class="flex items-center justify-between gap-3 text-sm text-muted-foreground">
    <span class="tabular-nums">{{ t("shared.pager_range", { from, to, total: page.total }) }}</span>
    <div class="flex items-center gap-1">
      <!-- a disabled attr on an <a> does nothing, so the edges render a real disabled <button> -->
      <Button v-if="page.page <= 1" variant="outline" size="sm" disabled><ChevronLeft /> {{ t("shared.prev") }}</Button>
      <Button v-else-if="local" variant="outline" size="sm" @click="emit('go', page.page - 1)"><ChevronLeft /> {{ t("shared.prev") }}</Button>
      <Button v-else as-child variant="outline" size="sm"><Link :href="href(page.page - 1)" preserve-scroll><ChevronLeft /> {{ t("shared.prev") }}</Link></Button>
      <span class="px-2 tabular-nums">{{ page.page }} / {{ page.last_page }}</span>
      <Button v-if="page.page >= page.last_page" variant="outline" size="sm" disabled>{{ t("shared.next") }} <ChevronRight /></Button>
      <Button v-else-if="local" variant="outline" size="sm" @click="emit('go', page.page + 1)">{{ t("shared.next") }} <ChevronRight /></Button>
      <Button v-else as-child variant="outline" size="sm"><Link :href="href(page.page + 1)" preserve-scroll>{{ t("shared.next") }} <ChevronRight /></Link></Button>
    </div>
  </div>
</template>
