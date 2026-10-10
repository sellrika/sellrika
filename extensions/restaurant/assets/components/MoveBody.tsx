/**
 * The body of the "Move or join tables" dialog: a switch between "Move to a
 * free table" and "Join with another table", that tab's tables as cards to
 * pick, then what will happen. The JSX here is plain DOM.
 */
import { icon } from "./icons.ts";

/** A table to pick: its name and what the card's second line says (Free, or its bill). */
type Pick = { name: string; line: string };

/**
 * One table card. The picked one is outlined, with a check.
 * @param props.pick The table.
 * @param props.picked True when it is the picked one.
 * @param props.onPick Called when it is clicked.
 * @returns The card, a button.
 */
function PickCard({
	pick,
	picked,
	onPick,
}: {
	pick: Pick;
	picked: boolean;
	onPick: () => void;
}) {
	const check = (<span class="text-primary" />) as HTMLElement;
	if (picked) check.innerHTML = icon("check", 14);
	const card = (
		<button
			type="button"
			class={`grid gap-1 rounded-xl border px-3.5 py-3 text-left text-sm transition-colors hover:border-primary/60 ${picked ? "border-primary bg-primary/10 ring-1 ring-primary" : ""}`}
			aria-pressed={picked ? "true" : "false"}
			data-pick={pick.name}
		>
			<span class="flex items-center justify-between gap-2 font-medium">
				{pick.name}
				{check}
			</span>
			<span class={picked ? "" : "text-muted-foreground"}>{pick.line}</span>
		</button>
	) as HTMLButtonElement;
	card.onclick = onPick;
	return card;
}

/** The two things the dialog does. */
export type MoveMode = "move" | "join";

/**
 * One tab of the switch at the top: its icon and its words. The picked one is raised.
 * @param props.on True when it is the picked tab.
 * @param props.mark The icon's name.
 * @param props.label Its words.
 * @param props.mode Which tab it is, for tests.
 * @param props.onPick Called when it is clicked.
 * @returns The tab, a button.
 */
function Tab({
	on,
	mark,
	label,
	mode,
	onPick,
}: {
	on: boolean;
	mark: "arrow" | "merge";
	label: string;
	mode: MoveMode;
	onPick: () => void;
}) {
	const sign = (
		<span class={on ? "text-primary" : "text-muted-foreground"} />
	) as HTMLElement;
	sign.innerHTML = icon(mark, 15);
	const tab = (
		<button
			type="button"
			class={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
			aria-pressed={on ? "true" : "false"}
			data-move-mode={mode}
		>
			{sign}
			{label}
		</button>
	) as HTMLButtonElement;
	tab.onclick = onPick;
	return tab;
}

/**
 * The "What happens" line of a move: from which table to which, and the bill that goes along.
 * @param props.from The table the guests leave.
 * @param props.to The table they go to.
 * @param props.bill "bill of THB 374.50".
 * @returns The line.
 */
function MoveLine({
	from,
	to,
	bill,
}: {
	from: string;
	to: string;
	bill: string;
}) {
	const arrow = (<span class="text-muted-foreground" />) as HTMLElement;
	arrow.innerHTML = icon("arrow", 14);
	return (
		<p class="flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="font-semibold">{from}</span>
			{arrow}
			<span class="font-semibold">{to}</span>
			<span class="text-muted-foreground">· {bill}</span>
		</p>
	);
}

/**
 * Draw the dialog body: the Move / Join switch, the tables of the picked
 * tab as cards, and what will happen once one is picked.
 * @param props.mode The picked tab.
 * @param props.onMode Called with a tab when it is clicked.
 * @param props.picks The tables of the picked tab.
 * @param props.picked The picked table's name, or null.
 * @param props.onPick Called with a table's name when its card is clicked.
 * @param props.summary The "What happens" box, or null before a pick: `move` = the
 * "Table 1 → Table 4 · bill of …" line (a move), `rows` + `total` = the two bills and their sum (a join).
 * @param props.texts The words it shows, already translated.
 * @returns The body element.
 */
export function MoveBody({
	mode,
	onMode,
	picks,
	picked,
	onPick,
	summary,
	texts,
}: {
	mode: MoveMode;
	onMode: (mode: MoveMode) => void;
	picks: Pick[];
	picked: string | null;
	onPick: (name: string) => void;
	summary: {
		move: { from: string; to: string; bill: string } | null;
		rows: [string, string][];
		total: [string, string] | null;
		after: string;
	} | null;
	texts: {
		tabMove: string;
		tabJoin: string;
		heading: string;
		count: string;
		what: string;
		none: string;
	};
}) {
	return (
		<div class="grid gap-5">
			<div class="grid grid-cols-2 gap-1 rounded-xl border p-1">
				<Tab
					on={mode === "move"}
					mark="arrow"
					label={texts.tabMove}
					mode="move"
					onPick={() => onMode("move")}
				/>
				<Tab
					on={mode === "join"}
					mark="merge"
					label={texts.tabJoin}
					mode="join"
					onPick={() => onMode("join")}
				/>
			</div>
			{picks.length ? (
				<div class="grid gap-2.5">
					<p class="flex flex-wrap items-baseline gap-x-2 text-sm">
						<span class="font-medium">{texts.heading}</span>
						<span class="text-muted-foreground">{texts.count}</span>
					</p>
					<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
						{picks.map((pick) => (
							<PickCard
								pick={pick}
								picked={picked === pick.name}
								onPick={() => onPick(pick.name)}
							/>
						))}
					</div>
				</div>
			) : (
				<p class="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
					{texts.none}
				</p>
			)}
			{summary ? (
				<div
					class="grid gap-2.5 rounded-xl bg-muted/50 p-4 text-sm"
					data-move-summary
				>
					<p class="text-xs font-medium text-muted-foreground">{texts.what}</p>
					{summary.move ? <MoveLine {...summary.move} /> : ""}
					{summary.rows.map(([left, right]) => (
						<p class="flex justify-between gap-3 text-muted-foreground">
							<span>{left}</span>
							<span class="tabular-nums">{right}</span>
						</p>
					))}
					{summary.total ? (
						<p class="flex items-baseline justify-between gap-3 border-t pt-2.5 font-semibold">
							<span>{summary.total[0]}</span>
							<span class="text-base tabular-nums">{summary.total[1]}</span>
						</p>
					) : (
						""
					)}
					<p class="text-muted-foreground">{summary.after}</p>
				</div>
			) : (
				""
			)}
		</div>
	);
}
