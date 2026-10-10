/**
 * One line of a member's history: what happened, when, and the points.
 * The JSX here is plain DOM.
 */

/**
 * One row of the history list.
 * @param props.text What happened, already as text.
 * @param props.when When it happened, already as text.
 * @param props.points The points added or taken.
 * @returns The row element.
 */
export function HistoryRow({
	text,
	when,
	points,
}: {
	text: string;
	when: string;
	points: number;
}) {
	return (
		<li class="flex items-center justify-between gap-4 py-2.5 text-sm">
			<div class="min-w-0">
				<div class="truncate">{text}</div>
				<div class="text-xs text-muted-foreground">{when}</div>
			</div>
			<span
				class={`shrink-0 font-medium tabular-nums ${points < 0 ? "text-muted-foreground" : "text-emerald-600"}`}
			>
				{points > 0 ? `+${points}` : String(points)}
			</span>
		</li>
	);
}
