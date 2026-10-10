/**
 * The "Labels" page, named in the manifest's `pages`.
 * It sits in the sidebar's Catalog group.
 * Left: the products, each with Add or its copies.
 * Right: the label as it prints, its size and what it shows.
 * The labels are drawn in the browser and printed from a hidden frame.
 * JSX here is plain DOM, see ../../README.md › JSX.
 * The smaller pieces live in components/.
 */
import type { Api, PageScript } from "../../types";
import { Icon } from "./components/icons.tsx";
import { Label } from "./components/Label.tsx";
import { List } from "./components/List.tsx";
import { Stepper } from "./components/Stepper.tsx";
import { Chip, Tab } from "./components/Toggle.tsx";
import { UnitRow } from "./components/UnitRow.tsx";
import {
	DEFAULT_SIZE,
	json,
	labelName,
	MAX_LABELS,
	money,
	SEARCH_DEBOUNCE_MS,
	SIZES,
	type Show,
	type Size,
	type Unit,
} from "./utils.ts";

/**
 * How wide the preview label is drawn, in mm, whatever its real size.
 */
const PREVIEW_MM = 80;

/**
 * The space kept under the product list, for the card's padding
 * and the page's own.
 */
const LIST_BOTTOM_PX = 48;

/**
 * The product list is never shorter than this, on a very low screen.
 */
const LIST_MIN_PX = 240;

/**
 * The parts of a label, in the order of their chips.
 */
const PARTS = ["name", "price", "code"] as const;

/**
 * A picked unit and how many labels it gets.
 */
type Picked = { unit: Unit; copies: number };

/**
 * Everything the page holds.
 */
type State = {
	/**
	 * The extension api of this page.
	 */
	api: Api;
	/**
	 * The units of the last search.
	 */
	results: Unit[];
	/**
	 * The picked units, by key.
	 */
	picked: Map<string, Picked>;
	/**
	 * Which list is open: every result, or only the picked ones.
	 */
	tab: "all" | "picked";
	/**
	 * Which picked unit the preview shows, counted from 0.
	 */
	at: number;
	/**
	 * The label size.
	 */
	size: Size;
	/**
	 * Which parts the label shows.
	 */
	show: Show;
	/**
	 * The timer of the waiting search, if one is waiting.
	 */
	timer?: ReturnType<typeof setTimeout>;
	/**
	 * The search box.
	 */
	box: HTMLInputElement;
	/**
	 * The number next to the "Products" title.
	 */
	found: HTMLElement;
	/**
	 * Where the two tabs are drawn.
	 */
	tabs: HTMLElement;
	/**
	 * Where the product list is drawn.
	 */
	list: HTMLElement;
	/**
	 * Where "name · 1 of 4" and its arrows are drawn.
	 */
	pager: HTMLElement;
	/**
	 * Where the preview label is drawn.
	 */
	preview: HTMLElement;
	/**
	 * Where the Name / Price / Barcode chips are drawn.
	 */
	chips: HTMLElement;
	/**
	 * The Clear all button.
	 */
	clearBtn: HTMLButtonElement;
	/**
	 * The Print button.
	 */
	printBtn: HTMLButtonElement;
	/**
	 * The text inside the Print button.
	 */
	printText: HTMLElement;
};

/**
 * The price of a unit as text, in the shop's currency.
 * @param s The page state.
 * @param unit The unit.
 * @returns The price text.
 */
function priceOf(s: State, unit: Unit) {
	return money(unit.price, s.api.shop.currency, s.api.locale);
}

/**
 * How many labels the list holds, all copies counted.
 * @param s The page state.
 * @returns The number of labels.
 */
function total(s: State) {
	let n = 0;
	for (const item of s.picked.values()) n += item.copies;
	return n;
}

/**
 * Build one label for a unit, with the page's size and options.
 * @param s The page state.
 * @param unit The unit.
 * @returns The label element.
 */
function labelOf(s: State, unit: Unit) {
	return (
		<Label unit={unit} size={s.size} show={s.show} price={priceOf(s, unit)} />
	);
}

/**
 * Draw the two header buttons: Clear all, and Print with its count.
 * @param s The page state.
 */
function renderActions(s: State) {
	const n = total(s);
	s.clearBtn.disabled = n === 0;
	s.printBtn.disabled = n === 0;
	s.printText.textContent =
		n === 0
			? s.api.t("print.button")
			: s.api.t(n === 1 ? "print.one" : "print.many", { count: n });
}

/**
 * Draw the tabs and the number next to the title.
 * @param s The page state.
 */
function renderTabs(s: State) {
	s.found.textContent = String(s.results.length);
	s.tabs.replaceChildren(
		<Tab
			text={s.api.t("tab.all")}
			count={s.results.length}
			on={s.tab === "all"}
			onclick={() => setTab(s, "all")}
		/>,
		<Tab
			text={s.api.t("tab.picked")}
			count={s.picked.size}
			on={s.tab === "picked"}
			onclick={() => setTab(s, "picked")}
		/>,
	);
}

/**
 * Build what sits at the right of a row.
 * A picked unit gets its copies stepper, any other an Add button.
 * @param s The page state.
 * @param unit The unit of the row.
 * @returns The stepper or the button.
 */
function actionOf(s: State, unit: Unit): HTMLElement {
	const item = s.picked.get(unit.key);
	const name = labelName(unit);
	if (item)
		return (
			<Stepper
				copies={item.copies}
				labels={{
					less: s.api.t("picked.less", { name }),
					copies: s.api.t("picked.copies", { name }),
					more: s.api.t("picked.more", { name }),
				}}
				onstep={(by: number) => setCopies(s, unit, item.copies + by)}
				onset={(input: HTMLInputElement) =>
					setCopies(s, unit, Math.floor(Number(input.value)) || 1)
				}
			/>
		);
	const add = s.api.ui.button(s.api.t("search.add"), {
		variant: "outline",
		size: "sm",
	});
	add.prepend(<Icon name="plus" size={14} />);
	add.onclick = () => setCopies(s, unit, 1);
	return add;
}

/**
 * Draw the open list: every search result, or only the picked units.
 * @param s The page state.
 */
function renderList(s: State) {
	const all = s.tab === "all";
	const units = all
		? s.results
		: [...s.picked.values()].map((item) => item.unit);
	const rows = units.map(function row(unit) {
		return (
			<UnitRow
				unit={unit}
				price={priceOf(s, unit)}
				noCode={s.api.t("picked.no_code")}
				action={actionOf(s, unit)}
			/>
		);
	});
	s.list.replaceChildren(
		<List rows={rows} empty={s.api.t(all ? "search.none" : "picked.none")} />,
	);
}

/**
 * One arrow of the preview's pager.
 * @param props.s The page state.
 * @param props.by -1 for the label before, 1 for the next one.
 * @returns The arrow button.
 */
function PagerButton({ s, by }: { s: State; by: number }) {
	return (
		<button
			type="button"
			class="flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground"
			aria-label={s.api.t(by < 0 ? "label.prev" : "label.next")}
			onclick={() => turn(s, by)}
		>
			<Icon name={by < 0 ? "left" : "right"} size={14} />
		</button>
	);
}

/**
 * Draw the preview and the pager over it.
 * It walks through the picked units, one label each.
 * With nothing picked it shows the first search result and no pager.
 * @param s The page state.
 */
function renderPreview(s: State) {
	const units = [...s.picked.values()].map((item) => item.unit);
	s.at = Math.max(0, Math.min(s.at, units.length - 1));
	const unit = units[s.at] ?? s.results[0];
	s.pager.replaceChildren(
		...(units.length && unit
			? [
					<PagerButton s={s} by={-1} />,
					<span class="truncate text-sm text-muted-foreground">
						{s.api.t("label.of", {
							name: labelName(unit),
							at: s.at + 1,
							count: units.length,
						})}
					</span>,
					<PagerButton s={s} by={1} />,
				]
			: []),
	);
	s.preview.replaceChildren(
		unit ? (
			<div
				class="overflow-hidden rounded-md shadow-sm"
				style={`zoom:${PREVIEW_MM / s.size.w};line-height:0`}
			>
				{labelOf(s, unit)}
			</div>
		) : (
			<p class="py-8 text-sm text-muted-foreground">{s.api.t("label.empty")}</p>
		),
		<p class="text-xs text-muted-foreground">
			{s.size.w} × {s.size.h} mm
		</p>,
	);
}

/**
 * Draw the Name / Price / Barcode chips.
 * @param s The page state.
 */
function renderChips(s: State) {
	s.chips.replaceChildren(
		...PARTS.map(function chip(part) {
			return (
				<Chip
					text={s.api.t(`show.${part}`)}
					on={s.show[part]}
					onclick={() => setShow(s, part, !s.show[part])}
				/>
			);
		}),
	);
}

/**
 * Draw everything that follows the picked list.
 * @param s The page state.
 */
function render(s: State) {
	renderActions(s);
	renderTabs(s);
	renderList(s);
	renderPreview(s);
}

/**
 * Set how many labels a unit gets.
 * Zero takes it off the list. More than the print can hold is cut down.
 * @param s The page state.
 * @param unit The unit.
 * @param wanted The copies asked for.
 */
function setCopies(s: State, unit: Unit, wanted: number) {
	const room = MAX_LABELS - total(s) + (s.picked.get(unit.key)?.copies ?? 0);
	if (wanted > room)
		s.api.toast(s.api.t("picked.max", { max: MAX_LABELS }), "error");
	const copies = Math.min(wanted, room);
	if (copies < 1) s.picked.delete(unit.key);
	else {
		// a unit new to the list becomes the one in the preview
		if (!s.picked.has(unit.key)) s.at = s.picked.size;
		s.picked.set(unit.key, { unit, copies });
	}
	render(s);
}

/**
 * Take every unit off the list.
 * @param s The page state.
 */
function clearAll(s: State) {
	s.picked.clear();
	s.tab = "all";
	render(s);
}

/**
 * Open one of the two lists.
 * @param s The page state.
 * @param tab The list to open.
 */
function setTab(s: State, tab: State["tab"]) {
	s.tab = tab;
	renderTabs(s);
	renderList(s);
}

/**
 * Show the label before or after the one in the preview.
 * The last one is followed by the first.
 * @param s The page state.
 * @param by -1 or 1.
 */
function turn(s: State, by: number) {
	s.at = (s.at + by + s.picked.size) % s.picked.size;
	renderPreview(s);
}

/**
 * Take the size picked in the select box.
 * @param s The page state.
 * @param id The picked size id.
 */
function setSize(s: State, id: string) {
	s.size = SIZES.find((size) => size.id === id) ?? DEFAULT_SIZE;
	renderPreview(s);
}

/**
 * Switch one part of the label on or off.
 * @param s The page state.
 * @param part The part.
 * @param on Whether the label shows it.
 */
function setShow(s: State, part: keyof Show, on: boolean) {
	s.show[part] = on;
	renderChips(s);
	renderPreview(s);
}

/**
 * Keep the product list inside the screen: it ends a little above the
 * bottom edge and scrolls when it holds more rows than fit.
 * @param s The page state.
 */
function fitList(s: State) {
	const top = s.list.getBoundingClientRect().top + window.scrollY;
	s.list.style.maxHeight = `max(${LIST_MIN_PX}px, calc(100dvh - ${Math.ceil(top) + LIST_BOTTOM_PX}px))`;
}

/**
 * Load the units that match the search box, through `GET /products`.
 * An empty box loads the first page of the product list.
 * A failed search shows a toast and no results.
 * @param s The page state.
 */
async function search(s: State) {
	const q = s.box.value.trim();
	let results: Unit[] = [];
	try {
		results = (
			await json<{ items: Unit[] }>(
				await s.api.fetch(`/products?q=${encodeURIComponent(q)}`),
			)
		).items;
	} catch (e) {
		s.api.toast(
			s.api.t("search.failed", { error: (e as Error).message }),
			"error",
		);
	}
	// Only draw when the box still holds what this run searched for.
	// Otherwise a newer search is on its way and will draw instead.
	if (s.box.value.trim() !== q) return;
	s.results = results;
	s.tab = "all";
	render(s);
}

/**
 * Search a moment after the last keystroke.
 * @param s The page state.
 */
function searchSoon(s: State) {
	clearTimeout(s.timer);
	s.timer = setTimeout(() => search(s), SEARCH_DEBOUNCE_MS);
}

/**
 * The stylesheet of the print frame.
 * A roll makes the paper as big as one label.
 * A sheet is A4 with the labels in a grid from the top left corner.
 * @param size The label size.
 * @returns The CSS.
 */
function printCss(size: Size) {
	const paper = size.cols ? "A4" : `${size.w}mm ${size.h}mm`;
	return `@page{size:${paper};margin:0}html,body{margin:0;padding:0}.page{display:grid;grid-template-columns:repeat(${size.cols || 1},${size.w}mm);grid-auto-rows:${size.h}mm}.page+.page{break-before:page}`;
}

/**
 * Build the pages to print: every picked unit, as many times as its copies.
 * A roll gets one label per page, a sheet `cols × rows`.
 * @param s The page state.
 * @returns The page elements.
 */
function pagesOf(s: State) {
	const labels: HTMLElement[] = [];
	for (const item of s.picked.values())
		for (let i = 0; i < item.copies; i++) labels.push(labelOf(s, item.unit));
	const perPage = s.size.cols * s.size.rows || 1;
	const pages: HTMLElement[] = [];
	for (let i = 0; i < labels.length; i += perPage)
		pages.push(<div class="page">{labels.slice(i, i + perPage)}</div>);
	return pages;
}

/**
 * Print the labels from a hidden frame, so the app's page is not printed.
 * The frame is removed once the print window closes.
 * @param s The page state.
 */
function printLabels(s: State) {
	const frame = document.createElement("iframe");
	frame.style.cssText =
		"position:fixed;right:0;bottom:0;width:0;height:0;border:0";
	document.body.append(frame);
	const win = frame.contentWindow;
	const doc = frame.contentDocument;
	if (!win || !doc) return frame.remove();
	const style = doc.createElement("style");
	style.textContent = printCss(s.size);
	doc.head.append(style);
	doc.body.append(...pagesOf(s));
	win.onafterprint = () => frame.remove();
	win.focus();
	win.print();
}

/**
 * Build the page and wire its handlers.
 * @param el The element the page is drawn into.
 * @param api The extension api of this page.
 * @returns A cleanup that drops the search timer and the header buttons.
 */
const mount: PageScript = (el, api) => {
	const box = api.ui.searchInput({
		placeholder: api.t("search.placeholder"),
		"aria-label": api.t("search.placeholder"),
	});
	const printBtn = api.ui.button("");
	const printText = (<span />) as HTMLElement;
	printBtn.append(<Icon name="printer" />, printText);
	const s: State = {
		api,
		results: [],
		picked: new Map(),
		tab: "all",
		at: 0,
		size: DEFAULT_SIZE,
		show: { name: true, price: true, code: true },
		box: box.input,
		found: <span class="text-sm font-normal text-muted-foreground" />,
		tabs: <div class="flex shrink-0 gap-1 rounded-lg border p-1" />,
		list: <div class="-mr-2 overflow-y-auto pr-2" />,
		pager: <div class="flex min-w-0 items-center gap-2" />,
		preview: (
			<div class="flex flex-col items-center gap-3 overflow-hidden rounded-xl border bg-muted/30 px-4 py-8" />
		),
		chips: <div class="flex flex-wrap gap-2" />,
		clearBtn: api.ui.button(api.t("picked.clear"), { variant: "outline" }),
		printBtn,
		printText,
	};
	const sizes = api.ui.select(
		SIZES.map((size) => ({ value: size.id, label: api.t(`size.${size.id}`) })),
		{ value: s.size.id, "aria-label": api.t("size.label") },
	);
	const actions = (
		<div class="flex items-center gap-2">
			{s.clearBtn}
			{s.printBtn}
		</div>
	) as HTMLElement;
	el.replaceChildren(
		api.actions ? "" : <div class="mb-4 flex justify-end">{actions}</div>,
		<div class="grid items-start gap-4 lg:grid-cols-5">
			<div class="lg:col-span-3">
				{api.ui.card(
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="text-base font-semibold">
							{api.t("products.title")} {s.found}
						</h2>
						<span class="text-sm text-muted-foreground">
							{api.t("products.hint")}
						</span>
					</div>,
					<div class="flex items-center gap-3">
						<div class="min-w-0 flex-1">{box}</div>
						{s.tabs}
					</div>,
					s.list,
				)}
			</div>
			<div class="lg:col-span-2">
				{api.ui.card(
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-base font-semibold">{api.t("label.title")}</h2>
						{s.pager}
					</div>,
					s.preview,
					<div class="grid items-center gap-x-4 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
						<span class="text-muted-foreground">{api.t("size.label")}</span>
						{sizes}
						<span class="text-muted-foreground">{api.t("show.label")}</span>
						{s.chips}
					</div>,
					<p class="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
						<Icon name="info" class="text-blue-500" />
						{api.t("print.hint")}
					</p>,
				)}
			</div>
		</div>,
	);
	api.actions?.append(actions);
	s.box.oninput = () => searchSoon(s);
	sizes.onchange = () => setSize(s, sizes.value);
	s.clearBtn.onclick = () => clearAll(s);
	s.printBtn.onclick = () => printLabels(s);
	const refit = () => fitList(s);
	window.addEventListener("resize", refit);
	renderChips(s);
	render(s);
	fitList(s);
	void search(s);
	return () => {
		clearTimeout(s.timer);
		window.removeEventListener("resize", refit);
		actions.remove();
	};
};

export default mount;
