<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import {
	Ban,
	BanknoteArrowDown,
	CircleCheckBig,
	Equal,
	LoaderCircle,
	Plus,
	Printer,
	RotateCcw,
	Trash2,
	Truck,
	UserRound,
} from "@lucide/vue";
import AppLayout from "@/layouts/AppLayout.vue";
import BackButton from "@/components/BackButton.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import ExtensionSlot from "@/components/ExtensionSlot.vue";
import ReceiptSlip from "@/components/ReceiptSlip.vue";
import OrderItemImage from "@/components/OrderItemImage.vue";
import PaymentState from "@/components/PaymentState.vue";
import { printReceipt } from "@/lib/rawbt";
import { useAuth } from "@/lib/auth";
import { fmtDate, fromCents, money, toCents } from "@/lib/format";
import { t } from "@/lib/i18n";
import { taxLabel } from "@helpers/tax";
import PaymentMethodPicker from "@/components/pos/PaymentMethodPicker.vue";
import { deliveryHidden, stepLabel, statusBadges } from "@/lib/orders";
import { methodStyle, paymentIcon } from "@/lib/paymentIcons";
import type {
	FulfillmentStatus,
	OrderDetail,
	OrderSnapshot,
	PaymentMethod,
	SharedProps,
} from "@/types";

defineOptions({ layout: AppLayout });
const props = defineProps<{
	order: OrderDetail;
	payment_methods: PaymentMethod[];
	sales_staff: { id: number; name: string }[]; // the active sales people Record payment may name
}>();

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");
const { isAdmin } = useAuth();
watch(
	() => page.props.errors?.void,
	(msg) => msg && toast.error(msg),
);
watch(
	() => page.props.errors?.fulfillment,
	(msg) => msg && toast.error(msg),
);

/**
 * The lines of one side of a history entry, as text.
 * @param snap The order before or after the change.
 * @returns "2× Mug, 1× Tee".
 */
function snapshotLines(snap: OrderSnapshot) {
	return snap.items
		.map(function line(i) {
			return `${i.qty}× ${i.name}`;
		})
		.join(", ");
}

/**
 * The `order.show` extension slot (the extension guide › Slots).
 * An extension reads the order as the page shows it now.
 */
const orderSlot = {
	order: function order() {
		return props.order;
	},
};

// the public order code (what the buyer sees); the id only for older rows without one
const code = computed(() => props.order.reference ?? props.order.id);
const method = computed(() =>
	props.payment_methods.find((m) => m.name === props.order.payment_method),
);
// only money that came in can go back: what was handed over less the change, less earlier refunds
const remaining = computed(() =>
	Math.max(0, props.order.paid - props.order.change - props.order.refunded),
);
const canRefund = computed(
	() =>
		isAdmin.value &&
		props.order.status !== "voided" &&
		props.order.payment_status !== "unpaid" &&
		remaining.value > 0,
);
// cash on delivery / bank transfer: still to be collected
const due = computed(() =>
	Math.max(0, props.order.total - (props.order.paid - props.order.change)),
);
const canPay = computed(
	() =>
		props.order.status !== "voided" &&
		props.order.payment_status !== "paid" &&
		due.value > 0,
);
const canVoid = computed(
	() => isAdmin.value && props.order.status === "completed",
);
const itemCount = computed(() =>
	props.order.items.reduce((s, i) => s + i.qty, 0),
);
const print = () =>
	printReceipt(props.order, currency.value, page.props.shop?.name ?? "");

// An order that is not paid in full yet can still change: more lines (from the Sell screen), fewer lines.
const canEdit = computed(
	() =>
		props.order.status === "completed" && props.order.payment_status !== "paid",
);

// Remove items ----------------------------------------------------------------
// The delete button of a line only changes what is on screen (a draft).
// Nothing is removed from the order until "Save changes".
const removeQtys = ref<Record<number, number>>({}); // order_item_id → units to take off
const removing = ref(false);
const removeError = ref("");
const removeCount = computed(() =>
	Object.values(removeQtys.value).reduce((s, n) => s + n, 0),
);
/** The lines as shown: each with its draft quantity; a line at 0 is gone from the list. */
const shownItems = computed(() =>
	props.order.items
		.map(function draft(it) {
			return { ...it, qty: it.qty - (removeQtys.value[it.id] ?? 0) };
		})
		.filter(function left(it) {
			return it.qty > 0;
		}),
);
// the last unit can't go: that is a void
const canRemove = computed(
	() => canEdit.value && itemCount.value - removeCount.value > 1,
);

/**
 * The delete button of a line: one unit less on screen; the line goes away at 0.
 * @param id The order line.
 */
function removeOne(id: number) {
	if (!canRemove.value) return;
	removeQtys.value = {
		...removeQtys.value,
		[id]: (removeQtys.value[id] ?? 0) + 1,
	};
}

/** Forget the draft: the lines are shown as saved again. */
function undoRemove() {
	removeQtys.value = {};
	removeError.value = "";
}

/**
 * "Save changes": take the drafted units off the order. The server puts their stock back and works the totals out again.
 */
async function submitRemove() {
	removing.value = true;
	removeError.value = "";
	try {
		const res = await fetch(`/orders/${props.order.id}/items/remove`, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				items: Object.entries(removeQtys.value)
					.filter(([, n]) => n > 0)
					.map(([id, qty]) => ({ order_item_id: Number(id), qty })),
			}),
		});
		const data = await res.json();
		if (res.status === 201) {
			undoRemove();
			toast.success(t("orders.items_removed"));
			router.reload();
		} else {
			const errors: Record<string, string> = data.errors ?? {};
			removeError.value = Object.values(errors)[0] ?? t("orders.change_failed");
		}
	} catch {
		removeError.value = t("orders.server_unreachable");
	} finally {
		removing.value = false;
	}
}

// Refund ----------------------------------------------------------------------
const refundOpen = ref(false);
const qtys = ref<Record<number, number>>({}); // order_item_id → units to return
const restock = ref(true);
const amount = ref("");
const reason = ref("");
const amountTouched = ref(false);
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const returnable = (id: number) => {
	const it = props.order.items.find((i) => i.id === id)!;
	return it.qty - it.refunded_qty;
};
/** Pro-rata value of the selected units: their gross share of what was actually paid (same formula as the server default). */
const suggested = computed(() => {
	const gross = props.order.items.reduce(
		(s, i) => s + i.price * (qtys.value[i.id] ?? 0),
		0,
	);
	// the delivery fee isn't part of the goods, so it never scales a per-item refund
	const goods = props.order.total - props.order.delivery_fee;
	const v = props.order.subtotal
		? Math.round((gross * goods) / props.order.subtotal)
		: gross;
	return Math.min(remaining.value, v);
});
watch(suggested, (v) => {
	if (!amountTouched.value) amount.value = v ? fromCents(v) : "";
});
watch(refundOpen, (o) => {
	if (o) {
		qtys.value = {};
		restock.value = true;
		amount.value = "";
		reason.value = "";
		amountTouched.value = false;
		errors.value = {};
	}
});
const setQty = (id: number, n: number) => {
	qtys.value = {
		...qtys.value,
		[id]: Math.max(0, Math.min(returnable(id), n)),
	};
};
const amountCents = computed(() => toCents(amount.value));
const refundAll = () => {
	for (const it of props.order.items) qtys.value[it.id] = returnable(it.id);
	amountTouched.value = false;
	amount.value = fromCents(remaining.value);
};

async function submitRefund() {
	saving.value = true;
	errors.value = {};
	try {
		const res = await fetch(`/orders/${props.order.id}/refund`, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				amount: amountCents.value,
				reason: reason.value,
				restock: restock.value,
				items: Object.entries(qtys.value)
					.filter(([, n]) => n > 0)
					.map(([id, qty]) => ({ order_item_id: Number(id), qty })),
			}),
		});
		const data = await res.json();
		if (res.status === 201) {
			refundOpen.value = false;
			toast.success(
				t("orders.refunded_toast", {
					amount: money(amountCents.value, currency.value),
				}),
			);
			router.reload();
		} else errors.value = data.errors ?? { amount: t("orders.refund_failed") };
	} catch {
		errors.value = { amount: t("orders.server_unreachable") };
	} finally {
		saving.value = false;
	}
}

// Record payment (cash on delivery collected, bank transfer seen) -------------
// The dialog works like the Sell screen's checkout, without a discount.
const payOpen = ref(false);
const payAmount = ref("");
const payMethod = ref<PaymentMethod | null>(null); // null = the order keeps the method it has
const paySeller = ref("none"); // the sales person: their id as text, "none" = nobody
const paying = ref(false);
const payError = ref("");
/** The shop's methods that are switched on: the ones the dialog offers. */
const payMethods = computed(function enabledMethods() {
	return props.payment_methods.filter((m) => m.enabled);
});
/**
 * The sales person the order names now, when they can still be picked.
 * @returns Their id as text, else "none".
 */
function sellerNow() {
	const id = props.order.sales_staff_id;
	return props.sales_staff.some((s) => s.id === id) ? String(id) : "none";
}
/**
 * Fills the dialog each time it opens.
 * The method starts on the order's own one. A till order with none of the
 * shop's methods yet (Pay later) starts on the first; an online order keeps its own.
 * @param open True when the dialog was just opened.
 */
function fillPayment(open: boolean) {
	if (!open) return;
	payAmount.value = fromCents(due.value);
	payMethod.value =
		payMethods.value.find((m) => m.name === props.order.payment_method) ??
		(props.order.fulfillment ? null : (payMethods.value[0] ?? null));
	paySeller.value = sellerNow();
	payError.value = "";
}
watch(payOpen, fillPayment);
// `?pay=1` (a "Pay" link, e.g. a restaurant table's) opens the dialog at once
onMounted(function payOnArrival() {
	if (canPay.value && new URLSearchParams(location.search).has("pay"))
		payOpen.value = true;
});
const payCents = computed(() => toCents(payAmount.value));
/** The cents that go on the order: never more than what is due, the rest is change. */
const payApplied = computed(() => Math.min(payCents.value, due.value));
/** More than the due amount is fine only for a cash method: it gives change. */
const payTooMuch = computed(
	() => payCents.value > due.value && !payMethod.value?.tendered,
);
/** The due amount + the next whole 5/10/20/50 note above it, like the Sell screen. */
const payQuick = computed(function quickAmounts() {
	const set = new Set<number>([due.value]);
	for (const note of [5, 10, 20, 50]) {
		const v = Math.ceil(due.value / (note * 100)) * note * 100;
		if (v > due.value) set.add(v);
	}
	return [...set].sort((a, b) => a - b);
});
async function submitPayment() {
	paying.value = true;
	payError.value = "";
	try {
		const res = await fetch(`/orders/${props.order.id}/payments`, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				amount: payApplied.value,
				payment_method: payMethod.value?.name,
				tendered: payMethod.value?.tendered ? payCents.value : undefined,
				// sent only when changed, so a sales person switched off since stays on the order
				sales_staff_id:
					paySeller.value === sellerNow()
						? undefined
						: paySeller.value === "none"
							? null
							: Number(paySeller.value),
			}),
		});
		const data = await res.json();
		if (res.status === 201) {
			payOpen.value = false;
			toast.success(
				t("orders.recorded_amount", {
					amount: money(payApplied.value, currency.value),
				}),
			);
			router.reload();
		} else
			payError.value =
				(Object.values(data.errors ?? {})[0] as string | undefined) ??
				t("orders.payment_failed");
	} catch {
		payError.value = t("orders.server_unreachable");
	} finally {
		paying.value = false;
	}
}

// Delivery (online orders walk the shop's own steps, in its order) -------------
const steps = computed(() => page.props.shop?.fulfillment_steps ?? []);
const stage = ref<FulfillmentStatus | "">(props.order.fulfillment);
const tracking = ref(props.order.tracking);
const savingStage = ref(false);
watch(
	() => [props.order.fulfillment, props.order.tracking],
	([f, code]) => {
		stage.value = f as FulfillmentStatus;
		tracking.value = code as string;
	},
);
const stageDirty = computed(
	() =>
		stage.value !== props.order.fulfillment ||
		tracking.value.trim() !== props.order.tracking,
);
const saveStage = () =>
	router.put(
		`/orders/${props.order.id}/fulfillment`,
		{ fulfillment: stage.value, tracking: tracking.value },
		{
			preserveScroll: true,
			onStart: () => (savingStage.value = true),
			onFinish: () => (savingStage.value = false),
			onSuccess: () =>
				toast.success(
					t(
						stage.value === "shipped"
							? "orders.marked_shipped"
							: "orders.delivery_status_saved",
					),
				),
		},
	);

/** "This sale was voided on 3 May by Ada." — one whole sentence per case. */
const voidedLine = computed(function line() {
	const date = props.order.voided_at ? fmtDate(props.order.voided_at) : "";
	const name = props.order.voided_by_name;
	if (date && name) return t("orders.voided_banner_on_by", { date, name });
	if (date) return t("orders.voided_banner_on", { date });
	if (name) return t("orders.voided_banner_by", { name });
	return t("orders.voided_banner");
});

// Void ------------------------------------------------------------------------
const voidOpen = ref(false);
const voidReason = ref("");
const voiding = ref(false);
const submitVoid = () =>
	router.post(
		`/orders/${props.order.id}/void`,
		{ reason: voidReason.value },
		{
			preserveScroll: true,
			onStart: () => (voiding.value = true),
			onFinish: () => (voiding.value = false),
			onSuccess: () => {
				voidOpen.value = false;
				toast.success(t("orders.voided_toast", { id: code.value }));
			},
		},
	);
</script>

<template>
  <Head :title="t('orders.order_no', { id: code })" />

  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <!-- Header -->
    <div class="flex flex-wrap items-start gap-3">
      <BackButton href="/orders" :label="t('orders.back_to_orders')" />
      <div class="mr-auto min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-xl font-semibold tracking-tight">{{ t("orders.order_no", { id: code }) }}</h1>
          <Badge v-for="b in statusBadges(order, steps)" :key="b.label" variant="outline" :class="b.class" :style="b.style">{{ b.label }}</Badge>
        </div>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{{ fmtDate(order.created_at) }}</span>
          <span v-if="order.cashier">{{ t("orders.by_name", { name: order.cashier }) }}</span>
          <span v-if="order.sales_staff">{{ t("orders.sold_by", { name: order.sales_staff }) }}</span>
          <Badge variant="outline" :style="methodStyle(method?.color)"><component :is="paymentIcon(method?.icon)" /> {{ order.payment_method }}</Badge>
          <PaymentState :order="order" />
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <!-- extensions' own buttons for this order (the tax invoice) -->
        <ExtensionSlot name="order.show" :context="orderSlot" class="contents!" />
        <Button variant="outline" @click="print"><Printer /> {{ t("orders.print") }}</Button>
        <Button v-if="canEdit" as-child variant="outline"><Link :href="`/pos?order=${order.id}`"><Plus /> {{ t("orders.add_items") }}</Link></Button>
        <Button v-if="canPay" @click="payOpen = true"><BanknoteArrowDown /> {{ t("orders.record_payment") }}</Button>
        <Button v-if="canRefund" variant="outline" @click="refundOpen = true"><RotateCcw /> {{ t("orders.refund") }}</Button>
        <Button v-if="canVoid" variant="outline" class="text-destructive hover:text-destructive" @click="voidOpen = true"><Ban /> {{ t("orders.void") }}</Button>
      </div>
    </div>

    <!-- Voided banner -->
    <div v-if="order.status === 'voided'" class="rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p class="font-medium">{{ voidedLine }}</p>
      <p class="text-muted-foreground"><template v-if="order.void_reason">{{ t("orders.void_reason_shown", { reason: order.void_reason }) }} </template>{{ t("orders.voided_note") }}</p>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <!-- Items -->
      <!-- gap-0 + self-start: no strip between the lines and the totals, and no empty space when the side column is taller -->
      <Card class="gap-0 py-0 lg:col-span-2 lg:self-start" data-order-items>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="pl-4">{{ t("orders.item") }}</TableHead>
              <TableHead class="w-16 text-right">{{ t("common.qty") }}</TableHead>
              <TableHead class="hidden w-28 text-right sm:table-cell">{{ t("common.price") }}</TableHead>
              <TableHead class="w-28 pr-4 text-right">{{ t("common.total") }}</TableHead>
              <TableHead v-if="canEdit" class="w-12 pr-2"><span class="sr-only">{{ t("common.remove") }}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="it in shownItems" :key="it.id">
              <TableCell class="max-w-0 pl-4">
                <div class="flex items-center gap-3">
                  <OrderItemImage :src="it.image" />
                  <div class="min-w-0">
                    <p class="truncate font-medium">{{ it.name }}</p>
                    <p v-if="it.note" class="text-xs whitespace-pre-line break-words text-muted-foreground" data-line-note><span class="font-medium">{{ t("orders.line_note") }}:</span> {{ it.note }}</p>
                    <p v-if="it.refunded_qty" class="text-xs text-amber-600 dark:text-amber-400">{{ t("orders.n_returned", { count: it.refunded_qty }) }}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ it.qty }}</TableCell>
              <TableCell class="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{{ money(it.price, currency) }}</TableCell>
              <TableCell class="pr-4 text-right font-medium tabular-nums">{{ money(it.price * it.qty, currency) }}</TableCell>
              <TableCell v-if="canEdit" class="pr-2 text-right">
                <Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-destructive" :disabled="!canRemove" :aria-label="t('orders.remove_one', { name: it.name })" @click="removeOne(it.id)"><Trash2 class="size-4" /></Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <!-- the draft: shown only while something waits to be removed -->
        <div v-if="removeCount" class="flex flex-wrap items-center justify-between gap-2 border-t bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/30" data-remove-draft>
          <p :class="removeError ? 'text-destructive' : ''">{{ removeError || t(removeCount === 1 ? "orders.remove_draft_one" : "orders.remove_draft_other", { count: removeCount }) }}</p>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" :disabled="removing" @click="undoRemove">{{ t("common.undo") }}</Button>
            <Button size="sm" :disabled="removing" @click="submitRemove"><LoaderCircle v-if="removing" class="animate-spin" /> {{ t("orders.save_changes") }}</Button>
          </div>
        </div>
        <div class="border-t bg-muted/30 p-4">
          <dl class="ml-auto max-w-xs space-y-1 text-sm">
            <div class="flex justify-between text-muted-foreground"><dt>{{ t(itemCount === 1 ? "orders.items_subtotal_one" : "orders.items_subtotal_other", { count: itemCount }) }}</dt><dd class="tabular-nums">{{ money(order.subtotal, currency) }}</dd></div>
            <div v-if="order.discount" class="flex justify-between text-muted-foreground"><dt>{{ order.discount_type === "percent" ? t("orders.discount_percent", { value: order.discount_value }) : t("common.discount") }}<template v-if="order.coupon_code"> · <span class="font-mono" data-coupon-code>{{ order.coupon_code }}</span></template></dt><dd class="tabular-nums">−{{ money(order.discount, currency) }}</dd></div>
            <div v-if="order.tax" class="flex justify-between text-muted-foreground"><dt>{{ taxLabel(order, t("common.tax_included_prefix")) }}</dt><dd class="tabular-nums" data-tax>{{ money(order.tax, currency) }}</dd></div>
            <div v-if="order.delivery_fee" class="flex justify-between text-muted-foreground"><dt>{{ t("orders.delivery") }}</dt><dd class="tabular-nums">{{ money(order.delivery_fee, currency) }}</dd></div>
            <div v-else-if="order.coupon_code && !order.discount" class="flex justify-between text-muted-foreground"><dt>{{ t("orders.delivery") }} · <span class="font-mono" data-coupon-code>{{ order.coupon_code }}</span></dt><dd>{{ t("orders.free") }}</dd></div>
            <div class="flex justify-between text-base font-semibold"><dt>{{ t("common.total") }}</dt><dd class="tabular-nums">{{ money(order.total, currency) }}</dd></div>
            <Separator class="my-2" />
            <div class="flex justify-between text-muted-foreground"><dt>{{ t("orders.paid") }}</dt><dd class="tabular-nums">{{ money(order.paid, currency) }}</dd></div>
            <div v-if="due" class="flex justify-between font-medium text-red-700 dark:text-red-400"><dt>{{ t("orders.still_due") }}</dt><dd class="tabular-nums">{{ money(due, currency) }}</dd></div>
            <div v-else class="flex justify-between text-muted-foreground"><dt>{{ t("orders.change") }}</dt><dd class="tabular-nums">{{ money(order.change, currency) }}</dd></div>
            <template v-if="order.refunded">
              <div class="flex justify-between text-amber-700 dark:text-amber-400"><dt>{{ t("orders.refunded") }}</dt><dd class="tabular-nums">−{{ money(order.refunded, currency) }}</dd></div>
              <div class="flex justify-between font-medium"><dt>{{ t("orders.net") }}</dt><dd class="tabular-nums">{{ money(order.total - order.refunded, currency) }}</dd></div>
            </template>
          </dl>
        </div>
      </Card>

      <!-- Side: delivery (online orders) + customer + refunds -->
      <div class="space-y-4">
        <Card v-if="order.fulfillment && !deliveryHidden()">
          <CardHeader><CardTitle class="flex items-center gap-2 text-base"><Truck class="size-4" /> {{ t("orders.delivery") }}</CardTitle></CardHeader>
          <CardContent>
            <form class="space-y-3" @submit.prevent="saveStage">
              <div class="space-y-1.5">
                <Label for="fulfillment">{{ t("common.status") }}</Label>
                <Select v-model="stage" :disabled="order.status === 'voided'">
                  <SelectTrigger id="fulfillment" class="w-full" :aria-label="t('orders.delivery_status')"><SelectValue :placeholder="t('orders.choose')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="f in steps" :key="f.key" :value="f.key">{{ stepLabel(f.key, steps) }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-1.5">
                <Label for="tracking">{{ t("orders.tracking_number") }} <span class="font-normal text-muted-foreground">{{ t("orders.optional") }}</span></Label>
                <Input id="tracking" v-model="tracking" maxlength="100" :placeholder="t('orders.tracking_placeholder')" :disabled="order.status === 'voided'" />
              </div>
              <p class="text-xs text-muted-foreground">{{ t("orders.shipping_note") }}</p>
              <Button type="submit" size="sm" :disabled="savingStage || !stageDirty || order.status === 'voided'"><LoaderCircle v-if="savingStage" class="animate-spin" /> {{ t("orders.save_delivery_status") }}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle class="text-base">{{ t("common.customer") }}</CardTitle></CardHeader>
          <CardContent>
            <Link v-if="order.customer" :href="`/customers/${order.customer.id}`" class="flex items-center gap-3 rounded-lg hover:underline">
              <span class="flex size-9 items-center justify-center rounded-full bg-muted"><UserRound class="size-4 text-muted-foreground" /></span>
              <span class="min-w-0"><span class="block truncate font-medium">{{ order.customer.name }}</span><span v-if="order.customer.phone" class="block text-xs text-muted-foreground">{{ order.customer.phone }}</span></span>
            </Link>
            <p v-else class="text-sm text-muted-foreground">{{ t("orders.walk_in") }}</p>
            <p v-if="order.note" class="mt-3 text-sm whitespace-pre-line text-muted-foreground" data-order-note>{{ order.note }}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle class="text-base">{{ t("orders.refunds") }}</CardTitle></CardHeader>
          <CardContent>
            <p v-if="!order.refunds.length" class="text-sm text-muted-foreground">{{ t("orders.none_dot") }}</p>
            <ul v-else class="space-y-3">
              <li v-for="r in order.refunds" :key="r.id" class="rounded-lg border p-3 text-sm">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-medium tabular-nums">−{{ money(r.amount, currency) }}</span>
                  <span class="text-xs text-muted-foreground">{{ fmtDate(r.created_at) }}</span>
                </div>
                <p v-if="r.items.length" class="mt-1 text-muted-foreground">{{ r.items.map((i) => `${i.qty}× ${i.name}`).join(", ") }}<span v-if="r.restock"> · {{ t("orders.restocked") }}</span><span v-else> · {{ t("orders.not_restocked") }}</span></p>
                <p v-if="r.reason" class="mt-1">{{ r.reason }}</p>
                <p v-if="r.by" class="mt-1 text-xs text-muted-foreground">{{ t("orders.by_name", { name: r.by }) }}</p>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Items added or removed after the order was made: the order before and after, one row per change -->
    <Card v-if="order.history.length" class="gap-0 py-0" data-order-history>
      <CardHeader class="border-b py-4"><CardTitle class="text-base">{{ t("orders.history") }}</CardTitle></CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-4">{{ t("common.date") }}</TableHead>
            <TableHead>{{ t("orders.history_what") }}</TableHead>
            <TableHead>{{ t("orders.history_items") }}</TableHead>
            <TableHead>{{ t("orders.history_before") }}</TableHead>
            <TableHead>{{ t("orders.history_after") }}</TableHead>
            <TableHead class="pr-4">{{ t("orders.history_by") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="h in order.history" :key="h.id" class="align-top">
            <TableCell class="pl-4 whitespace-nowrap text-muted-foreground">{{ fmtDate(h.created_at) }}</TableCell>
            <TableCell class="font-medium whitespace-nowrap">{{ t(h.type === "items_added" ? "orders.items_added" : "orders.items_removed") }}</TableCell>
            <TableCell class="whitespace-normal font-medium" :class="h.type === 'items_added' ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'" data-history-changed>
              <p v-for="(c, i) in h.data.changed" :key="i">{{ h.type === "items_added" ? "+" : "−" }} {{ c.qty }}× {{ c.name }}</p>
            </TableCell>
            <TableCell class="whitespace-normal text-muted-foreground">
              <p>{{ snapshotLines(h.data.before) }}</p>
              <p class="tabular-nums">{{ money(h.data.before.total, currency) }}</p>
            </TableCell>
            <TableCell class="whitespace-normal">
              <p>{{ snapshotLines(h.data.after) }}</p>
              <p class="font-medium tabular-nums">{{ money(h.data.after.total, currency) }}</p>
            </TableCell>
            <TableCell class="pr-4 whitespace-nowrap text-muted-foreground">{{ h.by ?? "—" }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <ReceiptSlip :order="order" :currency="currency" />
  </div>

  <!-- Refund dialog -->
  <Dialog v-model:open="refundOpen">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("orders.refund_title", { id: code }) }}</DialogTitle>
        <DialogDescription>{{ t("orders.refund_desc", { amount: money(remaining, currency) }) }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="rounded-lg border">
          <div v-for="it in order.items" :key="it.id" class="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0" :class="!returnable(it.id) && 'opacity-50'">
            <OrderItemImage :src="it.image" :size="32" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ it.name }}</p>
              <p class="text-xs text-muted-foreground">{{ money(it.price, currency) }} · {{ t("orders.returnable", { left: returnable(it.id), qty: it.qty }) }}</p>
            </div>
            <div class="inline-flex h-8 items-center rounded-md border">
              <Button variant="ghost" size="icon" class="size-8 rounded-r-none" :disabled="!(qtys[it.id] ?? 0)" :aria-label="t('orders.return_fewer', { name: it.name })" @click="setQty(it.id, (qtys[it.id] ?? 0) - 1)">−</Button>
              <span class="min-w-8 border-x text-center tabular-nums leading-8">{{ qtys[it.id] ?? 0 }}</span>
              <Button variant="ghost" size="icon" class="size-8 rounded-l-none" :disabled="(qtys[it.id] ?? 0) >= returnable(it.id)" :aria-label="t('orders.return_more', { name: it.name })" @click="setQty(it.id, (qtys[it.id] ?? 0) + 1)">+</Button>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Label class="flex items-center gap-2 font-normal"><Checkbox v-model="restock" /> {{ t("orders.restock_label") }}</Label>
          <Button variant="ghost" size="sm" @click="refundAll">{{ t("orders.refund_everything") }}</Button>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="refund-amount">{{ t("orders.amount_to_refund") }}</Label>
            <Input id="refund-amount" v-model="amount" inputmode="decimal" class="tabular-nums" :aria-invalid="!!errors.amount" @input="amountTouched = true" />
            <p v-if="errors.amount" class="text-sm text-destructive">{{ errors.amount }}</p>
            <p v-else-if="suggested && amountTouched && amountCents !== suggested" class="text-xs text-muted-foreground">{{ t("orders.suggested", { amount: money(suggested, currency) }) }}</p>
            <p v-else class="text-xs text-muted-foreground">{{ t("orders.max_amount", { amount: money(remaining, currency) }) }}</p>
          </div>
          <div class="space-y-1.5">
            <Label for="refund-reason">{{ t("orders.reason") }} <span class="font-normal text-muted-foreground">{{ t("orders.optional") }}</span></Label>
            <Textarea id="refund-reason" v-model="reason" rows="2" :placeholder="t('orders.reason_placeholder')" />
          </div>
        </div>
        <p v-for="(msg, key) in errors" v-show="key !== 'amount'" :key="key" class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ msg }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="refundOpen = false">{{ t("common.cancel") }}</Button>
        <Button :disabled="saving || amountCents <= 0 || amountCents > remaining" @click="submitRefund">
          <LoaderCircle v-if="saving" class="animate-spin" /><CircleCheckBig v-else />
          {{ amountCents > 0 ? t("orders.refund_amount", { amount: money(amountCents, currency) }) : t("orders.refund") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Record payment dialog -->
  <Dialog v-model:open="payOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("orders.record_payment_title", { id: code }) }}</DialogTitle>
        <DialogDescription>{{ t("orders.record_payment_desc", { amount: money(due, currency), method: order.payment_method }) }}</DialogDescription>
      </DialogHeader>
      <!-- the money asked for: what is due, or the part typed for a method that takes no cash -->
      <PaymentMethodPicker v-if="payMethods.length" v-model="payMethod" :methods="payMethods" :amount="payMethod?.tendered ? due : payApplied" />
      <div class="space-y-2">
        <Label for="pay-amount">{{ t("orders.amount_received") }}</Label>
        <Input id="pay-amount" v-model="payAmount" inputmode="decimal" class="h-11 text-lg tabular-nums" :aria-invalid="!!payError || payTooMuch" />
        <div v-if="payMethod?.tendered" class="flex flex-wrap gap-2">
          <Button v-for="q in payQuick" :key="q" variant="outline" class="h-10 shrink-0" @click="payAmount = fromCents(q)">
            <Equal v-if="q === due" class="size-4" />
            {{ q === due ? t("pos.exact") : money(q, currency) }}
          </Button>
        </div>
        <p v-if="payError" class="text-sm text-destructive">{{ payError }}</p>
        <p v-else-if="!payMethod?.tendered" class="text-xs text-muted-foreground">{{ t("orders.max_amount", { amount: money(due, currency) }) }}</p>
      </div>
      <div v-if="sales_staff.length" class="space-y-2">
        <Label for="pay-sales-staff">{{ t("pos.sales_staff") }}</Label>
        <Select v-model="paySeller">
          <SelectTrigger id="pay-sales-staff" class="h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{{ t("pos.no_sales_staff") }}</SelectItem>
            <SelectItem v-for="s in sales_staff" :key="s.id" :value="String(s.id)">{{ s.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Separator />
      <div class="flex justify-between text-base font-semibold">
        <template v-if="payCents < due"><span>{{ t("orders.still_due") }}</span><span class="tabular-nums">{{ money(due - payCents, currency) }}</span></template>
        <template v-else><span>{{ t("pos.change") }}</span><span class="tabular-nums">{{ money(payTooMuch ? 0 : payCents - due, currency) }}</span></template>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="payOpen = false">{{ t("common.cancel") }}</Button>
        <Button :disabled="paying || payCents <= 0 || payTooMuch" @click="submitPayment">
          <LoaderCircle v-if="paying" class="animate-spin" /><CircleCheckBig v-else />
          {{ payCents > 0 ? t("orders.record_amount", { amount: money(payApplied, currency) }) : t("orders.record") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Void dialog -->
  <Dialog v-model:open="voidOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("orders.void_title", { id: code }) }}</DialogTitle>
        <DialogDescription>{{ t("orders.void_desc") }}</DialogDescription>
      </DialogHeader>
      <div class="space-y-1.5">
        <Label for="void-reason">{{ t("orders.reason") }} <span class="font-normal text-muted-foreground">{{ t("orders.optional") }}</span></Label>
        <Textarea id="void-reason" v-model="voidReason" rows="2" :placeholder="t('orders.void_reason_placeholder')" />
      </div>
      <DialogFooter>
        <Button variant="outline" @click="voidOpen = false">{{ t("orders.keep_order") }}</Button>
        <Button variant="destructive" :disabled="voiding" @click="submitVoid"><LoaderCircle v-if="voiding" class="animate-spin" /><Ban v-else /> {{ t("orders.void_order") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
