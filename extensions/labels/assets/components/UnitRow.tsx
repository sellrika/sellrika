/**
 * One product of the list: the picture, the name with its variant,
 * the price and barcode under it, and what the list puts at the right.
 * The JSX here is plain DOM.
 */
import type { Unit } from "../utils.ts";
import { Icon } from "./icons.tsx";

/**
 * Hide a picture that did not load.
 * @param e The picture's error event.
 */
function hide(e: Event) {
	(e.target as HTMLElement).style.visibility = "hidden";
}

/**
 * One row of the product list.
 * A unit with no barcode shows a warning in its place.
 * @param props.unit The product or variant.
 * @param props.price Its price, already as text.
 * @param props.noCode The warning text for a unit with no barcode.
 * @param props.action What sits at the right: Add, or the copies stepper.
 * @returns The row element.
 */
export function UnitRow({
	unit,
	price,
	noCode,
	action,
}: {
	unit: Unit;
	price: string;
	noCode: string;
	action: HTMLElement;
}) {
	return (
		<li class="flex items-center gap-4 py-3" data-unit={unit.key}>
			<div class="size-11 shrink-0 overflow-hidden rounded-lg bg-muted">
				{unit.image ? (
					<img
						src={unit.image}
						alt=""
						loading="lazy"
						class="size-full object-cover"
						onerror={hide}
					/>
				) : null}
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<span class="truncate font-medium">{unit.name}</span>
					{unit.variant ? (
						<span class="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
							{unit.variant}
						</span>
					) : null}
				</div>
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					<span class="tabular-nums">{price}</span>
					<span aria-hidden="true">·</span>
					{unit.code ? (
						<span class="truncate font-mono text-xs">{unit.code}</span>
					) : (
						<span class="flex items-center gap-1">
							<Icon name="alert" size={14} class="text-amber-500" />
							{noCode}
						</span>
					)}
				</div>
			</div>
			{action}
		</li>
	);
}
