/**
 * The body of the Pay dialog: the discount box, the payment methods, the
 * amount received, the waiter and the sums. The JSX here is plain DOM.
 */
import { icon } from "./icons.ts";

/**
 * Draw the dialog body, laid out like the Sell screen's checkout: the
 * discount box, the payment methods, the amount received with quick amounts
 * (only for a method that takes cash), the waiter, then the sums.
 * Every control comes in already wired.
 * @param props.discount The discount box (`DiscountBox`).
 * @param props.methods The app's payment method buttons (`api.paymentPicker`), with their own label.
 * @param props.cash The amount received box (with an `id` for its label) and its quick amounts, or null for a method that takes no cash.
 * @param props.waiter The waiter select (with an `id`), or null when the shop has no sales staff.
 * @param props.sums The sums block, updated by the page as the amount is typed.
 * @param props.error Where a refusal is shown.
 * @param props.texts The words it shows, already translated.
 * @returns The body element.
 */
export function PayBody({
	discount,
	methods,
	cash,
	waiter,
	sums,
	error,
	texts,
}: {
	discount: HTMLElement;
	methods: HTMLElement;
	cash: { input: HTMLElement; quick: HTMLElement[] } | null;
	waiter: HTMLElement | null;
	sums: HTMLElement;
	error: HTMLElement;
	texts: {
		received: string;
		waiter: string;
	};
}) {
	return (
		<div class="grid gap-4">
			{discount}
			{methods}
			{cash ? (
				<div class="grid gap-2">
					<label class="text-sm font-medium" for={cash.input.id}>
						{texts.received}
					</label>
					{cash.input}
					<div class="flex flex-wrap gap-2">{cash.quick}</div>
				</div>
			) : (
				""
			)}
			{waiter ? (
				<div class="grid gap-2">
					<label class="text-sm font-medium" for={waiter.id}>
						{texts.waiter}
					</label>
					{waiter}
				</div>
			) : (
				""
			)}
			<div class="h-px bg-border" />
			{sums}
			{error}
		</div>
	);
}

/**
 * The sums of the Pay dialog: one row each, the last two (total, change) stronger.
 * @param props.rows Label and amount; `strong` = bold, `bad` = red (not enough money).
 * @returns The rows.
 */
export function PaySums({
	rows,
}: {
	rows: { label: string; amount: string; strong?: boolean; bad?: boolean }[];
}) {
	return (
		<dl class="grid gap-1 text-sm" data-pay-sums>
			{rows.map((row) => (
				<div
					class={`flex justify-between ${row.strong ? "font-semibold" : "text-muted-foreground"} ${row.bad ? "text-destructive" : ""}`}
				>
					<dt>{row.label}</dt>
					<dd class="tabular-nums">{row.amount}</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * The discount box of the Pay dialog, like the Sell screen's: closed it is one
 * row (Discount, and what is taken off, or "Add"); open it has a percent /
 * amount switch with a value box and Apply, quick percent buttons, a discount
 * code box, and Remove discount. The controls come in already wired.
 * @param props.applied What is on the bill: its label ("10% off", or the code) and the amount, or null.
 * @param props.types The percent / amount switch buttons.
 * @param props.value The value box.
 * @param props.apply The Apply button.
 * @param props.quick The quick percent buttons.
 * @param props.code The code box (with an `id` for its label).
 * @param props.applyCode The Apply code button.
 * @param props.remove The Remove discount button, or null when there is none.
 * @param props.error Where a refusal is shown.
 * @param props.texts The words it shows, already translated.
 * @returns The box, a `<details>` element.
 */
export function DiscountBox({
	applied,
	types,
	value,
	apply,
	quick,
	code,
	applyCode,
	remove,
	error,
	texts,
}: {
	applied: { label: string; amount: string } | null;
	types: HTMLElement[];
	value: HTMLElement;
	apply: HTMLElement;
	quick: HTMLElement[];
	code: HTMLElement;
	applyCode: HTMLElement;
	remove: HTMLElement | null;
	error: HTMLElement;
	texts: { title: string; add: string; code: string };
}) {
	const mark = (<span class="text-muted-foreground" />) as HTMLElement;
	mark.innerHTML = icon("tag", 14);
	return (
		<details class="rounded-lg border" data-discount>
			<summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
				<span class="flex min-w-0 items-center gap-2">
					{mark}
					<span class="font-medium">{texts.title}</span>
					{applied?.label ? (
						<span class="truncate text-muted-foreground">{applied.label}</span>
					) : (
						""
					)}
				</span>
				<span
					class={
						applied
							? "tabular-nums"
							: "text-muted-foreground hover:text-foreground"
					}
					data-discount-amount
				>
					{applied ? `−${applied.amount}` : texts.add}
				</span>
			</summary>
			<div class="grid gap-3 border-t p-3">
				<div class="flex gap-2">
					<div class="inline-flex h-9 shrink-0 rounded-md border p-0.5">
						{types}
					</div>
					{value}
					{apply}
				</div>
				<div class="flex flex-wrap gap-1.5">{quick}</div>
				<div class="grid gap-1.5 border-t pt-3">
					<label class="text-xs text-muted-foreground" for={code.id}>
						{texts.code}
					</label>
					<div class="flex gap-2">
						{code}
						{applyCode}
					</div>
				</div>
				{error}
				{remove ?? ""}
			</div>
		</details>
	);
}
