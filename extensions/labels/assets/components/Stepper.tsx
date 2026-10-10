/**
 * The copies of one picked product: less, the number, more.
 * The JSX here is plain DOM.
 */
import { Icon } from "./icons.tsx";

const BUTTON =
	"flex size-9 items-center justify-center text-primary hover:bg-primary/10";

/**
 * Draw the stepper.
 * The number is a box, so many copies can be typed.
 * @param props.copies The copies now.
 * @param props.labels What a screen reader says for less, the box and more.
 * @param props.onstep Run with -1 or 1 when a button is clicked.
 * @param props.onset Run with the box when a number was typed.
 * @returns The stepper element.
 */
export function Stepper({
	copies,
	labels,
	onstep,
	onset,
}: {
	copies: number;
	labels: { less: string; copies: string; more: string };
	onstep: (by: number) => void;
	onset: (input: HTMLInputElement) => void;
}) {
	return (
		<div class="flex shrink-0 items-center overflow-hidden rounded-lg border border-primary/60 bg-primary/10">
			<button
				type="button"
				class={BUTTON}
				aria-label={labels.less}
				onclick={() => onstep(-1)}
			>
				<Icon name="minus" size={14} />
			</button>
			<input
				type="text"
				inputmode="numeric"
				value={String(copies)}
				aria-label={labels.copies}
				class="w-10 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
				onchange={(e: Event) => onset(e.target as HTMLInputElement)}
			/>
			<button
				type="button"
				class={BUTTON}
				aria-label={labels.more}
				onclick={() => onstep(1)}
			>
				<Icon name="plus" size={14} />
			</button>
		</div>
	);
}
