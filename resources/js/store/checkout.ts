import "../../css/store-island.css";
import { type Component, createApp, reactive } from "vue";
import AddressFields from "@/components/store/AddressFields.vue";
import Checkout from "./islands/Checkout.vue";
import Done from "./islands/Done.vue";

/**
 * The Vue island of the store pages (a Vite entry, loaded after window.Store).
 * It mounts the shared parts on the server-rendered page:
 *   #store-checkout        the checkout form   (store/checkout.edge)
 *   #store-done            the order / payment state (store/done.edge)
 *   [data-store-address]   address boxes in a plain HTML form (store/partials/address.edge)
 * Each mount element carries its props as JSON in `data-props`.
 */

/**
 * The props a mount element carries.
 * @param el The mount element.
 * @returns The parsed `data-props` ({} when missing or broken).
 */
function propsOf(el: HTMLElement): Record<string, unknown> {
	try {
		return JSON.parse(el.dataset.props ?? "{}");
	} catch {
		return {};
	}
}

/**
 * Mount one island.
 * @param el Where (its server-rendered content is replaced).
 * @param component What.
 * @param props Its props.
 */
function mount(
	el: HTMLElement,
	component: Component,
	props: Record<string, unknown>,
) {
	createApp(component, props).mount(el);
}

/**
 * Address boxes inside a plain form (the account page).
 * `values` = the address to show (the posted values after an error).
 * The boxes write named inputs, so the form posts them as usual.
 * The first form's box ids are `addr-*`, the next ones `addr2-*`, `addr3-*` …
 * @param el The `[data-store-address]` element.
 * @param n Its place among the address forms on the page (0 = first).
 */
function mountAddress(el: HTMLElement, n: number) {
	const p = propsOf(el) as {
		store?: unknown;
		values?: Record<string, string>;
		errors?: Record<string, string>;
		states?: string[];
		withPhone?: boolean;
	};
	const form = reactive({
		phone: "",
		address_1: "",
		address_2: "",
		city: "",
		state: "",
		country: "",
		postal_code: "",
		...p.values,
	});
	mount(el, AddressFields, {
		store: p.store ?? window.Store.data.store,
		form,
		errors: p.errors ?? {},
		states: p.states ?? [],
		withPhone: !!p.withPhone,
		idPrefix: n ? `addr${n + 1}` : "addr",
	});
}

/**
 * Find every mount point on the page and mount it.
 */
function start() {
	const checkout = document.getElementById("store-checkout");
	if (checkout) mount(checkout, Checkout, propsOf(checkout));
	const done = document.getElementById("store-done");
	if (done) mount(done, Done, propsOf(done));
	const addresses = document.querySelectorAll<HTMLElement>(
		"[data-store-address]",
	);
	addresses.forEach(mountAddress);
}

start();
