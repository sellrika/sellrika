<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Head, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Download, Plus, RefreshCw, Trash2, X } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import CountrySelect from "@/components/store/CountrySelect.vue";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import type { PostalStatus, SharedProps } from "@/types";

defineOptions({ layout: AppLayout });

// Cities & postal codes (GeoNames): one list for the whole account — every shop's checkout uses it. A background
// download the page follows with a progress bar (polled while it runs); any country can be fetched.
const postal = ref<PostalStatus | null>(null);
const postalCountry = ref(usePage<SharedProps>().props.shop?.country ?? ""); // what "Download" fetches — the active shop's country first
/** The "Add cities" dialog (pick a country, or all of them). */
const addOpen = ref(false);
const postalBusy = computed(
	() =>
		postal.value?.status === "downloading" ||
		postal.value?.status === "importing",
);
const postalPct = computed(() =>
	postal.value?.total
		? Math.min(100, Math.round((postal.value.done / postal.value.total) * 100))
		: 0,
);
const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;
const postalProgress = computed(function progress() {
	const p = postal.value;
	if (!p) return "";
	const what = p.scope === "all" ? t("online_store.all_countries") : p.country;
	if (p.status === "downloading")
		return p.total
			? t("online_store.downloading_size", {
					what,
					done: mb(p.done),
					total: mb(p.total),
				})
			: t("online_store.downloading", { what });
	if (p.status === "importing")
		return t("online_store.saving_pct", { what, pct: postalPct.value });
	return "";
});
const postalLast = computed(() => {
	const p = postal.value;
	if (!p || p.status === "none" || postalBusy.value) return "";
	const when = p.updated_at ? new Date(p.updated_at).toLocaleString() : "";
	if (p.status === "failed")
		return t("online_store.postal_failed", {
			what:
				p.scope === "all" ? t("online_store.all_countries_caps") : p.country,
			error: p.error ?? t("online_store.download_failed"),
		});
	return t("online_store.last_download", {
		what: p.scope === "all" ? t("online_store.all_countries") : p.country,
		rows: p.rows.toLocaleString(),
		when,
	});
});
let postalTimer: ReturnType<typeof setTimeout> | undefined;
async function pollPostal() {
	clearTimeout(postalTimer);
	try {
		const res = await fetch("/postal-codes/status", {
			headers: { Accept: "application/json" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		postal.value = await res.json();
	} catch (e) {
		// never freeze on the last answer (a mid-run server restart would leave "Saving… 100%" on screen forever)
		if (postal.value)
			postal.value = {
				...postal.value,
				status: "failed",
				error: t("online_store.status_unreadable", {
					reason: e instanceof Error ? e.message : t("online_store.offline"),
				}),
			};
	}
	if (postalBusy.value) postalTimer = setTimeout(pollPostal, 1500);
}
async function downloadPostal(
	scope: "country" | "all",
	country = postalCountry.value,
) {
	const res = await fetch("/postal-codes", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ scope, country }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok)
		return toast.error(
			data.errors?.scope ??
				data.errors?.country ??
				t("online_store.download_start_failed"),
		);
	postal.value = data;
	addOpen.value = false;
	pollPostal();
}
/** Stop the run in flight (one stuck at "Saving… 100%" after a server reload, say) — the buttons work again. */
async function cancelPostal() {
	const res = await fetch("/postal-codes/cancel", {
		method: "POST",
		headers: { Accept: "application/json" },
	});
	if (!res.ok) return toast.error(t("online_store.cancel_failed"));
	clearTimeout(postalTimer);
	postal.value = await res.json();
}
/** Take a country off the list (its rows go; a download brings it back). */
async function removePostal(code: string) {
	const res = await fetch(`/postal-codes/${code}`, {
		method: "DELETE",
		headers: { Accept: "application/json" },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok)
		return toast.error(
			data.errors?.scope ?? t("online_store.remove_country_failed"),
		);
	postal.value = data;
}
onMounted(pollPostal);
onUnmounted(() => clearTimeout(postalTimer));
</script>

<template>
  <Head :title="t('online_store.postal')" />
  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-center gap-3">
      <header class="mr-auto space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t("online_store.postal") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("online_store.postal_desc") }}</p>
      </header>
      <Button type="button" :disabled="postalBusy" @click="addOpen = true"><Plus /> {{ t("online_store.add_cities") }}</Button>
    </div>

    <Dialog v-model:open="addOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ t("online_store.add_cities") }}</DialogTitle>
          <DialogDescription>{{ t("online_store.postal_desc") }}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-2">
          <Label for="postal-country">{{ t("online_store.postal_for") }}</Label>
          <CountrySelect id="postal-country" v-model="postalCountry" />
        </div>
        <DialogFooter class="flex-wrap">
          <Button type="button" variant="outline" :disabled="postalBusy" @click="downloadPostal('all')">{{ t("online_store.all_countries_button") }} <span class="text-muted-foreground">{{ t("online_store.all_countries_size") }}</span></Button>
          <Button type="button" :disabled="postalBusy || !postalCountry" @click="downloadPostal('country')"><Download /> {{ t("online_store.download") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div v-if="postalBusy" class="space-y-1.5">
      <div class="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="postalPct" aria-valuemin="0" aria-valuemax="100" :aria-label="postalProgress">
        <div class="h-full rounded-full bg-primary transition-[width] duration-300" :style="{ width: `${postalPct}%` }" />
      </div>
      <div class="flex items-center gap-2">
        <p class="mr-auto text-xs text-muted-foreground">{{ postalProgress }}</p>
        <Button type="button" size="sm" variant="ghost" @click="cancelPostal"><X /> {{ t("common.cancel") }}</Button>
      </div>
    </div>
    <p v-else-if="postalLast" class="text-sm" :class="postal?.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'" data-postal-status>{{ postalLast }}</p>

    <Card v-if="postal?.countries.length" class="py-0">
      <Table :aria-label="t('online_store.downloaded_countries')">
        <TableHeader>
          <TableRow><TableHead class="pl-4">{{ t("online_store.country") }}</TableHead><TableHead class="text-right">{{ t("online_store.places") }}</TableHead><TableHead>{{ t("online_store.updated") }}</TableHead><TableHead class="w-px whitespace-nowrap pr-4"></TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in postal.countries" :key="c.code">
            <TableCell class="pl-4 font-medium">{{ c.name }} <span class="font-mono text-xs text-muted-foreground">{{ c.code }}</span></TableCell>
            <TableCell class="text-right tabular-nums">{{ c.rows.toLocaleString() }}</TableCell>
            <TableCell class="text-muted-foreground">{{ c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "—" }}</TableCell>
            <TableCell class="pr-4"><Button type="button" size="sm" variant="ghost" :disabled="postalBusy" :aria-label="t('online_store.redownload_aria', { name: c.name })" @click="downloadPostal('country', c.name)"><RefreshCw /> {{ t("online_store.redownload") }}</Button>
              <Button type="button" size="sm" variant="ghost" :disabled="postalBusy" :aria-label="t('online_store.remove_country_aria', { name: c.name })" @click="removePostal(c.code)"><Trash2 /> {{ t("common.remove") }}</Button></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <p v-else-if="!postalBusy" class="text-sm text-muted-foreground" data-postal-status>{{ t("online_store.no_countries") }}</p>
    <p class="text-xs text-muted-foreground">
      {{ t("online_store.geonames_1") }} <a href="https://www.geonames.org" target="_blank" rel="noopener" class="underline">GeoNames</a> {{ t("online_store.geonames_2") }}
    </p>
  </div>
</template>
