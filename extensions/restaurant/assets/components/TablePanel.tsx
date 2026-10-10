/**
 * The details panel of the Tables page, in the page's right column.
 * A header (the table's name, when its bill opened, its state) with two tabs:
 * - Bill: the lines (they scroll; each with its note and a remove button),
 *   then a footer that stays in view: discount, tax, total and the buttons.
 * - Table setup: the table's name (rename), the QR code with its buttons, and at the bottom Remove table.
 * The buttons come in already wired. The JSX here is plain DOM.
 */
import { icon } from "./icons.ts";

/**
 * One bill line, already formatted.
 * `note` = the guest's request, "" = none.
 * `remove` = its remove button, already wired.
 */
type Line = {
	qty: number;
	name: string;
	amount: string;
	note: string;
	remove: HTMLElement;
};

/**
 * A line's note: a speech-bubble icon and the text, wrapping when long.
 * @param note The guest's request.
 * @returns The element.
 */
function Note({ note }: { note: string }) {
	const mark = (
		<span class="mt-0.5 shrink-0 text-muted-foreground/70" />
	) as HTMLElement;
	mark.innerHTML = icon("note", 12);
	return (
		<span class="flex gap-1.5 text-sm text-muted-foreground" data-note>
			{mark}
			<span>{note}</span>
		</span>
	);
}

/** The panel's tabs. */
export type PanelTab = "bill" | "setup";

/**
 * One tab of the header: underlined when picked.
 * @param props.on True when it is the picked tab.
 * @param props.label Its words.
 * @param props.tab Which tab it is, for tests.
 * @param props.onPick Called when it is clicked.
 * @returns The tab, a button.
 */
function Tab({
	on,
	label,
	tab,
	onPick,
}: {
	on: boolean;
	label: string;
	tab: PanelTab;
	onPick: () => void;
}) {
	const button = (
		<button
			type="button"
			class={`-mb-px border-b-2 pb-3 text-sm font-medium transition-colors ${on ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
			aria-pressed={on ? "true" : "false"}
			data-panel-tab={tab}
		>
			{label}
		</button>
	) as HTMLButtonElement;
	button.onclick = onPick;
	return button;
}

/**
 * Draw the panel.
 * @param props.name The table name.
 * @param props.subtitle "Opened 19:12 · 38 min ago", or "No open bill".
 * @param props.open True when it has an open bill.
 * @param props.tab The picked tab.
 * @param props.onTab Called with a tab when it is clicked.
 * @param props.bill The bill, formatted, or null; `draft` = the bar shown while units wait to be removed.
 * @param props.mainButtons Add items and Pay.
 * @param props.otherButtons Print bill and Move or join.
 * @param props.rename The rename form (the name box and its button), or null when this staff member may not.
 * @param props.qrSvg The QR code's SVG markup, or null when there is none.
 * @param props.made When the code was made, formatted, or null.
 * @param props.qrButtons Print QR and New / Make QR code, then Remove QR code when there is one.
 * @param props.remove The Remove table button, or null when this staff member may not.
 * @param props.texts The words it shows, already translated.
 * @returns The panel element.
 */
export function TablePanel({
	name,
	subtitle,
	open,
	tab,
	onTab,
	bill,
	mainButtons,
	otherButtons,
	rename,
	qrSvg,
	made,
	qrButtons,
	remove,
	texts,
}: {
	name: string;
	subtitle: string;
	open: boolean;
	tab: PanelTab;
	onTab: (tab: PanelTab) => void;
	bill: {
		heading: string;
		href: string;
		lines: Line[];
		draft: HTMLElement | null;
		discount: { label: string; amount: string } | null;
		tax: { label: string; amount: string } | null;
		total: string;
	} | null;
	mainButtons: HTMLElement[];
	otherButtons: HTMLElement[];
	rename: HTMLElement | null;
	qrSvg: string | null;
	made: string | null;
	qrButtons: HTMLElement[];
	remove: HTMLElement | null;
	texts: {
		badge: string;
		tabBill: string;
		tabSetup: string;
		viewOrder: string;
		total: string;
		noBill: string;
		noBillBody: string;
		qrTitle: string;
		qrBody: string;
		noQrTitle: string;
		noQrBody: string;
	};
}) {
	const header = (
		<div class="grid shrink-0 gap-4 px-7 pt-6">
			<div class="flex items-center justify-between gap-3">
				<div class="grid min-w-0 gap-1">
					<h2 class="truncate text-xl font-semibold">{name}</h2>
					<p class="text-sm text-muted-foreground">{subtitle}</p>
				</div>
				<span
					class={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${open ? "bg-primary/12 text-primary" : "border text-muted-foreground"}`}
				>
					<span
						class={`size-1.5 rounded-full ${open ? "bg-primary" : "border border-current"}`}
					/>
					{texts.badge}
				</span>
			</div>
			<div class="flex gap-6 border-b">
				<Tab
					on={tab === "bill"}
					label={texts.tabBill}
					tab="bill"
					onPick={() => onTab("bill")}
				/>
				<Tab
					on={tab === "setup"}
					label={texts.tabSetup}
					tab="setup"
					onPick={() => onTab("setup")}
				/>
			</div>
		</div>
	);
	return (
		<div class="flex flex-col lg:h-full" data-table-panel={name}>
			{header}
			{tab === "bill" ? (
				<BillTab
					bill={bill}
					mainButtons={mainButtons}
					otherButtons={otherButtons}
					texts={texts}
				/>
			) : (
				<SetupTab
					rename={rename}
					qrSvg={qrSvg}
					made={made}
					qrButtons={qrButtons}
					remove={remove}
					texts={texts}
				/>
			)}
		</div>
	);
}

/**
 * The Bill tab: the lines in a box that scrolls, then the footer that stays
 * in view (discount, tax, total, the buttons). Without a bill: a short notice
 * in the middle, and the buttons.
 * @param props The bill, its buttons and the words: see `TablePanel`.
 * @returns The tab's elements.
 */
function BillTab({
	bill,
	mainButtons,
	otherButtons,
	texts,
}: {
	bill: Parameters<typeof TablePanel>[0]["bill"];
	mainButtons: HTMLElement[];
	otherButtons: HTMLElement[];
	texts: Parameters<typeof TablePanel>[0]["texts"];
}) {
	const empty = (<span class="mb-1 text-muted-foreground/70" />) as HTMLElement;
	empty.innerHTML = icon("receipt", 26);
	return (
		<>
			{bill ? (
				<div
					class="grid min-h-0 flex-1 content-start gap-3.5 px-7 pt-4 pb-4 lg:overflow-y-auto [scrollbar-width:thin]"
					data-bill
					data-bill-scroll
				>
					<div class="flex items-center justify-between text-sm">
						<span class="text-muted-foreground">{bill.heading}</span>
						<a class="font-medium hover:underline" href={bill.href}>
							{texts.viewOrder}
						</a>
					</div>
					<ul class="-mr-2 grid gap-1 text-sm">
						{bill.lines.map((line) => (
							<li class="flex items-start gap-2.5 py-1" data-bill-line>
								<span class="shrink-0 text-muted-foreground/70 tabular-nums">
									{line.qty} ×
								</span>
								<span class="grid min-w-0 flex-1 gap-1">
									<span>{line.name}</span>
									{line.note ? <Note note={line.note} /> : ""}
								</span>
								<span class="text-muted-foreground tabular-nums">
									{line.amount}
								</span>
								{line.remove}
							</li>
						))}
					</ul>
					{bill.draft ?? ""}
				</div>
			) : (
				<div class="grid min-h-40 flex-1 content-center justify-items-center gap-1.5 px-12 text-center">
					{empty}
					<p class="font-semibold">{texts.noBill}</p>
					<p class="text-sm text-muted-foreground">{texts.noBillBody}</p>
				</div>
			)}
			<div
				class="grid shrink-0 gap-3.5 border-t px-7 pt-4 pb-6"
				data-bill-footer
			>
				{bill?.discount ? (
					<div
						class="flex justify-between text-sm text-muted-foreground"
						data-bill-discount
					>
						<span>{bill.discount.label}</span>
						<span class="tabular-nums">{bill.discount.amount}</span>
					</div>
				) : (
					""
				)}
				{bill?.tax ? (
					<div class="flex justify-between text-sm text-muted-foreground">
						<span>{bill.tax.label}</span>
						<span class="tabular-nums">{bill.tax.amount}</span>
					</div>
				) : (
					""
				)}
				{bill ? (
					<div class="flex items-center justify-between">
						<span class="font-medium">{texts.total}</span>
						<span class="text-xl font-semibold tabular-nums" data-bill-total>
							{bill.total}
						</span>
					</div>
				) : (
					""
				)}
				<div class="grid gap-2.5">
					<div class="grid grid-cols-2 gap-2.5">{mainButtons}</div>
					<div class="grid grid-cols-2 gap-2.5">{otherButtons}</div>
				</div>
			</div>
		</>
	);
}

/**
 * The Table setup tab: the rename form, the QR code with its buttons, and Remove table at the bottom.
 * @param props The code, its buttons, Remove table and the words: see `TablePanel`.
 * @returns The tab's element.
 */
function SetupTab({
	rename,
	qrSvg,
	made,
	qrButtons,
	remove,
	texts,
}: {
	rename: HTMLElement | null;
	qrSvg: string | null;
	made: string | null;
	qrButtons: HTMLElement[];
	remove: HTMLElement | null;
	texts: Parameters<typeof TablePanel>[0]["texts"];
}) {
	const code = (
		<div
			class={`flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg ${qrSvg ? "bg-white p-2" : "border border-dashed text-muted-foreground"}`}
			data-qr
		/>
	) as HTMLElement;
	code.innerHTML = qrSvg ?? icon("qr", 28);
	return (
		<div class="flex min-h-0 flex-1 flex-col justify-between gap-6 px-7 py-6 lg:overflow-y-auto">
			<div class="grid gap-4">
				{rename ?? ""}
				{rename ? <div class="h-px bg-border" /> : ""}
				<div class="flex items-center gap-4">
					{code}
					<div class="grid gap-1.5">
						<p class="font-semibold">
							{qrSvg ? texts.qrTitle : texts.noQrTitle}
						</p>
						<p class="text-sm text-muted-foreground">
							{qrSvg ? texts.qrBody : texts.noQrBody}
						</p>
						{made ? <p class="text-xs text-muted-foreground/70">{made}</p> : ""}
					</div>
				</div>
				<div class="grid grid-cols-2 gap-2.5">{qrButtons}</div>
			</div>
			{remove ? (
				<div class="grid gap-4">
					<div class="h-px bg-border" />
					{remove}
				</div>
			) : (
				""
			)}
		</div>
	);
}
