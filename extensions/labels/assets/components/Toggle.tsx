/**
 * The two on/off buttons of the page: a tab of the product list
 * and a chip for one part of the label.
 * The JSX here is plain DOM.
 */
import { Icon } from "./icons.tsx";

/**
 * One tab of the product list, with its count.
 * @param props.text The tab's name.
 * @param props.count The number beside it.
 * @param props.on Whether it is the open tab.
 * @param props.onclick Run when it is clicked.
 * @returns The tab button.
 */
export function Tab({
	text,
	count,
	on,
	onclick,
}: {
	text: string;
	count: number;
	on: boolean;
	onclick: () => void;
}) {
	return (
		<button
			type="button"
			class={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${on ? "bg-muted" : "text-muted-foreground hover:text-foreground"}`}
			aria-pressed={on ? "true" : "false"}
			onclick={onclick}
		>
			{text}
			<span class="font-normal text-muted-foreground tabular-nums">
				{count}
			</span>
		</button>
	);
}

/**
 * A chip that switches one part of the label on or off.
 * It shows a tick while on.
 * @param props.text The part's name.
 * @param props.on Whether the label shows it.
 * @param props.onclick Run when it is clicked.
 * @returns The chip button.
 */
export function Chip({
	text,
	on,
	onclick,
}: {
	text: string;
	on: boolean;
	onclick: () => void;
}) {
	return (
		<button
			type="button"
			class={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${on ? "border-primary/60 bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
			aria-pressed={on ? "true" : "false"}
			onclick={onclick}
		>
			{on ? <Icon name="check" size={14} class="text-primary" /> : null}
			{text}
		</button>
	);
}
