<script setup lang="ts">
import { CUSTOM_REQUEST_MAX } from "@constants/Product.Constant";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { watchDebounced } from "@vueuse/core";
import { Head, Link, router, usePage } from "@inertiajs/vue3";
import AppLayout from "@/layouts/AppLayout.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "vue-sonner";
import {
	Check,
	Minus,
	Maximize,
	Minimize,
	Monitor,
	Package,
	Plus,
	Search,
	ShoppingCart,
} from "@lucide/vue";
import ProductCard from "@/components/pos/ProductCard.vue";
import ImageGallery from "@/components/ImageGallery.vue";
import ProductExtra from "@/components/ProductExtra.vue";
import { galleryOf } from "@/lib/images";
import CartPanel, {
	quoteCoupon,
	type CartLine,
	type Discount,
} from "@/components/pos/CartPanel.vue";
import CheckoutDialog from "@/components/pos/CheckoutDialog.vue";
import CustomerPicker from "@/components/pos/CustomerPicker.vue";
import CategoryDot from "@/components/CategoryDot.vue";
import { announceShop, delegateFullscreen, setDisplay } from "@/lib/display";
import { maximized, toggleMaximized } from "@/lib/fullscreen";
import { money } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
	availableFor,
	chosenNames,
	hasChoices,
	isChoice,
	lineKey,
	optionLeft,
	type Choices,
} from "@/lib/bundles";
import { contentsLabel, contentsOf } from "@/lib/bundleLabels";
import { saleTotals } from "@/components/pos/CartPanel.vue";
import WithTooltip from "@/components/WithTooltip.vue";
import type {
	BundleItem,
	Category,
	Customer,
	Paged,
	PaymentMethod,
	Product,
	ProductVariant,
	SharedProps,
} from "@/types";

defineOptions({ layout: AppLayout });
/** `products` is the first page only — the grid loads more as you scroll (GET /pos/products), search and category filter on the server. */
const props = defineProps<{
	products: Paged<Product>;
	categories: Category[];
	payment_methods: PaymentMethod[];
	sales_staff: { id: number; name: string }[]; // the active sales people the checkout may name
	/**
	 * Set when the screen was opened for an order that is not paid yet (`/pos?order=`): the cart is added to it.
	 * Or for a customer's bill (`/pos?customer=`): their open order, else `id: null` = the cart starts their unpaid order.
	 * `back` = where to go once it is sent (default: the order).
	 */
	adding: Adding | null;
}>();

/** What the Sell screen was opened for: see `adding` in the props. */
type Adding = {
	id: number | null;
	code: string;
	customer?: { id: number; name: string };
	back: string | null;
};

const page = usePage<SharedProps>();
const currency = computed(() => page.props.shop?.currency ?? "USD");

const search = ref("");
// the picked category lives in the address (`?category=<id>`), so a refresh keeps it
const categoryId = ref<number | null>(
	Number(new URLSearchParams(window.location.search).get("category")) || null,
);
/** Writes the picked category into the address, keeping the other query params. */
function syncCategory() {
	const url = new URL(window.location.href);
	if (categoryId.value)
		url.searchParams.set("category", String(categoryId.value));
	else url.searchParams.delete("category");
	router.replace({
		url: url.pathname + url.search,
		preserveState: true,
		preserveScroll: true,
	});
}
watch(categoryId, syncCategory);
// Input.vue renders a single <input> root, so $el is the element.
const searchInput = ref<{ $el: HTMLInputElement } | null>(null);

// Server-paged grid: `loaded` grows page by page as the sentinel under the grid scrolls into view; a new search or
// category starts over from page 1. `extra` holds products fetched by id (restored cart lines, scanned barcodes) that
// aren't on a loaded page.
const loaded = ref<Product[]>(props.products.data);
const extra = ref<Product[]>([]);
const pageNo = ref(props.products.page);
const lastPage = ref(props.products.last_page);
const loading = ref(false);
let reqId = 0; // ignore responses of superseded searches
const visible = computed(() => loaded.value);
const findProduct = (id: number) =>
	loaded.value.find((p) => p.id === id) ?? extra.value.find((p) => p.id === id);
async function fetchProducts(
	params: Record<string, string | number | null | undefined>,
): Promise<Paged<Product>> {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params))
		if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
	const res = await fetch(`/pos/products?${sp}`, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`products ${res.status}`);
	return res.json();
}
/** Page 1 of the current search + category (replaces the grid). */
async function reload() {
	const id = ++reqId;
	loading.value = true;
	try {
		const r = await fetchProducts({
			q: search.value.trim(),
			category: categoryId.value,
			page: 1,
		});
		if (id !== reqId) return;
		loaded.value = r.data;
		pageNo.value = r.page;
		lastPage.value = r.last_page;
	} catch {
		toast.error(t("pos.load_products_failed"));
	} finally {
		if (id === reqId) loading.value = false;
	}
}
/** The next page, appended (called by the scroll sentinel). */
async function loadMore() {
	if (loading.value || pageNo.value >= lastPage.value) return;
	const id = ++reqId;
	loading.value = true;
	try {
		const r = await fetchProducts({
			q: search.value.trim(),
			category: categoryId.value,
			page: pageNo.value + 1,
		});
		if (id !== reqId) return;
		const seen = new Set(loaded.value.map((p) => p.id));
		loaded.value.push(...r.data.filter((p) => !seen.has(p.id)));
		pageNo.value = r.page;
		lastPage.value = r.last_page;
	} catch {
		toast.error(t("pos.load_more_failed"));
	} finally {
		if (id === reqId) loading.value = false;
	}
}
watchDebounced([search, categoryId], reload, { debounce: 200 });
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
onMounted(() => {
	observer = new IntersectionObserver(
		(entries) => entries.some((e) => e.isIntersecting) && loadMore(),
		{ rootMargin: "200px" },
	);
	if (sentinel.value) observer.observe(sentinel.value);
});
onUnmounted(() => observer?.disconnect());

// Cart -------------------------------------------------------------------
const cart = ref<CartLine[]>([]);
const discount = ref<Discount>(null);
const customer = ref<Customer | null>(null);
const pickingCustomer = ref(false);

// the customer's screen is another window: it moves to this shop when the Sell screen does
announceShop(page.props.shop?.id ?? 0);

// Unfinished sale survives page switches/reloads: one localStorage key per shop, dropped after a day.
const CART_TTL = 24 * 60 * 60 * 1000;
// lines meant for an order have a key of their own, so the unfinished sale is left alone
const cartKey = `cart:${page.props.shop?.id ?? 0}${props.adding ? `:order:${props.adding.id ?? `c${props.adding.customer?.id}`}` : ""}`;
try {
	const saved = JSON.parse(localStorage.getItem(cartKey) ?? "null");
	if (saved && Date.now() - saved.at < CART_TTL) {
		cart.value = saved.cart as CartLine[]; // as saved for now — re-synced right after mount (resync below)
		discount.value = saved.discount ?? null;
		customer.value = saved.customer ?? null;
	} else localStorage.removeItem(cartKey);
} catch {
	/* ponytail: corrupt/blocked storage → start empty */
}
/** Re-sync restored lines against today's catalog: drop vanished units, refresh price/stock, clamp qty. */
function resync(lines: CartLine[], products: Product[]) {
	return lines.flatMap((l) => {
		const p = products.find((x) => x.id === l.product_id);
		if (!p) return [];
		// a package: its choices must still resolve, and availability comes from the components
		if (p.kind === "bundle") {
			const choices = l.choices ?? {};
			const stock = availableFor(p, choices);
			if (stock !== null && stock < 1) return [];
			return [
				{
					...l,
					choices,
					key: lineKey(p.id, null, choices),
					price: p.price,
					variant_name: chosenNames(p, choices),
					stock,
					qty: stock === null ? l.qty : Math.min(l.qty, stock),
				},
			];
		}
		const v = l.variant_id
			? p.variants.find((x) => x.id === l.variant_id)
			: null;
		if (l.variant_id && !v) return [];
		const stock = p.track_stock ? (v ? v.stock : p.stock) : null;
		if (stock !== null && stock < 1) return [];
		return [
			{
				...l,
				choices: {},
				key: lineKey(p.id, v?.id ?? null),
				price: v?.price ?? p.price,
				stock,
				qty: stock === null ? l.qty : Math.min(l.qty, stock),
			},
		];
	});
}
// the restored lines' products may not be on the first page → fetch exactly those, then re-sync
onMounted(async () => {
	const ids = [...new Set(cart.value.map((l) => l.product_id))];
	if (!ids.length) return;
	try {
		const r = await fetchProducts({ ids: ids.join(",") });
		extra.value.push(...r.data);
		cart.value = resync(cart.value, r.data);
	} catch {
		/* offline → keep the saved lines; checkout re-checks everything */
	}
});
watch(
	[cart, discount, customer],
	() => {
		if (!cart.value.length && !discount.value && !customer.value)
			localStorage.removeItem(cartKey);
		else
			localStorage.setItem(
				cartKey,
				JSON.stringify({
					at: Date.now(),
					cart: cart.value,
					discount: discount.value,
					customer: customer.value,
				}),
			);
	},
	{ deep: true },
);
// a code's discount depends on the lines it covers and on who is buying → re-ask the server when the cart or the customer changes
watch(
	() => [
		cart.value.map((l) => `${l.key}:${l.qty}:${l.price}`).join("|"),
		customer.value?.id ?? 0,
	],
	async () => {
		const d = discount.value;
		if (d?.type !== "coupon" || !cart.value.length) return;
		const r = await quoteCoupon(
			cart.value,
			customer.value?.id ?? null,
			d.quote.code,
		);
		if (r.quote) discount.value = { type: "coupon", quote: r.quote };
		else {
			discount.value = null;
			toast.warning(
				t("pos.coupon_removed", { code: d.quote.code, reason: r.error }),
			);
		}
	},
);
const total = computed(
	() => saleTotals(cart.value, discount.value, page.props.shop).total,
);
const count = computed(() => cart.value.reduce((s, l) => s + l.qty, 0));

/** On-hand count for a unit when the product tracks stock, else null. A package counts what its chosen components allow. */
const stockOf = (
	product: Product,
	variant: ProductVariant | null,
	choices: Choices = {},
) =>
	product.kind === "bundle"
		? availableFor(product, choices)
		: product.track_stock
			? variant
				? variant.stock
				: product.stock
			: null;
const unitName = (product: Product, variant: ProductVariant | null) =>
	variant ? `${product.name} — ${variant.name}` : product.name;

/** Add one unit; refuses (with a toast) past the tracked stock. Returns false when nothing was added. */
function add(
	product: Product,
	variant: ProductVariant | null,
	choices: Choices = {},
) {
	const key = lineKey(product.id, variant?.id ?? null, choices);
	const stock = stockOf(product, variant, choices);
	const line = cart.value.find((l) => l.key === key);
	const have = line?.qty ?? 0;
	if (stock !== null && have + 1 > stock) {
		toast.warning(
			stock > 0
				? t("pos.only_n_of_unit", {
						count: stock,
						name: unitName(product, variant),
					})
				: t("pos.unit_out_of_stock", { name: unitName(product, variant) }),
		);
		return false;
	}
	if (line) line.qty++;
	else
		cart.value.push({
			key,
			product_id: product.id,
			variant_id: variant?.id ?? null,
			name: product.name,
			variant_name: variant?.name ?? chosenNames(product, choices),
			image: variant?.images[0] ?? product.images[0] ?? null,
			price: variant?.price ?? product.price,
			qty: 1,
			stock,
			choices,
		});
	return true;
}

/**
 * Set a cart line's note (the box under the line).
 * @param key The line.
 * @param note What was typed.
 */
function setNote(key: string, note: string) {
	const line = cart.value.find((l) => l.key === key);
	if (line) line.note = note.slice(0, CUSTOM_REQUEST_MAX);
}

function setQty(key: string, qty: number) {
	if (qty < 1) return remove(key);
	const line = cart.value.find((l) => l.key === key);
	if (!line) return;
	if (line.stock !== null && qty > line.stock) {
		toast.warning(t("pos.only_n_in_stock", { count: line.stock }));
		qty = line.stock;
	}
	line.qty = qty;
}
const remove = (key: string) =>
	(cart.value = cart.value.filter((l) => l.key !== key));
function resetSale() {
	cart.value = [];
	discount.value = null;
	customer.value = null;
	// stock counts on the cards changed with this sale — pull fresh products.
	// The grid shows `loaded`, not the page prop, so an Inertia reload would change nothing on screen.
	extra.value = [];
	void reload();
}

// Product tap: variants → pick one, otherwise straight into the cart.
const picking = ref<Product | null>(null);
const pickQty = ref(1);
const selection = ref<Record<string, string>>({}); // group → chosen value
const listChoice = ref<ProductVariant | null>(null); // for variants without groups
const slotChoice = ref<Choices>({}); // package slot id → chosen variant id
// Reopening a cart line: the picker starts from that line's answers, and adding replaces the line instead of stacking on it.
const editing = ref<string | null>(null);
const preset = ref<{
	choices: Choices;
	qty: number;
	variant_id: number | null;
} | null>(null);

// Packages: one pill row per slot the customer has to answer.
const isBundle = computed(() => picking.value?.kind === "bundle");
/** A product with nothing to choose — the sheet only asks for a quantity (reached from the cart, never from the grid). */
const plain = computed(
	() => !!picking.value && !isBundle.value && !picking.value.variants.length,
);
const choiceSlots = computed(() =>
	(picking.value?.bundle_items ?? []).filter(isChoice),
);
const bundleReady = computed(() =>
	choiceSlots.value.every((s) => slotChoice.value[s.id] != null),
);
function pickSlot(slot: BundleItem, variantId: number) {
	const next = { ...slotChoice.value };
	if (next[slot.id] === variantId) delete next[slot.id];
	else next[slot.id] = variantId;
	slotChoice.value = next;
}

/** Option groups from the variants’ attributes, e.g. [{ name: "Color", values: [Red, Blue] }, { name: "Size", values: [S, M] }]. */
const variantGroups = computed(() => {
	const groups = new Map<string, Set<string>>();
	for (const v of picking.value?.variants ?? [])
		for (const [k, val] of Object.entries(v.attributes ?? {}))
			(groups.get(k) ?? groups.set(k, new Set()).get(k)!).add(val);
	return [...groups].map(([name, vals]) => ({ name, values: [...vals] }));
});
/** Guided mode when every variant carries attributes; otherwise a plain radio list. */
const guided = computed(
	() =>
		variantGroups.value.length > 0 &&
		!!picking.value?.variants.every(
			(v) => v.attributes && Object.keys(v.attributes).length,
		),
);
watch(picking, () => {
	const pre = preset.value;
	preset.value = null;
	pickQty.value = pre?.qty ?? 1;
	listChoice.value = null;
	slotChoice.value = pre?.choices ?? {};
	if (!picking.value) editing.value = null; // closed without adding
	selection.value = Object.fromEntries(
		variantGroups.value
			.filter((g) => g.values.length === 1)
			.map((g) => [g.name, g.values[0]!]),
	);
	// reopened from the cart: start from the line's variant
	const v = pre?.variant_id
		? picking.value?.variants.find((x) => x.id === pre.variant_id)
		: null;
	if (v)
		guided.value
			? (selection.value = { ...v.attributes })
			: (listChoice.value = v);
});
const matches = (v: ProductVariant, sel: Record<string, string>) =>
	Object.entries(sel).every(([k, val]) => !val || v.attributes?.[k] === val);
const inStock = (v: ProductVariant) =>
	!picking.value?.track_stock || v.stock > 0;
/** Is this value still possible given the other groups’ selections (and is such a variant in stock)? */
const available = (group: string, value: string) => {
	const others = Object.fromEntries(
		Object.entries(selection.value).filter(([k]) => k !== group),
	);
	return (picking.value?.variants ?? []).some(
		(v) => v.attributes?.[group] === value && matches(v, others) && inStock(v),
	);
};
const choose = (group: string, value: string) => {
	selection.value = {
		...selection.value,
		[group]: selection.value[group] === value ? "" : value,
	};
};
const missingGroups = computed(() =>
	variantGroups.value
		.filter((g) => !selection.value[g.name])
		.map((g) => g.name),
);
const chosen = computed(() =>
	guided.value
		? missingGroups.value.length
			? null
			: ((picking.value?.variants ?? []).find((v) =>
					matches(v, selection.value),
				) ?? null)
		: listChoice.value,
);
/** Can the Add button fire? A package needs every choice slot answered. */
const canAdd = computed(() =>
	isBundle.value ? bundleReady.value : plain.value || !!chosen.value,
);
/** How many of the chosen unit can still go in the cart (null = unlimited). */
const chosenLeft = computed(() => {
	if (!picking.value) return null;
	if (isBundle.value) {
		if (!bundleReady.value) return null;
		const avail = availableFor(picking.value, slotChoice.value);
		if (avail === null) return null;
		const key = lineKey(picking.value!.id, null, slotChoice.value);
		const inCart =
			key === editing.value
				? 0
				: (cart.value.find((l) => l.key === key)?.qty ?? 0); // the line being edited is replaced, not added to
		return Math.max(0, avail - inCart);
	}
	const except = (key: string) =>
		key === editing.value
			? 0
			: (cart.value.find((l) => l.key === key)?.qty ?? 0); // the edited line is replaced
	if (plain.value) {
		const avail = stockOf(picking.value, null);
		return avail === null
			? null
			: Math.max(0, avail - except(lineKey(picking.value.id, null)));
	}
	if (!chosen.value || !picking.value.track_stock) return null;
	return Math.max(
		0,
		chosen.value.stock - except(lineKey(picking.value.id, chosen.value.id)),
	);
});
const priceRange = computed(() => {
	if (isBundle.value) return money(picking.value!.price, currency.value);
	const ps = (picking.value?.variants ?? []).map((v) => v.price);
	if (!ps.length) return "";
	const lo = Math.min(...ps),
		hi = Math.max(...ps);
	return lo === hi
		? money(lo, currency.value)
		: `${money(lo, currency.value)} – ${money(hi, currency.value)}`;
});
/** "Red", "navy", "#336699" … → a CSS color for a swatch; null otherwise. */
const swatch = (value: string) =>
	typeof CSS !== "undefined" &&
	CSS.supports("color", value.trim().toLowerCase())
		? value.trim().toLowerCase()
		: null;
function tap(product: Product) {
	if (product.variants.length || hasChoices(product)) picking.value = product;
	else add(product, null);
}
/** A package line in the cart → the picker with its current answers and quantity. */
async function editLine(key: string) {
	const line = cart.value.find((l) => l.key === key);
	if (!line) return;
	let product = findProduct(line.product_id);
	if (!product) {
		// not on a loaded page → fetch it
		try {
			product = (await fetchProducts({ ids: String(line.product_id) })).data[0];
			if (product) extra.value.push(product);
		} catch {
			/* stays uneditable offline */
		}
	}
	if (!product) return;
	editing.value = key;
	preset.value = {
		choices: { ...line.choices },
		qty: line.qty,
		variant_id: line.variant_id,
	};
	picking.value = product;
}
const pickerError = computed(function error() {
	if (chosenLeft.value === 0) return t("pos.out_of_stock");
	if (chosenLeft.value !== null && pickQty.value > chosenLeft.value)
		return t("pos.only_n_left", { count: chosenLeft.value });
	return null;
});
/** The Add button's text: short on a phone, the whole thing from `sm` up. */
const addLabel = computed(function label() {
	if (!editing.value)
		return { short: t("pos.add"), long: t("pos.add_to_cart") };
	if (plain.value) return { short: t("pos.ok"), long: t("pos.ok") };
	return { short: t("pos.update"), long: t("pos.update_line") };
});

// Barcode → product (variants open the picker, otherwise straight into the cart). Looks through the loaded
// products first, then asks the server (the grid only holds a page).
function matchBarcode(
	products: Product[],
	code: string,
): { p: Product; v: ProductVariant | null } | null {
	for (const p of products) {
		const v = p.variants.find((v) => v.barcode === code);
		if (v) return { p, v };
	}
	const p = products.find((p) => p.barcode === code);
	return p ? { p, v: null } : null;
}
async function addByBarcode(code: string, quiet = false) {
	let hit = matchBarcode([...loaded.value, ...extra.value], code);
	if (!hit) {
		try {
			const r = await fetchProducts({ q: code, page: 1 });
			hit = matchBarcode(r.data, code);
			if (hit) extra.value.push(hit.p);
		} catch {
			/* offline → treated as unknown */
		}
	}
	if (!hit) {
		if (!quiet) toast.error(t("pos.no_product_with_barcode", { code }));
		return false;
	}
	if (hit.v) add(hit.p, hit.v);
	else tap(hit.p);
	return true;
}
// Enter inside the search box: exact barcode match adds the product and clears the box.
async function scan() {
	if (await addByBarcode(search.value.trim(), true)) search.value = "";
}

function addChosen() {
	if (!picking.value || !canAdd.value || pickerError.value) return;
	const [unit, choices] = isBundle.value
		? [null, slotChoice.value]
		: [plain.value ? null : chosen.value, {}];
	if (editing.value) remove(editing.value);
	for (let i = 0; i < pickQty.value; i++)
		if (!add(picking.value, unit, choices)) break;
	picking.value = null;
}

/** The part of Chromium's Window Management API this page uses; other browsers don't have it. */
type ScreenDetails = {
	currentScreen: unknown;
	screens: {
		availLeft: number;
		availTop: number;
		availWidth: number;
		availHeight: number;
	}[];
};

/**
 * Open the customer's screen in a window of its own. It follows this cart by itself (Pages/Pos/Display.vue).
 * In Chrome and Edge the window opens on the second monitor and fills it: the browser asks once for the
 * "manage windows" permission. Refused, or another browser: a plain window to drag over.
 */
async function openDisplay() {
	let features = "popup,width=1024,height=768";
	try {
		const details = await (
			window as { getScreenDetails?: () => Promise<ScreenDetails> }
		).getScreenDetails?.();
		const other = details?.screens.find((s) => s !== details.currentScreen);
		// `fullscreen` opens it with no window bar where the browser allows it; else Display.vue asks for one click
		if (other)
			features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight},fullscreen`;
	} catch {
		/* permission refused → the plain window */
	}
	// answering the permission question can take longer than the browser lets a click open a window
	const opened = window.open("/pos/display", "pos-display", features);
	setDisplay(opened);
	if (!opened) toast.warning(t("pos.display_blocked"));
}
// Opening the window uses up the click, so the customer's screen can't go full screen from it.
// The cashier's next click anywhere on this screen is passed on instead (lib/display.ts).
onMounted(function passClicks() {
	window.addEventListener("click", delegateFullscreen, true);
});
onUnmounted(function stopPassing() {
	window.removeEventListener("click", delegateFullscreen, true);
});

const checkoutOpen = ref(false);
const cartSheet = ref(false);
function charge() {
	cartSheet.value = false;
	if (props.adding) void addToOrder(props.adding);
	else checkoutOpen.value = true;
}

const addingBusy = ref(false);
/**
 * Send the cart to the order this screen was opened for, then go back to it (or to `back`).
 * With no order yet, the cart starts the customer's unpaid order (`POST /pos/open`, which also joins one opened meanwhile).
 * The server prices the lines and takes the stock, like a sale.
 * @param order What the screen was opened for.
 */
async function addToOrder(order: Adding) {
	if (addingBusy.value) return;
	addingBusy.value = true;
	try {
		const res = await fetch(
			order.id ? `/orders/${order.id}/items` : "/pos/open",
			{
				method: "POST",
				credentials: "same-origin",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					items: cart.value.map(function item(l) {
						return {
							product_id: l.product_id,
							variant_id: l.variant_id,
							qty: l.qty,
							choices: l.choices ?? {},
							note: l.note?.trim() || undefined,
						};
					}),
					customer_id: order.customer?.id ?? null,
				}),
			},
		);
		const data = await res.json();
		if (res.status !== 201) {
			const errors: Record<string, string> = data.errors ?? {};
			toast.error(Object.values(errors)[0] ?? t("orders.change_failed"));
			return;
		}
		cart.value = [];
		const sent = data.order as { id: number; reference: string | null };
		toast.success(
			t("pos.added_to_order", { id: sent.reference ?? String(sent.id) }),
		);
		router.visit(order.back ?? `/orders/${sent.id}`);
	} catch {
		toast.error(t("pos.server_unreachable"));
	} finally {
		addingBusy.value = false;
	}
}

// Keys typed outside any field: "/" focuses search; a fast burst ending in Enter is a barcode scanner.
let scanBuf = "";
let scanAt = 0;
function onKey(e: KeyboardEvent) {
	const el = e.target as HTMLElement | null;
	if (
		el?.tagName === "INPUT" ||
		el?.tagName === "TEXTAREA" ||
		el?.isContentEditable
	)
		return;
	if (e.key === "/") {
		e.preventDefault();
		searchInput.value?.$el.focus();
		return;
	}
	if (e.timeStamp - scanAt > 100) scanBuf = ""; // ponytail: >100ms between keys = a human, not a scanner
	scanAt = e.timeStamp;
	if (e.key === "Enter") {
		if (scanBuf.length >= 3) addByBarcode(scanBuf);
		scanBuf = "";
	} else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) scanBuf += e.key;
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Head :title="t('pos.title')" />

  <div class="flex h-full min-h-0">
    <!-- Products -->
    <section class="flex min-w-0 flex-1 flex-col">
      <div class="shrink-0 space-y-3 p-3 sm:p-4 pb-0 sm:pb-0">
        <!-- opened for an order: say so, with the way back -->
        <div v-if="adding" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm" data-adding-to-order>
          <span class="font-medium">{{ adding.id ? t("pos.adding_to_order", { id: adding.code }) : t("pos.new_order_for", { name: adding.customer?.name ?? "" }) }}</span>
          <Link :href="adding.back ?? (adding.id ? `/orders/${adding.id}` : '/pos')" class="underline">{{ t("common.back") }}</Link>
        </div>
        <div class="flex gap-2">
          <div class="relative min-w-0 flex-1">
            <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref="searchInput" v-model="search" :placeholder="t('pos.search_placeholder')" class="h-9 pl-9" @keydown.enter.prevent="scan" />
          </div>
          <WithTooltip :label="t('pos.display')"><Button variant="outline" size="icon" class="size-9 shrink-0" :aria-label="t('pos.display')" @click="openDisplay"><Monitor /></Button></WithTooltip>
          <WithTooltip :label="t(maximized ? 'nav.fullscreen_exit' : 'nav.fullscreen')"><Button variant="outline" size="icon" class="size-9 shrink-0" :aria-label="t(maximized ? 'nav.fullscreen_exit' : 'nav.fullscreen')" data-fullscreen-toggle @click="toggleMaximized"><Minimize v-if="maximized" /><Maximize v-else /></Button></WithTooltip>
        </div>
        <div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <Badge as="button" :variant="categoryId === null ? 'default' : 'outline'" class="h-7 cursor-pointer px-3 text-sm" @click="categoryId = null">
            {{ t("common.all") }}
          </Badge>
          <Badge v-for="c in categories" :key="c.id" as="button" :variant="categoryId === c.id ? 'default' : 'outline'"
            class="h-7 cursor-pointer px-3 text-sm" @click="categoryId = c.id">
            <CategoryDot :color="c.color" />{{ c.name }}
          </Badge>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-3 pb-24 sm:p-4 lg:pb-4">
        <!-- No products at all -->
        <div v-if="!products.total" class="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <span class="flex size-12 items-center justify-center rounded-full bg-muted"><Package class="size-5 text-muted-foreground" /></span>
          <div>
            <p class="font-medium">{{ t("pos.no_products") }}</p>
            <p class="text-sm text-muted-foreground">{{ t("pos.no_products_body") }}</p>
          </div>
          <Button as-child class="h-10"><Link href="/products/create"><Plus /> {{ t("pos.new_product") }}</Link></Button>
        </div>

        <!-- No matches -->
        <div v-else-if="!visible.length && !loading" class="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <p class="font-medium">{{ t("pos.no_match") }}</p>
          <p class="text-sm text-muted-foreground">{{ t("pos.no_match_body") }}</p>
        </div>

        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          <ProductCard v-for="p in visible" :key="p.id" :product="p" :currency="currency" @click="tap(p)" />
        </div>
        <!-- scroll sentinel: the next page loads when this comes into view -->
        <div ref="sentinel" data-sentinel class="flex h-10 items-center justify-center text-xs text-muted-foreground">
          <span v-if="loading">{{ t("common.loading") }}</span>
          <span v-else-if="pageNo < lastPage">{{ t("pos.scroll_for_more") }}</span>
        </div>
      </div>
    </section>

    <!-- Cart (desktop / tablet landscape) -->
    <aside class="hidden w-72 shrink-0 border-l lg:flex xl:w-80">
      <CartPanel class="w-full" :lines="cart" :currency="currency" :adding="!!adding" v-model:discount="discount" v-model:customer="customer"
        @set-qty="setQty" @set-note="setNote" @remove="remove" @clear="cart = []" @charge="charge" @pick-customer="pickingCustomer = true" @edit="editLine" />
    </aside>
  </div>

  <!-- Cart (narrow screens): bottom bar + sheet -->
  <div class="fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 md:left-52 lg:hidden">
    <Button class="h-12 w-full justify-between text-base" :disabled="!count" @click="cartSheet = true">
      <span class="flex items-center gap-2"><ShoppingCart /> {{ t("pos.view_cart", { count }) }}</span>
      <span class="tabular-nums">{{ money(total, currency) }}</span>
    </Button>
  </div>

  <Sheet v-model:open="cartSheet">
    <!-- data-[side=bottom]:h-[85vh] beats the component's data-[side=bottom]:h-auto (tailwind-merge); otherwise a full cart grows to 100vh and hides the overlay -->
    <SheetContent side="bottom" class="gap-0 p-0 data-[side=bottom]:h-[85vh]" :show-close-button="false">
      <SheetHeader class="sr-only"><SheetTitle>{{ t("pos.cart") }}</SheetTitle></SheetHeader>
      <CartPanel class="min-h-0 flex-1" closable :lines="cart" :currency="currency" :adding="!!adding" v-model:discount="discount" v-model:customer="customer"
        @set-qty="setQty" @set-note="setNote" @remove="remove" @clear="cart = []" @charge="charge" @close="cartSheet = false" @pick-customer="cartSheet = false; pickingCustomer = true" @edit="(k: string) => { cartSheet = false; editLine(k); }" />
    </SheetContent>
  </Sheet>

  <!-- Variant picker: product sheet with option groups -->
  <Dialog :open="!!picking" @update:open="(v: boolean) => !v && (picking = null)">
    <DialogContent class="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader class="sr-only"><DialogTitle>{{ picking?.name }}</DialogTitle><DialogDescription>{{ t("pos.choose_options") }}</DialogDescription></DialogHeader>
      <div v-if="picking" class="grid min-w-0 max-h-[85vh] grid-cols-1 overflow-hidden rounded-xl sm:grid-cols-[240px_1fr]">
        <!-- Left: product summary -->
        <div class="flex gap-4 border-b bg-muted/30 p-4 sm:flex-col sm:border-r sm:border-b-0 sm:p-5">
          <ImageGallery :images="galleryOf(picking, chosen)" :alt="picking.name" class="shrink-0" frame="size-20 rounded-xl bg-muted sm:aspect-square sm:size-auto sm:w-full" thumbs="hidden sm:flex">
            <div class="flex size-full items-center justify-center bg-gradient-to-br from-muted to-accent text-4xl font-semibold text-muted-foreground/60">{{ picking.name.trim().charAt(0).toUpperCase() }}</div>
          </ImageGallery>
          <div class="min-w-0">
            <h2 class="text-lg font-semibold leading-tight">{{ picking.name }}</h2>
            <p class="mt-1 text-sm font-medium tabular-nums">{{ priceRange }}</p>
            <ProductExtra :rows="picking.extra" class="mt-2" />
            <div v-if="picking.description" class="rich-html mt-2 max-h-32 overflow-y-auto text-sm text-muted-foreground" v-html="picking.description" />
            <p v-if="isBundle" class="mt-2 text-xs text-muted-foreground">{{ t("pos.package_contents", { contents: contentsOf(picking) }) }}</p>
            <p v-else-if="picking.variants.length" class="mt-2 text-xs text-muted-foreground">{{ t("pos.n_options", { count: picking.variants.length }) }}</p>
          </div>
        </div>

        <!-- Right: options + footer -->
        <div class="flex min-h-0 min-w-0 flex-col">
          <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <!-- Package: one pill row per slot the customer answers -->
            <div v-if="isBundle" class="space-y-6">
              <section v-for="slot in choiceSlots" :key="slot.id">
                <div class="mb-2.5 flex items-baseline justify-between pr-6">
                  <h3 class="text-sm font-semibold">{{ slot.qty }} × {{ slot.name }}</h3>
                  <span class="text-xs" :class="slotChoice[slot.id] ? 'text-foreground' : 'text-muted-foreground'">{{ slot.options.find((o) => o.variant_id === slotChoice[slot.id])?.name ?? t("common.required") }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button v-for="o in slot.options" :key="o.variant_id ?? 0" type="button" :aria-pressed="slotChoice[slot.id] === o.variant_id" :aria-label="o.name"
                    :disabled="optionLeft(slot, o) === 0"
                    class="inline-flex h-11 min-w-12 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-all focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through"
                    :class="slotChoice[slot.id] === o.variant_id ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-background hover:border-foreground/40 hover:bg-muted'"
                    @click="pickSlot(slot, o.variant_id!)">
                    <span v-if="swatch(o.name)" class="size-4 rounded-full border border-black/15 shadow-inner" :style="{ background: swatch(o.name)! }" />
                    {{ o.name }}
                  </button>
                </div>
              </section>
              <section>
                <h3 class="mb-2.5 text-sm font-semibold">{{ t("pos.in_this_package") }}</h3>
                <ul class="space-y-1 text-sm text-muted-foreground">
                  <li v-for="slot in picking.bundle_items" :key="slot.id">{{ contentsLabel(slot) }}</li>
                </ul>
              </section>
            </div>
            <!-- Guided: one pill row per group -->
            <div v-else-if="guided" class="space-y-6">
              <section v-for="g in variantGroups" :key="g.name">
                <div class="mb-2.5 flex items-baseline justify-between pr-6">
                  <h3 class="text-sm font-semibold">{{ g.name }}</h3>
                  <span class="text-xs" :class="selection[g.name] ? 'text-foreground' : 'text-muted-foreground'">{{ selection[g.name] || t("common.required") }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button v-for="val in g.values" :key="val" type="button" :aria-pressed="selection[g.name] === val" :disabled="!available(g.name, val)"
                    class="inline-flex h-11 min-w-12 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-all focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through"
                    :class="selection[g.name] === val ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-background hover:border-foreground/40 hover:bg-muted'"
                    @click="choose(g.name, val)">
                    <span v-if="swatch(val)" class="size-4 rounded-full border border-black/15 shadow-inner" :style="{ background: swatch(val)! }" />
                    {{ val }}
                  </button>
                </div>
              </section>
            </div>
            <!-- Plain radio list -->
            <div v-else-if="picking.variants.length" class="space-y-2">
              <h3 class="mb-2.5 text-sm font-semibold">{{ t("pos.option") }}</h3>
              <button v-for="v in picking.variants" :key="v.id" type="button" :aria-pressed="listChoice?.id === v.id" :disabled="!inStock(v)"
                class="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                :class="listChoice?.id === v.id ? 'border-primary bg-primary/15 ring-1 ring-primary' : 'bg-background hover:bg-muted'"
                @click="listChoice = listChoice?.id === v.id ? null : v">
                <span class="flex items-center gap-3">
                  <span class="flex size-5 items-center justify-center rounded-full border" :class="listChoice?.id === v.id ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'"><Check v-if="listChoice?.id === v.id" class="size-3" /></span>
                  <span class="font-medium">{{ v.name }}</span>
                  <Badge v-if="picking.track_stock && v.stock <= 0" variant="destructive" class="ml-1">{{ t("pos.out_of_stock") }}</Badge>
                  <Badge v-else-if="picking.track_stock && v.stock <= picking.low_stock_at" variant="outline" class="ml-1 border-amber-300 text-amber-700 dark:text-amber-400">{{ t("pos.n_left", { count: v.stock }) }}</Badge>
                </span>
                <span class="tabular-nums text-muted-foreground">{{ money(v.price, currency) }}</span>
              </button>
            </div>
            <p v-else class="text-sm text-muted-foreground">{{ t("pos.no_options") }}</p>
          </div>

          <!-- Footer: qty + add -->
          <div class="space-y-2 border-t bg-background p-4">
            <div class="flex items-center gap-3">
              <div class="flex h-12 shrink-0 items-center rounded-xl border">
                <WithTooltip :label="t('pos.decrease_quantity')"><Button variant="ghost" size="icon" class="size-10 sm:size-11" :aria-label="t('pos.decrease_quantity')" :disabled="pickQty <= 1" @click="pickQty--"><Minus /></Button></WithTooltip>
                <span class="w-7 text-center font-semibold tabular-nums sm:w-8">{{ pickQty }}</span>
                <WithTooltip :label="t('pos.increase_quantity')"><Button variant="ghost" size="icon" class="size-10 sm:size-11" :aria-label="t('pos.increase_quantity')" @click="pickQty++"><Plus /></Button></WithTooltip>
              </div>
              <Button class="h-12 min-w-0 flex-1 justify-between px-3 text-base sm:px-4" :disabled="!canAdd || !!pickerError" @click="addChosen">
                <span class="flex min-w-0 items-center gap-2"><ShoppingCart class="shrink-0" /><span class="truncate"><span class="sm:hidden">{{ addLabel.short }}</span><span class="hidden sm:inline">{{ addLabel.long }}</span></span></span>
                <span class="shrink-0 tabular-nums">{{ isBundle || plain ? money(picking.price * pickQty, currency) : chosen ? money(chosen.price * pickQty, currency) : "" }}</span>
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              <template v-if="isBundle && pickerError"><span class="text-destructive">{{ pickerError }}</span></template>
              <template v-else-if="isBundle && bundleReady">{{ t("pos.unit_each", { name: chosenNames(picking, slotChoice) ?? t("pos.package"), price: money(picking.price, currency) }) }}<span v-if="chosenLeft !== null"> · {{ t("pos.can_be_built", { count: chosenLeft }) }}</span></template>
              <template v-else-if="isBundle">{{ t("pos.choose_to_continue", { what: choiceSlots.map((s) => s.name).join(` ${t("pos.and")} `) }) }}</template>
              <template v-else-if="plain && pickerError"><span class="text-destructive">{{ pickerError }}</span></template>
              <template v-else-if="plain">{{ t("pos.price_each", { price: money(picking.price, currency) }) }}<span v-if="chosenLeft !== null"> · {{ t("pos.n_in_stock", { count: chosenLeft }) }}</span></template>
              <template v-else-if="chosen && pickerError"><span class="text-destructive">{{ pickerError }}</span> · {{ chosen.name }}</template>
              <template v-else-if="chosen">{{ t("pos.unit_each", { name: chosen.name, price: money(chosen.price, currency) }) }}<span v-if="chosenLeft !== null"> · {{ t("pos.n_in_stock", { count: chosenLeft }) }}</span></template>
              <template v-else-if="guided && missingGroups.length">{{ t("pos.choose_to_continue", { what: missingGroups.join(` ${t("pos.and")} `) }) }}</template>
              <template v-else-if="guided">{{ t("pos.combination_unavailable") }}</template>
              <template v-else>{{ t("pos.select_option") }}</template>
            </p>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <CheckoutDialog v-model:open="checkoutOpen" :lines="cart" :currency="currency" :methods="payment_methods" :sales-staff="sales_staff" :discount="discount" :customer="customer" @done="resetSale" />
  <CustomerPicker v-model:open="pickingCustomer" @select="(c: Customer) => (customer = c)" />
</template>
