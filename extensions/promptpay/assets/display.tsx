/**
 * The customer's screen (slot `pos.display`): while a pay dialog has this
 * extension's payment method picked, it shows a PromptPay QR code for the
 * exact amount. The rest of the time its element stays empty, so the screen
 * shows the shop's logo.
 */
import type { DisplayPayment, SlotScript } from "../../types";
import { PayCode, PayNotice } from "./components/PayCode.tsx";
import { PROMPTPAY_CURRENCY, promptpayPayload } from "./promptpay.ts";

type Api = Parameters<SlotScript<"pos.display">>[1];
type State = {
	api: Api;
	el: HTMLElement;
	/** The shop's PromptPay ID as digits, null when the settings hold none that is valid. */
	id: string | null;
	/** The name to show under the code, "" for none. */
	name: string;
	/** The account's name to show under it, "" for none. */
	account: string;
};

/**
 * Format cents of baht for the customer.
 * @param s The state.
 * @param cents The amount.
 * @returns The amount, e.g. "฿120".
 */
function money(s: State, cents: number) {
	return new Intl.NumberFormat(s.api.locale, {
		style: "currency",
		currency: PROMPTPAY_CURRENCY,
		currencyDisplay: "narrowSymbol",
		trailingZeroDisplay: "stripIfInteger",
	} as Intl.NumberFormatOptions).format(cents / 100);
}

/**
 * Draw the code for the picked method, or nothing when it is not ours.
 * @param s The state.
 * @param payment The method picked in a pay dialog, or null while none is open.
 */
function draw(s: State, payment: DisplayPayment | null) {
	const { api, el } = s;
	if (payment?.extension !== api.key || payment.amount <= 0)
		return el.replaceChildren();
	// PromptPay moves Thai baht only: a code in another currency would ask for the wrong money
	if (api.shop?.currency !== PROMPTPAY_CURRENCY)
		return el.replaceChildren(<PayNotice text={api.t("display.not_thb")} />);
	if (!s.id)
		return el.replaceChildren(<PayNotice text={api.t("display.bad_id")} />);
	el.replaceChildren(
		<PayCode
			svg={api.qr(promptpayPayload(s.id, payment.amount))}
			assets={`${api.base}/assets`}
			amount={money(s, payment.amount)}
			name={s.name}
			account={s.account ? api.t("display.account", { name: s.account }) : ""}
			hint={api.t("display.scan")}
		/>,
	);
}

const mount: SlotScript<"pos.display"> = async (el, api) => {
	const res = await api.fetch("/config");
	const answer = res.ok ? await res.json().catch(() => null) : null;
	const s: State = {
		api,
		el,
		id: answer?.id ?? null,
		name: answer?.name ?? "",
		account: answer?.account ?? "",
	};
	draw(s, api.context.payment());
	return api.context.onPayment((payment) => draw(s, payment));
};

export default mount;
