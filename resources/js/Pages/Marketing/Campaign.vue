<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Head, router, useForm, usePage } from "@inertiajs/vue3";
import { watchDebounced } from "@vueuse/core";
import { toast } from "vue-sonner";
import { Send, Trash2 } from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import Pager from "@/components/Pager.vue";
import RichText from "@/components/RichText.vue";
import { fmtDate } from "@/lib/format";
import { campaignStatus } from "@/lib/marketing";
import { t } from "@/lib/i18n";
import type {
	Campaign,
	CampaignSend,
	MarketingCustomer,
	Paged,
	SharedProps,
} from "@/types";

/**
 * One email campaign: write it, pick products and customers, then send or schedule it.
 * A draft or scheduled campaign can be edited; one that is sending or sent is read-only
 * and lists who got it. The marketing sweep does the sending, so "Send now" returns fast.
 */
defineOptions({ layout: AppLayout });
const props = defineProps<{
	campaign: Campaign | null;
	products: { id: number; name: string }[];
	sends: Paged<CampaignSend> | null;
	/** The scheduled time on the shop's clock. */
	send_at: { date: string; time: string } | null;
	limits: { products: number; recipients: number };
}>();

const page = usePage<SharedProps>();
const timezone = computed(() => page.props.shop?.timezone ?? "UTC");
const locked = computed(
	() =>
		props.campaign?.status === "sending" || props.campaign?.status === "sent",
);

const form = useForm({
	subject: props.campaign?.subject ?? "",
	body: props.campaign?.body ?? "",
	product_ids: [...(props.campaign?.product_ids ?? [])],
	customer_ids: [...(props.campaign?.customer_ids ?? [])],
});

/** Save the campaign (a new one becomes a draft). */
function save() {
	const done = {
		preserveScroll: true,
		onSuccess: function saved() {
			toast.success(t("marketing.saved"));
		},
	};
	if (props.campaign)
		form.put(`/marketing/campaigns/${props.campaign.id}`, done);
	else form.post("/marketing/campaigns", done);
}

// ---- products -------------------------------------------------------------------------------------------
const productQuery = ref("");
const shownProducts = computed(function shown() {
	const q = productQuery.value.trim().toLowerCase();
	const hits = q
		? props.products.filter(function match(p) {
				return p.name.toLowerCase().includes(q);
			})
		: props.products;
	return hits.slice(0, 50); // ponytail: the first 50 matches; search narrows it
});

/**
 * Add or remove a product card.
 * @param id Product id.
 */
function toggleProduct(id: number) {
	const i = form.product_ids.indexOf(id);
	if (i !== -1) form.product_ids.splice(i, 1);
	else if (form.product_ids.length < props.limits.products)
		form.product_ids.push(id);
}

// ---- recipients (server-paged picker) --------------------------------------------------------------------
const customerQuery = ref("");
const customerPage = ref(1);
const customers = ref<Paged<MarketingCustomer> | null>(null);

/** Load the picker's current page. */
async function loadCustomers() {
	const sp = new URLSearchParams({
		q: customerQuery.value.trim(),
		page: String(customerPage.value),
	});
	const res = await fetch(`/marketing/customers?${sp}`);
	if (res.ok) customers.value = await res.json();
}

/**
 * Go to another page of the picker.
 * @param n The page number.
 */
function goCustomers(n: number) {
	customerPage.value = n;
	void loadCustomers();
}

/**
 * Pick or unpick one customer.
 * @param id Customer id.
 */
function toggleCustomer(id: number) {
	const i = form.customer_ids.indexOf(id);
	if (i !== -1) form.customer_ids.splice(i, 1);
	else if (form.customer_ids.length < props.limits.recipients)
		form.customer_ids.push(id);
}

/** "Select all": every matching customer who may get email. */
async function selectAll() {
	const sp = new URLSearchParams({ q: customerQuery.value.trim(), all: "1" });
	const res = await fetch(`/marketing/customers?${sp}`);
	if (!res.ok) return;
	const { ids } = (await res.json()) as { ids: number[] };
	const all = new Set([...form.customer_ids, ...ids]);
	form.customer_ids = [...all].slice(0, props.limits.recipients);
}

/** "Clear": nobody picked. */
function clearAll() {
	form.customer_ids = [];
}

watchDebounced(
	customerQuery,
	function search() {
		customerPage.value = 1;
		void loadCustomers();
	},
	{ debounce: 300 },
);
onMounted(function start() {
	if (!locked.value) void loadCustomers();
});

// ---- send / schedule -------------------------------------------------------------------------------------
const schedule = useForm({
	now: false,
	date: props.send_at?.date ?? "",
	time: props.send_at?.time ?? "",
});

/** "Schedule": send at the picked date and time. */
function scheduleAt() {
	schedule
		.transform(function later(d) {
			return { ...d, now: false };
		})
		.post(`/marketing/campaigns/${props.campaign!.id}/schedule`, {
			preserveScroll: true,
			onSuccess: function done() {
				toast.success(t("marketing.scheduled"));
			},
		});
}

/** "Send now": due right away; the sweep sends it within a minute. */
function sendNow() {
	schedule
		.transform(function now(d) {
			return { ...d, now: true };
		})
		.post(`/marketing/campaigns/${props.campaign!.id}/schedule`, {
			preserveScroll: true,
			onSuccess: function done() {
				toast.success(t("marketing.sending_soon"));
			},
		});
}

/** "Cancel schedule": back to a draft. */
function cancel() {
	router.post(
		`/marketing/campaigns/${props.campaign!.id}/cancel`,
		{},
		{
			preserveScroll: true,
			onSuccess: function done() {
				toast.success(t("marketing.schedule_cancelled"));
			},
		},
	);
}

const testing = ref(false);

/** "Send test to me": the saved campaign to the signed-in user's email. */
function sendTest() {
	testing.value = true;
	router.post(
		`/marketing/campaigns/${props.campaign!.id}/test`,
		{},
		{
			preserveScroll: true,
			onSuccess: function done() {
				toast.success(t("marketing.test_sent"));
			},
			onError: function failed(errors) {
				toast.error(errors.test ?? t("marketing.test_failed"));
			},
			onFinish: function finish() {
				testing.value = false;
			},
		},
	);
}

const confirmDelete = ref(false);

/** Delete the campaign. */
function destroy() {
	router.delete(`/marketing/campaigns/${props.campaign!.id}`, {
		onSuccess: function done() {
			toast.success(t("marketing.deleted"));
		},
	});
}

/**
 * A time on the shop's clock.
 * @param s A DB timestamp.
 * @returns The date and time.
 */
function when(s: string) {
	return fmtDate(s, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: timezone.value,
	});
}
</script>

<template>
  <Head :title="campaign ? campaign.subject : t('marketing.new_campaign')" />

  <div class="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-center gap-3">
      <BackButton href="/marketing" :label="t('marketing.back_aria')" />
      <h1 class="mr-auto text-xl font-semibold tracking-tight">{{ campaign ? campaign.subject : t("marketing.new_campaign") }}</h1>
      <Badge v-if="campaign" :variant="campaignStatus(campaign.status).variant">{{ campaignStatus(campaign.status).label }}</Badge>
      <Button v-if="campaign && campaign.status !== 'sending'" variant="ghost" size="icon" :aria-label="t('marketing.delete')" @click="confirmDelete = true"><Trash2 /></Button>
    </div>

    <!-- read-only: sending or sent -->
    <template v-if="campaign && locked">
      <Card>
        <CardContent class="space-y-3">
          <p class="text-sm text-muted-foreground">{{ campaign.send_at ? t("marketing.sent_at", { date: when(campaign.send_at) }) : "" }}</p>
          <!-- sanitised on save (app/helpers/html.ts) -->
          <div class="rich-html text-sm" v-html="campaign.body" />
          <p class="text-sm"><span class="font-medium">{{ t("marketing.sent_count", { count: campaign.sent }) }}</span> · {{ t("marketing.failed_count", { count: campaign.failed }) }}</p>
        </CardContent>
      </Card>
      <Card v-if="sends" class="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="pl-4">{{ t("common.name") }}</TableHead>
              <TableHead>{{ t("common.email") }}</TableHead>
              <TableHead class="pr-4">{{ t("common.status") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="s in sends.data" :key="s.id">
              <TableCell class="pl-4">{{ s.name ?? "—" }}</TableCell>
              <TableCell class="text-muted-foreground">{{ s.email }}</TableCell>
              <TableCell class="pr-4">
                <Badge v-if="s.sent_at" variant="default">{{ t("marketing.recipient_sent") }}</Badge>
                <span v-else class="text-sm text-destructive">{{ s.error ?? t("marketing.recipient_not_sent") }}</span>
              </TableCell>
            </TableRow>
            <TableRow v-if="!sends.data.length"><TableCell colspan="3" class="py-8 text-center text-muted-foreground">{{ t("marketing.no_sends") }}</TableCell></TableRow>
          </TableBody>
        </Table>
      </Card>
      <Pager v-if="sends" :page="sends" />
    </template>

    <!-- editable: new, draft or scheduled -->
    <template v-else>
      <form class="grid gap-6" @submit.prevent="save">
        <Card>
          <CardContent class="grid gap-4">
            <div class="grid gap-2">
              <Label for="cm-subject">{{ t("marketing.subject") }}</Label>
              <Input id="cm-subject" v-model="form.subject" :aria-invalid="!!form.errors.subject" />
              <p v-if="form.errors.subject" class="text-sm text-destructive">{{ form.errors.subject }}</p>
            </div>
            <div class="grid gap-2">
              <Label>{{ t("marketing.body") }}</Label>
              <RichText v-model="form.body" :label="t('marketing.body')" :invalid="!!form.errors.body" />
              <p v-if="form.errors.body" class="text-sm text-destructive">{{ form.errors.body }}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="grid gap-2">
            <Label for="cm-product-search">{{ t("marketing.products") }} <span class="font-normal text-muted-foreground">({{ t("marketing.products_help", { max: limits.products }) }})</span></Label>
            <Input id="cm-product-search" v-model="productQuery" type="search" :placeholder="t('coupons.product_search')" />
            <div class="max-h-40 overflow-y-auto rounded-md border text-sm">
              <label v-for="p in shownProducts" :key="p.id" class="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted">
                <input type="checkbox" class="accent-primary" :checked="form.product_ids.includes(p.id)" :aria-label="p.name" @change="toggleProduct(p.id)" />
                <span class="truncate">{{ p.name }}</span>
              </label>
              <p v-if="!shownProducts.length" class="px-3 py-2 text-muted-foreground">{{ t("coupons.no_products_match") }}</p>
            </div>
            <p v-if="form.errors.product_ids" class="text-sm text-destructive">{{ form.errors.product_ids }}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="grid gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <Label for="cm-customer-search" class="mr-auto">{{ t("marketing.recipients") }} <span class="font-normal text-muted-foreground">{{ t("marketing.selected", { count: form.customer_ids.length }) }}</span></Label>
              <Button type="button" variant="outline" size="sm" @click="selectAll">{{ t("marketing.select_all") }}</Button>
              <Button type="button" variant="ghost" size="sm" :disabled="!form.customer_ids.length" @click="clearAll">{{ t("marketing.clear") }}</Button>
            </div>
            <Input id="cm-customer-search" v-model="customerQuery" type="search" :placeholder="t('marketing.customer_search')" />
            <div class="rounded-md border text-sm">
              <label v-for="c in customers?.data ?? []" :key="c.id" class="flex items-center gap-2 px-3 py-1.5" :class="c.unsubscribed ? 'opacity-60' : 'cursor-pointer hover:bg-muted'">
                <input type="checkbox" class="accent-primary" :disabled="c.unsubscribed" :checked="form.customer_ids.includes(c.id)" :aria-label="c.name" @change="toggleCustomer(c.id)" />
                <span class="truncate">{{ c.name }}</span>
                <span class="truncate text-muted-foreground">{{ c.email }}</span>
                <Badge v-if="c.unsubscribed" variant="outline" class="ml-auto font-normal">{{ t("marketing.unsubscribed") }}</Badge>
              </label>
              <p v-if="customers && !customers.data.length" class="px-3 py-2 text-muted-foreground">{{ t("marketing.no_customers") }}</p>
            </div>
            <div v-if="customers && customers.last_page > 1" class="flex items-center justify-end gap-2 text-sm">
              <Button type="button" variant="outline" size="sm" :disabled="customers.page <= 1" @click="goCustomers(customers.page - 1)">{{ t("marketing.prev") }}</Button>
              <span class="text-muted-foreground">{{ customers.page }} / {{ customers.last_page }}</span>
              <Button type="button" variant="outline" size="sm" :disabled="customers.page >= customers.last_page" @click="goCustomers(customers.page + 1)">{{ t("marketing.next") }}</Button>
            </div>
            <p v-if="form.errors.customer_ids" class="text-sm text-destructive">{{ form.errors.customer_ids }}</p>
          </CardContent>
        </Card>

        <div><Button type="submit" :disabled="form.processing">{{ t("marketing.save") }}</Button></div>
      </form>

      <!-- send or schedule: only a saved campaign, and only once its changes are saved -->
      <Card v-if="campaign">
        <CardContent class="grid gap-4">
          <h2 class="font-medium">{{ t("marketing.send_title") }}</h2>
          <p v-if="form.isDirty" class="text-sm text-muted-foreground">{{ t("marketing.save_first") }}</p>
          <p v-if="campaign.status === 'scheduled' && campaign.send_at" class="text-sm" role="status">{{ t("marketing.scheduled_for", { date: when(campaign.send_at) }) }}</p>
          <div class="flex flex-wrap items-end gap-3">
            <div class="grid gap-2">
              <Label for="cm-date">{{ t("marketing.send_date") }}</Label>
              <Input id="cm-date" v-model="schedule.date" type="date" class="w-44" />
            </div>
            <div class="grid gap-2">
              <Label for="cm-time">{{ t("marketing.send_time") }}</Label>
              <Input id="cm-time" v-model="schedule.time" type="time" class="w-32" />
            </div>
            <Button type="button" variant="outline" :disabled="form.isDirty || schedule.processing" @click="scheduleAt">{{ t("marketing.schedule") }}</Button>
            <Button type="button" :disabled="form.isDirty || schedule.processing" @click="sendNow"><Send /> {{ t("marketing.send_now") }}</Button>
            <Button v-if="campaign.status === 'scheduled'" type="button" variant="ghost" @click="cancel">{{ t("marketing.cancel_schedule") }}</Button>
          </div>
          <p class="text-xs text-muted-foreground">{{ t("marketing.timezone_note", { timezone }) }}</p>
          <p v-if="schedule.errors.date" class="text-sm text-destructive" role="alert">{{ schedule.errors.date }}</p>
          <div>
            <Button type="button" variant="secondary" :disabled="form.isDirty || testing" @click="sendTest">{{ t("marketing.send_test") }}</Button>
          </div>
        </CardContent>
      </Card>
    </template>

    <AlertDialog v-model:open="confirmDelete">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t("marketing.delete_title") }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t("marketing.delete_desc") }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction @click="destroy">{{ t("marketing.delete") }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
