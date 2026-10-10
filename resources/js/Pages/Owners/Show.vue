<script setup lang="ts">
import { Head, Link, router, useForm } from "@inertiajs/vue3";
import { ChevronRight, Globe } from "@lucide/vue";
import { toast } from "vue-sonner";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import ShopLogo from "@/components/ShopLogo.vue";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { OwnerRow, OwnerShopRow, OwnerStaff } from "@/types";

defineOptions({ layout: AppLayout });
/** One shop owner for the platform admin: who they are, their shops with totals, their staff, their campaign emails. */
const props = defineProps<{
	owner: OwnerRow;
	shops: OwnerShopRow[];
	staff: OwnerStaff[];
	/** this month, through the platform's email; `own` = the limit set on them, null = the default */
	campaign_emails: {
		used: number;
		limit: number;
		own: number | null;
		default: number;
	};
}>();

/** The owner's monthly campaign email limit. Empty = the default. */
const limitForm = useForm<{ limit: number | "" }>({
	limit: props.campaign_emails.own ?? "",
});
limitForm.transform(function sent(d) {
	return { limit: d.limit === "" ? null : d.limit };
});

/** Save the campaign email limit. */
function saveLimit() {
	limitForm.put(`/owners/${props.owner.id}/campaign-limit`, {
		preserveScroll: true,
		onSuccess: function saved() {
			toast.success(t("owners.campaign_limit_saved"));
		},
	});
}

/**
 * The date as a short day, or a dash.
 * @param s The date, or null.
 * @returns What to show.
 */
function day(s: string | null) {
	return s ? fmtDate(s, { dateStyle: "medium" }) : "—";
}
</script>

<template>
  <Head :title="owner.name" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header class="flex items-start gap-3">
      <BackButton href="/owners" :label="t('owners.back')" />
      <div class="min-w-0 space-y-1">
        <h1 class="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          {{ owner.name }}
          <Badge v-if="owner.invited" variant="secondary">{{ t("owners.invited") }}</Badge>
          <Badge v-else-if="!owner.active" variant="outline">{{ t("owners.inactive") }}</Badge>
        </h1>
        <p class="text-sm text-muted-foreground">{{ owner.email }} · {{ t("owners.joined_on", { date: day(owner.created_at) }) }}</p>
      </div>
    </header>

    <section class="space-y-3" :aria-label="t('owners.shops')">
      <h2 class="text-lg font-semibold">{{ t("owners.shops") }} <span class="text-muted-foreground">({{ shops.length }})</span></h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card v-for="s in shops" :key="s.id" class="cursor-pointer gap-3 transition-shadow hover:shadow-md" @click="router.visit(`/owners/${owner.id}/shops/${s.id}`)">
          <CardHeader class="flex flex-row items-center gap-3">
            <ShopLogo :shop="s" class="size-10" />
            <div class="min-w-0 flex-1">
              <CardTitle class="truncate">
                <Link :href="`/owners/${owner.id}/shops/${s.id}`" class="hover:underline" @click.stop>{{ s.name }}</Link>
              </CardTitle>
              <p class="text-xs text-muted-foreground">{{ s.currency }} · {{ s.timezone }}</p>
            </div>
            <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
          </CardHeader>
          <CardContent class="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div class="text-xs text-muted-foreground">{{ t("owners.products") }}</div>
              <div class="font-medium tabular-nums">{{ s.products }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">{{ t("owners.orders") }}</div>
              <div class="font-medium tabular-nums">{{ s.orders }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">{{ t("owners.sales") }}</div>
              <div class="font-medium tabular-nums">{{ money(s.sales, s.currency) }}</div>
            </div>
            <div class="col-span-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{{ t("owners.last_order") }}: {{ day(s.last_order_at) }}</span>
              <Badge v-if="s.online_enabled" variant="secondary"><Globe /> {{ t("owners.online") }}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
      <p v-if="!shops.length" class="text-sm text-muted-foreground">{{ t("owners.no_shops") }}</p>
    </section>

    <section class="space-y-3" :aria-label="t('owners.campaign_emails')">
      <h2 class="text-lg font-semibold">{{ t("owners.campaign_emails") }}</h2>
      <Card>
        <CardContent class="space-y-3">
          <p class="text-sm text-muted-foreground">{{ t("owners.campaign_emails_used", { used: campaign_emails.used, limit: campaign_emails.limit }) }}</p>
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="saveLimit">
            <div class="space-y-1.5">
              <Label for="campaign-limit">{{ t("owners.campaign_limit") }}</Label>
              <Input id="campaign-limit" v-model.number="limitForm.limit" type="number" min="0" step="1" class="w-40" :placeholder="String(campaign_emails.default)" />
            </div>
            <Button type="submit" :disabled="limitForm.processing">{{ t("common.save") }}</Button>
          </form>
          <p v-if="limitForm.errors.limit" class="text-sm text-destructive">{{ limitForm.errors.limit }}</p>
          <p class="text-xs text-muted-foreground">{{ t("owners.campaign_limit_help", { n: campaign_emails.default }) }}</p>
        </CardContent>
      </Card>
    </section>

    <section class="space-y-3" :aria-label="t('owners.staff')">
      <h2 class="text-lg font-semibold">{{ t("owners.staff") }} <span class="text-muted-foreground">({{ staff.length }})</span></h2>
      <Card class="py-0">
        <Table :aria-label="t('owners.staff')">
          <TableHeader>
            <TableRow>
              <TableHead>{{ t("common.name") }}</TableHead>
              <TableHead>{{ t("owners.role") }}</TableHead>
              <TableHead class="hidden sm:table-cell">{{ t("owners.joined") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in staff" :key="u.id">
              <TableCell>
                <span class="font-medium">{{ u.name }}</span>
                <Badge v-if="!u.active" variant="outline" class="ml-2">{{ t("owners.inactive") }}</Badge>
                <div class="text-xs text-muted-foreground">{{ u.email }}</div>
              </TableCell>
              <TableCell>{{ t(`users.role_${u.role}`) }}</TableCell>
              <TableCell class="hidden text-muted-foreground sm:table-cell">{{ day(u.created_at) }}</TableCell>
            </TableRow>
            <TableRow v-if="!staff.length">
              <TableCell colspan="3" class="py-6 text-center text-muted-foreground">{{ t("owners.no_staff") }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </section>
  </div>
</template>
