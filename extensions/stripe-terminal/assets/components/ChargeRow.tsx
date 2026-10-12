/**
 * One card payment of an order, in the order page's dialog: the amount,
 * where it stands, and what went back to the card. The JSX is plain DOM.
 */

/**
 * Draw the row.
 * @param props.amount The amount the reader asked for, formatted.
 * @param props.state Where it stands, as a line of text.
 * @param props.bad True when the money was not taken.
 * @param props.refunded The "refund done" line, or "" for none.
 * @param props.failed The "refund failed" line, or "" for none.
 * @param props.error Why the last try failed, or "" for none.
 * @returns The element.
 */
export function ChargeRow({
	amount,
	state,
	bad,
	refunded,
	failed,
	error,
}: {
	amount: string;
	state: string;
	bad: boolean;
	refunded: string;
	failed: string;
	error: string;
}) {
	return (
		<li class="grid gap-1 rounded-lg border p-3 text-sm" data-terminal-charge>
			<div class="flex items-baseline justify-between gap-3">
				<span class={bad ? "font-medium text-destructive" : "font-medium"}>
					{state}
				</span>
				<span class="tabular-nums">{amount}</span>
			</div>
			{refunded ? <p class="text-muted-foreground">{refunded}</p> : null}
			{failed ? <p class="font-medium text-destructive">{failed}</p> : null}
			{error ? <p class="text-xs text-muted-foreground">{error}</p> : null}
		</li>
	);
}
