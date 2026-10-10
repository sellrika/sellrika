/**
 * The settings form of Loyalty Points (slot `extension.config`).
 * It replaces the plain fields in the Configure dialog with three
 * questions, and shows on the right what the answers mean for a customer.
 * It only reads and fills the dialog's form: Save and Cancel are the
 * dialog's own, and the server checks the values (manifest `fields`).
 * JSX here is plain DOM, see ../../README.md › JSX.
 */
import type { Api, SlotScript } from "../../types";
import { moneyText, rewardLabel } from "./utils.ts";

/**
 * The most pieces the "points collected" bar is cut into.
 */
const BAR_PIECES = 10;

const ICON = {
	percent:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
	money:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>',
	receipt:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></svg>',
	ticket:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6"><path d="M2 9a3 3 0 1 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M9 9h.01"/><path d="m15 9-6 6"/><path d="M15 15h.01"/></svg>',
};

/**
 * An icon as an element.
 * @param name Which icon.
 * @param cls Classes for the wrapper.
 * @returns The element.
 */
function Icon({ name, cls }: { name: keyof typeof ICON; cls?: string }) {
	const span = (
		<span class={`inline-flex shrink-0 ${cls ?? ""}`} />
	) as HTMLElement;
	span.innerHTML = ICON[name];
	return span;
}

/**
 * One numbered question with its controls and a hint under them.
 * @param props.n The step number.
 * @param props.question The question.
 * @param props.children The controls.
 * @returns The step element.
 */
function Step({
	n,
	question,
	children,
}: {
	n: number;
	question: string;
	children?: unknown;
}) {
	return (
		<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3">
			<span class="flex size-7 items-center justify-center rounded-full border text-xs font-medium text-muted-foreground">
				{n}
			</span>
			<p class="self-center font-medium">{question}</p>
			<div class="col-start-2 grid gap-2">{children as Node[]}</div>
		</div>
	);
}

/**
 * A number box with a small word inside it, at the left or the right.
 * @param api The extension api.
 * @param attrs The input's attributes.
 * @param side Where the word sits.
 * @returns The wrapper, the input and the word's element.
 */
function numberBox(
	api: Api,
	attrs: Record<string, string>,
	side: "left" | "right",
) {
	const input = api.ui.input({
		type: "number",
		inputmode: "decimal",
		autocomplete: "off",
		...attrs,
	});
	input.classList.add(
		"h-10!",
		"tabular-nums",
		side === "left" ? "pl-14!" : "pr-16!",
	);
	const word = (
		<span
			class={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-sm text-muted-foreground ${side === "left" ? "left-3" : "right-3"}`}
		/>
	) as HTMLElement;
	const wrap = (
		<div class="relative w-44 shrink-0">
			{input}
			{word}
		</div>
	) as HTMLElement;
	return { wrap, input, word };
}

/**
 * A number from a setting, or NaN when it is not filled.
 * @param value The setting.
 * @returns The number.
 */
function num(value: unknown) {
	return value === "" || value == null ? Number.NaN : Number(value);
}

/**
 * Round money to two decimals.
 * @param amount The amount.
 * @returns The rounded amount.
 */
function round2(amount: number) {
	return Math.round(amount * 100) / 100;
}

const mount: SlotScript<"extension.config"> = function mount(el, api) {
	const { context, t } = api;
	const currency = api.shop?.currency ?? "USD";

	/**
	 * Money in the shop's currency.
	 * @param amount The amount.
	 * @returns The text.
	 */
	function money(amount: number) {
		return moneyText(round2(amount), currency, api.locale);
	}

	/**
	 * "1 point" or "5 points".
	 * @param n How many.
	 * @returns The text.
	 */
	function points(n: number) {
		return t(n === 1 ? "config.n_point" : "config.n_points", { n });
	}

	// a new shop starts with "percent off", like the form shows it
	if (!context.values().reward_type) context.set({ reward_type: "percent" });

	// --- the switch
	const onOff = api.ui.switch({
		id: "loyalty-enabled",
		"aria-label": t("config.switch_aria"),
	});
	onOff.checked = context.enabled();
	const onOffTitle = (<p class="font-medium" />) as HTMLElement;
	onOff.onchange = function flip() {
		context.setEnabled(onOff.checked);
		update();
	};

	// --- step 1: the money for one point
	const spend = numberBox(
		api,
		{
			id: "loyalty-spend",
			min: "0.01",
			step: "0.01",
			placeholder: "1",
			"aria-label": t("config.spend_question"),
		},
		"left",
	);
	spend.word.textContent = currency;
	const spendHint = (
		<p class="text-sm text-muted-foreground" />
	) as HTMLElement;
	const spendError = api.ui.error("");

	// --- step 2: the goal
	const goal = numberBox(
		api,
		{
			id: "loyalty-goal",
			min: "1",
			step: "1",
			placeholder: "100",
			"aria-label": t("config.goal_question"),
		},
		"right",
	);
	goal.word.textContent = t("config.points_word");
	const goalHint = (<p class="text-sm text-muted-foreground" />) as HTMLElement;
	const goalError = api.ui.error("");

	// --- step 3: the reward
	const value = numberBox(
		api,
		{
			id: "loyalty-value",
			min: "0.01",
			step: "0.01",
			placeholder: "5",
			"aria-label": t("config.reward_size"),
		},
		"right",
	);
	value.wrap.classList.replace("w-44", "w-36");
	const valueHint = (
		<p class="text-sm text-muted-foreground" />
	) as HTMLElement;
	const valueError = api.ui.error("");
	const kinds = (["percent", "fixed"] as const).map(function kind(type) {
		const b = (
			<button
				type="button"
				aria-pressed="false"
				class="inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 text-muted-foreground aria-pressed:bg-primary/15 aria-pressed:text-primary"
				onclick={function pick() {
					context.set({ reward_type: type });
					update();
				}}
			>
				<Icon name={type === "percent" ? "percent" : "money"} />
				{t(`option.${type}`)}
			</button>
		) as HTMLButtonElement;
		return { type, b };
	});

	spend.input.value = String(context.values().spend ?? "");
	goal.input.value = String(context.values().goal ?? "");
	value.input.value = String(context.values().reward_value ?? "");
	/**
	 * Keep a number box's value in the dialog's form.
	 * @param name The setting.
	 * @param input The box.
	 */
	function bind(name: string, input: HTMLInputElement) {
		input.oninput = function typed() {
			context.set({ [name]: input.value === "" ? "" : Number(input.value) });
			update();
		};
	}
	bind("spend", spend.input);
	bind("goal", goal.input);
	bind("reward_value", value.input);

	// --- the example on the right
	const preview = (<div class="grid content-start gap-5" />) as HTMLElement;

	/**
	 * Draw the example for the values as they are now.
	 * @param spendNow The money for one point.
	 * @param goalNow The points for a reward.
	 * @param reward What the reward gives, in words.
	 */
	function drawPreview(spendNow: number, goalNow: number, reward: string) {
		// two orders that reach the goal together, each a bit over a whole point
		const first = goalNow === 1 ? 1 : Math.ceil(goalNow * 0.4);
		const orders = [
			{ points: first, amount: first * spendNow + spendNow * 0.25 },
			{
				points: goalNow - first,
				amount: (goalNow - first) * spendNow + spendNow * 0.1,
			},
		].filter((order) => order.points > 0);
		const pieces = Math.min(goalNow, BAR_PIECES);
		preview.replaceChildren(
			<div class="grid gap-2 border-b pb-5">
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
					{t("config.with_these")}
				</p>
				<p class="text-lg leading-snug font-semibold" data-loyalty-summary>
					{t("config.summary", {
						amount: money(spendNow * goalNow),
						reward,
					})}
				</p>
			</div>,
			<div class="grid gap-3">
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
					{t("config.example")}
				</p>
				{orders.map(function row(order) {
					return (
						<div class="flex items-center gap-2 text-sm">
							<Icon name="receipt" cls="text-muted-foreground" />
							<span class="flex-1">
								{t("config.order_paid", { amount: money(order.amount) })}
							</span>
							<span class="font-medium text-primary tabular-nums">
								+{points(order.points)}
							</span>
						</div>
					);
				})}
				<div class="mt-1 flex justify-between text-sm">
					<span class="text-muted-foreground">{t("config.collected")}</span>
					<span class="font-medium tabular-nums">
						{t("receipt.of", { points: goalNow, goal: goalNow })}
					</span>
				</div>
				<div class="flex gap-1">
					{Array.from({ length: pieces }, function piece() {
						return <span class="h-1.5 flex-1 rounded-full bg-primary" />;
					})}
				</div>
			</div>,
			<div class="flex items-center gap-3 rounded-xl bg-primary/15 p-4">
				<Icon name="ticket" cls="text-primary" />
				<div class="grid gap-1">
					<p class="font-medium">{t("config.gets", { reward })}</p>
					<p class="text-sm text-muted-foreground">
						{t("config.used_up", { points: points(goalNow) })}
					</p>
				</div>
			</div>,
		);
	}

	/**
	 * Redraw everything that follows from the values: the switch's title,
	 * the hints, the reward's unit and the example.
	 */
	function update() {
		const v = context.values();
		const spendNow = num(v.spend);
		const goalNow = Math.floor(num(v.goal));
		const type = v.reward_type === "fixed" ? "fixed" : "percent";
		const size = num(v.reward_value);

		onOffTitle.textContent = t(context.enabled() ? "config.on" : "config.off");
		for (const kind of kinds)
			kind.b.setAttribute("aria-pressed", String(kind.type === type));
		value.word.textContent = type === "percent" ? "%" : currency;
		if (type === "percent") value.input.max = "100";
		else value.input.removeAttribute("max");

		spendHint.textContent =
			spendNow > 0
				? t("config.spend_hint", {
						amount: money(spendNow * 2.25),
						points: points(2),
					})
				: t("config.spend_hint_empty");
		goalHint.textContent =
			goalNow >= 1
				? t("config.goal_hint", { points: points(goalNow) })
				: t("config.goal_hint_empty");
		const reward =
			size > 0
				? rewardLabel(
						t,
						{ type, value: type === "percent" ? size : Math.round(size * 100) },
						currency,
						api.locale,
					)
				: "";
		valueHint.textContent = reward
			? t("config.value_hint", { reward })
			: t("config.value_hint_empty");

		if (spendNow > 0 && goalNow >= 1 && reward)
			drawPreview(spendNow, goalNow, reward);
		else
			preview.replaceChildren(
				<p class="text-sm text-muted-foreground">{t("config.fill_in")}</p>,
			);
	}

	/**
	 * Show what the last save refused, under the box it is about.
	 */
	function showErrors() {
		const errors = context.errors();
		const shown: [HTMLElement, HTMLInputElement | null, string | undefined][] =
			[
				[spendError, spend.input, errors.spend],
				[goalError, goal.input, errors.goal],
				[valueError, value.input, errors.reward_value ?? errors.reward_type],
			];
		for (const [box, input, message] of shown) {
			box.textContent = message ?? "";
			box.hidden = !message;
			input?.setAttribute("aria-invalid", String(!!message));
		}
	}

	el.replaceChildren(
		<div class="grid lg:grid-cols-[1fr_24rem]" data-loyalty-config>
			<div class="grid content-start gap-7 p-6">
				<label
					for="loyalty-enabled"
					class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4"
				>
					<span class="grid gap-1">
						{onOffTitle}
						<span class="text-sm text-muted-foreground">
							{t("config.on_hint")}
						</span>
					</span>
					{onOff}
				</label>
				<Step n={1} question={t("config.spend_question")}>
					<div class="flex items-center gap-3">
						{spend.wrap}
						<span class="text-sm text-muted-foreground">= {points(1)}</span>
					</div>
					{spendError}
					{spendHint}
				</Step>
				<Step n={2} question={t("config.goal_question")}>
					<div class="flex items-center gap-3">
						{goal.wrap}
						<span class="text-sm text-muted-foreground">
							= {t("config.one_code")}
						</span>
					</div>
					{goalError}
					{goalHint}
				</Step>
				<Step n={3} question={t("config.reward_question")}>
					<div class="flex flex-wrap items-center gap-3">
						<fieldset
							aria-label={t("config.reward_question")}
							class="inline-flex gap-1 rounded-lg border p-1"
						>
							{kinds.map((kind) => kind.b)}
						</fieldset>
						{value.wrap}
					</div>
					{valueError}
					{valueHint}
				</Step>
			</div>
			<div class="border-t bg-muted/30 p-6 lg:border-t-0 lg:border-l">
				{preview}
			</div>
		</div>,
	);
	update();
	showErrors();
	return context.onErrors(showErrors);
};

export default mount;
