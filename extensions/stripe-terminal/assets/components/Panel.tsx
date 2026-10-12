/**
 * The card reader's box next to a pay dialog: a title, the amount asked
 * for, then whatever the step shows. The JSX here is plain DOM.
 */

/**
 * Draw the box.
 * @param props.title The box's heading.
 * @param props.amount The amount asked for, formatted.
 * @param props.phase The step it is on, for tests and styling.
 * @param props.body What the step shows: a line, a picker, buttons.
 * @returns The element.
 */
export function Panel({
	title,
	amount,
	phase,
	body,
}: {
	title: string;
	amount: string;
	phase: string;
	body: (Node | null)[];
}) {
	return (
		<div
			class="grid w-full gap-3 text-left"
			data-terminal
			data-terminal-phase={phase}
		>
			<div class="flex items-baseline justify-between gap-3">
				<p class="font-medium">{title}</p>
				<p class="text-lg font-semibold tabular-nums">{amount}</p>
			</div>
			{body}
		</div>
	);
}

/**
 * One line of status inside the box.
 * @param props.text What it says.
 * @param props.tone How it looks: plain, good (approved) or bad (declined).
 * @returns The element.
 */
export function StatusLine({
	text,
	tone = "plain",
}: {
	text: string;
	tone?: "plain" | "good" | "bad";
}) {
	const look = {
		plain: "text-sm text-muted-foreground",
		good: "text-base font-semibold text-primary",
		bad: "text-sm font-medium text-destructive",
	}[tone];
	return (
		<p class={look} data-terminal-status>
			{text}
		</p>
	);
}
