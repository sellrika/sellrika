<script lang="ts">
import { taxAmount, type TaxRules } from "@helpers/tax";
import { t } from "@/lib/i18n";
import type { PosCouponQuote } from "@/types";
/** One cart line; `key` identifies product+variant so repeat taps bump qty. */
export type CartLine = {
	key: string;
	product_id: number;
	variant_id: number | null;
	name: string;
	variant_name: string | null;
	image: string | null;
	price: number; // cents, unit
	qty: number;
	stock: number | null; // on hand when tracked, else null (no cap)
	choices: Record<number, number>; // package slot id → chosen variant id ({} on ordinary lines)
	note?: string; // the staff's note for the kitchen or the order ("no onions"), kept on the order line
};
/** Order-level discount as typed at the till (percent / fixed), or a discount code as the server quoted it; the server recomputes the cents either way. */
export type Discount =
	| { type: "percent" | "fixed"; value: number }
	| { type: "coupon"; quote: PosCouponQuote }
	| null;
/** What the Sell screen saves under its cart key (`cart:<shop id>`). */
export type SavedCart = {
	cart: CartLine[];
	discount: Discount;
	customer?: { name: string } | null;
};
export const discountCents = (subtotal: number, d: Discount) =>
	!d
		? 0
		: d.type === "coupon"
			? Math.min(subtotal, d.quote.discount)
			: d.value <= 0
				? 0
				: Math.min(
						subtotal,
						d.type === "percent"
							? Math.round((subtotal * d.value) / 100)
							: d.value,
					);
/** Ask the server what a discount code takes off these lines (`POST /pos/coupon`) — the code's rules run there, not here. */
export async function quoteCoupon(
	lines: CartLine[],
	customerId: number | null,
	code: string,
): Promise<
	{ quote: PosCouponQuote; error?: never } | { error: string; quote?: never }
> {
	try {
		const res = await fetch("/pos/coupon", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: lines.map((l) => ({
					product_id: l.product_id,
					variant_id: l.variant_id,
					qty: l.qty,
					choices: l.choices ?? {},
				})),
				customer_id: customerId,
				coupon: code,
			}),
		});
		const data = await res.json();
		return res.ok
			? { quote: data.quote as PosCouponQuote }
			: {
					error:
						(data.errors?.coupon as string | undefined) ??
						t("pos.coupon_invalid"),
				};
	} catch {
		return {
			error: t("pos.server_unreachable"),
		};
	}
}
/** Subtotal, discount, the shop's tax line and the total — the same sums the server recomputes at checkout. */
export const saleTotals = (
	lines: { price: number; qty: number }[],
	d: Discount,
	shop: TaxRules | null,
) => {
	const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
	const discount = discountCents(subtotal, d);
	const tax = shop ? taxAmount(subtotal - discount, shop) : 0;
	return {
		subtotal,
		discount,
		tax,
		total: subtotal - discount + (shop?.tax_included ? 0 : tax),
	};
};
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { usePage } from "@inertiajs/vue3";
import { taxLabel } from "@helpers/tax";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MessageSquare, Minus, Percent, Plus, ShoppingCart, Tag, Trash2, UserRound, UserRoundPlus, X } from "@lucide/vue";
import ExtensionSlot from "@/components/ExtensionSlot.vue";
import { fromCents, money, toCents } from "@/lib/format";
import type { Customer, SharedProps } from "@/types";

/** `adding` = the cart joins an order that already exists: no customer, no discount, and the button says so. */
const props = defineProps<{ lines: CartLine[]; currency: string; closable?: boolean; discount: Discount; customer: Customer | null; adding?: boolean }>();
const emit = defineEmits<{
  (e: "setQty", key: string, qty: number): void;
  (e: "remove", key: string): void;
  (e: "clear"): void;
  (e: "charge"): void;
  (e: "close"): void;
  (e: "update:discount", d: Discount): void;
  (e: "pickCustomer"): void;
  (e: "edit", key: string): void; // reopen the product sheet for this line (image or name tap)
  (e: "setNote", key: string, note: string): void;
  (e: "update:customer", c: Customer | null): void;
}>();

const shop = computed(() => usePage<SharedProps>().props.shop);
const totals = computed(() => saleTotals(props.lines, props.discount, shop.value));
const subtotal = computed(() => totals.value.subtotal);
const discountAmt = computed(() => totals.value.discount);
const total = computed(() => totals.value.total);
const count = computed(() => props.lines.reduce((s, l) => s + l.qty, 0));
const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/** The line whose note box is open, by key; one at a time. */
const noting = ref<string | null>(null);
/**
 * Open or close a line's note box.
 * @param key The line.
 */
function toggleNote(key: string) {
	noting.value = noting.value === key ? null : key;
}

// Discount editor (popover): % or fixed amount, plus quick % buttons
const editOpen = ref(false);
const type = ref<"percent" | "fixed">("percent");
const value = ref("");
watch(editOpen, (o) => {
  if (!o) return;
  const d = props.discount?.type === "coupon" ? null : props.discount; // a code isn't editable as a number
  type.value = d?.type ?? "percent";
  value.value = d ? (d.type === "percent" ? String(d.value) : fromCents(d.value)) : "";
  code.value = "";
  codeError.value = "";
});
const parsed = computed(() => (type.value === "percent" ? Math.min(100, Math.max(0, Math.floor(Number(value.value) || 0))) : Math.max(0, toCents(value.value))));
function apply() {
  emit("update:discount", parsed.value > 0 ? { type: type.value, value: parsed.value } : null);
  editOpen.value = false;
}
function quick(p: number) {
  type.value = "percent";
  value.value = String(p);
  apply();
}
// Discount code: the server says what it takes off (POST /pos/coupon); one discount per sale, so a code replaces a manual % and vice versa
const code = ref("");
const codeError = ref("");
const applying = ref(false);
async function applyCode() {
  applying.value = true;
  codeError.value = "";
  const r = await quoteCoupon(props.lines, props.customer?.id ?? null, code.value);
  applying.value = false;
  if (r.error) { codeError.value = r.error; return; }
  emit("update:discount", { type: "coupon", quote: r.quote });
  editOpen.value = false;
}
/**
 * The `pos.cart` extension slot (the extension guide › Slots): under the
 * customer row. An extension reads who is buying and may apply a code.
 */
const cartListeners = new Set<() => void>();
const cartSlot = {
	customer: () =>
		props.customer
			? {
					id: props.customer.id,
					name: props.customer.name,
					phone: props.customer.phone ?? null,
				}
			: null,
	code: () =>
		props.discount?.type === "coupon" ? props.discount.quote.code : null,
	onChange(fn: () => void) {
		cartListeners.add(fn);
		return () => cartListeners.delete(fn);
	},
	applyCode: applySlotCode,
};
/**
 * Apply a discount code for an extension, like the cashier typing it.
 * @param slotCode The code.
 * @returns Null when it was applied, else why not.
 */
async function applySlotCode(slotCode: string) {
	const r = await quoteCoupon(
		props.lines,
		props.customer?.id ?? null,
		String(slotCode),
	);
	if (r.error) return r.error;
	emit("update:discount", { type: "coupon", quote: r.quote });
	return null;
}
watch(
	() => [props.customer?.id, cartSlot.code()],
	function tellSlot() {
		for (const fn of cartListeners) fn();
	},
);
const couponLabel = computed(() => {
  const q = props.discount?.type === "coupon" ? props.discount.quote : null;
  if (!q) return "";
  return (
    q.description ||
    (q.type === "percent"
      ? t("pos.percent_off", { value: q.value })
      : t("pos.amount_off", { amount: money(q.value, props.currency) }))
  );
});
const discountLabel = computed(function label() {
  const d = props.discount;
  if (d?.type === "coupon") return d.quote.code;
  if (d?.type === "percent") return t("pos.percent_off", { value: d.value });
  return t("common.discount");
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <ShoppingCart class="size-4 text-muted-foreground" />
      <h2 class="font-semibold tracking-tight">{{ t("pos.cart") }}</h2>
      <Badge v-if="count" variant="secondary" class="tabular-nums">{{ count }}</Badge>
      <AlertDialog v-if="lines.length">
        <AlertDialogTrigger as-child>
          <Button variant="ghost" size="sm" class="ml-auto h-8 text-muted-foreground">{{ t("pos.clear") }}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t("pos.clear_cart_question") }}</AlertDialogTitle>
            <AlertDialogDescription>{{ t(count === 1 ? "pos.clear_cart_body_one" : "pos.clear_cart_body_other", { count }) }}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{{ t("pos.keep") }}</AlertDialogCancel>
            <AlertDialogAction @click="emit('clear')">{{ t("pos.clear_cart") }}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button v-if="closable" variant="ghost" size="icon-sm" :class="!lines.length && 'ml-auto'" :aria-label="t('pos.close_cart')" @click="emit('close')"><X /></Button>
    </header>

    <!-- Customer -->
    <div v-if="!adding" class="flex h-11 shrink-0 items-center gap-2 border-b px-3 text-sm">
      <template v-if="customer">
        <span class="flex size-6 items-center justify-center rounded-full bg-primary/20"><UserRound class="size-3.5" /></span>
        <span class="min-w-0 flex-1 truncate font-medium">{{ customer.name }}<span v-if="customer.phone" class="font-normal text-muted-foreground"> · {{ customer.phone }}</span></span>
        <Button variant="ghost" size="sm" class="h-7 text-muted-foreground" @click="emit('pickCustomer')">{{ t("pos.change_customer") }}</Button>
        <Button variant="ghost" size="icon-sm" :aria-label="t('pos.remove_customer')" @click="emit('update:customer', null)"><X /></Button>
      </template>
      <Button v-else variant="ghost" size="sm" class="h-8 -ml-1 text-muted-foreground" @click="emit('pickCustomer')"><UserRoundPlus /> {{ t("pos.add_customer") }}</Button>
    </div>

    <ExtensionSlot v-if="!adding" name="pos.cart" :context="cartSlot" class="shrink-0 gap-0!" />

    <div v-if="!lines.length" class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <span class="flex size-12 items-center justify-center rounded-full bg-muted"><ShoppingCart class="size-5 text-muted-foreground" /></span>
      <p class="text-sm font-medium">{{ t("pos.cart_empty") }}</p>
      <p class="text-sm text-muted-foreground">{{ t("pos.cart_empty_body") }}</p>
    </div>

    <ul v-else class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      <li v-for="l in lines" :key="l.key" class="flex gap-3 rounded-xl border bg-card p-2.5">
        <!-- Thumbnail -->
        <!-- mouse-only twin of the name button below (one accessible "Edit …" per line) -->
        <button type="button" tabindex="-1" aria-hidden="true" class="size-14 shrink-0 overflow-hidden rounded-lg bg-muted" @click="emit('edit', l.key)">
          <img v-if="l.image" :src="l.image" :alt="l.name" loading="lazy" decoding="async" class="size-full object-cover" />
          <span v-else class="flex size-full items-center justify-center bg-gradient-to-br from-muted to-accent text-lg font-semibold text-muted-foreground/60">
            {{ initial(l.name) }}
          </span>
        </button>

        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <!-- Name + line total -->
          <div class="flex items-start justify-between gap-2">
            <button type="button" class="min-w-0 rounded-sm text-left hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" :aria-label="t('pos.edit_line', { name: l.name })" @click="emit('edit', l.key)">
              <p class="truncate text-sm leading-tight font-medium">{{ l.name }}</p>
              <p class="truncate text-xs text-muted-foreground">
                <span v-if="l.variant_name">{{ l.variant_name }} · </span>{{ money(l.price, currency) }}
                <span v-if="l.stock !== null && l.qty >= l.stock" class="text-amber-600 dark:text-amber-400"> · {{ t("pos.last_n", { count: l.stock }) }}</span>
              </p>
            </button>
            <span class="shrink-0 text-sm font-semibold tabular-nums">{{ money(l.price * l.qty, currency) }}</span>
          </div>

          <!-- the line's note: shown under the name, edited in a box the note button opens -->
          <p v-if="l.note && noting !== l.key" class="flex gap-1.5 text-xs leading-snug text-muted-foreground" data-line-note>
            <MessageSquare class="mt-0.5 size-3 shrink-0" /><span class="min-w-0 break-words">{{ l.note }}</span>
          </p>
          <Textarea v-if="noting === l.key" :model-value="l.note ?? ''" rows="2" maxlength="1000" autofocus class="min-h-0 text-sm"
            :placeholder="t('pos.note_placeholder')" :aria-label="t('pos.note_for', { name: l.name })"
            @update:model-value="(v: string | number) => emit('setNote', l.key, String(v))"
            @keydown.enter.exact.prevent="noting = null" @blur="noting = null" />

          <!-- Qty stepper + note + remove -->
          <div class="flex items-center justify-between">
            <div class="inline-flex h-8 items-center rounded-md border">
              <Button variant="ghost" size="icon" class="size-8 rounded-r-none" :aria-label="t('pos.decrease_line', { name: l.name })" @click="emit('setQty', l.key, l.qty - 1)">
                <Minus class="size-3.5" />
              </Button>
              <span class="min-w-8 border-x text-center text-sm font-medium tabular-nums leading-8">{{ l.qty }}</span>
              <Button variant="ghost" size="icon" class="size-8 rounded-l-none" :aria-label="t('pos.increase_line', { name: l.name })" :disabled="l.stock !== null && l.qty >= l.stock" @click="emit('setQty', l.key, l.qty + 1)">
                <Plus class="size-3.5" />
              </Button>
            </div>
            <div class="flex items-center">
              <Button variant="ghost" size="icon" class="size-8" :class="l.note ? 'text-primary' : 'text-muted-foreground'"
                :aria-label="t('pos.note_for', { name: l.name })" :aria-pressed="noting === l.key" @mousedown.prevent @click="toggleNote(l.key)">
                <MessageSquare class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-destructive"
                :aria-label="t('pos.remove_line', { name: l.name })" @click="emit('remove', l.key)">
                <Trash2 class="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </li>
    </ul>

    <footer class="shrink-0 space-y-3 border-t bg-muted/30 p-4">
      <dl class="space-y-1 text-sm">
        <div class="flex justify-between text-muted-foreground">
          <dt>{{ t("pos.items") }}</dt><dd class="tabular-nums">{{ count }}</dd>
        </div>
        <div class="flex justify-between text-muted-foreground">
          <dt>{{ t("common.subtotal") }}</dt><dd class="tabular-nums">{{ money(subtotal, currency) }}</dd>
        </div>
        <div v-if="!adding" class="flex items-center justify-between text-muted-foreground">
          <dt>
            <Popover v-model:open="editOpen">
              <PopoverTrigger as-child>
                <button type="button" class="-ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1 hover:bg-muted hover:text-foreground" :disabled="!lines.length">
                  <Tag class="size-3.5" /> {{ discountLabel }}
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-72 space-y-3" align="start" side="top">
                <p class="text-sm font-medium">{{ t("pos.discount_on_sale") }}</p>
                <div class="flex gap-2">
                  <div class="inline-flex h-9 shrink-0 rounded-md border p-0.5">
                    <button type="button" class="rounded px-2.5 text-sm" :class="type === 'percent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'" @click="type = 'percent'"><Percent class="size-3.5" /></button>
                    <button type="button" class="rounded px-2.5 text-sm tabular-nums" :class="type === 'fixed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'" @click="type = 'fixed'">{{ money(0, currency).replace(/[\d.,\s]/g, "") || currency }}</button>
                  </div>
                  <Input v-model="value" inputmode="decimal" class="h-9 min-w-0 flex-1 tabular-nums" :placeholder="type === 'percent' ? '10' : '0.00'" @keydown.enter.prevent="apply" />
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <Button v-for="p in [5, 10, 15, 20]" :key="p" variant="outline" size="sm" @click="quick(p)">{{ p }}%</Button>
                </div>
                <div class="space-y-1.5 border-t pt-3">
                  <Label for="cart-coupon" class="text-xs text-muted-foreground">{{ t("pos.discount_code") }}</Label>
                  <div v-if="discount?.type === 'coupon'" class="text-sm" data-coupon-applied>
                    <span class="font-mono">{{ discount.quote.code }}</span>
                    <span class="block text-xs text-muted-foreground">{{ couponLabel }}</span>
                  </div>
                  <div v-else class="flex gap-2">
                    <Input id="cart-coupon" v-model="code" autocomplete="off" autocapitalize="characters" :placeholder="t('pos.enter_code')" class="h-9 min-w-0 flex-1 font-mono uppercase" :aria-invalid="!!codeError" @keydown.enter.prevent="applyCode" />
                    <Button variant="outline" size="sm" class="h-9 shrink-0" :disabled="!code.trim() || applying" @click="applyCode">{{ t("pos.apply_code") }}</Button>
                  </div>
                  <p v-if="codeError" class="text-xs text-destructive">{{ codeError }}</p>
                </div>
                <div class="flex justify-between">
                  <Button variant="ghost" size="sm" :disabled="!discount" @click="emit('update:discount', null); editOpen = false">{{ t("common.remove") }}</Button>
                  <Button size="sm" @click="apply">{{ t("pos.apply") }}</Button>
                </div>
              </PopoverContent>
            </Popover>
          </dt>
          <dd class="tabular-nums" :class="discountAmt ? 'text-foreground' : ''">{{ discountAmt ? "−" + money(discountAmt, currency) : "—" }}</dd>
        </div>
        <div v-if="totals.tax && shop" class="flex justify-between text-muted-foreground">
          <dt>{{ taxLabel(shop, t("common.tax_included_prefix")) }}</dt><dd class="tabular-nums" data-tax>{{ money(totals.tax, currency) }}</dd>
        </div>
        <div class="flex justify-between border-t pt-2 text-base font-semibold">
          <dt>{{ t("common.total") }}</dt><dd class="tabular-nums">{{ money(total, currency) }}</dd>
        </div>
      </dl>
      <Button class="h-12 w-full text-base" :disabled="!lines.length" @click="emit('charge')">
        {{ t(adding ? "pos.add_to_order" : "pos.charge", { amount: money(total, currency) }) }}
      </Button>
    </footer>
  </div>
</template>
