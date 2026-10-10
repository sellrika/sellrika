/**
 * One label, as it is printed.
 * It uses inline styles only, because it is also drawn inside the
 * print frame, where the app's stylesheet is not loaded.
 * The JSX here is plain DOM.
 */
import { barcodeSvg } from "../code128.ts";
import { labelName, type Show, type Size, type Unit } from "../utils.ts";

const BOX =
	"box-sizing:border-box;padding:1.5mm 2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.6mm;overflow:hidden;font-family:system-ui,sans-serif;color:#000;background:#fff;text-align:center;";
const NAME =
	"font-size:2.7mm;line-height:1.15;max-height:2.3em;overflow:hidden;width:100%;";
const PRICE = "font-size:4.6mm;font-weight:700;line-height:1;";
const BARS = "flex:1;min-height:0;width:100%;";
const CODE = "font-size:2.2mm;line-height:1;letter-spacing:0.2mm;";

/**
 * Draw one label.
 * A code the barcode can't carry is left out, bars and text.
 * @param props.unit The product or variant.
 * @param props.size The label size.
 * @param props.show Which parts the label shows.
 * @param props.price The price, already as text.
 * @returns The label element, `size.w` × `size.h` mm.
 */
export function Label({
	unit,
	size,
	show,
	price,
}: {
	unit: Unit;
	size: Size;
	show: Show;
	price: string;
}) {
	const svg = show.code ? barcodeSvg(unit.code) : "";
	const bars = (<div style={BARS} />) as HTMLElement;
	bars.innerHTML = svg;
	return (
		<div
			data-label={unit.key}
			style={`width:${size.w}mm;height:${size.h}mm;${BOX}`}
		>
			{show.name ? <div style={NAME}>{labelName(unit)}</div> : null}
			{show.price ? <div style={PRICE}>{price}</div> : null}
			{svg ? bars : null}
			{svg ? <div style={CODE}>{unit.code}</div> : null}
		</div>
	);
}
