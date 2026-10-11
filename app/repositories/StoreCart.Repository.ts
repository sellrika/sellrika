import { Service } from "@xcore/di";
import type { Locale } from "@i18n";
import { Db, sql } from "@xcore/database/Database";
import { parseJson } from "@helpers/json";
import { sqlStamp } from "@helpers/time";
import {
	STORE_CART_TTL_MS,
	STORE_RECONCILE_WINDOW_MS,
} from "@constants/Store.Constant";
import type { NewItem } from "./Order.Repository";
import type { CouponType } from "@constants/Coupon.Constant";

/** The buyer as typed on the checkout page (name, phone, email, delivery address). */
export type StoreCustomer = {
	name: string;
	phone: string;
	email: string;
	address_1: string;
	address_2: string;
	city: string;
	state: string;
	country: string;
	postal_code: string;
};
/**
 * The priced cart as frozen when the checkout starts.
 * `delivery_fee` is missing on snapshots taken before migration 0030.
 * `tax*` is missing before 0041. Treat them as 0 / false.
 * `charge_id` is only set by tokenising gateways (Omise).
 * The row is keyed by our own ref,
 * so the provider's id for the payment has to ride along in the snapshot.
 * `gateway` is set when the buyer picked a manual option
 * (cash on delivery, bank transfer) instead of the shop's online provider.
 * `customer_id` is the signed-in store customer the order belongs to
 * (accounts, migration 0046).
 * Missing = a guest, matched by email / phone.
 */
export type StoreCartPayload = {
	/**
	 * The language the buyer checked out in.
	 * So a later reconcile emails them in it.
	 */
	locale?: Locale;
	items: NewItem[];
	subtotal: number;
	discount?: number;
	delivery_fee?: number;
	tax?: number;
	tax_rate?: number;
	tax_label?: string;
	tax_included?: boolean;
	total: number;
	customer?: StoreCustomer;
	customer_id?: number;
	save_address?: boolean;
	pickup?: boolean;
	charge_id?: string;
	qr?: string;
	gateway?: string;
	coupon?: StoreCartCoupon;
};
/**
 * The code applied at the checkout, frozen with what it took off.
 * `saved` = goods discount + waived delivery.
 * So the order and the usage row match what was charged.
 */
export type StoreCartCoupon = {
	id: number;
	code: string;
	type: CouponType;
	value: number;
	saved: number;
};
export type StoreCart = {
	id: number;
	shop_id: number;
	payload: StoreCartPayload;
	stripe_session_id: string | null;
	order_id: number | null;
	created_at: string;
	checks: number;
	next_check_at: string | null;
	/** When the abandoned-cart email was claimed; null = not yet. */
	reminded_at: string | null;
	/** The key of the "Complete your order" link; null = no email sent. */
	restore_token: string | null;
};

/**
 * A `store_carts` row as the driver returns it.
 * The snapshot is JSON text on SQLite, already parsed on Postgres.
 */
type StoreCartRow = Omit<StoreCart, "payload"> & {
	payload: string | StoreCartPayload;
};

/**
 * Priced cart snapshot taken when the online checkout starts.
 * The order is built from this exact snapshot on return.
 * So the order always matches what the gateway charged.
 */
@Service()
export class StoreCartRepository {
	/**
	 * Store a priced cart snapshot.
	 * A discount code on it is held from now on
	 * (`coupon_id` + `coupon_email`, see `CouponRepository.usage`).
	 * @param shopId Owning shop.
	 * @param payload Lines, totals and the buyer as typed on the checkout page.
	 * @returns The created cart.
	 */
	async create(shopId: number, payload: StoreCartPayload): Promise<StoreCart> {
		const couponId = payload.coupon?.id ?? null;
		const email = couponId
			? (payload.customer?.email ?? "").trim().toLowerCase()
			: "";
		// the signed-in customer who holds the code; null = a guest
		const holder = couponId ? (payload.customer_id ?? null) : null;
		return this.#row(
			(
				await Db.insert(
					sql,
					"store_carts",
					sql`insert into store_carts (shop_id, payload, coupon_id, coupon_email, coupon_customer_id) values (${shopId}, ${JSON.stringify(payload)}, ${couponId}, ${email}, ${holder})`,
				)
			)[0],
		);
	}

	/**
	 * Key the cart by the gateway's checkout id.
	 * For tokenising gateways, by our own ref.
	 * @param id Cart id.
	 * @param sessionId The id the customer comes back with.
	 */
	setSession(id: number, sessionId: string) {
		return sql`update store_carts set stripe_session_id = ${sessionId} where id = ${id}`;
	}

	/**
	 * Rewrite the snapshot.
	 * Tokenising gateways add the charge id to it once the card is charged.
	 * @param id Cart id.
	 * @param payload The full replacement payload.
	 */
	setPayload(id: number, payload: StoreCartPayload) {
		return sql`update store_carts set payload = ${JSON.stringify(payload)} where id = ${id}`;
	}

	/**
	 * Find the cart the customer is coming back for.
	 * @param shopId Owning shop.
	 * @param sessionId The checkout id / ref the cart was keyed by.
	 * @returns The cart, or null.
	 */
	async bySession(
		shopId: number,
		sessionId: string,
	): Promise<StoreCart | null> {
		return Db.one(
			sql`select * from store_carts where shop_id = ${shopId} and stripe_session_id = ${sessionId}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Atomically mark the cart as being fulfilled (order_id 0).
	 * @param id Cart id.
	 * @returns False when another request got there first.
	 */
	async claim(id: number) {
		return Db.exists(
			Db.update(
				sql,
				"store_carts",
				sql`order_id = 0`,
				sql`id = ${id} and order_id is null`,
			),
		);
	}

	/**
	 * Point the cart at the order it became — or release the claim again with null.
	 * @param id Cart id.
	 * @param orderId The created order, or null to un-claim after a failure.
	 */
	attachOrder(id: number, orderId: number | null) {
		return sql`update store_carts set order_id = ${orderId} where id = ${id}`;
	}

	/**
	 * Checkouts the buyer may have paid for without coming back.
	 * Handed to a gateway, no order yet,
	 * and not deferred to later by a previous check. Oldest first.
	 * Only carts younger than `STORE_RECONCILE_WINDOW_MS`: carts now live a week,
	 * and the gateways must not be asked about them all week long.
	 * @param now The current time.
	 * @returns Those carts.
	 */
	async due(now: Date): Promise<StoreCart[]> {
		return (
			await sql`select * from store_carts where order_id is null and stripe_session_id is not null and created_at > ${sqlStamp(new Date(now.getTime() - STORE_RECONCILE_WINDOW_MS))} and (next_check_at is null or next_check_at <= ${sqlStamp(now)}) order by created_at`
		).map((r: StoreCartRow) => this.#row(r));
	}

	/**
	 * Record one "still pending" answer and when to ask again.
	 * @param id Cart id.
	 * @param checks How many times the gateway has been asked, this one included.
	 * @param next When to ask next.
	 */
	defer(id: number, checks: number, next: Date) {
		return sql`update store_carts set checks = ${checks}, next_check_at = ${sqlStamp(next)} where id = ${id}`;
	}

	/**
	 * A shop's carts made since a moment that have no order, oldest first.
	 * The abandoned-cart sweep picks the due ones from these.
	 * A cart with an order is left out: it is never reminded, and
	 * `orderedSince` already knows its buyer ordered.
	 * @param shopId Owning shop.
	 * @param from The oldest creation time to include.
	 * @returns Those carts.
	 */
	async since(shopId: number, from: Date): Promise<StoreCart[]> {
		return (
			await sql`select * from store_carts where shop_id = ${shopId} and order_id is null and created_at >= ${sqlStamp(from)} order by created_at, id`
		).map((r: StoreCartRow) => this.#row(r));
	}

	/**
	 * The shops that may have an abandoned cart to email.
	 * A cheap first question, so the sweep skips every other shop.
	 * @param from The oldest creation time that can still be emailed.
	 * @returns The ids of the shops with a cart made since then
	 *   that has no order and no reminder yet.
	 */
	async shopsToRemind(from: Date): Promise<number[]> {
		const rows: { shop_id: unknown }[] =
			await sql`select distinct shop_id from store_carts where order_id is null and reminded_at is null and created_at >= ${sqlStamp(from)}`;
		return rows.map((r) => Number(r.shop_id));
	}

	/**
	 * Claim the abandoned-cart email for a cart and give it its restore key.
	 * Atomic, so two sweeps never both send it.
	 * @param id Cart id.
	 * @param token The random key of its "Complete your order" link.
	 * @param now The current time.
	 * @returns False when it was already claimed, or became an order.
	 */
	async remind(id: number, token: string, now: Date) {
		return Db.exists(
			Db.update(
				sql,
				"store_carts",
				sql`reminded_at = ${sqlStamp(now)}, restore_token = ${token}`,
				sql`id = ${id} and reminded_at is null and order_id is null`,
			),
		);
	}

	/**
	 * The cart behind a "Complete your order" link.
	 * @param shopId The shop of the store it was opened on.
	 * @param token The link's key.
	 * @returns The cart, or null when it is unknown, purged or already an order.
	 */
	async byToken(shopId: number, token: string): Promise<StoreCart | null> {
		return Db.one(
			sql`select * from store_carts where shop_id = ${shopId} and restore_token = ${token} and order_id is null`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Drop the carts that never turned into an order, after a week.
	 * @returns The delete query.
	 */
	purgeStale() {
		return sql`delete from store_carts where order_id is null and created_at < ${sqlStamp(new Date(Date.now() - STORE_CART_TTL_MS))}`;
	}
	/**
	 * Turn a database row into a `StoreCart`.
	 * An empty column stays as it is.
	 * @param r The raw row.
	 * @returns The cart with its parsed snapshot.
	 */
	#row(r: StoreCartRow): StoreCart {
		return {
			...r,
			payload: parseJson<StoreCartPayload>(
				r.payload,
				r.payload as StoreCartPayload,
			),
		};
	}
}
