import { Account } from "@xcore/auth/Account";
import { t } from "@xcore/i18n/I18n";
import { Service } from "@xcore/di";
import { PlanLimitService } from "@services/settings/PlanLimit.Service";
import { ExtensionService } from "@services/settings/extensions/Extension.Service";
import { SessionRepository } from "@repositories/Session.Repository";
import { PasskeyRepository } from "@repositories/Passkey.Repository";
import { ApiKeyRepository } from "@repositories/ApiKey.Repository";
import { UserRepository } from "@repositories/User.Repository";
import type { Role, User } from "@models/User";
import type { EditUserInput, NewUserInput } from "@validators/User.Validator";
import type { Errors } from "@validators/validate";

/**
 * Staff management.
 * And the rules that stop an account from locking itself out.
 */
@Service()
export class UserService {
	constructor(
		private users: UserRepository,
		private sessions: SessionRepository,
		private passkeys: PasskeyRepository,
		private apiKeys: ApiKeyRepository,
		private extensions: ExtensionService,
		private limits: PlanLimitService,
	) {}

	/**
	 * Everyone in the actor's account, without password hashes.
	 * @param actor The signed-in user.
	 * @returns Users with their `activity` count.
	 */
	list(actor: User) {
		return this.users.all(Account.id(actor));
	}

	/**
	 * Create a staff account in the actor's account.
	 * A manager may only create cashiers.
	 * @param d Validated name, email, role and password.
	 * @param actor The signed-in user doing it.
	 * @returns Inertia errors, or null on success.
	 */
	async create(d: NewUserInput, actor: User): Promise<Errors | null> {
		const refused = this.#managerRefusal(actor, d.role);
		if (refused) return refused;
		// the platform admin's address is never given to a new user
		if (Account.isAdminEmail(d.email) || (await this.users.emailTaken(d.email)))
			return { email: t("server.user_email_taken") };
		const owner = Account.id(actor);
		const full = await this.limits.freeError(
			owner,
			"staff",
			(await this.users.all(owner)).length,
		);
		if (full) return { email: full };
		const user = await this.users.create(
			d,
			await Bun.password.hash(d.password),
			owner,
		);
		// staff works in every shop of the account
		// each of those shops' extensions hears it
		void this.extensions.emitAll(owner, "staff.created", {
			user: this.#pub(user),
		});
		return null;
	}

	/**
	 * Edit a staff account of the actor's account.
	 * You can't demote or deactivate yourself.
	 * The owner can't be demoted or deactivated by anyone.
	 * So an account always keeps one admin.
	 * Only the owner may change the owner's details (email, password).
	 * A manager may only change cashiers, and keep them cashiers.
	 * A new password (if given) or deactivation signs that user out everywhere.
	 * @param id User being edited.
	 * @param d Validated name, email, role and active flag.
	 * And a new password, if one was typed.
	 * @param actor The signed-in user doing the edit.
	 * @returns Inertia errors, or null on success.
	 */
	async update(
		id: number,
		d: EditUserInput,
		actor: User,
	): Promise<Errors | null> {
		const target = await this.#inAccount(id, actor);
		if (!target) return { user: t("server.user_not_found") };
		const refused = this.#managerRefusal(actor, d.role, target);
		if (refused) return refused;
		// only the user who already holds the platform admin's address keeps it
		const adminEmail =
			Account.isAdminEmail(d.email) && !Account.isAdminEmail(target.email);
		if (adminEmail || (await this.users.emailTaken(d.email, id)))
			return { email: t("server.user_email_taken") };
		const demoted = d.role !== "admin" || !d.active;
		if (actor.id === id && demoted)
			return { role: t("server.user_no_self_demote") };
		if (target.owner_id === null && demoted)
			return { role: t("server.user_owner_stays_admin") };
		// only the owner edits the owner
		// else another admin could take over their login
		if (target.owner_id === null && actor.id !== id)
			return { user: t("server.user_owner_edits_self") };
		const user = await this.users.update(
			id,
			d,
			d.password ? await Bun.password.hash(d.password) : null,
		);
		if (d.password || !d.active) await this.sessions.deleteAllFor(id);
		// somebody else set the password: the user's passkeys go too,
		// so the old holder of the account has no way back in
		if (d.password && actor.id !== id) await this.passkeys.deleteAllFor(id);
		if (user)
			void this.extensions.emitAll(Account.id(user), "staff.updated", {
				user: this.#pub(user),
			});
		return null;
	}

	/**
	 * Delete a staff account of the actor's account.
	 * Only users with no history (orders, refunds, stock movements) can go;
	 * everyone else has to be deactivated instead. The owner never goes.
	 * A manager may only delete cashiers.
	 * @param id User being deleted.
	 * @param actor The signed-in user doing it.
	 * @returns Inertia errors, or null on success.
	 */
	async remove(id: number, actor: User): Promise<Errors | null> {
		if (actor.id === id) return { user: t("server.user_no_self_delete") };
		const owner = Account.id(actor);
		const target = (await this.users.all(owner)).find((u) => u.id === id);
		if (!target) return { user: t("server.user_not_found") };
		const refused = this.#managerRefusal(actor, null, target);
		if (refused) return refused;
		if (target.owner_id === null)
			return { user: t("server.user_owner_stays_admin") };
		if (target.activity > 0)
			return {
				user: t("server.user_has_history"),
			};
		await this.sessions.deleteAllFor(id);
		await this.passkeys.deleteAllFor(id);
		await this.apiKeys.deleteAllFor(id);
		await this.users.delete(id);
		const { activity: _, ...user } = target;
		void this.extensions.emitAll(owner, "staff.deleted", { user });
		return null;
	}

	/**
	 * What a manager may not do to a staff account.
	 * A manager adds, changes and deletes cashiers only.
	 * A manager gives out no other role.
	 * Admins are never refused here.
	 * @param actor The signed-in user.
	 * @param role The role being given, if any.
	 * @param target The account being changed, if any.
	 * @returns Inertia errors, or null when it is allowed.
	 */
	#managerRefusal(
		actor: User,
		role: Role | null,
		target?: Pick<User, "role">,
	): Errors | null {
		if (actor.role !== "manager") return null;
		if ((role && role !== "cashier") || (target && target.role !== "cashier"))
			return { user: t("server.user_manager_cashiers_only") };
		return null;
	}

	/**
	 * A user of the actor's account.
	 * @param id The user.
	 * @param actor The signed-in user.
	 * @returns The user, or null when missing or in another account.
	 */
	async #inAccount(id: number, actor: User) {
		const user = await this.users.find(id);
		return user && Account.id(user) === Account.id(actor) ? user : null;
	}

	/**
	 * A user as the extensions may see it.
	 * @param user The user row.
	 * @returns The same user, without the password hash.
	 */
	#pub({ password_hash: _, ...u }: User) {
		return u;
	}
}
