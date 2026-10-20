<script setup lang="ts">
import { computed, ref } from "vue";
import { Head, Link, router, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	Megaphone,
	Plus,
	Settings,
	ShoppingCart,
	TriangleAlert,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import Pager from "@/components/Pager.vue";
import WithTooltip from "@/components/WithTooltip.vue";
import { fmtDate } from "@/lib/format";
import { campaignStatus } from "@/lib/marketing";
import { t } from "@/lib/i18n";
import type { Campaign, Paged, SharedProps } from "@/types";

/**
 * /marketing (admin): the shop's email campaigns and the abandoned-cart email.
 * There is no newsletter sign-up anywhere: campaigns go to customers the owner picks.
 */
defineOptions({ layout: AppLayout });
const props = defineProps<{
	campaigns: Paged<Campaign>;
	abandoned: { enabled: boolean; hours: number };
	delays: number[];
	/** Outgoing email is set up (the platform admin's /email page). */
	mail_ready: boolean;
	/** The online store is on and has an address. */
	store_ready: boolean;
	/** Why this shop may send no campaigns, null when it may. */
	campaign_blocked: string | null;
}>();

const page = usePage<SharedProps>();
const timezone = computed(() => page.props.shop?.timezone);

/** The settings dialog (the abandoned-cart email). */
const settingsOpen = ref(false);

const form = useForm({
	enabled: props.abandoned.enabled,
	hours: props.abandoned.hours,
});

/** Save the abandoned-cart switch and delay. */
function save() {
	form.put("/marketing/abandoned", {
		preserveScroll: true,
		preserveState: true,
		onSuccess: function saved() {
			settingsOpen.value = false;
			toast.success(t("marketing.abandoned_saved"));
		},
	});
}

/**
 * When a campaign went out or will go out, on the shop's clock.
 * @param c The campaign.
 * @returns The date, or "—" for a draft.
 */
function when(c: Campaign) {
	if (!c.send_at) return "—";
	return fmtDate(c.send_at, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: timezone.value,
	});
}

/**
 * Open a campaign.
 * @param c The campaign.
 */
function open(c: Campaign) {
	router.visit(`/marketing/campaigns/${c.id}`);
}
</script>

<template>
  <Head :title="t('marketing.title')" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-center gap-3">
      <div class="mr-auto">
        <h1 class="text-xl font-semibold tracking-tight">{{ t("marketing.title") }}</h1>
        <p class="text-sm text-muted-foreground">{{ t("marketing.subtitle") }}</p>
      </div>
      <Button v-if="!campaign_blocked" as-child><Link href="/marketing/campaigns/create"><Plus /> {{ t("marketing.new_campaign") }}</Link></Button>
      <WithTooltip :label="t('nav.settings')"><Button variant="outline" size="icon" :aria-label="t('nav.settings')" @click="settingsOpen = true"><Settings /></Button></WithTooltip>
    </div>

    <p v-if="campaign_blocked" class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="note">
      <TriangleAlert class="size-4 shrink-0" /> {{ campaign_blocked }}
      <Link v-if="page.props.plan?.href" :href="page.props.plan.href" class="font-medium underline underline-offset-4">{{ page.props.plan.cta }}</Link>
    </p>
    <p v-if="!mail_ready" class="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="note"><TriangleAlert class="size-4 shrink-0" /> {{ t("marketing.mail_off") }}</p>
    <p v-if="!store_ready" class="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="note"><TriangleAlert class="size-4 shrink-0" /> {{ t("marketing.needs_store") }}</p>

    <!-- settings: the abandoned-cart email -->
    <Dialog v-model:open="settingsOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2"><ShoppingCart class="size-5" /> {{ t("marketing.abandoned_title") }}</DialogTitle>
          <DialogDescription>{{ t("marketing.abandoned_help") }}</DialogDescription>
        </DialogHeader>
        <form id="abandoned-cart" class="grid gap-4" @submit.prevent="save">
          <div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <Label for="abandoned-switch">{{ t("marketing.abandoned_switch") }}</Label>
            <Switch id="abandoned-switch" v-model="form.enabled" />
          </div>
          <fieldset class="grid gap-2" :disabled="!form.enabled">
            <legend class="mb-2 text-sm font-medium">{{ t("marketing.abandoned_delay") }}</legend>
            <div class="flex flex-wrap gap-2 text-sm">
              <label v-for="h in delays" :key="h" class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5" :class="form.hours === h && 'border-primary ring-1 ring-primary'">
                <input v-model="form.hours" type="radio" name="hours" :value="h" class="accent-primary" />
                {{ t(h === 1 ? "marketing.hours_one" : "marketing.hours_other", { count: h }) }}
              </label>
            </div>
            <p v-if="form.errors.hours" class="text-sm text-destructive">{{ form.errors.hours }}</p>
          </fieldset>
        </form>
        <DialogFooter><Button type="submit" form="abandoned-cart" :disabled="form.processing">{{ t("marketing.abandoned_save") }}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- campaigns -->
    <h2 class="text-lg font-semibold">{{ t("marketing.campaigns") }}</h2>
    <Card v-if="!campaigns.total">
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Megaphone class="size-5" /></span>
        <p class="font-medium">{{ t("marketing.empty_title") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("marketing.empty_text") }}</p>
      </CardContent>
    </Card>
    <Card v-else class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t("marketing.subject") }}</TableHead>
            <TableHead class="w-28">{{ t("common.status") }}</TableHead>
            <TableHead class="w-28 text-right">{{ t("marketing.recipients") }}</TableHead>
            <TableHead class="hidden w-32 text-right md:table-cell">{{ t("marketing.sent_failed") }}</TableHead>
            <TableHead class="hidden w-44 pr-4 sm:table-cell">{{ t("marketing.date") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in campaigns.data" :key="c.id" class="cursor-pointer" :class="{ 'bg-muted/40 text-muted-foreground': c.status === 'sent' }" tabindex="0" role="button" :aria-label="t('marketing.open_aria', { subject: c.subject })" @click="open(c)" @keydown.enter="open(c)" @keydown.space.prevent="open(c)">
            <TableCell class="max-w-0 truncate pl-4 font-medium">{{ c.subject }}</TableCell>
            <TableCell><Badge :variant="campaignStatus(c.status).variant">{{ campaignStatus(c.status).label }}</Badge></TableCell>
            <TableCell class="text-right tabular-nums">{{ c.customer_ids.length }}</TableCell>
            <TableCell class="hidden text-right tabular-nums md:table-cell">{{ c.status === "sent" ? `${c.sent} / ${c.failed}` : "—" }}</TableCell>
            <TableCell class="hidden pr-4 text-sm text-muted-foreground sm:table-cell">{{ when(c) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
    <Pager :page="campaigns" />
  </div>
</template>
