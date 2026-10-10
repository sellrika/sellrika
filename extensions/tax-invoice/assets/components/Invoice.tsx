/**
 * The tax invoice as it prints: one A4 page.
 * It is drawn inside the print frame, which has none of the app's styles,
 * so it uses its own class names, styled by `INVOICE_CSS`.
 * JSX here is plain DOM, see ../../../README.md › JSX.
 */
import type { Api, OrderDetail } from "../../../types";
import { type Invoice as Saved, money, type Party, sums } from "../utils.ts";

/**
 * The stylesheet of the print frame.
 */
export const INVOICE_CSS = `@page{size:A4;margin:14mm}
html,body{margin:0;padding:0}
body{font:11pt/1.45 system-ui,sans-serif;color:#000}
h1{font-size:17pt;margin:0;text-align:right}
p{margin:0}
.top{display:flex;justify-content:space-between;gap:10mm}
.top>div{flex:1}
.right{text-align:right}
.strong{font-weight:700}
.pre{white-space:pre-line}
.box{border:1px solid #000;padding:3mm;margin-top:6mm}
table{width:100%;border-collapse:collapse;margin-top:6mm}
th,td{border:1px solid #000;padding:1.5mm 2mm;vertical-align:top}
th{font-weight:700;text-align:center}
td.num{text-align:right;white-space:nowrap}
.sums{margin:4mm 0 0 auto;width:60%}
.sums p{display:flex;justify-content:space-between;gap:6mm}
.sums .total{font-weight:700;border-top:1px solid #000;margin-top:1mm;padding-top:1mm}`;

/**
 * The seller or the buyer: name, address, then the tax ID and the branch
 * when they were typed.
 * @param props.t The extension's translate function.
 * @param props.party Who it is.
 * @returns The block.
 */
function PartyBlock({ t, party }: { t: Api["t"]; party: Party }) {
	return (
		<div>
			<p class="strong">{party.name}</p>
			<p class="pre">{party.address}</p>
			{party.tax_id ? (
				<p>
					{t("doc.tax_id")}: {party.tax_id}
				</p>
			) : (
				""
			)}
			{party.branch ? (
				<p>
					{t("doc.branch")}: {party.branch}
				</p>
			) : (
				""
			)}
		</div>
	);
}

/**
 * One row of the sums under the lines.
 * @param props.label What the amount is.
 * @param props.amount The money text.
 * @param props.total True for the last, bold row.
 * @returns The row.
 */
function SumRow({
	label,
	amount,
	total,
}: {
	label: string;
	amount: string;
	total?: boolean;
}) {
	return (
		<p class={total ? "total" : ""}>
			<span>{label}</span>
			<span>{amount}</span>
		</p>
	);
}

/**
 * The whole invoice.
 * @param props.api The extension api: the texts, the shop, the language.
 * @param props.seller The seller, from the settings.
 * @param props.invoice The issued invoice: number, date and buyer.
 * @param props.order The order it is for.
 * @returns The page element.
 */
export function Invoice({
	api,
	seller,
	invoice,
	order,
}: {
	api: Api;
	seller: Party;
	invoice: Saved;
	order: OrderDetail;
}) {
	const { t } = api;
	const cash = (cents: number) => money(cents, api.shop.currency, api.locale);
	const date = new Intl.DateTimeFormat(api.locale, {
		dateStyle: "long",
		timeZone: api.shop.timezone,
	}).format(new Date(invoice.issued_at));
	const sum = sums(order);
	// the name the shop gave its tax when the order was made: VAT, GST…
	const label = order.tax_label || t("doc.tax_name");
	return (
		<div data-invoice>
			<div class="top">
				<PartyBlock t={t} party={seller} />
				<div class="right">
					<h1>{t("doc.title")}</h1>
					<p>{t("doc.original")}</p>
					<p>
						{t("doc.number")}: <span class="strong">{invoice.number}</span>
					</p>
					<p>
						{t("doc.date")}: {date}
					</p>
				</div>
			</div>
			<div class="box">
				<p>{t("doc.buyer")}</p>
				<PartyBlock t={t} party={invoice.buyer} />
			</div>
			<table>
				<thead>
					<tr>
						<th>{t("doc.no")}</th>
						<th>{t("doc.item")}</th>
						<th>{t("doc.qty")}</th>
						<th>{t("doc.price")}</th>
						<th>{t("doc.amount")}</th>
					</tr>
				</thead>
				<tbody>
					{order.items.map(function row(item, i) {
						return (
							<tr>
								<td class="num">{i + 1}</td>
								<td>{item.name}</td>
								<td class="num">{item.qty}</td>
								<td class="num">{cash(item.price)}</td>
								<td class="num">{cash(item.price * item.qty)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<div class="sums">
				<SumRow label={t("doc.subtotal")} amount={cash(order.subtotal)} />
				{order.discount ? (
					<SumRow label={t("doc.discount")} amount={cash(-order.discount)} />
				) : (
					""
				)}
				<SumRow label={t("doc.value")} amount={cash(sum.value)} />
				<SumRow
					label={t("doc.tax", { label, rate: order.tax_rate / 100 })}
					amount={cash(sum.tax)}
				/>
				{sum.delivery ? (
					<SumRow label={t("doc.delivery")} amount={cash(sum.delivery)} />
				) : (
					""
				)}
				<SumRow label={t("doc.total")} amount={cash(sum.total)} total />
				{order.tax_included ? <p>{t("doc.included", { label })}</p> : ""}
			</div>
		</div>
	);
}
