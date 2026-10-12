// The customer's screen window (Pages/Pos/Display.vue), as the Sell screen knows it.
// Kept here, outside the page, so the handle survives a switch to another page and back.
import { watch } from "vue";

/** What the Sell screen sends the customer's screen to make it go full screen. */
export const DISPLAY_FULLSCREEN = "pos-display:fullscreen";

let display: Window | null = null;

/**
 * Remember the customer's screen window.
 * @param w The window `window.open` gave back, or null when it was blocked.
 */
export function setDisplay(w: Window | null) {
	display = w;
}

/**
 * Hand the customer's screen the right to go full screen.
 * A browser only lets a window go full screen after a click inside it. Chromium lets another
 * window pass its own click on (capability delegation), so the cashier's next click on the
 * Sell screen does it and nobody has to reach over to the second monitor.
 * Call it from a click. It does nothing when there is no window or it is full screen already.
 */
export function delegateFullscreen() {
	if (!display || display.closed) return;
	try {
		if (display.document.fullscreenElement) return;
		// `delegate` is not in TypeScript's DOM types yet
		display.postMessage(DISPLAY_FULLSCREEN, {
			targetOrigin: window.location.origin,
			delegate: "fullscreen",
		} as WindowPostMessageOptions);
	} catch {
		/* ponytail: no click to pass on, or a browser without delegation → the customer's screen keeps its own "click for full screen" */
	}
}

/**
 * What a pay dialog tells the customer's screen while it asks for the money:
 * the picked payment method and the cents asked for.
 */
export type DisplayPayment = {
	name: string;
	/** The method's picture (a QR code to pay), when it has one. */
	image: string | null;
	/** The key of the extension that added the method, when one did. */
	extension: string | null;
	amount: number;
};

/**
 * The `localStorage` key the customer's screen reads the picked method from.
 * @param shopId The active shop.
 * @returns The key.
 */
export function paymentKey(shopId: number) {
	return `display:${shopId}`;
}

/**
 * Tell the customer's screen which method is picked, or that none is any more.
 * It reads the key like the cart's: the browser tells every other window of the site.
 * @param shopId The active shop.
 * @param payment The picked method and the amount, or null to stop showing one.
 */
export function showPayment(shopId: number, payment: DisplayPayment | null) {
	try {
		if (payment)
			localStorage.setItem(paymentKey(shopId), JSON.stringify(payment));
		else localStorage.removeItem(paymentKey(shopId));
	} catch {
		/* ponytail: blocked storage → the customer's screen just shows no payment */
	}
}

/**
 * The `localStorage` key that holds the shop the Sell screen is on.
 * The customer's screen is a window of its own: it only learns of a switch to another shop from this key.
 */
export const DISPLAY_SHOP = "pos:shop";

/**
 * Tell the customer's screen which shop the Sell screen is on now.
 * @param shopId The active shop.
 */
export function announceShop(shopId: number) {
	try {
		localStorage.setItem(DISPLAY_SHOP, String(shopId));
	} catch {
		/* ponytail: blocked storage → the customer's screen keeps its shop until it is reloaded */
	}
}

/**
 * Read a saved cart (`SavedCart` in components/pos/CartPanel.vue).
 * @param raw The stored JSON, or null when the key is gone.
 * @returns The cart, or null when there is none or it can't be read.
 */
export function parseCart<S extends { cart: unknown[] }>(
	raw: string | null,
): S | null {
	try {
		const saved = JSON.parse(raw ?? "null");
		return Array.isArray(saved?.cart) ? saved : null;
	} catch {
		return null;
	}
}

/**
 * The sale as the customer sees it, in cents (`DisplaySale` in extensions/types.ts).
 * @param cart The cart's lines (`CartLine` in components/pos/CartPanel.vue).
 * @param totals The sums of the sale (`saleTotals` there).
 * @param customer The customer's name, or null.
 * @param currency The shop's currency.
 * @returns The lines and the sums.
 */
export function displaySale(
	cart: {
		name: string;
		variant_name: string | null;
		qty: number;
		price: number;
		image: string | null;
		note?: string;
	}[],
	totals: { subtotal: number; discount: number; tax: number; total: number },
	customer: string | null,
	currency: string,
) {
	return {
		lines: cart.map(function line(l) {
			return {
				name: l.name,
				variant: l.variant_name,
				qty: l.qty,
				price: l.price,
				total: l.price * l.qty,
				image: l.image,
				note: l.note?.trim() || null,
			};
		}),
		// how many units, not how many lines
		count: cart.reduce((n, l) => n + l.qty, 0),
		customer,
		...totals,
		currency,
	};
}
export type DisplaySale = ReturnType<typeof displaySale>;

/** The picked payment method as an extension gets it. */
export type SlotPayment = {
	method: string;
	extension: string | null;
	amount: number;
};

/**
 * What the `pos.display` slot hands an extension (the extension guide).
 * Read only: an extension can't change the cart.
 * Call it while a component is set up: it watches both values.
 * @param sale Gives the sale as it is now.
 * @param payment Gives the picked method, or null while no pay dialog is open.
 * @param place Where the slot is drawn: next to a pay dialog, or on the customer's screen.
 * @param approve What the dialog does when the extension says the money is taken. The customer's screen has none.
 * @returns The slot's context.
 */
export function displayContext(
	sale: () => DisplaySale,
	payment: () => SlotPayment | null,
	place: "dialog" | "screen" = "screen",
	approve: (ref: string) => void = () => {},
) {
	const listeners = new Set<(sale: DisplaySale) => void>();
	const paymentListeners = new Set<(payment: SlotPayment | null) => void>();
	watch(sale, function tell(s) {
		for (const fn of listeners) fn(s);
	});
	watch(payment, function tellPayment(p) {
		for (const fn of paymentListeners) fn(p);
	});
	return {
		sale,
		onChange(fn: (sale: DisplaySale) => void) {
			listeners.add(fn);
			return () => void listeners.delete(fn);
		},
		payment,
		onPayment(fn: (payment: SlotPayment | null) => void) {
			paymentListeners.add(fn);
			return () => void paymentListeners.delete(fn);
		},
		place,
		approve,
	};
}
