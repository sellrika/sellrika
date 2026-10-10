/**
 * The "Loyalty" page, named in the manifest's `pages`.
 * It sits in the sidebar's Sales group.
 * It lists the members with their points, and a search by name or phone.
 * Pressing a member opens their history in a dialog.
 * The page only reads: points change on the server when an order is paid.
 * JSX here is plain DOM, see ../../README.md › JSX.
 * The smaller pieces live in components/.
 */
import type { Api, PageScript } from "../../types";
import { HistoryRow } from "./components/HistoryRow.tsx";
import { List } from "./components/List.tsx";
import { MemberRow } from "./components/MemberRow.tsx";
import {
	type Entry,
	json,
	type Member,
	type MembersAnswer,
	type Page,
	SEARCH_DEBOUNCE_MS,
} from "./utils.ts";

/**
 * Everything the page holds.
 */
type State = {
	/**
	 * The extension api of this page.
	 */
	api: Api;
	/**
	 * What the search box holds.
	 */
	q: string;
	/**
	 * The page of the member list that is shown.
	 */
	page: number;
	/**
	 * The timer of the search box's wait.
	 */
	timer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Where the member list is drawn.
	 */
	list: HTMLElement;
	/**
	 * Where the count and the Previous / Next buttons are drawn.
	 */
	pager: HTMLElement;
};

/**
 * The name shown for a member.
 * @param api The extension api.
 * @param member The member.
 * @returns The customer's name, or "Customer #12" when it has none.
 */
function nameOf(api: Api, member: Member) {
	return member.name || api.t("members.no_name", { id: member.customer_id });
}

/**
 * The text of one history line.
 * @param api The extension api.
 * @param entry The line.
 * @returns What happened, in the page's language.
 */
function textOf(api: Api, entry: Entry) {
	return api.t(`history.${entry.type}`, {
		reference: entry.reference ?? "",
		code: entry.code ?? "",
	});
}

/**
 * Load one page of a member's history into the dialog's list.
 * @param api The extension api.
 * @param member The member.
 * @param page The page to load, from 1.
 * @param list Where the lines are added.
 * @param more The "Show more" button, hidden after the last page.
 */
async function loadHistory(
	api: Api,
	member: Member,
	page: number,
	list: HTMLElement,
	more: HTMLButtonElement,
) {
	const answer = await json<Page<Entry>>(
		await api.fetch(`/members/${member.customer_id}/history?page=${page}`),
	);
	const when = new Intl.DateTimeFormat(api.locale, {
		dateStyle: "medium",
		timeStyle: "short",
	});
	for (const entry of answer.data)
		list.append(
			<HistoryRow
				text={textOf(api, entry)}
				when={when.format(new Date(entry.at))}
				points={entry.points}
			/>,
		);
	if (!answer.total)
		list.append(
			<li class="py-6 text-center text-sm text-muted-foreground">
				{api.t("history.none")}
			</li>,
		);
	more.hidden = answer.page >= answer.last_page;
	more.onclick = () => loadHistory(api, member, page + 1, list, more);
}

/**
 * Open a member's history in a dialog.
 * @param api The extension api.
 * @param member The member.
 */
function openHistory(api: Api, member: Member) {
	const list = (<ul class="divide-y" />) as HTMLElement;
	const more = api.ui.button(api.t("history.more"), {
		variant: "outline",
		size: "sm",
	});
	more.hidden = true;
	api.dialog({
		title: api.t("history.title", { name: nameOf(api, member) }),
		description: api.t("members.total", { total: member.total }),
		body: (
			<div class="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
				{list}
				{more}
			</div>
		) as HTMLElement,
	});
	loadHistory(api, member, 1, list, more).catch(function failed(error) {
		api.toast(api.t("members.failed", { error: String(error) }), "error");
	});
}

/**
 * Draw the member list and the pager under it.
 * @param s The page state.
 * @param answer The members to show.
 */
function render(s: State, answer: MembersAnswer) {
	const { api } = s;
	const rows = answer.data.map(function row(member) {
		return (
			<MemberRow
				member={member}
				name={nameOf(api, member)}
				points={api.t("members.points", {
					points: member.points,
					goal: answer.goal,
				})}
				total={api.t("members.total", { total: member.total })}
				share={answer.goal > 0 ? Math.min(1, member.points / answer.goal) : 0}
				onclick={() => openHistory(api, member)}
			/>
		);
	});
	s.list.replaceChildren(
		<List
			rows={rows}
			empty={api.t(s.q ? "members.none_found" : "members.none")}
		/>,
	);
	const prev = api.ui.button(api.t("pager.prev"), {
		variant: "outline",
		size: "sm",
	});
	const next = api.ui.button(api.t("pager.next"), {
		variant: "outline",
		size: "sm",
	});
	prev.disabled = answer.page <= 1;
	next.disabled = answer.page >= answer.last_page;
	prev.onclick = () => load(s, answer.page - 1);
	next.onclick = () => load(s, answer.page + 1);
	s.pager.replaceChildren(
		<span class="text-sm text-muted-foreground">
			{api.t("members.count", { count: answer.total })}
		</span>,
		...(answer.last_page > 1
			? [
					<div class="flex items-center gap-2">
						<span class="text-sm text-muted-foreground">
							{api.t("pager.page", {
								page: answer.page,
								last: answer.last_page,
							})}
						</span>
						{prev}
						{next}
					</div>,
				]
			: []),
	);
}

/**
 * Load one page of the members, or the search's matches, and draw it.
 * @param s The page state.
 * @param page The page to load, from 1.
 */
async function load(s: State, page: number) {
	s.page = page;
	const query = new URLSearchParams({ page: String(page), q: s.q });
	try {
		const answer = await json<MembersAnswer>(
			await s.api.fetch(`/members?${query}`),
		);
		// an older answer must not replace a newer search
		if (query.get("q") === s.q) render(s, answer);
	} catch (error) {
		s.api.toast(s.api.t("members.failed", { error: String(error) }), "error");
	}
}

/**
 * The search box changed: search once the typing stops.
 * @param s The page state.
 * @param value What the box holds.
 */
function onSearch(s: State, value: string) {
	clearTimeout(s.timer);
	s.timer = setTimeout(function run() {
		s.q = value.trim();
		load(s, 1);
	}, SEARCH_DEBOUNCE_MS);
}

/**
 * Build the page and load the first members.
 * @param el The element the page mounts in.
 * @param api What the browser side gets from the app.
 * @returns The cleanup: it stops a search that is still waiting.
 */
const mount: PageScript = (el, api) => {
	const search = api.ui.searchInput({
		placeholder: api.t("search.placeholder"),
		"aria-label": api.t("search.placeholder"),
	});
	const s: State = {
		api,
		q: "",
		page: 1,
		timer: undefined,
		list: (<div />) as HTMLElement,
		pager: (
			<div class="flex items-center justify-between gap-4 pt-3" />
		) as HTMLElement,
	};
	search.input.oninput = () => onSearch(s, search.input.value);
	el.replaceChildren(
		api.ui.card(
			(<div class="max-w-sm">{search}</div>) as HTMLElement,
			s.list,
			s.pager,
		),
	);
	load(s, 1);
	return () => clearTimeout(s.timer);
};

export default mount;
