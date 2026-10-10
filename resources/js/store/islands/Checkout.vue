<script setup lang="ts">
import {
	computed,
	onBeforeUnmount,
	onMounted,
	reactive,
	ref,
	watch,
} from "vue";
import { Loader2, ShoppingBag, X } from "@lucide/vue";
import { watchDebounced } from "@vueuse/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AddressFields from "@/components/store/AddressFields.vue";
import { t } from "@/lib/i18n";
import { lineKey } from "@/lib/bundles";
import { taxAmount, taxLabel } from "@helpers/tax";
import {
	customerErrors,
	deliveryFee,
	deliveryZone,
	undeliverable,
	type StoreCustomerField,
} from "@validators/StoreCustomer.Validator";
import type { Key } from "@i18n";
import type {
	CustomerAddress,
	RestoredLine,
	StoreCouponQuote,
	StoreInfo,
} from "@/types";
import type { StoreCartEvent, StoreCartLine } from "../types";
import { checkout, quoteCoupon, type StoreCustomer } from "../checkout-api";
import { noteKey } from "../cart";

/**
 * The shared checkout page: who is buying and where it goes, then "Pay".
 * A client-only island inside `store/checkout.edge` (the theme draws the frame).
 * The cart is `window.Store.cart` (localStorage); the look comes from the
 * theme's `--store-*` variables (resources/css/store-island.css).
 * A guest's details are remembered in localStorage, per shop (`store-customer:<slug>`);
 * a signed-in customer's come from their account instead.
 */
const props = defineProps<{
	/** The shop (storeInfo): zones, tax, payments, customer, … */
	store: StoreInfo;
	/** The shop country's states when its postal codes are downloaded, else []. */
	states?: string[];
	/** The cart from an abandoned-cart link (/cart/<token>): it replaces the cart. */
	restore?: (RestoredLine | StoreCartLine)[] | null;
}>();
const Store = window.Store;
const currency = props.store.currency;

/**
 * Money in the shop's own currency: the checkout charges in it.
 * @param cents The amount.
 * @returns The formatted amount.
 */
function money(cents: number) {
	return Store.moneyIn(cents, currency);
}

/**
 * A line from the "Complete your order" link, as a cart line.
 * Price and stock are checked again at the checkout.
 * @param l The restored line (the server's shape, or a full cart line).
 * @returns The cart line.
 */
function restoredLine(l: RestoredLine | StoreCartLine): StoreCartLine {
	const full = l as Partial<StoreCartLine>;
	return {
		key:
			full.key ??
			noteKey(lineKey(l.product_id, l.variant_id, full.choices), l.note),
		product_id: l.product_id,
		variant_id: l.variant_id,
		name: l.name,
		variant_name: full.variant_name ?? null,
		image: l.image,
		price: l.price,
		qty: l.qty,
		stock: full.stock ?? null,
		choices: full.choices ?? {},
		slug: full.slug,
		...(l.note ? { note: l.note } : {}),
	};
}

// the cart, kept in step with window.Store through its `store:cart` event
const lines = ref<StoreCartLine[]>(Store.cart.lines());
const subtotal = computed(() =>
	lines.value.reduce(function sum(n, l) {
		return n + l.price * l.qty;
	}, 0),
);

/**
 * Follow every cart change (another tab, the theme's drawer).
 * @param e The `store:cart` event.
 */
function onCart(e: Event) {
	lines.value = (e as StoreCartEvent).detail.lines;
}

const checkingOut = ref(false);
const error = ref("");

/**
 * Checking out ended on this page: stop the spinner, show why.
 * @param message The message ("" = none).
 */
function stop(message: string) {
	checkingOut.value = false;
	error.value = message;
}

/** Per shop: one shop's buyer details (a country it delivers to) must never fill another shop's checkout. */
const CUSTOMER_KEY = `store-customer:${props.store.slug}`;
const form = reactive<StoreCustomer>({
	name: "",
	phone: "",
	email: "",
	address_1: "",
	address_2: "",
	city: "",
	state: "",
	country: "",
	postal_code: "",
});
const errors = ref<Partial<Record<StoreCustomerField, string>>>({});
// pick up in store (when the shop offers it): no fee and no address
const pickup = ref(false);
// a signed-in buyer keeps this address on the account (on by default)
const saveAddress = ref(true);
// no country picked yet = the shop's own; the fee rule is the server's own
const to = computed(() => ({
	country: form.country || props.store.country || "",
	state: form.state,
	city: form.city,
}));
const zone = computed(() => deliveryZone(props.store.delivery_zones, to.value));
const fee = computed(() =>
	pickup.value ? 0 : deliveryFee(props.store, to.value, subtotal.value),
);
// "Add $X more for free delivery" while the goods are under the threshold
const freeFrom = computed(() =>
	pickup.value || !zone.value || zone.value.free_delivery_min === null
		? 0
		: Math.max(0, zone.value.free_delivery_min - subtotal.value),
);

/**
 * Discount code (one per order).
 * "Apply" asks the server, which runs the checkout's own rules.
 * The answer is asked again when the email, the place or the cart changes.
 */
const couponCode = ref("");
const applied = ref<StoreCouponQuote | null>(null);
const couponError = ref("");
const applying = ref(false);

/**
 * Ask the server what a code takes off.
 * @param code The code (default: what is typed in the box).
 */
async function applyCoupon(code = couponCode.value) {
	code = code.trim();
	if (!code || applying.value) return;
	applying.value = true;
	couponError.value = "";
	const r = await quoteCoupon(
		props.store.base,
		lines.value,
		code,
		{
			email: form.email,
			country: form.country,
			state: form.state,
			city: form.city,
			postal_code: form.postal_code,
		},
		pickup.value,
	);
	applying.value = false;
	if (r.quote) {
		applied.value = r.quote;
		couponCode.value = "";
	} else {
		applied.value = null;
		couponCode.value = code;
		couponError.value = r.error ?? "";
	}
}

/**
 * Drop the applied code.
 */
function removeCoupon() {
	applied.value = null;
	couponCode.value = "";
	couponError.value = "";
}

/**
 * Ask again for the applied code after a change that may alter it.
 */
function requote() {
	if (applied.value) applyCoupon(applied.value.code);
}
watchDebounced(
	[
		() => form.email,
		() => form.country,
		() => form.state,
		() => form.city,
		() => form.postal_code,
		pickup,
		subtotal,
	],
	requote,
	{ debounce: 400 },
);

const couponLabel = computed(() => {
	const a = applied.value;
	if (!a) return "";
	if (a.type === "percent") return t("store.percent_off", { value: a.value });
	if (a.type === "fixed")
		return t("store.amount_off", { amount: money(a.value) });
	return t("store.free_delivery");
});
const discount = computed(() => applied.value?.discount ?? 0);
// the quote waives the fee; otherwise the place decides it
const feeAfter = computed(() =>
	applied.value?.type === "free_delivery" ? 0 : fee.value,
);
// the server works the tax out the same way at checkout
const tax = computed(() =>
	taxAmount(subtotal.value - discount.value, props.store),
);
const total = computed(
	() =>
		subtotal.value -
		discount.value +
		(props.store.tax_included ? 0 : tax.value) +
		(feeAfter.value ?? 0),
);

// how to pay: the online provider first, then the manual options that are on
const payments = props.store.payments ?? [];
const payment = ref(payments[0]?.manual ? payments[0].key : "");

/**
 * Is this the payment option picked?
 * @param p The option.
 * @returns true when picked.
 */
function isPicked(p: { key: string; manual: boolean }) {
	return p.manual ? p.key === payment.value : payment.value === "";
}
const chosen = computed(() => payments.find(isPicked) ?? null);

/**
 * The name of a payment option: cash on delivery is paid at pick-up when nothing is delivered.
 * The server names the order the same way.
 * @param p The option.
 * @returns The name to show.
 */
function payLabel(p: { key: string; manual: boolean; label: string }) {
	return p.manual && p.key === "cod" && pickup.value
		? t("store.pay_at_pickup")
		: p.label;
}

// a signed-in buyer's saved addresses: one tap fills the boxes (and phone)
const saved = props.store.customer?.addresses ?? [];
const ADDRESS_KEYS = [
	"address_1",
	"address_2",
	"city",
	"state",
	"country",
	"postal_code",
] as const;

/**
 * Fill the boxes from a saved address.
 * @param a The address.
 */
function useAddress(a: CustomerAddress) {
	for (const k of ADDRESS_KEYS) form[k] = a[k];
	if (a.phone) form.phone = a.phone;
}

/**
 * Do the boxes hold this saved address?
 * @param a The address.
 * @returns true when every field matches.
 */
function picked(a: CustomerAddress) {
	return ADDRESS_KEYS.every(function same(k) {
		return form[k] === a[k];
	});
}

/**
 * Put the abandoned cart in place and move on to the plain checkout URL,
 * so a reload does not restore it again.
 */
function restoreCart() {
	const restore = props.restore ?? Store.data.restore;
	if (!restore?.length) return;
	Store.cart.replace(restore.map(restoredLine));
	lines.value = Store.cart.lines();
	history.replaceState(history.state, "", `${props.store.base}/checkout`);
}

/**
 * Prefill the buyer: a signed-in customer from the account,
 * a guest from what this device remembered.
 */
function prefill() {
	const me = props.store.customer;
	if (me) {
		if (me.name) form.name = me.name;
		if (me.phone) form.phone = me.phone;
		if (me.email) form.email = me.email;
		if (saved[0]) useAddress(saved[0]);
		return;
	}
	try {
		const kept = JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? "{}");
		for (const k of Object.keys(form) as StoreCustomerField[])
			if (typeof kept[k] === "string") form[k] = kept[k];
	} catch {
		// ponytail: corrupt or blocked storage = an empty form
	}
}

onMounted(function mounted() {
	document.addEventListener("store:cart", onCart);
	restoreCart();
	prefill();
});
onBeforeUnmount(function unmounted() {
	document.removeEventListener("store:cart", onCart);
});

/**
 * Ask the theme to open its sign-in dialog.
 */
function signIn() {
	document.dispatchEvent(new CustomEvent("store:login"));
}

// validation: on Pay, then live on every change once the buyer tried
const tried = ref(false);

/**
 * The server's own schema, plus the one rule it can't know:
 * the shop doesn't deliver there. Both are keys, translated here.
 * @returns The message per field.
 */
function validate() {
	const keys = customerErrors(form, pickup.value);
	const bad = pickup.value
		? null
		: undeliverable(props.store.delivery_zones, to.value);
	const found: Partial<Record<StoreCustomerField, string>> = {};
	for (const [field, key] of Object.entries(keys) as [
		StoreCustomerField,
		Key,
	][])
		found[field] = t(key);
	if (bad) found[bad.field] ??= t(bad.key, bad.params);
	return found;
}

/**
 * Check again after a change, once the buyer tried to pay.
 */
function revalidate() {
	if (tried.value) errors.value = validate();
}
watch([form, pickup], revalidate);

/**
 * The id of a field's box: the buyer's own boxes are `co-*`,
 * the address boxes (AddressFields) are `addr-*`.
 * @param field The field.
 * @returns The element id.
 */
function fieldId(field: StoreCustomerField) {
	const dashed = field.replace(/_/g, "-");
	return ["name", "phone", "email"].includes(field)
		? `co-${dashed}`
		: `addr-${dashed}`;
}

/**
 * Pay: check the form, remember a guest, then send it all.
 */
async function pay() {
	if (!lines.value.length || checkingOut.value) return;
	tried.value = true;
	errors.value = validate();
	const first = (Object.keys(form) as StoreCustomerField[]).find(
		function bad(k) {
			return errors.value[k];
		},
	);
	if (first) return document.getElementById(fieldId(first))?.focus();
	if (!props.store.customer) {
		try {
			localStorage.setItem(CUSTOMER_KEY, JSON.stringify(form));
		} catch {
			// private mode etc. — still pay
		}
	}
	checkingOut.value = true;
	error.value = "";
	// the server checks again; its field errors come back as `customer.<field>`
	const server = await checkout(
		props.store.base,
		props.store.name,
		{
			lines: lines.value,
			customer: { ...form },
			payment: payment.value,
			coupon: applied.value?.code ?? "",
			pickup: pickup.value,
			saveAddress: saveAddress.value,
		},
		stop,
	);
	for (const [k, v] of Object.entries(server))
		if (k.startsWith("customer."))
			errors.value[k.slice("customer.".length) as StoreCustomerField] = v;
	if (server.coupon) {
		// the code stopped working between "Apply" and "Pay": drop it, say why
		couponCode.value = applied.value?.code ?? "";
		applied.value = null;
		couponError.value = server.coupon;
	}
}
</script>

<template>
  <div v-if="!lines.length" class="rounded-lg border bg-card p-8 text-center text-card-foreground">
    <ShoppingBag class="mx-auto size-10 opacity-30" />
    <p class="mt-3 font-medium">{{ t("store.cart_empty") }}</p>
    <a :href="store.base || '/'" class="mt-2 inline-block text-sm text-muted-foreground underline">{{ t("store.back_to_the_shop") }}</a>
  </div>
  <form v-else class="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_360px]" novalidate @submit.prevent="pay">
    <!-- Who + where -->
    <section class="min-w-0 space-y-4 rounded-lg border bg-card p-6 text-card-foreground">
      <h2 class="island-heading font-semibold">{{ t("store.your_details") }}</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <Label for="co-name">{{ t("common.name") }}</Label>
          <Input id="co-name" v-model="form.name" name="name" autocomplete="name" :aria-invalid="!!errors.name" />
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>
        <div class="space-y-1.5">
          <Label for="co-phone">{{ t("store.phone_number") }}</Label>
          <Input id="co-phone" v-model="form.phone" name="phone" type="tel" autocomplete="tel" :aria-invalid="!!errors.phone" />
          <p v-if="errors.phone" class="text-xs text-destructive">{{ errors.phone }}</p>
        </div>
      </div>
      <div class="space-y-1.5">
        <Label for="co-email">{{ t("common.email") }}</Label>
        <Input id="co-email" v-model="form.email" name="email" type="email" autocomplete="email" :readonly="!!store.customer?.email" :aria-invalid="!!errors.email" :class="store.customer?.email && 'cursor-not-allowed opacity-70'" />
        <p v-if="errors.email" class="text-xs text-destructive">{{ errors.email }}</p>
        <p v-if="store.customer" class="text-xs text-muted-foreground">{{ t("store.signed_in_order_shows", { email: store.customer.email }) }} <a :href="`${store.base}/account`" class="underline">{{ t("store.your_account") }}</a>.</p>
        <p v-else-if="store.login" class="text-xs text-muted-foreground">{{ t("store.receipt_goes_here") }} {{ t("store.have_account") }} <button type="button" class="underline" @click="signIn">{{ t("store.sign_in") }}</button> {{ t("store.signin_to_fill") }}</p>
        <p v-else class="text-xs text-muted-foreground">{{ t("store.receipt_goes_here") }}</p>
      </div>
      <!-- how to get it (only when the shop offers pick-up) -->
      <fieldset v-if="store.pickup" class="space-y-2 pt-2">
        <legend class="mb-2 text-sm font-semibold">{{ t("store.how_to_get") }}</legend>
        <label class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm" :class="!pickup && 'ring-1 ring-current'">
          <input v-model="pickup" type="radio" name="pickup" :value="false" class="accent-current" />
          <span class="font-medium">{{ t("store.delivery") }}</span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" :class="pickup && 'ring-1 ring-current'">
          <input v-model="pickup" type="radio" name="pickup" :value="true" class="mt-0.5 accent-current" />
          <span class="min-w-0">
            <span class="block font-medium">{{ t("store.pickup") }}</span>
            <span class="block text-xs text-muted-foreground">{{ t("store.pickup_free", { place: store.address || t("store.pickup_tbd") }) }}</span>
          </span>
        </label>
      </fieldset>
      <template v-if="!pickup">
        <h3 class="island-heading pt-2 text-sm font-semibold">{{ t("store.delivery_address") }}</h3>
        <div v-if="saved.length" class="grid gap-2 sm:grid-cols-2" role="group" :aria-label="t('store.saved_addresses')">
          <button v-for="a in saved" :key="a.id" type="button" class="rounded-lg border p-3 text-left text-sm transition-opacity" :class="picked(a) ? 'ring-2 ring-current' : 'opacity-70 hover:opacity-100'" :aria-pressed="picked(a)" @click="useAddress(a)">
            <span class="block font-medium">{{ a.label || a.address_1 }}</span>
            <span class="block text-xs text-muted-foreground">{{ [a.address_1, a.city, a.country].filter(Boolean).join(", ") }}<template v-if="a.phone"> · {{ a.phone }}</template></span>
          </button>
        </div>
        <!-- the same boxes as the account page: guided State → City lists when the shop has them -->
        <AddressFields :store="store" :form="form" :errors="errors" :states="states" />
      </template>
      <label v-if="store.customer && !pickup" class="flex cursor-pointer items-center gap-2 text-sm">
        <input v-model="saveAddress" type="checkbox" class="size-4 accent-current" />
        {{ t("store.save_address_next") }}
      </label>
      <p v-else-if="!store.customer" class="text-xs text-muted-foreground">{{ t("store.remembered_on_device") }}</p>
    </section>

    <!-- What -->
    <aside class="h-fit min-w-0 space-y-4 rounded-lg border bg-card p-6 text-card-foreground">
      <h2 class="island-heading font-semibold">{{ t("store.your_order") }}</h2>
      <!-- payment option (only when there is more than one) -->
      <fieldset v-if="payments.length > 1" class="space-y-2">
        <legend class="mb-2 text-sm font-medium">{{ t("store.pay_with") }}</legend>
        <label v-for="p in payments" :key="p.key" class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" :class="isPicked(p) && 'ring-1 ring-current'">
          <input v-model="payment" type="radio" name="payment" :value="p.manual ? p.key : ''" class="mt-0.5 accent-current" />
          <span class="min-w-0">
            <span class="block font-medium">{{ payLabel(p) }}</span>
            <span v-if="p.instructions && isPicked(p)" class="mt-1 block text-xs whitespace-pre-line text-muted-foreground">{{ p.instructions }}</span>
          </span>
        </label>
      </fieldset>
      <p v-else-if="chosen?.instructions" class="rounded-lg border p-3 text-xs whitespace-pre-line text-muted-foreground">{{ chosen.instructions }}</p>
      <ul class="divide-y text-sm">
        <li v-for="l in lines" :key="l.key" class="flex items-start justify-between gap-3 py-2">
          <span class="min-w-0">
            <span class="block truncate font-medium">{{ l.name }}</span>
            <span v-if="l.variant_name" class="block text-xs text-muted-foreground">{{ l.variant_name }}</span>
            <span v-if="l.note" class="block text-xs whitespace-pre-line break-words text-muted-foreground" data-line-note>{{ t("store_ui.custom_request") }}: {{ l.note }}</span>
            <span class="block text-xs text-muted-foreground">{{ l.qty }} × {{ money(l.price) }}</span>
          </span>
          <span class="shrink-0 tabular-nums">{{ money(l.price * l.qty) }}</span>
        </li>
      </ul>
      <!-- discount code (one per order) -->
      <div class="space-y-1.5 border-t pt-3">
        <div v-if="applied" class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm" data-coupon-applied>
          <span class="min-w-0">
            <span class="block font-mono font-medium">{{ applied.code }}</span>
            <span class="block text-xs text-muted-foreground">{{ applied.description || couponLabel }}</span>
          </span>
          <button type="button" class="shrink-0 rounded-md p-1 hover:bg-current/10" :aria-label="t('store.remove_code')" @click="removeCoupon"><X class="size-4" /></button>
        </div>
        <template v-else>
          <Label for="co-coupon">{{ t("store.discount_code") }}</Label>
          <div class="flex gap-2">
            <Input id="co-coupon" v-model="couponCode" name="coupon" autocomplete="off" autocapitalize="characters" :placeholder="t('store.enter_code')" class="font-mono uppercase" :aria-invalid="!!couponError" @keydown.enter.prevent="applyCoupon()" />
            <Button type="button" variant="outline" class="shrink-0" :disabled="!couponCode.trim() || applying" @click="applyCoupon()"><Loader2 v-if="applying" class="animate-spin" /> {{ t("store.apply") }}</Button>
          </div>
        </template>
        <p v-if="couponError" class="text-xs text-destructive">{{ couponError }}</p>
      </div>
      <div v-if="discount" class="flex items-center justify-between border-t pt-3 text-sm text-muted-foreground">
        <span>{{ t("common.discount") }}</span>
        <span class="tabular-nums" data-discount>−{{ money(discount) }}</span>
      </div>
      <div v-if="tax" class="flex items-center justify-between text-sm text-muted-foreground" :class="!discount && 'border-t pt-3'">
        <span>{{ taxLabel(store, t("common.tax_included_prefix")) }}</span>
        <span class="tabular-nums" data-tax>{{ money(tax) }}</span>
      </div>
      <div class="flex items-center justify-between text-sm text-muted-foreground" :class="!discount && !tax && 'border-t pt-3'">
        <span>{{ t(pickup ? "store.pickup" : "store.delivery") }}</span>
        <span class="tabular-nums">{{ feeAfter === null ? "—" : feeAfter ? money(feeAfter) : t("store.free") }}</span>
      </div>
      <p v-if="freeFrom" class="text-xs text-muted-foreground" data-free-delivery>{{ t("store.free_delivery_add", { amount: money(freeFrom) }) }}</p>
      <div class="flex items-center justify-between text-base font-semibold">
        <span>{{ t("common.total") }}</span>
        <span class="tabular-nums">{{ money(total) }}</span>
      </div>
      <!-- display only: the buyer browsed in another currency, the payment is in the shop's own -->
      <p v-if="store.display" class="text-xs text-muted-foreground" data-currency-note>{{ t("store.charged_in", { approx: Store.money(total), currency }) }}</p>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <Button type="submit" class="island-primary h-12 w-full text-base" :disabled="checkingOut || !lines.length">
        <Loader2 v-if="checkingOut" class="animate-spin" /> {{ t(chosen?.manual ? "store.place_order" : "store.pay") }} {{ money(total) }}
      </Button>
      <p v-if="chosen?.manual" class="text-center text-xs text-muted-foreground">{{ t("store.pay_by", { method: payLabel(chosen).toLowerCase() }) }}</p>
      <p v-else class="text-center text-xs text-muted-foreground">{{ t("store.secure_payment_by", { gateway: store.payment_label }) }}</p>
    </aside>
  </form>
</template>
