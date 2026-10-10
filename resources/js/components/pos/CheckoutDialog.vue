<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { usePage } from "@inertiajs/vue3";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	CircleCheckBig,
	Clock,
	Equal,
	LoaderCircle,
	Printer,
} from "@lucide/vue";
import { fromCents, money, toCents } from "@/lib/format";
import { t } from "@/lib/i18n";
import { printReceipt } from "@/lib/rawbt";
import { showPayment } from "@/lib/display";
import ReceiptSlip from "@/components/ReceiptSlip.vue";
import PaymentMethodPicker from "./PaymentMethodPicker.vue";
import type { Customer, Order, PaymentMethod, SharedProps } from "@/types";
import { taxLabel } from "@helpers/tax";
import { saleTotals, type CartLine, type Discount } from "./CartPanel.vue";

const props = defineProps<{
	open: boolean;
	lines: CartLine[];
	currency: string;
	methods: PaymentMethod[];
	salesStaff: { id: number; name: string }[];
	discount: Discount;
	customer: Customer | null;
}>();
const emit = defineEmits<{
	(e: "update:open", v: boolean): void;
	(e: "done"): void;
}>();

const shop = computed(() => usePage<SharedProps>().props.shop);
/** A running extension made Pay later the main button (`pos.primary`, e.g. a restaurant: guests pay at the end). */
const payLaterFirst = computed(() =>
	(usePage<SharedProps>().props.extension_ui ?? []).some(
		function laterFirst(e) {
			return e.app?.["pos.primary"] === "pay_later";
		},
	),
);
const totals = computed(() =>
	saleTotals(props.lines, props.discount, shop.value),
);
const subtotal = computed(() => totals.value.subtotal);
const discountAmt = computed(() => totals.value.discount);
const total = computed(() => totals.value.total);
const method = ref<PaymentMethod | null>(null); // one of the shop's methods; `tendered` ones ask for cash and show change
const tendered = ref("");
const seller = ref("none"); // the sales person named on the sale: their id as text, "none" = nobody
const loading = ref(false);
const error = ref<string | null>(null);
const order = ref<Order | null>(null);

const paid = computed(() =>
	method.value?.tendered ? toCents(tendered.value) : total.value,
);
const change = computed(() => paid.value - total.value);

/** Exact amount + the next whole 5/10/20/50 note above the total. */
const quick = computed(() => {
	const set = new Set<number>([total.value]);
	for (const note of [5, 10, 20, 50]) {
		const v = Math.ceil(total.value / (note * 100)) * note * 100;
		if (v > total.value) set.add(v);
	}
	return [...set].sort((a, b) => a - b);
});

watch(
	() => props.open,
	(open) => {
		if (!open) return;
		method.value = props.methods[0] ?? null;
		tendered.value = fromCents(total.value);
		seller.value = "none";
		error.value = null;
		order.value = null;
		loading.value = false;
	},
);

// The method buttons (PaymentMethodPicker) tell the customer's screen what is picked while they are on screen.
// Once at the start: a method left there by a closed tab goes away.
showPayment(shop.value?.id ?? 0, null);

/**
 * Send the cart to the server.
 * @param later True for "Pay later": the order is saved unpaid, so items can still be added or removed.
 */
async function confirm(later = false) {
	loading.value = true;
	error.value = null;
	try {
		const res = await fetch(later ? "/pos/open" : "/pos/checkout", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: props.lines.map((l) => ({
					product_id: l.product_id,
					variant_id: l.variant_id,
					qty: l.qty,
					choices: l.choices ?? {},
					note: l.note?.trim() || undefined,
				})),
				paid: paid.value,
				payment_method: method.value?.name,
				customer_id: props.customer?.id ?? null,
				sales_staff_id: seller.value === "none" ? null : Number(seller.value),
				discount_type:
					props.discount?.type === "coupon"
						? null
						: (props.discount?.type ?? null),
				discount_value:
					props.discount?.type === "coupon" ? 0 : (props.discount?.value ?? 0),
				coupon:
					props.discount?.type === "coupon" ? props.discount.quote.code : "",
			}),
		});
		const data = await res.json();
		if (res.status === 201) {
			order.value = {
				...(data.order as Order),
				customer: props.customer
					? {
							id: props.customer.id,
							name: props.customer.name,
							phone: props.customer.phone,
						}
					: null,
			};
			emit("done"); // the sale is booked — clear the cart now, not on close, or navigating away keeps it
			toast.success(t(later ? "pos.order_saved" : "pos.sale_complete"));
		} else {
			error.value =
				data.errors?.cart ??
				(Object.values(data.errors ?? {})[0] as string | undefined) ??
				t("pos.checkout_failed");
		}
	} catch {
		error.value = t("pos.server_unreachable");
	} finally {
		loading.value = false;
	}
}

const page = usePage<SharedProps>();
const shopName = computed(() => page.props.shop?.name ?? "");
const print = () =>
	order.value && printReceipt(order.value, props.currency, shopName.value);

const newSale = () => emit("update:open", false);

/** Is the order on the receipt still waiting for money ("Pay later")? */
const due = computed(
	() => !!order.value && order.value.payment_status !== "paid",
);

/** "2 lines in this sale for Ann." — one whole sentence per case, never glued together. */
const saleLines = computed(function lines() {
	const count = props.lines.length;
	const name = props.customer?.name;
	if (name)
		return t(
			count === 1 ? "pos.sale_lines_for_one" : "pos.sale_lines_for_other",
			{ count, name },
		);
	return t(count === 1 ? "pos.sale_lines_one" : "pos.sale_lines_other", {
		count,
	});
});
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => $emit('update:open', v)">
    <DialogContent class="sm:max-w-md" :show-close-button="!loading">
      <!-- Receipt -->
      <template v-if="order">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <CircleCheckBig class="size-5 text-primary" /> {{ t(due ? "pos.order_saved" : "pos.sale_complete") }}
          </DialogTitle>
          <DialogDescription>{{ t("pos.order_no", { id: order.id }) }} · {{ order.payment_method }}<template v-if="order.customer"> · {{ order.customer.name }}</template></DialogDescription>
        </DialogHeader>
        <ul class="max-h-56 space-y-1 overflow-y-auto text-sm">
          <li v-for="(it, i) in order.items" :key="i" class="flex justify-between gap-3">
            <span class="min-w-0 truncate">{{ it.qty }} × {{ it.name }}</span>
            <span class="tabular-nums">{{ money(it.price * it.qty, currency) }}</span>
          </li>
        </ul>
        <Separator />
        <dl class="space-y-1 text-sm">
          <template v-if="order.discount || order.tax">
            <div class="flex justify-between text-muted-foreground"><dt>{{ t("common.subtotal") }}</dt><dd class="tabular-nums">{{ money(order.subtotal, currency) }}</dd></div>
            <div v-if="order.discount" class="flex justify-between text-muted-foreground"><dt>{{ order.discount_type === "percent" ? t("pos.discount_percent", { value: order.discount_value }) : t("common.discount") }}<template v-if="order.coupon_code"> · <span class="font-mono" data-coupon-code>{{ order.coupon_code }}</span></template></dt><dd class="tabular-nums">−{{ money(order.discount, currency) }}</dd></div>
            <div v-if="order.tax" class="flex justify-between text-muted-foreground"><dt>{{ taxLabel(order, t("common.tax_included_prefix")) }}</dt><dd class="tabular-nums">{{ money(order.tax, currency) }}</dd></div>
          </template>
          <div class="flex justify-between font-semibold"><dt>{{ t("common.total") }}</dt><dd class="tabular-nums">{{ money(order.total, currency) }}</dd></div>
          <div class="flex justify-between text-muted-foreground"><dt>{{ t("pos.paid") }}</dt><dd class="tabular-nums">{{ money(order.paid, currency) }}</dd></div>
          <div v-if="due" class="flex justify-between text-base font-semibold"><dt>{{ t("orders.still_due") }}</dt><dd class="tabular-nums">{{ money(order.total - order.paid, currency) }}</dd></div>
          <div v-else class="flex justify-between text-base font-semibold"><dt>{{ t("pos.change") }}</dt><dd class="tabular-nums">{{ money(order.change, currency) }}</dd></div>
        </dl>
        <DialogFooter class="gap-2 sm:flex-row">
          <Button variant="outline" class="h-11 text-base sm:w-32" @click="print"><Printer /> {{ t("pos.print") }}</Button>
          <Button class="h-11 text-base sm:flex-1" @click="newSale">{{ t("common.done") }}</Button>
        </DialogFooter>

        <ReceiptSlip :order="order" :currency="currency" />
      </template>

      <!-- Payment -->
      <template v-else>
        <DialogHeader>
          <DialogTitle>{{ t("pos.charge", { amount: money(total, currency) }) }}</DialogTitle>
          <DialogDescription>{{ saleLines }}</DialogDescription>
        </DialogHeader>

        <PaymentMethodPicker v-model="method" :methods="methods" :amount="total" />

        <div v-if="method?.tendered" class="space-y-2">
          <Label for="tendered">{{ t("pos.amount_tendered") }}</Label>
          <Input id="tendered" v-model="tendered" inputmode="decimal" class="h-11 text-lg tabular-nums" />
          <div class="flex flex-wrap gap-2">
            <Button v-for="q in quick" :key="q" variant="outline" class="h-10 shrink-0"
              @click="tendered = fromCents(q)">
              <Equal v-if="q === total" class="size-4" />
              {{ q === total ? t("pos.exact") : money(q, currency) }}
            </Button>
          </div>
        </div>

        <div v-if="salesStaff.length" class="space-y-2">
          <Label for="sales-staff">{{ t("pos.sales_staff") }}</Label>
          <Select v-model="seller">
            <SelectTrigger id="sales-staff" class="h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{{ t("pos.no_sales_staff") }}</SelectItem>
              <SelectItem v-for="s in salesStaff" :key="s.id" :value="String(s.id)">{{ s.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />
        <dl class="space-y-1 text-sm">
          <template v-if="discountAmt || totals.tax">
            <div class="flex justify-between text-muted-foreground"><dt>{{ t("common.subtotal") }}</dt><dd class="tabular-nums">{{ money(subtotal, currency) }}</dd></div>
            <div v-if="discountAmt" class="flex justify-between text-muted-foreground"><dt>{{ discount?.type === "percent" ? t("pos.discount_percent", { value: discount.value }) : t("common.discount") }}<template v-if="discount?.type === 'coupon'"> · <span class="font-mono">{{ discount.quote.code }}</span></template></dt><dd class="tabular-nums">−{{ money(discountAmt, currency) }}</dd></div>
            <div v-if="totals.tax && shop" class="flex justify-between text-muted-foreground"><dt>{{ taxLabel(shop, t("common.tax_included_prefix")) }}</dt><dd class="tabular-nums">{{ money(totals.tax, currency) }}</dd></div>
          </template>
          <div class="flex justify-between font-semibold"><dt>{{ t("common.total") }}</dt><dd class="tabular-nums">{{ money(total, currency) }}</dd></div>
          <div class="flex justify-between text-muted-foreground"><dt>{{ t("pos.paid") }}</dt><dd class="tabular-nums">{{ money(paid, currency) }}</dd></div>
          <div class="flex justify-between text-base font-semibold" :class="change < 0 && 'text-destructive'">
            <dt>{{ t("pos.change") }}</dt><dd class="tabular-nums">{{ money(change, currency) }}</dd>
          </div>
        </dl>

        <p v-if="error" class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ error }}</p>

        <!-- `sm:flex-1`, not `flex-1`: on a phone the footer is a column, where `flex-1` squeezes the button's height -->
        <DialogFooter class="gap-2 sm:flex-row">
          <Button :variant="payLaterFirst ? 'default' : 'outline'" class="h-11 text-base" :class="payLaterFirst && 'sm:flex-1'" :data-primary="payLaterFirst || undefined" :disabled="loading || !lines.length" @click="confirm(true)"><Clock /> {{ t("pos.pay_later") }}</Button>
          <Button :variant="payLaterFirst ? 'outline' : 'default'" class="h-11 text-base" :class="payLaterFirst ? 'order-first' : 'sm:flex-1'" :data-primary="!payLaterFirst || undefined" :disabled="loading || change < 0 || !lines.length || !method" @click="confirm()">
            <LoaderCircle v-if="loading" class="animate-spin" />
            {{ loading ? t("pos.charging") : t("pos.confirm_amount", { amount: money(total, currency) }) }}
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
