/**
 * The card reader, slot `pos.display`. The script runs in two places:
 * - next to a pay dialog (`place: "dialog"`): it drives the reader. The
 *   cashier picks a reader and presses Send to reader, it asks the server
 *   every 2 seconds, and on Approved it tells the dialog (`approve`),
 *   which then completes the sale by itself.
 * - on the customer's screen (`place: "screen"`): it only says "Tap your
 *   card on the reader" with the amount. It never touches the reader, so
 *   the card is not charged twice.
 * The rest of the time its element stays empty.
 */
import type { DisplayPayment, SlotScript } from "../../types";
import { Panel, StatusLine } from "./components/Panel.tsx";
import { TapNotice } from "./components/TapNotice.tsx";
import {
	money,
	type Reader,
	type Refusal,
	type StatusAnswer,
} from "./utils.ts";

/** How often the server is asked about a charge, in milliseconds. */
const POLL_MS = 2000;

type Api = Parameters<SlotScript<"pos.display">>[1];
/**
 * Where the dialog's box stands.
 * `idle` = nothing sent yet, `sending` = on its way to the reader,
 * `waiting` = the reader asks for the card, then `approved` or `declined`.
 */
type Phase = "idle" | "sending" | "waiting" | "approved" | "declined";
type State = {
	api: Api;
	el: HTMLElement;
	/** The shop's readers, null until they are loaded. */
	readers: Reader[] | null;
	/** Why the readers could not be loaded, "" for none. */
	loadError: string;
	/** True while the readers are being loaded. */
	loading: boolean;
	/** The picked reader's ID, "" for none. */
	reader: string;
	phase: Phase;
	/** The charge on the reader or approved: its PaymentIntent ID. */
	pi: string | null;
	/** The cents that charge asked for. */
	charged: number;
	/** Why the card was declined, or why sending failed. */
	message: string;
	/** True while one status question is on its way. */
	asking: boolean;
	/** True once the dialog closed: a charge that comes back late is given up. */
	gone: boolean;
};

/**
 * The amount as the customer reads it.
 * @param s The state.
 * @param cents The amount.
 * @returns The formatted amount.
 */
function amountText(s: State, cents: number) {
	return money(cents, s.api.shop?.currency ?? "USD", s.api.locale);
}

/**
 * The `localStorage` key this till remembers its reader under.
 * @param s The state.
 * @returns The key.
 */
function readerKey(s: State) {
	return `${s.api.key}:reader:${s.api.shop?.id ?? 0}`;
}

/**
 * The reader this till used last.
 * @param s The state.
 * @returns Its ID, or "" when none is remembered or storage is blocked.
 */
function rememberedReader(s: State) {
	try {
		return localStorage.getItem(readerKey(s)) ?? "";
	} catch {
		return "";
	}
}

/**
 * Pick a reader and remember it for this till.
 * @param s The state.
 * @param id The reader's ID.
 */
function pickReader(s: State, id: string) {
	s.reader = id;
	try {
		localStorage.setItem(readerKey(s), id);
	} catch {
		/* blocked storage: the pick lasts until the dialog closes */
	}
	render(s);
}

/**
 * The payment the dialog asks for, when the picked method is ours.
 * @param s The state.
 * @returns The payment, or null when another method is picked.
 */
function ourPayment(s: State): DisplayPayment | null {
	const payment = s.api.context.payment();
	return payment?.extension === s.api.key && payment.amount > 0
		? payment
		: null;
}

/**
 * Load the shop's readers from Stripe, through the server.
 * The picked one is this till's last reader, else the first that is online.
 * @param s The state.
 */
async function loadReaders(s: State) {
	s.loading = true;
	s.loadError = "";
	render(s);
	const res = await s.api.fetch("/readers").catch(() => null);
	const answer = (await res?.json().catch(() => null)) as
		| ({ readers?: Reader[] } & Partial<Refusal>)
		| null;
	s.loading = false;
	if (!res?.ok || !answer?.readers) {
		s.loadError = answer?.error ?? s.api.t("error.request_failed");
		return render(s);
	}
	s.readers = answer.readers;
	const last = rememberedReader(s);
	const known = s.readers.find((r) => r.id === last);
	const first = s.readers.find((r) => r.online) ?? s.readers[0];
	s.reader = (known ?? first)?.id ?? "";
	render(s);
}

/**
 * "Send to reader": make the charge and show it on the picked reader.
 * @param s The state.
 */
async function send(s: State) {
	const payment = ourPayment(s);
	if (!payment || !s.reader) return;
	s.phase = "sending";
	s.message = "";
	render(s);
	const res = await s.api
		.fetch("/charge", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ reader: s.reader, amount: payment.amount }),
		})
		.catch(() => null);
	const answer = (await res?.json().catch(() => null)) as
		| ({ pi?: string } & Partial<Refusal>)
		| null;
	if (!res?.ok || !answer?.pi) {
		s.phase = "declined";
		s.message = answer?.error ?? s.api.t("error.request_failed");
		return render(s);
	}
	s.pi = answer.pi;
	s.charged = payment.amount;
	if (s.gone) return drop(s);
	s.phase = "waiting";
	render(s);
	// the dialog moved on while the charge was made: give it up at once
	follow(s);
}

/**
 * Ask the server where the charge stands. Runs every 2 seconds.
 * @param s The state.
 */
async function poll(s: State) {
	const pi = s.pi;
	if (s.phase !== "waiting" || !pi || s.asking) return;
	s.asking = true;
	const res = await s.api
		.fetch(`/status?pi=${encodeURIComponent(pi)}`)
		.catch(() => null);
	const answer = (await res?.json().catch(() => null)) as StatusAnswer | null;
	s.asking = false;
	// cancelled or changed while the answer was on its way
	if (s.pi !== pi || s.phase !== "waiting") return;
	// no answer: the next round asks again
	if (!res?.ok || !answer || answer.state === "waiting") return;
	if (answer.state === "approved") {
		s.phase = "approved";
		render(s);
		// the dialog completes the sale by itself and sends this ID along
		return s.api.context.approve(pi);
	}
	s.pi = null;
	s.phase = answer.state === "declined" ? "declined" : "idle";
	s.message = answer.message ?? "";
	render(s);
}

/**
 * Give the charge up: clear the reader and let go of the money.
 * A charge an order has claimed is left alone by the server.
 * @param s The state.
 */
function drop(s: State) {
	const pi = s.pi;
	s.pi = null;
	s.phase = "idle";
	s.message = "";
	if (!pi) return;
	// keepalive: it still goes out when the page is left
	void s.api
		.fetch("/cancel", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pi }),
			keepalive: true,
		})
		.catch(() => null);
}

/**
 * The dialog's method or amount changed.
 * A charge for another amount, or for a method that is no longer picked,
 * is given up. The readers are loaded the first time our method is picked.
 * @param s The state.
 */
function follow(s: State) {
	const payment = ourPayment(s);
	if (s.pi && payment?.amount !== s.charged) drop(s);
	if (payment && !s.readers && !s.loading && !s.loadError) void loadReaders(s);
	render(s);
}

/**
 * The reader picker: a list when the shop has several, else the one's name.
 * An offline reader can't be picked.
 * @param s The state.
 * @returns The field, or null when there is no reader.
 */
function readerField(s: State) {
	const { api } = s;
	const readers = s.readers ?? [];
	if (!readers.length) return null;
	const select = api.ui.select(
		readers.map(function option(r) {
			return {
				value: r.id,
				label: r.online ? r.label : api.t("reader.offline", { name: r.label }),
				disabled: !r.online,
			};
		}),
		{ id: "terminal-reader", value: s.reader },
	);
	select.onchange = () => pickReader(s, select.value);
	return api.ui.field(api.ui.label(api.t("reader.pick"), select.id), select);
}

/**
 * What the box shows for the step it is on.
 * @param s The state.
 * @returns The lines, the picker and the buttons.
 */
function panelBody(s: State): (Node | null)[] {
	const { api } = s;
	if (s.loading) return [<StatusLine text={api.t("reader.loading")} />];
	if (s.loadError || !s.readers?.length) {
		const again = api.ui.button(api.t("reader.reload"), { variant: "outline" });
		again.onclick = () => void loadReaders(s);
		return [
			<StatusLine
				text={s.loadError || api.t("reader.none")}
				tone={s.loadError ? "bad" : "plain"}
			/>,
			again,
		];
	}
	if (s.phase === "sending")
		return [<StatusLine text={api.t("reader.sending")} />];
	if (s.phase === "approved")
		return [<StatusLine text={api.t("reader.approved")} tone="good" />];
	if (s.phase === "waiting") {
		const cancel = api.ui.button(api.t("reader.cancel"), {
			variant: "outline",
		});
		cancel.onclick = () => {
			drop(s);
			render(s);
		};
		return [<StatusLine text={api.t("reader.waiting")} />, cancel];
	}
	// idle, or declined: the reader can be picked and the charge sent (again)
	const online = s.readers.find((r) => r.id === s.reader)?.online ?? false;
	const sendBtn = api.ui.button(
		api.t(s.phase === "declined" ? "reader.retry" : "reader.send"),
	);
	sendBtn.disabled = !online;
	sendBtn.dataset.terminalSend = "";
	sendBtn.onclick = () => void send(s);
	return [
		s.phase === "declined" ? (
			<StatusLine
				text={[api.t("reader.declined"), s.message].filter(Boolean).join(": ")}
				tone="bad"
			/>
		) : null,
		readerField(s),
		online ? null : <StatusLine text={api.t("reader.is_offline")} tone="bad" />,
		sendBtn,
	];
}

/**
 * Draw the dialog's box, or nothing while another method is picked.
 * @param s The state.
 */
function render(s: State) {
	const payment = ourPayment(s);
	if (!payment) return s.el.replaceChildren();
	s.el.replaceChildren(
		<Panel
			title={s.api.t("reader.title")}
			amount={amountText(s, payment.amount)}
			phase={s.phase}
			body={panelBody(s)}
		/>,
	);
}

/**
 * Draw the customer's screen: the amount and what to do, or nothing while
 * another method is picked.
 * @param s The state.
 */
function renderScreen(s: State) {
	const payment = ourPayment(s);
	if (!payment) return s.el.replaceChildren();
	s.el.replaceChildren(
		<TapNotice
			amount={amountText(s, payment.amount)}
			hint={s.api.t("screen.tap")}
		/>,
	);
}

const mount: SlotScript<"pos.display"> = (el, api) => {
	const s: State = {
		api,
		el,
		readers: null,
		loadError: "",
		loading: false,
		reader: "",
		phase: "idle",
		pi: null,
		charged: 0,
		message: "",
		asking: false,
		gone: false,
	};
	// the customer's screen only shows what to do: the dialog drives the reader
	if (api.context.place !== "dialog") {
		renderScreen(s);
		return api.context.onPayment(() => renderScreen(s));
	}
	follow(s);
	const stop = api.context.onPayment(() => follow(s));
	const timer = setInterval(() => void poll(s), POLL_MS);
	return () => {
		stop();
		clearInterval(timer);
		// the dialog closed: a charge with no order is given up
		s.gone = true;
		drop(s);
	};
};

export default mount;
