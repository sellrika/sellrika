/**
 * One table's lines in one Kitchen column: the table and how long it has
 * waited (red once it is long), then a row per line with the dish's picture,
 * the quantity, the dish, the guest's note and the row's buttons. Rows come in already built
 * and wired (drag, buttons). The JSX here is plain DOM.
 */
import { icon } from "./icons.ts";

/**
 * Draw one table's group.
 * @param props.table The table name.
 * @param props.waited How long ago its oldest line reached the kitchen, formatted.
 * @param props.late True once that is long: the time turns red.
 * @param props.done True in the Done column: the lines are dimmed.
 * @param props.rows The line rows.
 * @returns The group element.
 */
export function KitchenGroup({
	table,
	waited,
	late,
	done,
	rows,
}: {
	table: string;
	waited: string;
	late: boolean;
	done: boolean;
	rows: HTMLElement[];
}) {
	const time = (
		<span
			class={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${late ? "bg-red-500/15 text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
		/>
	) as HTMLElement;
	time.innerHTML = icon("timer", 13);
	time.append(waited);
	return (
		<li
			class={`overflow-hidden rounded-xl border ${done ? "" : "bg-card"}`}
			data-kitchen-group={table}
		>
			<div class="flex items-center justify-between gap-2 border-b px-4 py-3">
				<span class={`font-semibold ${done ? "text-muted-foreground" : ""}`}>
					{table}
				</span>
				{time}
			</div>
			<ul class="divide-y px-4 py-1">{rows}</ul>
		</li>
	);
}

/**
 * Draw one line of a group: the dish's picture, then the quantity, the dish
 * and the buttons, and the guest's note on its own row under the dish
 * (a long note wraps).
 * @param props.qty How many.
 * @param props.name The dish.
 * @param props.image The dish's picture, or null: a plain box with a chef's hat then.
 * @param props.note The guest's request, "" = none.
 * @param props.done True in the Done column: dimmed.
 * @param props.cancelled The red label of a cancelled dish ("Cancelled 1 min ago · stop cooking"), else null.
 * @param props.label "1× Soup", for tests and screen readers.
 * @param props.actions The row's buttons.
 * @returns The row element.
 */
export function KitchenLine({
	qty,
	name,
	image,
	note,
	done,
	cancelled,
	label,
	actions,
}: {
	qty: number;
	name: string;
	image: string | null;
	note: string;
	done: boolean;
	cancelled: string | null;
	label: string;
	actions: HTMLElement[];
}) {
	const dim = done || !!cancelled;
	let stop: HTMLElement | string = "";
	if (cancelled) {
		stop = (
			<p class="flex w-fit items-center gap-1.5 rounded-md bg-red-500/15 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400" />
		) as HTMLElement;
		stop.innerHTML = icon("ban", 13);
		stop.append(cancelled);
	}
	let chip: HTMLElement | string = "";
	if (note) {
		const mark = (<span class="mt-0.5 shrink-0" />) as HTMLElement;
		mark.innerHTML = icon("note", 13);
		chip = (
			<p
				class={`flex w-fit max-w-full gap-1.5 rounded-md px-2 py-1 text-xs font-medium leading-snug ${dim ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
				data-note
			>
				{mark}
				<span>{note}</span>
			</p>
		) as HTMLElement;
	}
	const picture = (
		<span
			class={`flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground/60 ${dim ? "opacity-50" : ""}`}
			data-kitchen-image
		/>
	) as HTMLElement;
	if (image)
		picture.append(
			<img
				class="size-full object-cover"
				src={image}
				alt=""
				loading="lazy"
				draggable="false"
			/>,
		);
	else picture.innerHTML = icon("chef", 20);
	return (
		<li
			class="flex items-start gap-3 py-2.5"
			data-kitchen-item={label}
			data-kitchen-cancelled={cancelled ? "" : undefined}
		>
			{picture}
			<div class="grid min-w-0 flex-1 gap-2">
				<div class="flex min-h-12 items-center gap-2">
					<span
						class={`shrink-0 text-sm font-semibold tabular-nums ${dim ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}
					>
						{qty}×
					</span>
					<span
						class={`min-w-0 flex-1 text-sm font-medium ${dim ? "text-muted-foreground" : ""}`}
					>
						{name}
					</span>
					<div class="flex shrink-0 gap-2">{actions}</div>
				</div>
				{chip}
				{stop}
			</div>
		</li>
	);
}
