<script setup lang="ts">
// The customer's screen: the Sell screen's cart and total, for a second monitor on the same computer.
// No server and no websocket: the Sell screen keeps the cart in localStorage, and the browser tells
// every other window of the same site when it changes (the `storage` event).
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Head, usePage } from "@inertiajs/vue3";
import { UserRound } from "@lucide/vue";
import { taxLabel } from "@helpers/tax";
import ExtensionSlot from "@/components/ExtensionSlot.vue";
import ShopLogo from "@/components/ShopLogo.vue";
import { saleTotals, type SavedCart } from "@/components/pos/CartPanel.vue";
import {
	DISPLAY_FULLSCREEN,
	DISPLAY_SHOP,
	type DisplayPayment,
	displayContext,
	displaySale,
	parseCart,
	paymentKey,
} from "@/lib/display";
import { money } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SharedProps } from "@/types";

// no layout: the customer sees only the sale. Always the light theme (pinned in app/xcore/view/Inertia.ts).

const page = usePage<SharedProps>();
const shop = computed(() => page.props.shop);
const currency = computed(() => shop.value?.currency ?? "USD");
// the Sell screen's key; a cart meant for an order has a longer one (`cart:<shop>:order:<id>`)
const cartKey = `cart:${shop.value?.id ?? 0}`;

/**
 * Read a saved cart.
 * @param raw The stored JSON, or null when the key is gone.
 * @returns The cart, or null when there is none or it can't be read.
 */
function parse(raw: string | null) {
	return parseCart<SavedCart>(raw);
}

const saved = ref<SavedCart | null>(parse(localStorage.getItem(cartKey)));

// The payment method picked in a pay dialog and the cents asked for,
// written by components/pos/PaymentMethodPicker.vue while the dialog asks for the money.
const paymentStore = paymentKey(shop.value?.id ?? 0);
/**
 * Read the picked payment method.
 * @param raw The stored JSON, or null when the key is gone.
 * @returns The method and the amount, or null when there is none or it can't be read.
 */
function parsePayment(raw: string | null): DisplayPayment | null {
	try {
		const p = JSON.parse(raw ?? "null");
		if (typeof p?.name !== "string") return null;
		return {
			name: p.name,
			image: typeof p.image === "string" ? p.image : null,
			extension: typeof p.extension === "string" ? p.extension : null,
			amount: Number.isSafeInteger(p.amount) ? p.amount : 0,
		};
	} catch {
		return null;
	}
}
const payment = ref<DisplayPayment | null>(
	parsePayment(localStorage.getItem(paymentStore)),
);

/**
 * Another window changed the storage: show the cart it wrote.
 * A cart that was emptied falls back to the unfinished sale.
 * @param e The browser's storage event.
 */
function onStorage(e: StorageEvent) {
	// the Sell screen moved to another shop: load this window again, the server then gives that shop and its cart
	if (
		e.key === DISPLAY_SHOP &&
		e.newValue &&
		e.newValue !== String(shop.value?.id ?? 0)
	)
		return window.location.reload();
	if (e.key === paymentStore || e.key === null)
		payment.value = parsePayment(e.newValue);
	if (e.key === cartKey || e.key?.startsWith(`${cartKey}:`) || e.key === null)
		saved.value = parse(e.newValue) ?? parse(localStorage.getItem(cartKey));
}
onMounted(function listen() {
	window.addEventListener("storage", onStorage);
});
onUnmounted(function stop() {
	window.removeEventListener("storage", onStorage);
});

const sale = computed(() =>
	displaySale(
		saved.value?.cart ?? [],
		saleTotals(
			saved.value?.cart ?? [],
			saved.value?.discount ?? null,
			shop.value,
		),
		saved.value?.customer?.name ?? null,
		currency.value,
	),
);

// Full screen needs a click (a browser rule): the first click or tap anywhere here asks for it,
// and so does the cashier's next click on the Sell screen, which is passed on to this window.
const fullscreen = ref(!!document.fullscreenElement);
/**
 * Go full screen, unless the window already is.
 */
function goFullscreen() {
	if (document.fullscreenElement) return;
	document.documentElement.requestFullscreen().catch(function refused() {
		/* ponytail: not allowed here → the window stays as it is */
	});
}
/**
 * Keep `fullscreen` in step, so the hint goes away and comes back.
 */
function onFullscreen() {
	fullscreen.value = !!document.fullscreenElement;
}
/**
 * The Sell screen passed one of its clicks on (lib/display.ts): go full screen with it.
 * @param e A message from another window.
 */
function onMessage(e: MessageEvent) {
	if (e.origin === window.location.origin && e.data === DISPLAY_FULLSCREEN)
		goFullscreen();
}
onMounted(function watchFullscreen() {
	document.addEventListener("fullscreenchange", onFullscreen);
	window.addEventListener("message", onMessage);
});
onUnmounted(function unwatchFullscreen() {
	document.removeEventListener("fullscreenchange", onFullscreen);
	window.removeEventListener("message", onMessage);
});

// A line that is new, or got more units, flashes and is scrolled into view, so the customer sees what was added.
// `bumps` counts those changes per line: it is part of the row's key, so the row is drawn again and the flash restarts.
const bumps = ref<Record<string, number>>({});
const list = ref<HTMLElement | null>(null);
/**
 * Mark the lines that grew since the last cart, then scroll to the last of them.
 * @param now The cart as it is now.
 * @param before The cart before the change.
 */
async function markAdded(now: SavedCart | null, before: SavedCart | null) {
	const had = new Map((before?.cart ?? []).map((l) => [l.key, l.qty]));
	const added = (now?.cart ?? []).filter((l) => l.qty > (had.get(l.key) ?? 0));
	if (!added.length) return;
	for (const l of added) bumps.value[l.key] = (bumps.value[l.key] ?? 0) + 1;
	await nextTick();
	const rows = list.value?.querySelectorAll("[data-added]");
	rows?.[rows.length - 1]?.scrollIntoView({
		block: "nearest",
		behavior: "smooth",
	});
}
watch(saved, markAdded);

// the `pos.display` extension slot (the extension guide): read only, an extension can't change the cart
/**
 * The picked payment method as an extension gets it.
 * @returns The method's name, the extension that added it and the cents asked for, or null while no pay dialog is open.
 */
function slotPayment() {
	const p = payment.value;
	return p && { method: p.name, extension: p.extension, amount: p.amount };
}
const displaySlot = displayContext(() => sale.value, slotPayment);
const hasSlot = computed(() =>
	(page.props.extension_ui ?? []).some((e) => e.slots["pos.display"]),
);
</script>

<template>
  <Head :title="t('pos.display')" />

  <div class="relative flex h-dvh bg-background text-foreground" @click="goFullscreen">
    <p v-if="!fullscreen" class="pointer-events-none absolute bottom-3 left-6 text-sm text-muted-foreground" data-fullscreen-hint>{{ t("pos.display_fullscreen_hint") }}</p>
    <!-- the big column: extensions (a QR code to pay, advertisements), else the shop's logo and name -->
    <div class="min-w-0 flex-1 overflow-y-auto border-r p-6" data-display-space>
      <!-- the picked payment method's picture (a QR code to pay) takes the column while a pay dialog asks for the money -->
      <div v-if="payment?.image" class="flex h-full flex-col items-center justify-center gap-6 text-center" data-payment>
        <img :src="payment.image" :alt="payment.name" class="max-h-[70%] max-w-full rounded-2xl object-contain" />
        <p class="text-3xl font-semibold">{{ payment.name }} · <span class="tabular-nums">{{ money(payment.amount, currency) }}</span></p>
      </div>
      <!-- v-show: an extension stays mounted under the picture. While no extension draws anything, the shop shows instead (the style below). -->
      <div v-if="hasSlot" v-show="!payment?.image" class="display-slot"><ExtensionSlot name="pos.display" :context="displaySlot" /></div>
      <div v-show="!payment?.image" class="display-shop flex h-full flex-col items-center justify-center gap-6 text-center">
        <ShopLogo :shop="shop" class="size-48" />
        <p class="text-5xl font-semibold">{{ shop?.name }}</p>
      </div>
    </div>

    <main class="flex w-[28rem] max-w-[50%] shrink-0 flex-col" data-display>
      <h1 class="flex shrink-0 items-center gap-3 border-b px-6 py-4 text-xl font-semibold">
        <ShopLogo :shop="shop" class="size-9 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ shop?.name }}</span>
        <span v-if="sale.count" class="shrink-0 text-base font-normal text-muted-foreground tabular-nums" data-count>{{ t("store.items_count", { count: sale.count }) }}</span>
      </h1>
      <p v-if="sale.customer" class="flex shrink-0 items-center gap-2 border-b px-6 py-2 text-lg" data-customer>
        <UserRound class="size-5 shrink-0 text-muted-foreground" /><span class="truncate">{{ sale.customer }}</span>
      </p>

      <p v-if="!sale.lines.length" class="flex flex-1 items-center justify-center p-6 text-2xl text-muted-foreground">{{ t("pos.display_empty") }}</p>

      <template v-else>
        <ul ref="list" class="min-h-0 flex-1 divide-y overflow-x-hidden overflow-y-auto">
          <li v-for="(l, i) in sale.lines" :key="`${saved!.cart[i]!.key}:${bumps[saved!.cart[i]!.key] ?? 0}`"
            class="flex items-center gap-4 px-6 py-3 text-lg" :class="bumps[saved!.cart[i]!.key] && 'display-added'" :data-added="bumps[saved!.cart[i]!.key] ? '' : undefined">
            <img v-if="l.image" :src="l.image" alt="" class="size-14 shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ l.name }}</p>
              <p class="truncate text-base text-muted-foreground">
                <template v-if="l.variant">{{ l.variant }} · </template>{{ l.qty }} × {{ money(l.price, currency) }}
              </p>
              <p v-if="l.note" class="text-base text-muted-foreground italic" data-note>{{ l.note }}</p>
            </div>
            <span class="shrink-0 font-medium tabular-nums">{{ money(l.total, currency) }}</span>
          </li>
        </ul>

        <dl class="shrink-0 space-y-1 border-t px-6 py-4 text-lg">
          <div class="flex justify-between text-muted-foreground">
            <dt>{{ t("common.subtotal") }}</dt><dd class="tabular-nums">{{ money(sale.subtotal, currency) }}</dd>
          </div>
          <div v-if="sale.discount" class="flex justify-between text-muted-foreground">
            <dt>{{ t("common.discount") }}</dt><dd class="tabular-nums">−{{ money(sale.discount, currency) }}</dd>
          </div>
          <div v-if="sale.tax && shop" class="flex justify-between text-muted-foreground">
            <dt>{{ taxLabel(shop, t("common.tax_included_prefix")) }}</dt><dd class="tabular-nums">{{ money(sale.tax, currency) }}</dd>
          </div>
          <div class="flex justify-between pt-2 text-4xl font-semibold">
            <dt>{{ t("common.total") }}</dt><dd class="tabular-nums" data-total>{{ money(sale.total, currency) }}</dd>
          </div>
        </dl>
      </template>
    </main>
  </div>
</template>

<!-- not scoped: the extensions' elements are drawn by ExtensionSlot -->
<style>
/* the big column is the extensions' while one of them draws something, else the shop's logo and name */
.display-slot:not(:has([data-extension]:not(:empty))),
.display-slot:has([data-extension]:not(:empty)) + .display-shop {
	display: none;
}
</style>

<style scoped>
/* a line that was just added: it slides in and its background fades from the shop's colour */
.display-added {
	animation: display-added 1.6s ease-out;
}
@keyframes display-added {
	from {
		background: color-mix(in oklab, var(--primary) 35%, transparent);
		transform: translateX(1rem);
	}
	30% {
		transform: none;
	}
	to {
		background: transparent;
	}
}
@media (prefers-reduced-motion: reduce) {
	.display-added {
		animation: none;
	}
}
</style>
