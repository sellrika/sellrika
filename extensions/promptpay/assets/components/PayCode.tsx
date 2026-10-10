/**
 * The QR code to pay, as the customer sees it: a card laid out like the
 * Thai QR Payment sheet a bank gives a shop. The JSX here is plain DOM.
 * The two logos are pictures in `assets/`: `promptpay.png` (from the Pencil
 * component "PromptPay logo") and `thai-qr-mark.svg`.
 */

/** The dark blue of the Thai QR Payment sheet. */
const NAVY = "#103e68";

/**
 * Fill the customer's screen.
 * The pay dialog sets `--display-height`, so there the card is only as tall as it needs.
 */
const FILL = "min-height:var(--display-height, calc(100dvh - 3rem))";

/**
 * Draw the card in the middle of the customer's screen: the blue header,
 * the PromptPay badge, the code with the mark in its middle, the shop's
 * name, then the account's name.
 * @param props.svg The QR code's SVG markup (`api.qr`).
 * @param props.assets Where the extension's pictures are served (`api.base` + `/assets`).
 * @param props.amount The amount asked for, formatted.
 * @param props.name The name under the code, from the extension's settings, or "" for none.
 * @param props.account The line with the account's name, or "" for none.
 * @param props.hint The line that says what to do.
 * @returns The element.
 */
export function PayCode({
	svg,
	assets,
	amount,
	name,
	account,
	hint,
}: {
	svg: string;
	assets: string;
	amount: string;
	name: string;
	account: string;
	hint: string;
}) {
	const code = (
		<div style="width:100%;aspect-ratio:1" data-promptpay-code />
	) as HTMLElement;
	// our own markup from the app's QR maker, no outside text in it
	code.innerHTML = svg;
	return (
		<div
			class="flex flex-col items-center justify-center gap-4 text-center"
			style={FILL}
			data-promptpay
		>
			<div
				class="overflow-hidden border bg-white"
				style="width:min(46vh,100%);color:#111"
			>
				<div
					style={`background:${NAVY};color:#fff;display:flex;align-items:center;justify-content:center;gap:.6em;padding:1em;font-weight:700;font-size:clamp(.9rem,2.2vh,1.5rem);line-height:1.1;text-align:left`}
				>
					<img
						src={`${assets}/thai-qr-mark.svg`}
						alt=""
						style="width:2.6em;height:2.6em"
					/>
					<span>
						THAI QR
						<br />
						PAYMENT
					</span>
				</div>
				<div style="display:flex;flex-direction:column;align-items:center;gap:1.5vh;padding:2vh 3vh 2.5vh">
					<img
						src={`${assets}/promptpay.png`}
						alt="PromptPay"
						style="height:clamp(2.25rem,6vh,4rem)"
					/>
					<div style="position:relative;width:100%">
						{code}
						{/* small enough for the code's error correction to read around it */}
						<img
							src={`${assets}/thai-qr-mark.svg`}
							alt=""
							style="position:absolute;top:50%;left:50%;width:13%;transform:translate(-50%,-50%);border:.4vh solid #fff;border-radius:26%;background:#fff;box-sizing:border-box"
						/>
					</div>
					<p
						class="tabular-nums"
						style="font-weight:700;font-size:clamp(1.5rem,4.2vh,2.75rem);line-height:1.1"
						data-promptpay-amount
					>
						{amount}
					</p>
					{name ? (
						<p
							style="font-weight:700;font-size:clamp(1.25rem,3.4vh,2.25rem);line-height:1.2"
							data-promptpay-name
						>
							{name}
						</p>
					) : null}
					{account ? (
						<p
							style="font-size:clamp(.9rem,2.2vh,1.4rem);line-height:1.2"
							data-promptpay-account
						>
							{account}
						</p>
					) : null}
				</div>
			</div>
			<p class="text-xl text-muted-foreground">{hint}</p>
		</div>
	);
}

/**
 * A notice for the staff when the code can't be made.
 * @param props.text What is wrong.
 * @returns The element.
 */
export function PayNotice({ text }: { text: string }) {
	return (
		<p
			class="flex items-center justify-center text-center text-2xl text-destructive"
			style={FILL}
			data-promptpay-notice
		>
			{text}
		</p>
	);
}
