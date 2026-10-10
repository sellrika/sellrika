<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Head, Link, router, useForm, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	CalendarClock,
	ChevronRight,
	Mail,
	MapPin,
	Pencil,
	Phone,
	Plus,
	ReceiptText,
	ShoppingBag,
	Trash2,
	TrendingUp,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard.vue";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
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
import { useFitPage } from "@/lib/fitPage";
import { fmtDate, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import { statusBadges } from "@/lib/orders";
import PaymentState from "@/components/PaymentState.vue";
import { methodStyle, paymentIcon } from "@/lib/paymentIcons";
import type {
	CustomerAddress,
	CustomerWithStats,
	Order,
	Paged,
	PaymentMethod,
	SharedProps,
} from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	customer: CustomerWithStats;
	addresses: CustomerAddress[]; // several: their store account's and the ones staff added
	orders: Paged<Order> | null;
	payment_methods: PaymentMethod[];
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");
const initials = computed(() =>
	props.customer.name
		.split(" ")
		.map((p) => p[0])
		.join("")
		.slice(0, 2)
		.toUpperCase(),
);

// page size follows the screen height (header + stats + note + table head + pager ≈ 500px around the rows)
useFitPage(
	"customer_orders",
	`/customers/${props.customer.id}`,
	500,
	() => props.orders?.per_page ?? 20,
);

// orders store the method *name*; icon/color come from the shop's current methods
const methodByName = computed(
	() => new Map(props.payment_methods.map((m) => [m.name, m])),
);
const methodIcon = (name: string) =>
	paymentIcon(methodByName.value.get(name)?.icon);
const methodStyleOf = (name: string) =>
	methodStyle(methodByName.value.get(name)?.color);
const summary = (o: Order) =>
	o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
const itemCount = (o: Order) => o.items.reduce((s, i) => s + i.qty, 0);
const open = (o: Order) => router.visit(`/orders/${o.id}`);

/* edit — the controller re-renders this page with `errors` when the input is bad */
const editing = ref(false);
const form = useForm({ name: "", phone: "", email: "", note: "" });
function startEdit() {
	const c = props.customer;
	form.defaults({
		name: c.name,
		phone: c.phone ?? "",
		email: c.email ?? "",
		note: c.note ?? "",
	});
	form.reset();
	form.clearErrors();
	editing.value = true;
}
function save() {
	form.put(`/customers/${props.customer.id}`, {
		preserveScroll: true,
		onSuccess: () => {
			editing.value = false;
			toast.success(t("customers.updated"));
		},
	});
}
// a validation re-render replaces the page props, so keep the dialog open while there are errors
watch(
	() => page.props.errors,
	(e) => {
		// the address dialog shows its own errors
		if (e && Object.keys(e).length && !addressOpen.value) editing.value = true;
	},
);

/* addresses — several per customer, one dialog to add or change one */
const addressOpen = ref(false);
/** The address being changed, or null while a new one is typed. */
const addressId = ref<number | null>(null);
const addressForm = useForm({
	label: "",
	phone: "",
	address_1: "",
	address_2: "",
	city: "",
	state: "",
	country: "",
	postal_code: "",
	tax_id: "",
});

/**
 * Open the address dialog.
 * @param a The address to change, or nothing for a new one.
 */
function openAddress(a?: CustomerAddress) {
	addressId.value = a?.id ?? null;
	addressForm.defaults({
		label: a?.label ?? "",
		phone: a?.phone ?? "",
		address_1: a?.address_1 ?? "",
		address_2: a?.address_2 ?? "",
		city: a?.city ?? "",
		state: a?.state ?? "",
		country: a?.country ?? "",
		postal_code: a?.postal_code ?? "",
		tax_id: a?.tax_id ?? "",
	});
	addressForm.reset();
	addressForm.clearErrors();
	addressOpen.value = true;
}

/**
 * Close the dialog and say the address is saved.
 */
function addressSaved() {
	addressOpen.value = false;
	toast.success(t("customers.address_saved"));
}

/**
 * Send the address: a new one, or the change of an old one.
 */
function saveAddress() {
	const base = `/customers/${props.customer.id}/addresses`;
	const options = { preserveScroll: true, onSuccess: addressSaved };
	if (addressId.value) addressForm.put(`${base}/${addressId.value}`, options);
	else addressForm.post(base, options);
}

/**
 * Say the address is gone.
 */
function addressRemoved() {
	toast.success(t("customers.address_removed"));
}

/**
 * Remove one address.
 * @param a The address.
 */
function removeAddress(a: CustomerAddress) {
	router.delete(`/customers/${props.customer.id}/addresses/${a.id}`, {
		preserveScroll: true,
		onSuccess: addressRemoved,
	});
}

/**
 * One address as a single line, empty parts left out.
 * @param a The address.
 * @returns "12 Main St, Apt 4, Bangkok, 10110, Thailand".
 */
function addressLine(a: CustomerAddress) {
	return [a.address_1, a.address_2, a.city, a.state, a.postal_code, a.country]
		.filter(Boolean)
		.join(", ");
}

const destroy = () =>
	router.delete(`/customers/${props.customer.id}`, {
		onSuccess: () =>
			toast.success(t("customers.deleted", { name: props.customer.name })),
	});
</script>

<template>
  <Head :title="customer.name" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <BackButton href="/customers" :label="t('customers.back')" />
      <Avatar class="size-11 shrink-0"><AvatarFallback>{{ initials }}</AvatarFallback></Avatar>
      <div class="mr-auto min-w-0">
        <h1 class="truncate text-xl font-semibold tracking-tight">{{ customer.name }}</h1>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span v-if="customer.phone" class="inline-flex items-center gap-1"><Phone class="size-3.5" />{{ customer.phone }}</span>
          <span v-if="customer.email" class="inline-flex items-center gap-1"><Mail class="size-3.5" />{{ customer.email }}<Badge v-if="customer.unsubscribed" variant="outline" class="ml-1 font-normal">{{ t("marketing.unsubscribed") }}</Badge></span>
          <span class="inline-flex items-center gap-1"><CalendarClock class="size-3.5" />{{ t("customers.since", { date: fmtDate(customer.created_at, { dateStyle: "medium" }) }) }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" @click="startEdit()"><Pencil /> {{ t("common.edit") }}</Button>
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <Button variant="ghost" size="icon" :aria-label="t('customers.delete_label', { name: customer.name })"><Trash2 class="text-destructive" /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ t("customers.delete_title", { name: customer.name }) }}</AlertDialogTitle>
              <AlertDialogDescription>{{ t("customers.delete_desc") }}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" @click="destroy">{{ t("common.delete") }}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid gap-3 sm:grid-cols-3">
      <StatCard :label="t('customers.orders')" :icon="ShoppingBag" :value="customer.orders_count" />
      <StatCard :label="t('customers.total_spent')" :icon="TrendingUp" :value="money(customer.total_spent, currency)" />
      <StatCard :label="t('customers.last_order')" :icon="CalendarClock" :value="customer.last_order_at ? fmtDate(customer.last_order_at, { dateStyle: 'medium' }) : '—'" />
    </div>

    <!-- Note -->
    <Card class="py-0">
      <CardContent class="p-4">
        <p class="mb-1 text-xs font-medium text-muted-foreground">{{ t("customers.note") }}</p>
        <p v-if="customer.note" class="whitespace-pre-wrap text-sm">{{ customer.note }}</p>
        <p v-else class="text-sm text-muted-foreground">{{ t("customers.no_notes") }}</p>
      </CardContent>
    </Card>

    <!-- Addresses -->
    <Card class="py-0" data-customer-addresses>
      <CardContent class="p-4">
        <div class="mb-2 flex items-center gap-3">
          <p class="mr-auto text-xs font-medium text-muted-foreground">{{ t("customers.addresses") }}</p>
          <Button variant="outline" size="sm" @click="openAddress()"><Plus /> {{ t("customers.add_address") }}</Button>
        </div>
        <p v-if="!addresses.length" class="text-sm text-muted-foreground">{{ t("customers.no_addresses") }}</p>
        <ul v-else class="divide-y">
          <li v-for="a in addresses" :key="a.id" class="flex items-start gap-3 py-2" data-address>
            <MapPin class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div class="mr-auto min-w-0 text-sm">
              <p v-if="a.label" class="font-medium">{{ a.label }}</p>
              <p class="break-words">{{ addressLine(a) }}</p>
              <p v-if="a.phone" class="text-muted-foreground">{{ a.phone }}</p>
              <p v-if="a.tax_id" class="text-muted-foreground" data-address-tax-id>{{ t("customers.tax_id") }}: {{ a.tax_id }}</p>
            </div>
            <Button variant="ghost" size="icon" class="size-8" :aria-label="t('customers.edit_address_label', { label: a.label || a.address_1 })" @click="openAddress(a)"><Pencil /></Button>
            <Button variant="ghost" size="icon" class="size-8" :aria-label="t('customers.delete_address', { label: a.label || a.address_1 })" @click="removeAddress(a)"><Trash2 class="text-destructive" /></Button>
          </li>
        </ul>
      </CardContent>
    </Card>

    <!-- Purchase history -->
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="mr-auto text-lg font-semibold tracking-tight">{{ t("customers.history") }}</h2>
      <Button as-child variant="outline" size="sm">
        <Link :href="`/orders?customer=${customer.id}`">{{ t("customers.view_in_orders") }}</Link>
      </Button>
    </div>

    <Card v-if="orders && orders.data.length" class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-16 pl-4">{{ t("orders.order") }}</TableHead>
            <TableHead class="w-36">{{ t("common.date") }}</TableHead>
            <TableHead class="hidden min-w-48 md:table-cell">{{ t("orders.items") }}</TableHead>
            <TableHead class="hidden w-28 sm:table-cell">{{ t("orders.payment") }}</TableHead>
            <TableHead class="hidden w-32 md:table-cell">{{ t("common.status") }}</TableHead>
            <TableHead class="w-28 text-right">{{ t("common.total") }}</TableHead>
            <TableHead class="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="o in orders.data"
            :key="o.id"
            class="cursor-pointer"
            tabindex="0"
            role="button"
            :aria-label="t('orders.open_order', { id: o.id })"
            :class="o.status === 'voided' && 'text-muted-foreground'"
            @click="open(o)"
            @keydown.enter="open(o)"
            @keydown.space.prevent="open(o)"
          >
            <TableCell class="pl-4 font-medium tabular-nums">
              #{{ o.id }}
              <component :is="methodIcon(o.payment_method)" class="mt-0.5 size-3.5 text-muted-foreground sm:hidden" :aria-label="o.payment_method" />
            </TableCell>
            <TableCell>
              <div class="text-sm">{{ fmtDate(o.created_at, { dateStyle: "medium" }) }}</div>
              <div class="text-xs text-muted-foreground">{{ fmtDate(o.created_at, { timeStyle: "short" }) }}</div>
            </TableCell>
            <TableCell class="hidden max-w-0 md:table-cell">
              <div class="flex items-center gap-2">
                <Badge variant="secondary" class="shrink-0 tabular-nums">{{ itemCount(o) }}</Badge>
                <span class="truncate text-muted-foreground">{{ summary(o) }}</span>
              </div>
            </TableCell>
            <TableCell class="hidden sm:table-cell">
              <Badge variant="outline" :style="methodStyleOf(o.payment_method)"><component :is="methodIcon(o.payment_method)" /> {{ o.payment_method }}</Badge>
            </TableCell>
            <TableCell class="hidden md:table-cell">
              <div class="flex flex-nowrap gap-1">
                <Badge v-for="b in statusBadges(o, page.props.shop?.fulfillment_steps)" :key="b.label" variant="outline" class="rounded-full" :class="b.class" :style="b.style">{{ b.label }}</Badge>
              </div>
              <PaymentState :order="o" class="mt-1" />
            </TableCell>
            <TableCell class="text-right font-semibold tabular-nums">
              <span :class="o.status === 'voided' && 'line-through'">{{ money(o.total, currency) }}</span>
              <p v-if="o.refunded && o.status !== 'voided'" class="text-xs font-normal text-amber-600 dark:text-amber-400">−{{ money(o.refunded, currency) }}</p>
            </TableCell>
            <TableCell class="pr-4 text-muted-foreground"><ChevronRight class="size-4" /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <Card v-else>
      <CardContent class="flex flex-col items-center gap-2 py-14 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><ReceiptText class="size-5" /></span>
        <p class="font-medium">{{ t("customers.no_purchases") }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t("customers.no_purchases_body", { name: customer.name }) }}</p>
      </CardContent>
    </Card>

    <Pager v-if="orders" :page="orders" />

    <!-- Edit -->
    <Dialog v-model:open="editing">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t("customers.edit_title") }}</DialogTitle>
          <DialogDescription>{{ t("customers.only_name_required") }}</DialogDescription>
        </DialogHeader>
        <form id="customer-edit" class="grid gap-4" @submit.prevent="save">
          <div class="grid gap-2">
            <Label for="e-name">{{ t("common.name") }}</Label>
            <Input id="e-name" v-model="form.name" autofocus :aria-invalid="!!form.errors.name" />
            <p v-if="form.errors.name" class="text-sm text-destructive">{{ form.errors.name }}</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="e-phone">{{ t("common.phone") }}</Label>
              <Input id="e-phone" v-model="form.phone" type="tel" :placeholder="t('customers.optional')" :aria-invalid="!!form.errors.phone" />
              <p v-if="form.errors.phone" class="text-sm text-destructive">{{ form.errors.phone }}</p>
            </div>
            <div class="grid gap-2">
              <Label for="e-email">{{ t("common.email") }}</Label>
              <Input id="e-email" v-model="form.email" type="email" :placeholder="t('customers.optional')" :aria-invalid="!!form.errors.email" />
              <p v-if="form.errors.email" class="text-sm text-destructive">{{ form.errors.email }}</p>
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="e-note">{{ t("customers.note") }}</Label>
            <Textarea id="e-note" v-model="form.note" rows="3" :aria-invalid="!!form.errors.note" />
            <p v-if="form.errors.note" class="text-sm text-destructive">{{ form.errors.note }}</p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" @click="editing = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" form="customer-edit" :disabled="form.processing">{{ t("common.save") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Add or change an address -->
    <Dialog v-model:open="addressOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t(addressId ? "customers.edit_address" : "customers.add_address") }}</DialogTitle>
          <DialogDescription>{{ customer.name }}</DialogDescription>
        </DialogHeader>
        <form id="customer-address" class="grid gap-4" @submit.prevent="saveAddress">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="a-label">{{ t("customers.address_label") }}</Label>
              <Input id="a-label" v-model="addressForm.label" maxlength="40" :placeholder="t('customers.address_label_placeholder')" :aria-invalid="!!addressForm.errors.label" />
              <p v-if="addressForm.errors.label" class="text-sm text-destructive">{{ addressForm.errors.label }}</p>
            </div>
            <div class="grid gap-2">
              <Label for="a-phone">{{ t("common.phone") }}</Label>
              <Input id="a-phone" v-model="addressForm.phone" type="tel" maxlength="30" :placeholder="t('customers.optional')" :aria-invalid="!!addressForm.errors.phone" />
              <p v-if="addressForm.errors.phone" class="text-sm text-destructive">{{ addressForm.errors.phone }}</p>
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="a-line1">{{ t("customers.address") }}</Label>
            <Input id="a-line1" v-model="addressForm.address_1" maxlength="200" :aria-invalid="!!addressForm.errors.address_1" />
            <p v-if="addressForm.errors.address_1" class="text-sm text-destructive">{{ addressForm.errors.address_1 }}</p>
          </div>
          <div class="grid gap-2">
            <Input id="a-line2" v-model="addressForm.address_2" maxlength="200" :placeholder="t('customers.address_2')" :aria-label="t('customers.address_2')" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="a-city">{{ t("customers.city") }}</Label>
              <Input id="a-city" v-model="addressForm.city" maxlength="100" :placeholder="t('customers.optional')" />
            </div>
            <div class="grid gap-2">
              <Label for="a-state">{{ t("customers.state") }}</Label>
              <Input id="a-state" v-model="addressForm.state" maxlength="100" :placeholder="t('customers.optional')" />
            </div>
            <div class="grid gap-2">
              <Label for="a-postal">{{ t("customers.postal_code") }}</Label>
              <Input id="a-postal" v-model="addressForm.postal_code" maxlength="20" :placeholder="t('customers.optional')" />
            </div>
            <div class="grid gap-2">
              <Label for="a-country">{{ t("customers.country") }}</Label>
              <Input id="a-country" v-model="addressForm.country" maxlength="100" :placeholder="t('customers.optional')" />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="a-tax-id">{{ t("customers.tax_id") }}</Label>
            <Input id="a-tax-id" v-model="addressForm.tax_id" maxlength="50" :placeholder="t('customers.optional')" :aria-invalid="!!addressForm.errors.tax_id" />
            <p v-if="addressForm.errors.tax_id" class="text-sm text-destructive">{{ addressForm.errors.tax_id }}</p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" @click="addressOpen = false">{{ t("common.cancel") }}</Button>
          <Button type="submit" form="customer-address" :disabled="addressForm.processing">{{ t("common.save") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
