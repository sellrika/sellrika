/**
 * What the customer's screen shows while the card reader waits: the
 * amount and one line that says what to do. The JSX here is plain DOM.
 */

/**
 * Fill the customer's screen.
 * A pay dialog sets `--display-height`, so there it is only as tall as it needs.
 */
const FILL = "min-height:var(--display-height, calc(100dvh - 3rem))";

/**
 * Draw the notice in the middle of the screen.
 * @param props.amount The amount asked for, formatted.
 * @param props.hint The line that says what to do.
 * @returns The element.
 */
export function TapNotice({ amount, hint }: { amount: string; hint: string }) {
	return (
		<div
			class="flex flex-col items-center justify-center gap-6 text-center"
			style={FILL}
			data-terminal-screen
		>
			<p class="text-6xl font-semibold tabular-nums">{amount}</p>
			<p class="text-3xl text-muted-foreground">{hint}</p>
		</div>
	);
}
