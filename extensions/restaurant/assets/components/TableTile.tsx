/**
 * One table in the Tables grid: its name, whether it has a QR code, open or
 * free (and for how long), and its bill. Clicking it selects it.
 * The JSX here is plain DOM.
 */
import { icon } from "./icons.ts";

/**
 * Draw one tile.
 * @param props.name The table name.
 * @param props.hasQr True when its QR code works.
 * @param props.status "Open · 38 min" or "Free".
 * @param props.open True when it has an open bill.
 * @param props.total The bill's total, formatted, or null.
 * @param props.count "4 items", or null.
 * @param props.selected True for the table in the side panel.
 * @param props.texts The words it shows, already translated.
 * @returns The tile, a button.
 */
export function TableTile({
	name,
	hasQr,
	status,
	open,
	total,
	count,
	selected,
	texts,
}: {
	name: string;
	hasQr: boolean;
	status: string;
	open: boolean;
	total: string | null;
	count: string | null;
	selected: boolean;
	texts: { noQr: string; noBill: string };
}) {
	const qr = hasQr ? (
		<span class="text-muted-foreground/70" title="QR" />
	) : (
		<span class="text-xs text-muted-foreground/70">{texts.noQr}</span>
	);
	if (hasQr) (qr as HTMLElement).innerHTML = icon("qr", 16);
	return (
		<button
			type="button"
			class={`flex min-h-35 flex-col justify-between rounded-xl border p-4 text-left transition-colors hover:border-primary/60 ${open ? "bg-card" : ""} ${selected ? "border-primary ring-[0.5px] ring-primary" : ""}`}
			data-table={name}
			aria-pressed={selected ? "true" : "false"}
		>
			<span class="grid gap-1.5">
				<span class="flex items-center justify-between gap-2">
					<span class="font-semibold">{name}</span>
					{qr}
				</span>
				<span
					class={`flex items-center gap-1.5 text-sm ${open ? "text-muted-foreground" : "text-muted-foreground/70"}`}
					data-table-status
				>
					<span
						class={`size-2 rounded-full ${open ? "bg-primary" : "border border-muted-foreground/70"}`}
					/>
					{status}
				</span>
			</span>
			{total ? (
				<span class="flex items-end justify-between gap-2">
					<span class="text-xl font-semibold tabular-nums">{total}</span>
					<span class="pb-0.5 text-sm text-muted-foreground">
						{count ?? ""}
					</span>
				</span>
			) : (
				<span class="text-sm text-muted-foreground/70">{texts.noBill}</span>
			)}
		</button>
	);
}
