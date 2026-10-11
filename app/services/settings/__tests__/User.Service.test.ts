import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { UserService: _UserService } = await import("../User.Service");
const UserService = Container.get(_UserService);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);
const { SessionRepository: _SessionRepository } = await import(
	"@repositories/Session.Repository"
);
const SessionRepository = Container.get(_SessionRepository);
const { AuthService: _AuthService } = await import("../Auth.Service");
const AuthService = Container.get(_AuthService);

await migrate(true);

/**
 * A new owner: an admin with their own account.
 * @param email Their email.
 * @returns The user row.
 */
function owner(email: string) {
	return UserRepository.create(
		{ name: "Owner", email, password: "", role: "admin" },
		"x",
		null,
	);
}

test("users: create, role rules, deactivate signs out, delete only without history", async () => {
	const boss = await owner("boss@x.io");
	expect(
		await UserService.create(
			{
				name: "Dup",
				email: "boss@x.io",
				password: "password1",
				role: "cashier",
			},
			boss,
		),
	).toEqual({ email: "That email is already in use" });
	expect(
		await UserService.create(
			{
				name: "Cash",
				email: "cash@x.io",
				password: "password1",
				role: "cashier",
			},
			boss,
		),
	).toBeNull();
	const cash = (await UserRepository.findByEmail("cash@x.io"))!;
	expect(cash.owner_id).toBe(boss.id);
	expect(cash.active).toBe(true);
	// the owner and their staff only
	expect((await UserService.list(cash)).map((u) => u.email)).toEqual([
		"boss@x.io",
		"cash@x.io",
	]);

	// the owner can't demote/deactivate themselves, nor be demoted by anyone
	expect(
		await UserService.update(
			boss.id,
			{
				name: "Boss",
				email: "boss@x.io",
				role: "cashier",
				active: true,
				password: "",
			},
			boss,
		),
	).toEqual({ role: "You can't remove your own admin access" });
	expect(
		await UserService.update(
			boss.id,
			{
				name: "Boss",
				email: "boss@x.io",
				role: "admin",
				active: false,
				password: "",
			},
			cash,
		),
	).toEqual({ role: "The shop owner always stays an active admin" });
	expect(
		await UserService.update(
			cash.id,
			{
				name: "Cash",
				email: "boss@x.io",
				role: "cashier",
				active: true,
				password: "",
			},
			boss,
		),
	).toEqual({ email: "That email is already in use" });

	// deactivating drops sessions and blocks login
	const sess = await SessionRepository.create(cash.id, null, 1);
	expect(
		await UserService.update(
			cash.id,
			{
				name: "Cash",
				email: "cash@x.io",
				role: "cashier",
				active: false,
				password: "",
			},
			boss,
		),
	).toBeNull();
	expect(await SessionRepository.findValid(sess.id)).toBeNull();
	expect(
		await AuthService.attempt({ email: "cash@x.io", password: "password1" }),
	).toBe("disabled");
	// admin password reset
	expect(
		await UserService.update(
			cash.id,
			{
				name: "Cash",
				email: "cash@x.io",
				role: "cashier",
				active: true,
				password: "newpass99",
			},
			boss,
		),
	).toBeNull();
	expect(
		(
			(await AuthService.attempt({
				email: "cash@x.io",
				password: "newpass99",
			})) as any
		)?.id,
	).toBe(cash.id);

	// delete: self no; with history no; clean yes
	expect(await UserService.remove(boss.id, boss)).toEqual({
		user: "You can't delete your own account",
	});
	await sql`insert into stock_movements (shop_id, product_id, variant_id, type, qty, user_id) values (1, 1, null, 'adjustment', 1, ${cash.id})`;
	expect((await UserService.remove(cash.id, boss))?.user).toMatch(/history/);
	await sql`delete from stock_movements where user_id = ${cash.id}`;
	expect(await UserService.remove(cash.id, boss)).toBeNull();
	expect(await UserRepository.find(cash.id)).toBeNull();
	// a second admin may manage staff, but never the owner
	expect(
		await UserService.create(
			{
				name: "Two",
				email: "two@x.io",
				password: "password1",
				role: "admin",
			},
			boss,
		),
	).toBeNull();
	const two = (await UserRepository.findByEmail("two@x.io"))!;
	expect(await UserService.remove(boss.id, two)).toEqual({
		user: "The shop owner always stays an active admin",
	});
	expect(
		await UserService.update(
			two.id,
			{
				name: "Two",
				email: "two@x.io",
				role: "cashier",
				active: true,
				password: "",
			},
			boss,
		),
	).toBeNull();
});

test("users: another account's people can't be seen, edited or deleted", async () => {
	const mine = await owner("mine@x.io");
	const other = await owner("other@x.io");
	await UserService.create(
		{
			name: "Staff",
			email: "staff@mine.io",
			password: "password1",
			role: "cashier",
		},
		mine,
	);
	const staff = (await UserRepository.findByEmail("staff@mine.io"))!;
	expect((await UserService.list(other)).map((u) => u.email)).toEqual([
		"other@x.io",
	]);
	expect(
		await UserService.update(
			staff.id,
			{
				name: "Hijacked",
				email: "staff@mine.io",
				role: "admin",
				active: true,
				password: "",
			},
			other,
		),
	).toEqual({ user: "User not found" });
	expect(await UserService.remove(staff.id, other)).toEqual({
		user: "User not found",
	});
	expect((await UserRepository.find(staff.id))?.name).toBe("Staff");
});

test("users: only the owner changes the owner's account; email clashes ignore case", async () => {
	const boss = await owner("Chief@Own.io");
	await UserService.create(
		{
			name: "Second admin",
			email: "second@own.io",
			password: "password1",
			role: "admin",
		},
		boss,
	);
	const second = (await UserRepository.findByEmail("second@own.io"))!;
	const takeover = {
		name: "Chief",
		email: "attacker@own.io",
		role: "admin" as const,
		active: true,
		password: "newpassword1",
	};
	// another admin can't take over the owner's login…
	expect(await UserService.update(boss.id, takeover, second)).toEqual({
		user: "Only the shop owner can change the owner's account",
	});
	expect((await UserRepository.find(boss.id))?.email).toBe("Chief@Own.io");
	// …nor move onto the owner's email in another case
	expect(
		await UserService.update(
			second.id,
			{ ...takeover, name: "Second", email: "chief@own.io", password: "" },
			second,
		),
	).toEqual({ email: "That email is already in use" });
	// the owner still edits themselves
	expect(
		await UserService.update(
			boss.id,
			{ ...takeover, email: "chief@own.io", password: "" },
			boss,
		),
	).toBeNull();
});

test("users: a manager adds, changes and deletes cashiers only", async () => {
	const boss = await owner("mgr-boss@x.io");
	const staff = (email: string, role: "admin" | "manager" | "cashier") =>
		UserRepository.create(
			{ name: role, email, password: "", role },
			"x",
			boss.id,
		);
	const mgr = await staff("mgr@x.io", "manager");
	const admin2 = await staff("mgr-admin@x.io", "admin");
	const other = await staff("mgr-other@x.io", "manager");
	const cash = await staff("mgr-cash@x.io", "cashier");
	const refused = { user: "Managers can only add and change cashiers" };
	const edit = (
		u: { name: string; email: string },
		role: typeof cash.role,
	) => ({
		name: u.name,
		email: u.email,
		role,
		active: true,
		password: "",
	});

	// only a cashier can be added
	const add = (email: string, role: typeof cash.role) =>
		UserService.create(
			{ name: "New", email, password: "password1", role },
			mgr,
		);
	expect(await add("mgr-new1@x.io", "manager")).toEqual(refused);
	expect(await add("mgr-new2@x.io", "admin")).toEqual(refused);
	expect(await add("mgr-new3@x.io", "cashier")).toBeNull();

	// a cashier can be changed, but not made a manager
	expect(
		await UserService.update(cash.id, edit(cash, "cashier"), mgr),
	).toBeNull();
	expect(await UserService.update(cash.id, edit(cash, "manager"), mgr)).toEqual(
		refused,
	);
	// admins and other managers are off limits
	expect(
		await UserService.update(admin2.id, edit(admin2, "admin"), mgr),
	).toEqual(refused);
	expect(
		await UserService.update(other.id, edit(other, "cashier"), mgr),
	).toEqual(refused);
	expect(await UserService.remove(admin2.id, mgr)).toEqual(refused);
	expect(await UserService.remove(other.id, mgr)).toEqual(refused);
	expect(await UserService.remove(cash.id, mgr)).toBeNull();

	// an admin may still make someone a manager
	expect(
		await UserService.update(admin2.id, edit(admin2, "manager"), boss),
	).toBeNull();
});

test("users: nobody is given the platform admin's address, and a staff row is never the platform admin", async () => {
	const { app } = await import("@config/app");
	const { Account } = await import("@xcore/auth/Account");
	const boss = await owner("tenant@adm.io");
	const saved = app.adminEmail;
	app.adminEmail = "root@adm.io"; // no user row holds it
	const taken = { email: "That email is already in use" };
	expect(
		await UserService.create(
			{
				name: "Fake",
				email: "Root@adm.io",
				password: "password1",
				role: "admin",
			},
			boss,
		),
	).toEqual(taken);
	expect(
		await UserService.update(
			boss.id,
			{
				name: "Owner",
				email: "root@adm.io",
				role: "admin",
				active: true,
				password: "",
			},
			boss,
		),
	).toEqual(taken);
	// the online store's system address is reserved too, also before that user exists
	expect(await UserRepository.emailTaken("Online-Store@pos.local")).toBe(true);
	const row = { email: "root@adm.io", role: "admin" as const };
	expect(Account.isPlatformAdmin({ ...row, owner_id: boss.id })).toBe(false);
	expect(Account.isPlatformAdmin({ ...row, owner_id: null })).toBe(true);
	app.adminEmail = saved;
});
