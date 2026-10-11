/**
 * Loyalty Points.
 * A customer earns points on every paid order.
 * At the goal they get a discount code that works once.
 * A refund or a void takes the points of that money back.
 * Kept in `ctx.data` collections:
 *   `members` (ref `customer:<id>`) = one row per customer, their points
 *   `earned` (ref `order:<id>`) = the points each order has given
 *   `history` (ref `customer:<id>`) = every change, newest first
 *   `rewards` (ref `customer:<id>`) = each discount code given, used or not
 *   `codes` (ref `code:<CODE>`) = which reward a code is, to find it
 *     again when an order uses the code
 * The customer hears of a reward by email, on the receipt, at the till
 * (slot `pos.cart`) and on the store's account page.
 * Every change of one customer runs inside `data.lock`, one at a time.
 */
import type {
	Collection,
	Config,
	ExtensionData,
	Listeners,
	RouteContext,
	Routes,
} from "../types";
import {
	type Entry,
	type Member,
	type MembersAnswer,
	type Page,
	PER_PAGE,
	pointsFor,
	type ReceiptAnswer,
	type Reward,
	rewardLabel,
	type Standing,
} from "./assets/utils.ts";

/**
 * How a reward's discount code starts.
 */
const CODE_PREFIX = "LOYAL-";

/**
 * How many letters and digits follow the prefix.
 */
const CODE_LENGTH = 8;

/**
 * The letters and digits of a code. None that look alike (0 O, 1 I).
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * A member as it is kept: the row's value in `members`.
 */
type Kept = { customer_id: number; points: number; total: number };

/**
 * A reward as it is kept: the row's value in `rewards`.
 * `used` = an order that is not voided carries its code.
 */
type KeptReward = Reward & { customer_id: number; used: boolean };

/**
 * How many rewards of one customer are read at once.
 */
const REWARDS_MAX = 50;

/**
 * What an order has given so far: the row's value in `earned`.
 */
type Earned = { customer_id: number; points: number };

/**
 * A history line as it is kept. Its time is the row's own.
 */
type Line = Omit<Entry, "at">;

/**
 * What a listener gets, whatever its event.
 */
type EventContext = Parameters<NonNullable<Listeners["order.paid"]>>[0];

/**
 * The lookup key of a customer's rows.
 * @param id The customer id.
 * @returns The `ref`.
 */
function customerRef(id: number) {
	return `customer:${id}`;
}

/**
 * The first record with a lookup key.
 * @param list The collection.
 * @param ref The lookup key.
 * @returns The record, or null when there is none.
 */
async function first<T>(list: Collection<T>, ref: string) {
	return (await list.list({ ref, per_page: 1 })).data[0] ?? null;
}

/**
 * A database time as ISO.
 * SQLite gives "2026-10-03 02:24:36" (UTC, no zone), which a browser
 * would read as its own local time.
 * @param time The stored time.
 * @returns The ISO time.
 */
function isoTime(time: string | Date) {
	const text = time instanceof Date ? time.toISOString() : String(time);
	return /^\d{4}-\d{2}-\d{2} /.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

/**
 * Make a new discount code. Nobody can guess it.
 * @returns The code, like `LOYAL-7K2M9QXD`.
 */
function newCode() {
	const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
	let code = CODE_PREFIX;
	// 32 letters, so a byte maps to them evenly
	for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
	return code;
}

/**
 * The reward as a discount code's type and value.
 * @param config The extension's settings.
 * @returns `percent` with 1 to 100, or `fixed` with cents.
 */
function rewardOf(config: Config) {
	const value = Number(config.reward_value);
	if (config.reward_type === "percent")
		return {
			type: "percent" as const,
			value: Math.min(100, Math.max(1, Math.round(value))),
		};
	return {
		type: "fixed" as const,
		value: Math.max(1, Math.round(value * 100)),
	};
}

/**
 * Give a member their rewards: one discount code per goal reached.
 * The goal is taken off only after its code was made, so a code that
 * could not be made leaves the points for the next try.
 * @param ctx The listener's context.
 * @param points The member's points.
 * @param goal The points one reward costs.
 * @returns The points left, and the rewards made.
 */
async function giveRewards(ctx: EventContext, points: number, goal: number) {
	const history = ctx.data.collection<Line>("history");
	const rewards = ctx.data.collection<KeptReward>("rewards");
	const codes = ctx.data.collection<{ reward_id: number }>("codes");
	const customerId = ctx.order.customer_id as number;
	const ref = customerRef(customerId);
	const made: Reward[] = [];
	let left = points;
	while (left >= goal) {
		const reward = rewardOf(ctx.config);
		const coupon = await ctx.coupons.create({
			code: newCode(),
			description: ctx.t("coupon.description"),
			...reward,
			usage_limit: 1,
		});
		left -= goal;
		const kept = { ...reward, code: coupon.code };
		const id = await rewards.add(
			{ ...kept, customer_id: customerId, used: false },
			ref,
		);
		await codes.add({ reward_id: id }, `code:${coupon.code}`);
		await history.add(
			{ type: "reward", points: -goal, code: coupon.code },
			ref,
		);
		made.push(kept);
	}
	return { left, made };
}

/**
 * Email a customer their new reward.
 * Nothing is sent to a customer with no email, or while the shop's
 * email is off: the receipt and the till still tell them.
 * @param ctx The listener's context.
 * @param reward The reward just made.
 * @param goal The points it cost.
 */
async function tellByEmail(ctx: EventContext, reward: Reward, goal: number) {
	const label = rewardLabel(ctx.t, reward, ctx.shop.currency, ctx.locale);
	await ctx.mail.customer(ctx.order.customer_id as number, {
		subject: ctx.t("mail.subject", { reward: label }),
		text: [
			ctx.t("mail.intro", { goal, shop: ctx.shop.name }),
			ctx.t("mail.reward", { reward: label }),
			ctx.t("mail.code", { code: reward.code }),
			ctx.t("mail.how"),
		].join("\n"),
	});
}

/**
 * Where a customer stands: their points, the goal and their unused rewards.
 * @param data The extension's data.
 * @param config The extension's settings.
 * @param customerId The customer.
 * @returns Their standing. A customer with no points yet has 0.
 */
async function standing(
	data: ExtensionData,
	config: Config,
	customerId: number,
): Promise<Standing> {
	const ref = customerRef(customerId);
	const member = await first(data.collection<Kept>("members"), ref);
	const list = await data
		.collection<KeptReward>("rewards")
		.list({ ref, per_page: REWARDS_MAX });
	const rewards: Reward[] = [];
	for (const { value } of list.data)
		if (!value.used)
			rewards.push({ code: value.code, type: value.type, value: value.value });
	return {
		points: member?.value.points ?? 0,
		goal: Math.floor(Number(config.goal)),
		rewards,
	};
}

/**
 * An order carries one of our codes: remember the reward as used.
 * A voided order gives the code back, so the reward is unused again.
 * ponytail: a code taken off an open order stays "used" here, although
 * the code works again. Keep the order id on the reward if that shows.
 * @param ctx The listener's context.
 */
async function markReward(ctx: EventContext) {
	const code = ctx.order.coupon_code;
	if (!code?.startsWith(CODE_PREFIX)) return;
	const codes = ctx.data.collection<{ reward_id: number }>("codes");
	const rewards = ctx.data.collection<KeptReward>("rewards");
	const found = await first(codes, `code:${code}`);
	const row = found && (await rewards.get(found.value.reward_id));
	if (!row) return;
	const used = ctx.order.status !== "voided";
	if (row.value.used !== used)
		await rewards.update(row.id, { ...row.value, used });
}

/**
 * Bring a customer's points in line with one order.
 * It works out what the order is worth now and books the difference
 * from what the order gave before. So a second `order.paid`, a refund
 * and a void are all the same step, and nothing is counted twice.
 * @param ctx The listener's context.
 */
async function settle(ctx: EventContext) {
	const { order, data } = ctx;
	const customerId = order.customer_id as number;
	const goal = Math.floor(Number(ctx.config.goal));
	const ref = customerRef(customerId);
	const earned = data.collection<Earned>("earned");
	const members = data.collection<Kept>("members");

	const before = await first(earned, `order:${order.id}`);
	const worth = pointsFor(order, Number(ctx.config.spend));
	const change = worth - (before?.value.points ?? 0);
	if (!change) return;

	const row = { customer_id: customerId, points: worth };
	if (before) await earned.update(before.id, row);
	else await earned.add(row, `order:${order.id}`);
	await data.collection<Line>("history").add(
		{
			type: change > 0 ? "earn" : "take",
			points: change,
			reference: order.reference ?? `#${order.id}`,
		},
		ref,
	);

	const member = await first(members, ref);
	const kept: Kept = {
		customer_id: customerId,
		// points already spent on a reward can't be taken back: never below 0
		points: Math.max(0, (member?.value.points ?? 0) + change),
		total: Math.max(0, (member?.value.total ?? 0) + change),
	};
	if (member) await members.update(member.id, kept);
	const id = member?.id ?? (await members.add(kept, ref));
	if (goal < 1) return;
	const { left, made } = await giveRewards(ctx, kept.points, goal);
	if (left !== kept.points) await members.update(id, { ...kept, points: left });
	for (const reward of made) await tellByEmail(ctx, reward, goal);
}

/**
 * An order was paid, refunded or voided: settle its customer's points.
 * An order with no customer earns nothing.
 * One at a time per customer, so two orders paid together both count.
 * @param ctx The listener's context.
 */
async function onOrder(ctx: EventContext) {
	const id = ctx.order.customer_id;
	if (!id) return;
	await ctx.data.lock(customerRef(id), () => settle(ctx));
}

/**
 * Forget a customer: their points and their history.
 * @param data The extension's data.
 * @param id The customer id.
 */
async function forget(data: ExtensionData, id: number) {
	await data.lock(customerRef(id), async function clear() {
		await data.collection("members").clear(customerRef(id));
		await data.collection("history").clear(customerRef(id));
		await data.collection("rewards").clear(customerRef(id));
	});
}

/**
 * Turn a kept member into the page's row, with the customer's name.
 * @param ctx The route's context.
 * @param kept The member as it is kept.
 * @returns The member for the page.
 */
async function memberOf(ctx: RouteContext, kept: Kept): Promise<Member> {
	const customer = await ctx.customers.get(kept.customer_id);
	return {
		...kept,
		name: customer?.name ?? "",
		phone: customer?.phone ?? "",
	};
}

/**
 * The members whose name or phone matches a search.
 * The customers are searched first, then each one's member row is read.
 * @param ctx The route's context.
 * @param q What to look for.
 * @returns The matching members, as one page.
 */
async function search(ctx: RouteContext, q: string): Promise<Page<Member>> {
	const members = ctx.data.collection<Kept>("members");
	const found = await ctx.customers.search(q);
	const rows = await Promise.all(
		found.map(function memberRow(customer) {
			return first(members, customerRef(customer.id));
		}),
	);
	const data: Member[] = [];
	for (const [i, row] of rows.entries())
		if (row)
			data.push({
				...row.value,
				name: found[i]!.name,
				phone: found[i]!.phone ?? "",
			});
	return { data, total: data.length, page: 1, last_page: 1 };
}

/**
 * Staff routes, served under `/ext/loyalty/…`.
 * Every role may read them. Nothing here changes points.
 */
export const routes: Routes = {
	/**
	 * One page of the members, newest first, and the goal.
	 * `?q=` finds members by the customer's name or phone instead.
	 */
	"GET /members": async (ctx) => {
		const q = ctx.url.searchParams.get("q")?.trim();
		const goal = Math.floor(Number(ctx.config.goal));
		if (q) return { ...(await search(ctx, q)), goal } satisfies MembersAnswer;
		const list = await ctx.data.collection<Kept>("members").list({
			page: Number(ctx.url.searchParams.get("page")),
			per_page: PER_PAGE,
		});
		return {
			data: await Promise.all(list.data.map((row) => memberOf(ctx, row.value))),
			total: list.total,
			page: list.page,
			last_page: list.last_page,
			goal,
		} satisfies MembersAnswer;
	},
	/**
	 * Where one customer stands, for the Sell screen: their points, the
	 * goal and the rewards they have not used.
	 */
	"GET /customers/:id/standing": async ({ params, data, config }) =>
		standing(data, config, Number(params.id)),
	/**
	 * What an order's receipt says: the points it gave and where its
	 * customer stands now. Null for an order with no customer.
	 * `pending` = the points are not booked yet (the order was just paid).
	 */
	"GET /orders/:id/receipt": async ({ params, data, config, orders }) => {
		const order = await orders.get(Number(params.id));
		const customerId = order?.customer_id;
		if (!order || !customerId) return null;
		/**
		 * Read inside the customer's lock.
		 * A settle writes in several steps: read between two of them,
		 * the receipt would print the old points.
		 */
		return data.lock(customerRef(customerId), async function read() {
			const given = await first(
				data.collection<Earned>("earned"),
				`order:${order.id}`,
			);
			const earned = given?.value.points ?? 0;
			return {
				...(await standing(data, config, customerId)),
				earned,
				pending: pointsFor(order, Number(config.spend)) !== earned,
			} satisfies ReceiptAnswer;
		});
	},
	/**
	 * One page of a customer's history, newest first.
	 */
	"GET /members/:id/history": async ({ params, url, data }) => {
		const list = await data.collection<Line>("history").list({
			ref: customerRef(Number(params.id)),
			page: Number(url.searchParams.get("page")),
			per_page: PER_PAGE,
		});
		return {
			data: list.data.map((row) => ({
				...row.value,
				at: isoTime(row.created_at),
			})),
			total: list.total,
			page: list.page,
			last_page: list.last_page,
		} satisfies Page<Entry>;
	},
};

/**
 * Public routes, served under `/store/<slug>/ext/loyalty/…`.
 */
export const publicRoutes: Routes = {
	/**
	 * The standing of the customer signed in to the store.
	 * A guest gets null. The customer comes from the session, never from
	 * the request, so nobody reads another customer's codes.
	 */
	"GET /me": async ({ customer, data, config }) =>
		customer ? standing(data, config, customer.id) : null,
};

/**
 * The event listeners of this extension.
 */
export default {
	/**
	 * An order is paid in full: its customer earns the points.
	 */
	"order.paid": onOrder,
	/**
	 * A new order may use a reward's code: the reward is used.
	 */
	"order.created": markReward,
	/**
	 * A code put on an open order later: the reward is used.
	 */
	"order.updated": markReward,
	/**
	 * Money went back: the points of that money go back too.
	 */
	"order.refunded": onOrder,
	/**
	 * A voided order gives no points.
	 */
	"order.voided": async (ctx) => {
		await onOrder(ctx);
		await markReward(ctx);
	},
	/**
	 * A deleted customer loses their points and history.
	 */
	"customer.deleted": ({ data, customer }) => forget(data, customer.id),
} satisfies Listeners;
