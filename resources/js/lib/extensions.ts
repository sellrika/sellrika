// Mounting an extension's browser code (the extension guide): a page or slot script is an ES module whose default
// export builds its UI inside an element we give it, with a small `api` for talking to its own routes.
import type { Params } from "@i18n";
import { extensionT, locale } from "@/lib/i18n";
import { router, usePage } from "@inertiajs/vue3";
import { createApp, h, reactive } from "vue";
import PaymentMethodPicker from "@/components/pos/PaymentMethodPicker.vue";
import ReceiptSlip from "@/components/ReceiptSlip.vue";
import { toast } from "vue-sonner";
import { cn } from "@/lib/utils";
import { buttonVariants, type ButtonVariants } from "@/components/ui/button";
import type { Order, PickerMethod, SharedProps } from "@/types";
import { borrowSearch } from "@/lib/search";
import { printReceipt, printSlip, type Slip } from "@/lib/rawbt";
import { qrSvg } from "@helpers/qr";

// The class strings of the app's own form components (components/ui/*), so an extension's plain DOM looks the same.
// Keep them in step with Input.vue / Textarea.vue / Label.vue / Card.vue when those change.
const CLASSES = {
	input:
		"dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors focus-visible:ring-3 aria-invalid:ring-3 md:text-sm w-full min-w-0 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
	textarea:
		"border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors focus-visible:ring-3 aria-invalid:ring-3 md:text-sm flex field-sizing-content min-h-16 w-full outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
	label:
		"gap-2 text-sm leading-none font-medium peer-disabled:opacity-50 flex items-center select-none peer-disabled:cursor-not-allowed",
	card: "ring-foreground/10 bg-card text-card-foreground gap-4 rounded-xl p-4 text-sm ring-1 flex flex-col",
	checkbox:
		"border-input size-4 shrink-0 rounded-[4px] border accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
	// a native checkbox drawn like the app's Switch (components/ui/switch): track + sliding thumb
	switch:
		"relative inline-flex h-[18.4px] w-8 shrink-0 cursor-pointer appearance-none items-center rounded-full border border-transparent bg-input outline-none transition-all checked:bg-primary dark:bg-input/80 dark:checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 before:pointer-events-none before:block before:size-4 before:rounded-full before:bg-background before:transition-transform checked:before:translate-x-[calc(100%-2px)] dark:before:bg-foreground dark:checked:before:bg-primary-foreground",
	hint: "text-sm text-muted-foreground",
	error: "text-sm text-destructive",
};

type Attrs = Record<string, string | number | boolean | undefined>;
const el = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	attrs: Attrs = {},
): HTMLElementTagNameMap[K] => {
	const e = document.createElement(tag);
	e.className = className;
	for (const [k, v] of Object.entries(attrs))
		if (v !== undefined && v !== false)
			e.setAttribute(k, v === true ? "" : String(v));
	return e;
};

/** Plain DOM elements dressed like the app's own components — what page and slot scripts get as `api.ui`. */
export const ui = {
	/** A `<label>`; give it the control's id so clicking it focuses the control (and tests can find the control by label). */
	label: (text: string, htmlFor?: string) =>
		Object.assign(el("label", CLASSES.label, { for: htmlFor }), {
			textContent: text,
		}),
	/** A text / number / url / password box. */
	input: (attrs: Attrs = {}) =>
		el("input", CLASSES.input, { type: "text", ...attrs }),
	textarea: (attrs: Attrs = {}) => el("textarea", CLASSES.textarea, attrs),
	/** A native `<select>` with the app's input look; `options` = `{ value, label }`, the first one with `value: ""` makes a placeholder. */
	select: (
		options: { value: string; label: string; disabled?: boolean }[],
		attrs: Attrs = {},
	) => {
		const s = el(
			"select",
			`${CLASSES.input} appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center] bg-[length:1rem_1rem] bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')]`,
			attrs,
		);
		for (const o of options) {
			const option = new Option(o.label, o.value, false, false);
			option.disabled = !!o.disabled;
			s.append(option);
		}
		return s;
	},
	/** A native checkbox in the app's colours. */
	checkbox: (attrs: Attrs = {}) =>
		el("input", CLASSES.checkbox, { type: "checkbox", ...attrs }),
	/** An on/off switch like the app's: a checkbox (`checked`, `change`) with `role="switch"`. */
	switch: (attrs: Attrs = {}) =>
		el("input", CLASSES.switch, { type: "checkbox", role: "switch", ...attrs }),
	/** A button in one of the app's variants (default, outline, secondary, ghost, destructive, link) and sizes (default, xs, sm, lg). */
	button: (
		text: string,
		opts: {
			variant?: ButtonVariants["variant"];
			size?: ButtonVariants["size"];
			type?: "button" | "submit";
		} = {},
	) =>
		Object.assign(
			// merged like the app's own Button: the variant's border colour must beat the base `border-transparent`
			el(
				"button",
				cn(buttonVariants({ variant: opts.variant, size: opts.size })),
				{
					type: opts.type ?? "button",
				},
			),
			{ textContent: text },
		),
	/** Label + control (+ hint) stacked the way the app's forms do. */
	field: (label: HTMLElement, control: HTMLElement, hint?: string) => {
		const f = el("div", "grid gap-2");
		f.append(label, control);
		if (hint) f.append(ui.hint(hint));
		return f;
	},
	/** The bordered box the app's cards use. */
	card: (...children: (HTMLElement | string)[]) => {
		const c = el("div", CLASSES.card);
		c.append(...children);
		return c;
	},
	hint: (text: string) =>
		Object.assign(el("p", CLASSES.hint), { textContent: text }),
	error: (text: string) =>
		Object.assign(el("p", CLASSES.error), { textContent: text }),
	/** A text box with the search icon inside it, like the sidebar's Search box. Returns the wrapper; the box is `.input`. */
	searchInput: (attrs: Attrs = {}) => {
		const wrap = el("div", "relative w-full") as HTMLDivElement & {
			input: HTMLInputElement;
		};
		const icon = el(
			"span",
			"pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground",
		);
		icon.innerHTML = SEARCH_ICON;
		wrap.input = el("input", `${CLASSES.input} pl-8`, {
			type: "search",
			autocomplete: "off",
			...attrs,
		});
		wrap.append(icon, wrap.input);
		return wrap;
	},
};
export type ExtensionUiKit = typeof ui;

export type DialogOptions = {
	title: string;
	description?: string;
	body?: HTMLElement | string;
	footer?: HTMLElement[];
	size?: "sm" | "md" | "lg";
	closable?: boolean;
};
export type DialogHandle = {
	el: HTMLDialogElement;
	body: HTMLElement;
	close: () => void;
	closed: Promise<void>;
};
const DIALOG_WIDTH = {
	sm: "sm:max-w-sm",
	md: "sm:max-w-lg",
	lg: "sm:max-w-2xl",
};
const SEARCH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
const X_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

/**
 * A dialog in the app's own style, on a native `<dialog>` (Escape, focus trap and the backdrop come from the browser).
 * Header (title + description), a scrolling body, an optional footer of buttons, and a close button unless `closable: false`.
 */
export function dialog(opts: DialogOptions): DialogHandle {
	const d = el(
		"dialog",
		`bg-popover text-popover-foreground ring-foreground/10 m-auto w-full max-w-[calc(100%-2rem)] ${DIALOG_WIDTH[opts.size ?? "sm"]} max-h-[calc(100dvh-2rem)] overflow-visible rounded-xl p-0 text-sm ring-1 outline-none backdrop:bg-black/10 supports-backdrop-filter:backdrop:backdrop-blur-xs open:animate-in open:fade-in-0 open:zoom-in-95 duration-100`,
		{ "aria-label": opts.title },
	);
	const box = el(
		"div",
		// the clip is here, not on the dialog: the pay dialog's card for the customer hangs off its left side (PaymentShow.vue)
		"isolate flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden rounded-[inherit]",
	);
	const header = el("div", "flex flex-col gap-2 p-4 pr-10");
	header.append(
		Object.assign(el("h2", "text-base leading-none font-medium"), {
			textContent: opts.title,
		}),
	);
	if (opts.description)
		header.append(
			Object.assign(el("p", "text-muted-foreground text-sm"), {
				textContent: opts.description,
			}),
		);
	const body = el(
		"div",
		"grid min-h-0 gap-4 overflow-x-hidden overflow-y-auto px-4 pb-4 [scrollbar-width:thin]",
	);
	if (opts.body) body.append(opts.body);
	box.append(header, body);
	if (opts.footer?.length) {
		const footer = el(
			"div",
			"flex flex-col-reverse gap-2 border-t bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-popover))] p-4 sm:flex-row sm:justify-end",
		);
		footer.append(...opts.footer);
		box.append(footer);
	}
	d.append(box);
	let done!: () => void;
	const closed = new Promise<void>((r) => (done = r));
	const close = () => {
		if (!d.open) return;
		d.close();
	};
	d.addEventListener("close", () => {
		d.remove();
		done();
	});
	if (opts.closable !== false) {
		const x = el(
			"button",
			"absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
			{ type: "button", "aria-label": "Close" },
		);
		x.innerHTML = X_ICON;
		x.onclick = close;
		d.append(x);
		d.addEventListener("click", (e) => e.target === d && close()); // the backdrop
	} else d.addEventListener("cancel", (e) => e.preventDefault());
	document.body.append(d);
	d.showModal();
	return { el: d, body, close, closed };
}

/**
 * The app's payment method buttons for an extension's own pay dialog: the same
 * `PaymentMethodPicker` the Sell screen uses, so the customer's screen follows it too.
 * @param opts The methods on offer, the one picked first (default the first), the cents asked for, and what to call on a pick.
 * @returns The element, the picked method, a way to change the amount, and `destroy()` for when the dialog goes.
 */
function paymentPicker<M extends PickerMethod>(opts: {
	methods: M[];
	value?: M | null;
	amount: number;
	onChange?: (method: M) => void;
}) {
	const state = reactive({
		value: (opts.value ?? opts.methods[0] ?? null) as PickerMethod | null,
		amount: opts.amount,
	});
	/**
	 * A button was pressed: keep the method and tell the extension.
	 * @param method The picked method.
	 */
	function pick(method: PickerMethod) {
		state.value = method;
		opts.onChange?.(method as M);
	}
	const app = createApp({
		render: () =>
			h(PaymentMethodPicker, {
				methods: opts.methods,
				amount: state.amount,
				modelValue: state.value,
				"onUpdate:modelValue": pick,
			}),
	});
	const el = document.createElement("div");
	app.mount(el);
	return {
		el,
		value: () => state.value as M | null,
		setAmount(cents: number) {
			state.amount = cents;
		},
		// unmounting twice is harmless: Vue only warns
		destroy: () => app.unmount(),
	};
}

export type ExtensionApi = {
	key: string;
	/** The extension's own dictionary (`i18n/<locale>.ts`) in the page's language, and that language. */
	t: (key: string, params?: Params) => string;
	locale: string;
	shop: SharedProps["shop"];
	user: SharedProps["auth"]["user"];
	base: string;
	fetch: (path: string, init?: RequestInit) => Promise<Response>;
	toast: (message: string, kind?: "success" | "error" | "info") => void;
	ui: ExtensionUiKit;
	dialog: typeof dialog;
	/** The ⌘K palette, lent to the extension while its picker is open (lib/search.ts › borrowSearch). */
	search: typeof borrowSearch;
	/** Print a slip like a receipt (browser print, or RawBT), with an optional QR code. */
	print: (slip: Slip) => void;
	/** Print an order's receipt: the same slip as the Sell screen and the order page. */
	printReceipt: (order: Order) => void;
	/** Open another page of the app without a full page load (full screen stays on). */
	visit: (url: string) => void;
	/** A QR code as SVG markup. */
	qr: (text: string) => string;
	/** The app's payment method buttons, for a pay dialog of the extension's own. */
	paymentPicker: typeof paymentPicker;
	/** Pages only: the right side of the page's heading, for the page's own buttons. */
	actions?: HTMLElement;
	/** Pages only: a full-height column on the right of the page, for a details panel (hidden while empty). */
	aside?: HTMLElement;
	context?: unknown;
};

/**
 * Print an order's receipt for an extension, the way the Sell screen and the order page do:
 * the app's own `ReceiptSlip` is put on the page for the print, then taken away.
 * @param order The order, as `orders.get()` answers it.
 * @param currency The shop's currency code.
 * @param shopName The shop's name (the RawBT receipt's heading).
 */
function printOrder(order: Order, currency: string, shopName: string) {
	const slip = createApp(ReceiptSlip, { order, currency });
	slip.mount(document.createElement("div")); // the slip teleports itself to <body>
	printReceipt(order, currency, shopName);
	slip.unmount();
}

/** The `api` handed to one extension's scripts, with the slot's `context` when there is one. */
export function extensionApi(
	key: string,
	context?: unknown,
	strings: Record<string, string> = {},
): ExtensionApi {
	const page = usePage<SharedProps>();
	const base = `/ext/${key}`;
	return {
		key,
		t: extensionT(strings),
		locale: locale(),
		shop: page.props.shop,
		user: page.props.auth.user,
		base,
		fetch: (path, init) =>
			fetch(base + path, { credentials: "same-origin", ...init }),
		toast: (message, kind = "success") => toast[kind](message),
		ui,
		dialog,
		search: borrowSearch,
		print: (slip) => printSlip(slip, qrSvg),
		printReceipt: (order) =>
			printOrder(
				order,
				page.props.shop?.currency ?? "USD",
				page.props.shop?.name ?? "",
			),
		visit: (url) => router.visit(url),
		qr: (text) => qrSvg(text),
		paymentPicker,
		context,
	};
}

/**
 * Import a script and run its default export inside `el`.
 * @returns The cleanup to call when the element goes away (the script's own, or a no-op).
 */
export async function mountExtension(
	el: HTMLElement,
	url: string,
	api: ExtensionApi,
): Promise<() => void> {
	try {
		// absolute against the page's origin: in dev the app's JS comes from the Vite server (5173), and a root-relative
		// import would be fetched from there instead of the app (3000) that serves the extension's files
		const mod = await import(
			/* @vite-ignore */ new URL(url, window.location.origin).href
		);
		const cleanup = await mod.default?.(el, api);
		return typeof cleanup === "function" ? cleanup : () => {};
	} catch (e) {
		console.error(`[extensions] ${api.key}: ${url}`, e);
		el.textContent = `${api.key}: this extension's script failed to load — see the browser console.`;
		el.className = "text-sm text-destructive";
		return () => {};
	}
}
