/**
 * The "Kitchen" page, named in the manifest's `pages` (sidebar › Sales).
 * The app's page around it gives the title and the padding.
 * Three columns: To do (a line lands here once it is on a table's bill),
 * Preparing and Done. In each column the lines are grouped by table, the
 * table that waited longest first. A line is dragged to another column, or
 * moved with its buttons (Start, Done, Back) — the buttons are for touch
 * screens, where dragging does not work in every browser.
 * At the top: the longest wait of what is not done yet, red once it is long.
 * It asks the server again every few seconds, so new rounds show up.
 * JSX here is plain DOM, see ../../README.md › JSX.
 */
import type { Api, PageScript } from "../../types";
import {
	type KitchenAnswer,
	type KitchenCancelled,
	type KitchenItem,
	KITCHEN_STEPS,
	type KitchenStep,
} from "./utils.ts";
import { KitchenGroup, KitchenLine } from "./components/KitchenGroup.tsx";
import { icon, withIcon } from "./components/icons.ts";

/** How often the page asks for new lines. */
const REFRESH_MS = 5_000;
/** From how many minutes of waiting a time turns red. */
const LATE_MIN = 10;
/** Each column's dot colour. */
const DOTS: Record<KitchenStep, string> = {
	todo: "bg-amber-500",
	preparing: "bg-blue-500",
	done: "bg-green-500",
};

/**
 * Everything the page holds.
 */
type State = {
	api: Api;
	/**
	 * One list per step, where its groups are drawn, and its count.
	 */
	columns: Record<KitchenStep, { list: HTMLElement; count: HTMLElement }>;
	/**
	 * The "Longest wait" badge.
	 */
	longest: HTMLElement;
	/**
	 * The red "dishes were cancelled" banner over the columns.
	 */
	banner: HTMLElement;
	/**
	 * True while a move is on its way, so a refresh doesn't draw the old step.
	 */
	busy: boolean;
	/**
	 * The lines as last drawn, to find the one a drop names.
	 */
	items: KitchenItem[];
};

/** The drag's data type: `<order id>:<line id>`. */
const DRAG_TYPE = "text/plain";
/** The classes a column gets while a line is dragged over it. */
const DROP_HINT = ["ring-2", "ring-primary"];

/**
 * Minutes since a time.
 * @param at The ISO time.
 * @returns Whole minutes, never below 0.
 */
function minutesSince(at: string) {
	return Math.max(
		0,
		Math.floor((Date.now() - new Date(at).getTime()) / 60_000),
	);
}

/**
 * A wait as text.
 * @param s The page state.
 * @param min The minutes.
 * @returns "just now" or "12 min".
 */
function waitText(s: State, min: number) {
	return min < 1
		? s.api.t("kitchen.just_now")
		: s.api.t("kitchen.min", { min });
}

/**
 * Move a line to another step and draw the answer.
 * @param s The page state.
 * @param item The line.
 * @param step Where it goes.
 */
async function move(s: State, item: KitchenItem, step: KitchenStep) {
	s.busy = true;
	try {
		const res = await s.api.fetch(`/kitchen/${item.order_id}/${item.item_id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ step }),
		});
		if (!res.ok) throw new Error(String(res.status));
		render(s, await res.json());
	} catch {
		s.api.toast(s.api.t("kitchen.failed"), "error");
	} finally {
		s.busy = false;
	}
}

/**
 * The buttons of a line: back one step, and on one step.
 * @param s The page state.
 * @param item The line.
 * @returns The buttons.
 */
function buttons(s: State, item: KitchenItem) {
	const { api } = s;
	const at = KITCHEN_STEPS.indexOf(item.step);
	const out: HTMLElement[] = [];
	const prev = KITCHEN_STEPS[at - 1];
	const next = KITCHEN_STEPS[at + 1];
	if (prev) {
		const back = withIcon(
			api.ui.button(api.t("kitchen.back"), { size: "sm", variant: "outline" }),
			"undo",
		);
		back.onclick = () => move(s, item, prev);
		out.push(back);
	}
	if (next) {
		const on = api.ui.button(
			api.t(next === "preparing" ? "kitchen.start" : "kitchen.finish"),
			{ size: "sm" },
		);
		on.onclick = () => move(s, item, next);
		out.push(on);
	}
	return out;
}

/**
 * Let a line be dragged: it carries its ids.
 * @param row The line's row.
 * @param item Its line.
 * @returns The row.
 */
function draggable(row: HTMLElement, item: KitchenItem) {
	row.draggable = true;
	row.classList.add("cursor-grab");
	row.ondragstart = (e) =>
		e.dataTransfer?.setData(DRAG_TYPE, `${item.order_id}:${item.item_id}`);
	return row;
}

/**
 * Let a column take dropped lines: the line moves to that column's step.
 * @param s The page state.
 * @param column The column element.
 * @param step Its step.
 */
function dropZone(s: State, column: HTMLElement, step: KitchenStep) {
	column.ondragover = (e) => {
		e.preventDefault(); // allows the drop
		column.classList.add(...DROP_HINT);
	};
	column.ondragleave = (e) => {
		if (!column.contains(e.relatedTarget as Node | null))
			column.classList.remove(...DROP_HINT);
	};
	column.ondrop = (e) => {
		e.preventDefault();
		column.classList.remove(...DROP_HINT);
		const [order, line] = (e.dataTransfer?.getData(DRAG_TYPE) ?? "")
			.split(":")
			.map(Number);
		const item = s.items.find(
			(i) => i.order_id === order && i.item_id === line,
		);
		if (item && item.step !== step) void move(s, item, step);
	};
}

/** A line of a column: a dish to cook, or a cancelled one. */
type ColumnLine =
	| { item: KitchenItem; cancelled: null }
	| { item: null; cancelled: KitchenCancelled };

/**
 * A column's lines as tickets: one per round of a table (the lines that
 * reached the kitchen together), oldest first. A table's later round is its
 * own ticket further down, so other tables' earlier orders come first.
 * A cancelled dish shows in the ticket of its round.
 * @param lines The column's lines.
 * @returns The tickets.
 */
function ticketsOf(lines: ColumnLine[]) {
	const roundOf = (l: ColumnLine) => l.item?.at ?? l.cancelled!.round;
	const orderOf = (l: ColumnLine) => l.item?.order_id ?? l.cancelled!.order_id;
	const tickets = new Map<string, ColumnLine[]>();
	for (const line of [...lines].sort((a, b) =>
		roundOf(a).localeCompare(roundOf(b)),
	)) {
		const key = `${orderOf(line)}@${roundOf(line)}`;
		const ticket = tickets.get(key) ?? [];
		ticket.push(line);
		tickets.set(key, ticket);
	}
	return [...tickets.values()];
}

/**
 * The card an empty column shows.
 * @param s The page state.
 * @param step The column.
 * @returns The card.
 */
function emptyCard(s: State, step: KitchenStep) {
	const mark = (<span class="text-muted-foreground" />) as HTMLElement;
	mark.innerHTML = icon("checks", 22);
	return (
		<li class="grid justify-items-center gap-2 rounded-xl border px-6 py-10 text-center">
			{mark}
			<p class="font-medium">{s.api.t(`kitchen.empty_${step}`)}</p>
			{step === "todo" ? (
				<p class="text-sm text-muted-foreground">
					{s.api.t("kitchen.empty_todo_body")}
				</p>
			) : (
				""
			)}
		</li>
	);
}

/**
 * Draw the "Longest wait" badge: the oldest line not done yet.
 * @param s The page state.
 * @param items Every line.
 */
function renderLongest(s: State, items: KitchenItem[]) {
	const waiting = items.filter((i) => i.step !== "done");
	const min = waiting.length
		? Math.max(...waiting.map((i) => minutesSince(i.at)))
		: null;
	const late = min !== null && min >= LATE_MIN;
	const badge = (
		<span
			class={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${late ? "bg-red-500/15 text-red-600 dark:text-red-400" : "text-foreground"}`}
			data-longest-wait
		/>
	) as HTMLElement;
	badge.innerHTML = icon("timer", 14);
	badge.append(min === null ? "—" : waitText(s, min));
	s.longest.replaceChildren(
		<span class="text-sm text-muted-foreground">
			{s.api.t("kitchen.longest")}
		</span>,
		badge,
	);
}

/**
 * Draw the three columns and the longest wait.
 * @param s The page state.
 * @param data What the server answered.
 */
function render(s: State, data: KitchenAnswer) {
	s.items = data.items;
	renderLongest(s, data.items);
	renderBanner(s, data.cancelled.length);
	for (const step of KITCHEN_STEPS) {
		const items = data.items.filter((i) => i.step === step);
		const gone = data.cancelled.filter((c) => c.step === step);
		const { list, count } = s.columns[step];
		count.textContent = String(items.length);
		const done = step === "done";
		const tickets = ticketsOf([
			...items.map((item) => ({ item, cancelled: null })),
			...gone.map((c) => ({ item: null, cancelled: c })),
		]);
		list.replaceChildren(
			...(tickets.length
				? tickets.map(function ticket(lines) {
						const first = lines[0]!;
						const round = first.item?.at ?? first.cancelled!.round;
						const min = minutesSince(round);
						return (
							<KitchenGroup
								table={first.item?.table ?? first.cancelled!.table}
								waited={waitText(s, min)}
								late={!done && min >= LATE_MIN}
								done={done}
								rows={lines.map((line) =>
									line.item
										? draggable(
												<KitchenLine
													qty={line.item.qty}
													name={line.item.name}
													image={line.item.image}
													note={line.item.note}
													done={done}
													cancelled={null}
													label={`${line.item.qty}× ${line.item.name}`}
													actions={buttons(s, line.item)}
												/>,
												line.item,
											)
										: cancelledLine(s, line.cancelled!, done),
								)}
							/>
						);
					})
				: [emptyCard(s, step)]),
		);
	}
}

/**
 * A cancelled dish's row: dimmed, with its red label and Got it.
 * @param s The page state.
 * @param c The cancelled dish.
 * @param done True in the Done column.
 * @returns The row.
 */
function cancelledLine(s: State, c: KitchenCancelled, done: boolean) {
	const { api } = s;
	const ack = api.ui.button(api.t("kitchen.got_it"), {
		size: "sm",
		variant: "outline",
	});
	ack.onclick = () => gotIt(s, c);
	const min = minutesSince(c.at);
	const when =
		min < 1 ? api.t("kitchen.just_now") : api.t("kitchen.min_ago", { min });
	return (
		<KitchenLine
			qty={c.qty}
			name={c.name}
			image={c.image ?? null}
			note={c.note}
			done={done}
			cancelled={api.t(`kitchen.cancelled_${c.step}`, { when })}
			label={`${c.qty}× ${c.name}`}
			actions={[ack]}
		/>
	) as HTMLElement;
}

/**
 * "Got it": the cancelled dish leaves the page.
 * @param s The page state.
 * @param c The cancelled dish.
 */
async function gotIt(s: State, c: KitchenCancelled) {
	const res = await s.api.fetch(`/kitchen/cancelled/${c.id}/ack`, {
		method: "POST",
	});
	if (res.ok) render(s, await res.json());
	else s.api.toast(s.api.t("kitchen.failed"), "error");
}

/**
 * The red banner over the columns while dishes are cancelled and not yet seen.
 * @param s The page state.
 * @param count How many.
 */
function renderBanner(s: State, count: number) {
	const { api } = s;
	s.banner.hidden = count === 0;
	if (!count) return;
	const mark = (
		<span class="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
	) as HTMLElement;
	mark.innerHTML = icon("ban", 18);
	s.banner.replaceChildren(
		mark,
		<div class="grid gap-0.5">
			<p class="font-semibold">
				{api.t(
					count === 1 ? "kitchen.cancelled_one" : "kitchen.cancelled_many",
					{
						count,
					},
				)}
			</p>
			<p class="text-sm text-muted-foreground">
				{api.t("kitchen.cancelled_hint")}
			</p>
		</div>,
	);
}

/**
 * Ask the server for the lines and draw them.
 * @param s The page state.
 */
async function load(s: State) {
	try {
		const res = await s.api.fetch("/kitchen");
		if (!res.ok) throw new Error(String(res.status));
		const data = await res.json();
		if (!s.busy) render(s, data);
	} catch {
		s.api.toast(s.api.t("kitchen.load_failed"), "error");
	}
}

const mount: PageScript = async (el, api) => {
	const columns = {} as State["columns"];
	const s: State = {
		api,
		columns,
		longest: (<div class="flex items-center gap-2" />) as HTMLElement,
		banner: (
			<div
				class="flex gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3"
				role="alert"
				data-kitchen-banner
				hidden
			/>
		) as HTMLElement,
		busy: false,
		items: [],
	};
	const sections = KITCHEN_STEPS.map(function column(step) {
		// from md up the list scrolls by itself, under its heading (the page is `fill`)
		const list = (
			<ul class="grid auto-rows-max content-start gap-3 md:min-h-0 md:flex-1 md:overflow-y-auto" />
		) as HTMLElement;
		const count = (
			<span class="rounded-full bg-muted px-2 text-xs tabular-nums" />
		) as HTMLElement;
		columns[step] = { list, count };
		const section = (
			<section
				class="grid min-h-40 content-start gap-3 rounded-xl transition-shadow md:flex md:min-h-0 md:flex-col"
				data-kitchen-step={step}
			>
				<h2 class="flex items-center gap-2 border-b pb-3 font-semibold">
					<span class={`size-2 rounded-full ${DOTS[step]}`} />
					{api.t(`kitchen.${step}`)}
					{count}
				</h2>
				{list}
			</section>
		) as HTMLElement;
		dropZone(s, section, step);
		return section;
	});
	// no title or padding of its own: the app's page around it has both; Longest wait sits next to its title
	api.actions?.append(s.longest);
	el.replaceChildren(
		<div class="flex flex-col gap-6 md:h-full">
			{s.banner}
			<div class="grid gap-6 md:min-h-0 md:flex-1 md:grid-cols-[1fr_1fr_340px] md:grid-rows-[minmax(0,1fr)]">
				{sections}
			</div>
		</div>,
	);
	await load(s);
	const timer = setInterval(() => load(s), REFRESH_MS);
	return () => {
		clearInterval(timer);
		s.longest.remove();
	};
};
export default mount;
