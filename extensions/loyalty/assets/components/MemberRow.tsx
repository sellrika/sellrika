/**
 * One member of the list: the name and phone, the points with a bar
 * that fills up to the goal, and the points earned in all.
 * The whole row is a button that opens the member's history.
 * The JSX here is plain DOM.
 */
import type { Member } from "../utils.ts";

/**
 * One row of the member list.
 * @param props.member The member.
 * @param props.name The name to show, never empty.
 * @param props.points The "40 of 100 points" text.
 * @param props.total The "140 earned in all" text.
 * @param props.share How full the bar is, from 0 to 1.
 * @param props.onclick Called when the row is pressed.
 * @returns The row element.
 */
export function MemberRow({
	member,
	name,
	points,
	total,
	share,
	onclick,
}: {
	member: Member;
	name: string;
	points: string;
	total: string;
	share: number;
	onclick: () => void;
}) {
	return (
		<li data-member={member.customer_id}>
			<button
				type="button"
				class="flex w-full items-center gap-4 rounded-md px-2 py-3 text-left hover:bg-muted/50"
				onclick={onclick}
			>
				<div class="min-w-0 flex-1">
					<div class="truncate font-medium">{name}</div>
					<div class="truncate text-sm text-muted-foreground">
						{member.phone || total}
					</div>
				</div>
				<div class="w-40 shrink-0">
					<div class="text-right text-sm tabular-nums">{points}</div>
					<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary"
							style={`width:${Math.round(share * 100)}%`}
						/>
					</div>
				</div>
			</button>
		</li>
	);
}
