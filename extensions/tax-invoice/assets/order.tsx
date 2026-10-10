/**
 * The "Tax invoice" button on the order page, slot `order.show`.
 * It opens a dialog for the buyer's name, address and tax ID (any country, no format checked), saves them
 * through the extension's own route (which gives the invoice its number)
 * and prints the invoice on an A4 page from a hidden frame.
 * JSX here is plain DOM, see ../../README.md › JSX.
 */
import type { SlotScript } from "../../types";
import { INVOICE_CSS, Invoice } from "./components/Invoice.tsx";
import {
	type Answer,
	type Party,
	refusal,
	type SavedAddress,
	TEXT_MAX,
} from "./utils.ts";

type Api = Parameters<SlotScript<"order.show">>[1];

/**
 * The boxes of the buyer form, by the field they fill.
 */
type Form = Record<keyof Party, HTMLInputElement | HTMLTextAreaElement>;

/**
 * Everything the open dialog holds.
 */
type State = {
	api: Api;
	form: Form;
	/**
	 * Where a refusal of the server is shown.
	 */
	error: HTMLElement;
	/**
	 * The Save and print button.
	 */
	printBtn: HTMLButtonElement;
	/**
	 * Closes the dialog.
	 */
	close: () => void;
};

/**
 * Print the invoice from a hidden frame, so the app's page is not printed.
 * The frame is removed once the print window closes.
 * @param api The extension api of the slot.
 * @param answer The seller and the issued invoice.
 */
function printInvoice(api: Api, answer: Answer) {
	if (!answer.invoice) return;
	const frame = document.createElement("iframe");
	frame.style.cssText =
		"position:fixed;right:0;bottom:0;width:0;height:0;border:0";
	document.body.append(frame);
	const win = frame.contentWindow;
	const doc = frame.contentDocument;
	if (!win || !doc) return frame.remove();
	const style = doc.createElement("style");
	style.textContent = INVOICE_CSS;
	doc.head.append(style);
	doc.body.append(
		<Invoice
			api={api}
			seller={answer.seller}
			invoice={answer.invoice}
			order={api.context.order()}
		/>,
	);
	win.onafterprint = () => frame.remove();
	win.focus();
	win.print();
}

/**
 * Save the buyer through `POST /orders/:id`, then print.
 * A refusal is shown in the dialog, which stays open.
 * @param s The dialog's state.
 */
async function save(s: State) {
	const { api, form } = s;
	s.printBtn.disabled = true;
	s.error.textContent = "";
	const res = await api.fetch(`/orders/${api.context.order().id}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: form.name.value,
			address: form.address.value,
			tax_id: form.tax_id.value,
			branch: form.branch.value,
		} satisfies Party),
	});
	const answer = (await res.json().catch(() => null)) as
		| (Answer & { error?: string })
		| null;
	s.printBtn.disabled = false;
	if (!res.ok || !answer?.invoice) {
		s.error.textContent = answer?.error ?? api.t("save.failed");
		return;
	}
	s.close();
	printInvoice(api, answer);
}

/**
 * Put the picked saved address into the address box, and its tax ID
 * into the tax ID box.
 * The placeholder row changes nothing.
 * @param form The buyer form.
 * @param saved The customer's saved addresses.
 * @param index The picked row, as the select holds it.
 */
function pickAddress(form: Form, saved: SavedAddress[], index: string) {
	const picked = saved[Number(index)];
	if (index === "" || !picked) return;
	form.address.value = picked.text;
	form.tax_id.value = picked.tax_id;
}

/**
 * Open the buyer dialog for the order on the page.
 * An order that can't get an invoice shows the reason as a toast.
 * The form starts with the buyer of the invoice the order already has,
 * else with the name of the order's customer and their first saved
 * address with its tax ID. With saved addresses, a list picks which one
 * to use.
 * @param api The extension api of the slot.
 */
async function open(api: Api) {
	const order = api.context.order();
	const why = refusal(order);
	if (why) return api.toast(api.t(why), "error");
	const res = await api.fetch(`/orders/${order.id}`);
	const answer = res.ok
		? ((await res.json().catch(() => null)) as Answer | null)
		: null;
	if (!answer) return api.toast(api.t("load.failed"), "error");
	const buyer = answer.invoice?.buyer;
	const saved = answer.addresses ?? [];
	const form: Form = {
		name: api.ui.input({
			id: "tax-invoice-name",
			maxlength: TEXT_MAX,
			value: buyer?.name ?? answer.customer?.name ?? "",
		}),
		address: api.ui.textarea({
			id: "tax-invoice-address",
			rows: 3,
			maxlength: TEXT_MAX,
		}),
		tax_id: api.ui.input({
			id: "tax-invoice-tax-id",
			maxlength: TEXT_MAX,
			value: buyer?.tax_id ?? saved[0]?.tax_id ?? "",
		}),
		branch: api.ui.input({
			id: "tax-invoice-branch",
			maxlength: TEXT_MAX,
			value: buyer?.branch ?? "",
		}),
	};
	form.address.value = buyer?.address ?? saved[0]?.text ?? "";
	// the customer's saved addresses: picking one fills the box below it
	const picker = api.ui.select(
		[
			{ value: "", label: api.t("buyer.saved_pick") },
			...saved.map((a, i) => ({ value: String(i), label: a.label })),
		],
		{ id: "tax-invoice-saved", value: buyer || !saved.length ? "" : "0" },
	);
	picker.onchange = () => pickAddress(form, saved, picker.value);
	const error = api.ui.error("");
	const cancelBtn = api.ui.button(api.t("button.cancel"), {
		variant: "outline",
	});
	const printBtn = api.ui.button(api.t("button.print"));
	const dialog = api.dialog({
		title: api.t("dialog.title"),
		description: answer.invoice
			? api.t("dialog.again", { number: answer.invoice.number })
			: undefined,
		body: (
			<div class="grid gap-4">
				{api.ui.field(
					api.ui.label(api.t("buyer.name"), form.name.id),
					form.name,
				)}
				{saved.length
					? api.ui.field(api.ui.label(api.t("buyer.saved"), picker.id), picker)
					: ""}
				{api.ui.field(
					api.ui.label(api.t("buyer.address"), form.address.id),
					form.address,
				)}
				{api.ui.field(
					api.ui.label(api.t("buyer.tax_id"), form.tax_id.id),
					form.tax_id,
					api.t("buyer.tax_id_hint"),
				)}
				{api.ui.field(
					api.ui.label(api.t("buyer.branch"), form.branch.id),
					form.branch,
					api.t("buyer.branch_hint"),
				)}
				{error}
			</div>
		),
		footer: [cancelBtn, printBtn],
	});
	const s: State = { api, form, error, printBtn, close: dialog.close };
	cancelBtn.onclick = () => dialog.close();
	printBtn.onclick = () => save(s);
}

/**
 * Put the button in the order page's button row.
 * @param el The element the slot mounts in.
 * @param api The extension api of the slot.
 */
const mount: SlotScript<"order.show"> = (el, api) => {
	const button = api.ui.button(api.t("button.open"), { variant: "outline" });
	button.onclick = () => open(api);
	el.replaceChildren(button);
};

export default mount;
