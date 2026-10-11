import type { SQL } from "bun";
import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import { Paginate } from "@xcore/http/Paginate";
import type { Customer, CustomerWithStats } from "@models/Customer";
import type { CustomerInput } from "@validators/Customer.Validator";
import type { CustomerSort } from "@constants/Customer.Constant";

/**
 * Is the email of `customers c` on its shop's unsubscribe list?
 * A condition, with no column name: the caller adds `as …` or `not`.
 */
export const isUnsubscribed = sql`exists (select 1 from email_unsubscribes u where u.shop_id = c.shop_id and u.email = lower(c.email))`;

/**
 * The purchase numbers of `customers c`, as columns.
 * Voided orders don't count as purchases.
 */
const stats = sql`(select count(*) from orders o where o.customer_id = c.id and o.status <> 'voided') as orders_count,
  (select coalesce(sum(o.total - o.refunded), 0) from orders o where o.customer_id = c.id and o.status <> 'voided') as total_spent,
  (select max(o.created_at) from orders o where o.customer_id = c.id and o.status <> 'voided') as last_order_at,
  ${isUnsubscribed} as unsubscribed`;
/**
 * A `customers` row as the driver returns it.
 * `firebase_uid` may be missing on old selects.
 */
type CustomerRow = Omit<Customer, "firebase_uid"> & {
	firebase_uid?: string | null;
};
/**
 * A customer row with the `stats` columns.
 * They are not numbers / a boolean yet.
 */
type CustomerStatsRow = CustomerRow & {
	orders_count: unknown;
	total_spent: unknown;
	last_order_at?: string | null;
	unsubscribed: unknown;
};

/** Customers — per shop; phone is unique per shop. */
@Service()
export class CustomerRepository {
	/**
	 * One page, newest first unless `sort` says otherwise.
	 * `q` matches name / phone / email (substring, case-insensitive).
	 * @param shopId Owning shop.
	 * @param q Search text ("" = everyone).
	 * @param page 1-based page number.
	 * @param perPage Rows per page.
	 * @param sort A column and direction, or null.
	 * @returns A page of customers with their purchase stats.
	 */
	async pageForShop(
		shopId: number,
		q: string,
		page: number,
		perPage: number,
		sort: CustomerSort | null = null,
	) {
		const like = `%${q.toLowerCase()}%`;
		const where = sql`where c.shop_id = ${shopId} and (${q} = '' or lower(c.name) like ${like} or lower(coalesce(c.phone, '')) like ${like} or lower(coalesce(c.email, '')) like ${like})`;
		const [{ n }] = await sql`select count(*) as n from customers c ${where}`;
		const rows: CustomerStatsRow[] =
			await sql`select * from (select c.*, ${stats} from customers c ${where}) x
        order by ${this.#sortBy(sort)} x.id desc ${Paginate.limit(page, perPage)}`;
		return Paginate.of<CustomerWithStats>(
			rows.map((r) => this.#row(r)),
			Number(n),
			page,
			perPage,
		);
	}

	/**
	 * Quick lookup for the checkout picker.
	 * It matches by name / phone (substring), name-prefix matches first.
	 * @param shopId Owning shop.
	 * @param q Search text ("" = the first few customers).
	 * @param limit How many to return.
	 * @returns Matching customers.
	 */
	async search(shopId: number, q: string, limit = 8): Promise<Customer[]> {
		const like = `%${q.toLowerCase()}%`;
		return (
			await sql`select * from customers where shop_id = ${shopId} and (${q} = '' or lower(name) like ${like} or lower(coalesce(phone, '')) like ${like})
      order by case when ${q} <> '' and lower(name) like ${`${q.toLowerCase()}%`} then 0 else 1 end, name limit ${limit}`
		).map((r: CustomerRow) => this.#shape(r));
	}

	/**
	 * One customer with their purchase stats.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @returns The customer, or null.
	 */
	async find(id: number, shopId: number): Promise<CustomerWithStats | null> {
		return Db.one(
			sql`select c.*, ${stats} from customers c where c.id = ${id} and c.shop_id = ${shopId}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * First customer of this shop with this email (case-insensitive).
	 * Emails are stored lower-case, so the column is compared directly.
	 * Used to attach online orders.
	 * @param shopId Owning shop.
	 * @param email Email to match.
	 * @returns The customer, or null.
	 */
	async byEmail(shopId: number, email: string): Promise<Customer | null> {
		return Db.one(
			sql`select * from customers where shop_id = ${shopId} and email = ${email.trim().toLowerCase()} order by id limit 1`,
			(r) => this.#shape(r),
		);
	}

	/**
	 * The customer a Firebase user signed in as before.
	 * Online store accounts, migration 0046.
	 * @param shopId Owning shop.
	 * @param uid The Firebase user id.
	 * @returns The customer, or null when this user never signed in here.
	 */
	async byFirebaseUid(shopId: number, uid: string): Promise<Customer | null> {
		return Db.one(
			sql`select * from customers where shop_id = ${shopId} and firebase_uid = ${uid} order by id limit 1`,
			(r) => this.#shape(r),
		);
	}

	/**
	 * Tie a customer record to a Firebase user.
	 * That user just proved they own its email.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @param uid The Firebase user id.
	 */
	linkFirebase(id: number, shopId: number, uid: string) {
		return sql`update customers set firebase_uid = ${uid}, updated_at = current_timestamp where id = ${id} and shop_id = ${shopId}`;
	}

	/**
	 * What a signed-in customer may change about themselves on /account.
	 * Their name and phone.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @param d The new name and phone.
	 * @returns The updated customer, or null when it doesn't belong to this shop.
	 */
	async updateProfile(
		id: number,
		shopId: number,
		d: { name: string; phone: string },
	): Promise<Customer | null> {
		return Db.one(
			Db.update(
				sql,
				"customers",
				sql`name = ${d.name}, phone = ${d.phone}, updated_at = current_timestamp`,
				sql`id = ${id} and shop_id = ${shopId}`,
				sql`*`,
			),
			(r) => this.#shape(r),
		);
	}

	/**
	 * Another customer of this shop with the same phone.
	 * @param shopId Owning shop.
	 * @param phone Phone number to match.
	 * @param exceptId Customer allowed to keep it (the one being edited).
	 * @returns The other owner of that phone number, or null.
	 */
	async phoneOwner(
		shopId: number,
		phone: string,
		exceptId = 0,
	): Promise<Customer | null> {
		return Db.one(
			sql`select * from customers where shop_id = ${shopId} and phone = ${phone} and id <> ${exceptId}`,
			(r) => this.#shape(r),
		);
	}

	/**
	 * Create a customer.
	 * @param shopId Owning shop.
	 * @param d Validated name, phone, email and note.
	 * @param db Transaction to run in (defaults to the pool).
	 * @returns The created customer.
	 */
	async create(
		shopId: number,
		d: CustomerInput,
		db: SQL = sql,
	): Promise<Customer> {
		return this.#shape(
			(
				await Db.insert(
					db,
					"customers",
					db`insert into customers (shop_id, name, phone, email, note) values (${shopId}, ${d.name}, ${d.phone}, ${this.#email(d.email)}, ${d.note})`,
				)
			)[0],
		);
	}

	/**
	 * Edit a customer of this shop.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated name, phone, email and note.
	 * @returns The updated customer, or null when it doesn't belong to this shop.
	 */
	async update(
		id: number,
		shopId: number,
		d: CustomerInput,
	): Promise<Customer | null> {
		return Db.one(
			Db.update(
				sql,
				"customers",
				sql`name = ${d.name}, phone = ${d.phone}, email = ${this.#email(d.email)}, note = ${d.note}, updated_at = current_timestamp`,
				sql`id = ${id} and shop_id = ${shopId}`,
				sql`*`,
			),
			(r) => this.#shape(r),
		);
	}

	/**
	 * Delete a customer.
	 * Their orders keep their history but lose the link.
	 * Their store sign-ins end.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 */
	delete(id: number, shopId: number) {
		return sql.begin((tx) => this.#drop(tx, id, shopId));
	}
	/**
	 * The email as it is stored: trimmed and lower-case.
	 * One spelling per address, so lookups can use the index.
	 * @param email What the form or the checkout sent.
	 * @returns The stored value, or null when there is none.
	 */
	#email(email: string | null | undefined): string | null {
		return email?.trim().toLowerCase() || null;
	}

	/**
	 * Turn a database row into a `Customer`.
	 * @param r The raw row.
	 * @returns The customer, with `firebase_uid` always there.
	 */
	#shape(r: CustomerRow): Customer {
		return {
			...r,
			firebase_uid: r.firebase_uid ?? null,
		};
	}

	/**
	 * Turn a database row with the `stats` columns into a `CustomerWithStats`.
	 * @param r The raw row.
	 * @returns The customer with real numbers and a real boolean.
	 */
	#row(r: CustomerStatsRow): CustomerWithStats {
		return {
			...this.#shape(r),
			orders_count: Number(r.orders_count),
			total_spent: Number(r.total_spent),
			last_order_at: r.last_order_at ?? null,
			unsubscribed: !!r.unsubscribed,
		};
	}

	/**
	 * The ORDER BY start for a sort of the customer list.
	 * It sorts over the `x` subquery with the stats.
	 * Only fixed SQL from this list is used, never the request's text.
	 * Empty values (no email, no order yet) always go last.
	 * @param sort The column and direction, or none.
	 * @returns A fragment ending in a comma, or an empty one.
	 */
	#sortBy(sort: CustomerSort | null) {
		if (!sort) return sql``;
		const value = {
			name: sql`lower(x.name)`,
			email: sql`nullif(lower(coalesce(x.email, '')), '')`,
			orders: sql`x.orders_count`,
			spent: sql`x.total_spent`,
			last_order: sql`x.last_order_at`,
		}[sort.by];
		return Db.nullsLast(value, sort.dir);
	}

	/**
	 * The writes of `delete`, inside its transaction.
	 * @param tx The open transaction.
	 * @param id Customer id.
	 * @param shopId Shop it must belong to.
	 */
	async #drop(tx: SQL, id: number, shopId: number) {
		await tx`update orders set customer_id = null where customer_id = ${id} and shop_id = ${shopId}`;
		await tx`delete from customer_sessions where customer_id = ${id} and shop_id = ${shopId}`;
		await tx`delete from customers where id = ${id} and shop_id = ${shopId}`;
	}
}
