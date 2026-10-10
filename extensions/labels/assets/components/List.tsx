/**
 * A list of rows, or one muted line when there are none.
 * The JSX here is plain DOM.
 */

/**
 * A list of rows, or one muted line when there are none.
 * @param props.rows The rows to show, already built.
 * @param props.empty The line to show when there are no rows.
 * @returns The list element.
 */
export function List({ rows, empty }: { rows: HTMLElement[]; empty: string }) {
	return (
		<ul class="divide-y">
			{rows.length ? (
				rows
			) : (
				<li class="py-6 text-center text-sm text-muted-foreground">{empty}</li>
			)}
		</ul>
	);
}
