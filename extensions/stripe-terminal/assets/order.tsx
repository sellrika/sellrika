/**
 * The order page, slot `order.show`: a button for the order's card
 * payments. It turns red when the money was not taken or a refund to the
 * card failed, and its dialog shows each card payment with a Try again
 * button. An order with no card payment gets no button.
 */
import type { SlotScript } from "../../types";
import { ChargeRow } from "./components/ChargeRow.tsx";
import { money, type OrderAnswer, problemOf } from "./utils.ts";

/** How often the page's order is looked at for a change, in milliseconds. */
const WATCH_MS = 3000;
/**
 * How many more looks follow a change of the order.
 * A refund reaches Stripe a moment after the page shows it.
 */
const LOOKS_AFTER_CHANGE = 2;

type Api = Parameters<SlotScript<"order.show">>[1];
type Charges = OrderAnswer["charges"];
type State = {
	api: Api;
	el: HTMLElement;
	charges: Charges;
	/** The order as it was at the last look: status, paid and refunded. */
	seen: string;
	/** How many more looks are due. */
	looks: number;
	/** The open dialog's list and message, null while it is closed. */
	open: {
		list: HTMLElement;
		note: HTMLElement;
		retry: HTMLButtonElement;
	} | null;
};

/**
 * The parts of the order a card payment follows.
 * @param s The state.
 * @returns A text that changes when a payment, a refund or a void happens.
 */
function orderMark(s: State) {
	const o = s.api.context.order();
	return `${o.status}:${o.paid}:${o.refunded}`;
}

/**
 * The amount as a person reads it.
 * @param s The state.
 * @param cents The amount.
 * @param currency The currency it was charged in.
 * @returns The formatted amount.
 */
function amountText(s: State, cents: number, currency: string) {
	return money(cents, currency, s.api.locale);
}

/**
 * The worst thing among the order's card payments.
 * @param s The state.
 * @returns "capture", "refund" or null.
 */
function worst(s: State) {
	const problems = s.charges.map(problemOf);
	if (problems.includes("capture")) return "capture";
	return problems.includes("refund") ? "refund" : null;
}

/**
 * Read the order's card payments from the server and draw again.
 * @param s The state.
 */
async function load(s: State) {
	const id = s.api.context.order().id;
	const res = await s.api.fetch(`/orders/${id}`).catch(() => null);
	const answer = (await res?.json().catch(() => null)) as OrderAnswer | null;
	if (!res?.ok || !answer?.charges) return;
	s.charges = answer.charges;
	render(s);
}

/**
 * Look at the page's order. After a change (a refund, a void, a payment)
 * the card payments are read again, a few times: the listener that talks
 * to Stripe runs a moment later.
 * @param s The state.
 */
function watch(s: State) {
	const mark = orderMark(s);
	if (mark !== s.seen) {
		s.seen = mark;
		s.looks = LOOKS_AFTER_CHANGE;
	}
	if (s.looks <= 0) return;
	s.looks--;
	void load(s);
}

/**
 * "Try again": take what was not captured and send the failed refunds.
 * @param s The state.
 */
async function retry(s: State) {
	if (!s.open) return;
	s.open.retry.disabled = true;
	const id = s.api.context.order().id;
	const res = await s.api
		.fetch(`/orders/${id}/retry`, { method: "POST" })
		.catch(() => null);
	const answer = (await res?.json().catch(() => null)) as OrderAnswer | null;
	if (res?.ok && answer?.charges) s.charges = answer.charges;
	const ok = !!res?.ok && !worst(s);
	if (s.open)
		s.open.note.textContent = s.api.t(
			ok ? "order.retry_ok" : "order.retry_failed",
		);
	render(s);
}

/**
 * The rows of the dialog, one per card payment.
 * @param s The state.
 * @returns The rows.
 */
function rows(s: State) {
	const { api } = s;
	return s.charges.map(function row(c) {
		const state =
			c.state === "captured"
				? "order.captured"
				: c.state === "uncaptured"
					? "order.uncaptured"
					: "order.cancelled";
		return (
			<ChargeRow
				amount={amountText(s, c.amount, c.currency)}
				state={api.t(state)}
				bad={c.state === "uncaptured"}
				refunded={
					c.refunded
						? api.t("order.refund_done", {
								amount: amountText(s, c.refunded, c.currency),
							})
						: ""
				}
				failed={
					c.failed
						? api.t("order.refund_failed", {
								amount: amountText(s, c.failed, c.currency),
							})
						: ""
				}
				error={problemOf(c) ? c.error : ""}
			/>
		);
	});
}

/**
 * Open the dialog with the order's card payments.
 * @param s The state.
 */
function openDialog(s: State) {
	const { api } = s;
	const list = (<ul class="grid gap-2" data-terminal-charges />) as HTMLElement;
	const note = api.ui.hint("");
	const close = api.ui.button(api.t("order.close"), { variant: "outline" });
	const again = api.ui.button(api.t("order.retry"));
	again.dataset.terminalRetry = "";
	const dialog = api.dialog({
		title: api.t("order.title"),
		description: api.t("order.description"),
		body: (
			<div class="grid gap-3">
				{list}
				{note}
			</div>
		) as HTMLElement,
		footer: [close, again],
	});
	close.onclick = () => dialog.close();
	again.onclick = () => void retry(s);
	s.open = { list, note, retry: again };
	void dialog.closed.then(() => {
		s.open = null;
	});
	render(s);
	// what the page shows may be a moment old
	void load(s);
}

/**
 * Draw the button, and the dialog's rows while it is open.
 * @param s The state.
 */
function render(s: State) {
	const { api } = s;
	if (s.open) {
		s.open.list.replaceChildren(...rows(s));
		s.open.retry.hidden = !worst(s);
		s.open.retry.disabled = false;
	}
	if (!s.charges.length) return s.el.replaceChildren();
	const problem = worst(s);
	const button = api.ui.button(
		api.t(
			problem === "capture"
				? "order.button_uncaptured"
				: problem === "refund"
					? "order.button_refund_failed"
					: "order.button",
		),
		{ variant: problem ? "destructive" : "outline" },
	);
	button.dataset.terminalOrder = problem ?? "ok";
	button.onclick = () => openDialog(s);
	s.el.replaceChildren(button);
}

const mount: SlotScript<"order.show"> = (el, api) => {
	const s: State = {
		api,
		el,
		charges: [],
		seen: "",
		looks: 0,
		open: null,
	};
	s.seen = orderMark(s);
	void load(s);
	const timer = setInterval(() => watch(s), WATCH_MS);
	return () => clearInterval(timer);
};

export default mount;
