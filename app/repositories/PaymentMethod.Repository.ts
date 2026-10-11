import { Service } from "@xcore/di";
import { Db, sql } from "@xcore/database/Database";
import type { PaymentMethod } from "@models/PaymentMethod";
import type { PaymentMethodInput } from "@validators/PaymentMethod.Validator";

/**
 * A `payment_methods` row as the driver returns it.
 * Booleans are 0/1 on SQLite.
 */
type PaymentMethodRow = Omit<PaymentMethod, "tendered" | "enabled"> & {
	tendered: unknown;
	enabled: unknown;
};

/**
 * Payment methods, per shop.
 * `orders.payment_method` stores the *name*, so history survives renames.
 */
@Service()
export class PaymentMethodRepository {
	/**
	 * Every method of a shop, in display order.
	 * @param shopId Owning shop.
	 * @returns Methods, enabled and disabled alike.
	 */
	async allForShop(shopId: number): Promise<PaymentMethod[]> {
		return (
			await sql`select * from payment_methods where shop_id = ${shopId} order by position, id`
		).map((r: PaymentMethodRow) => this.#row(r));
	}

	/**
	 * Usable at checkout: exists for this shop and is enabled.
	 * @param shopId Owning shop.
	 * @param name Method name as the client sent it.
	 * @returns True when the sale may use it.
	 */
	async usable(shopId: number, name: string) {
		return Db.exists(
			sql`select 1 from payment_methods where shop_id = ${shopId} and name = ${name} and enabled = ${true}`,
		);
	}

	/**
	 * One method of a shop.
	 * @param id Method id.
	 * @param shopId Shop it must belong to.
	 * @returns The method, or null.
	 */
	async find(id: number, shopId: number): Promise<PaymentMethod | null> {
		return Db.one(
			sql`select * from payment_methods where id = ${id} and shop_id = ${shopId}`,
			(r) => this.#row(r),
		);
	}

	/**
	 * How many methods a shop has (a shop must keep at least one).
	 * @param shopId Owning shop.
	 * @returns The count.
	 */
	async count(shopId: number) {
		return Number(
			(
				await sql`select count(*) as n from payment_methods where shop_id = ${shopId}`
			)[0].n,
		);
	}

	/**
	 * Append a method at the end of the shop's list.
	 * @param shopId Owning shop.
	 * @param d Validated name, icon, colour, picture and flags.
	 * @returns The created row.
	 */
	async create(shopId: number, d: PaymentMethodInput): Promise<PaymentMethod> {
		const position = await this.#nextPosition(shopId);
		return this.#row(
			(
				await Db.insert(
					sql,
					"payment_methods",
					sql`insert into payment_methods (shop_id, name, icon, color, image, tendered, enabled, position) values (${shopId}, ${d.name}, ${d.icon}, ${d.color}, ${d.image}, ${d.tendered}, ${d.enabled}, ${position})`,
				)
			)[0],
		);
	}

	/**
	 * Edit a method of this shop.
	 * @param id Method id.
	 * @param shopId Shop it must belong to.
	 * @param d Validated name, icon, colour, picture and flags.
	 * @returns The updated row, or null when it doesn't belong to this shop.
	 */
	async update(
		id: number,
		shopId: number,
		d: PaymentMethodInput,
	): Promise<PaymentMethod | null> {
		return Db.one(
			Db.update(
				sql,
				"payment_methods",
				sql`name = ${d.name}, icon = ${d.icon}, color = ${d.color}, image = ${d.image}, tendered = ${d.tendered}, enabled = ${d.enabled}`,
				sql`id = ${id} and shop_id = ${shopId}`,
				sql`*`,
			),
			(r) => this.#row(r),
		);
	}

	/**
	 * Delete a method (past orders keep the name they were paid with).
	 * @param id Method id.
	 * @param shopId Shop it must belong to.
	 */
	delete(id: number, shopId: number) {
		return sql`delete from payment_methods where id = ${id} and shop_id = ${shopId}`;
	}

	/**
	 * The method an extension added to a shop.
	 * @param shopId Owning shop.
	 * @param key The extension's key.
	 * @returns The method, or null.
	 */
	async ofExtension(
		shopId: number,
		key: string,
	): Promise<PaymentMethod | null> {
		return Db.one(
			sql`select * from payment_methods where shop_id = ${shopId} and extension = ${key} order by id limit 1`,
			(r) => this.#row(r),
		);
	}

	/**
	 * Keep an extension's method in step with the extension's switch.
	 * On: its method is switched on; a shop that has none yet gets one, and a
	 * method the shop already made with that name becomes the extension's.
	 * Off: its method is switched off (past orders keep the name).
	 * @param shopId Owning shop.
	 * @param key The extension's key.
	 * @param on Is the extension switched on?
	 * @param d The method as the manifest describes it.
	 */
	async syncExtension(
		shopId: number,
		key: string,
		on: boolean,
		d: { name: string; icon: string; color: string | null },
	) {
		const own = await this.ofExtension(shopId, key);
		if (own) {
			await sql`update payment_methods set enabled = ${on} where id = ${own.id}`;
			return;
		}
		if (!on) return;
		const [same] =
			await sql`select id from payment_methods where shop_id = ${shopId} and name = ${d.name} and extension is null order by id limit 1`;
		if (same) {
			await sql`update payment_methods set extension = ${key}, enabled = ${true} where id = ${same.id}`;
			return;
		}
		const position = await this.#nextPosition(shopId);
		await sql`insert into payment_methods (shop_id, name, icon, color, tendered, enabled, position, extension) values (${shopId}, ${d.name}, ${d.icon}, ${d.color}, ${false}, ${true}, ${position}, ${key})`;
	}

	/**
	 * Cash / Card / Other — what every shop starts with.
	 * Used for new shops and on first boot.
	 * The migration does the same for existing shops.
	 * @param shopId The shop to fill in.
	 */
	async seedDefaults(shopId: number) {
		await sql`insert into payment_methods (shop_id, name, icon, color, tendered, position) values
      (${shopId}, 'Cash', 'Banknote', '#22c55e', ${true}, 0),
      (${shopId}, 'Card', 'CreditCard', '#3b82f6', ${false}, 1),
      (${shopId}, 'Other', 'Wallet', '#f59e0b', ${false}, 2)`;
	}
	/**
	 * Turn a database row into a `PaymentMethod`.
	 * SQLite returns booleans as 0/1.
	 * @param r The raw row.
	 * @returns The row with real booleans.
	 */
	#row(r: PaymentMethodRow): PaymentMethod {
		return {
			...r,
			tendered: !!r.tendered,
			enabled: !!r.enabled,
		};
	}

	/**
	 * The place a new method takes: the end of the shop's list.
	 * @param shopId Owning shop.
	 * @returns The next free position, 0 for an empty list.
	 */
	async #nextPosition(shopId: number): Promise<number> {
		const [{ n }] =
			await sql`select coalesce(max(position), -1) + 1 as n from payment_methods where shop_id = ${shopId}`;
		return Number(n);
	}
}
