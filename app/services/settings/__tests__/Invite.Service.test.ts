import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { InviteService: _InviteService } = await import("../Invite.Service");
const InviteService = Container.get(_InviteService);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);
const { ShopRepository: _ShopRepository } = await import(
	"@repositories/Shop.Repository"
);
const ShopRepository = Container.get(_ShopRepository);
const { AuthService: _AuthService } = await import("../Auth.Service");
const AuthService = Container.get(_AuthService);

await migrate(true);

const shop = {
	name: "Invited Shop",
	currency: "EUR",
	logo: null,
	timezone: "UTC",
	tax_rate: 0,
	tax_label: "Tax",
	tax_included: false,
};

test("invite: a shop for a new owner, their own account, a link that works once", async () => {
	const r = await InviteService.createShopFor(
		shop,
		"new-owner@invite.io",
		"https://pos.test",
	);
	expect(r.errors).toBeUndefined();
	// email is not set up in tests: the admin gets the link to send by hand
	expect(r.mailError).toBe("Email is not set up yet");
	const token = r.link!.replace("https://pos.test/invite/", "");
	expect(token.length).toBeGreaterThan(30);

	const owner = (await UserRepository.findByEmail("new-owner@invite.io"))!;
	expect([owner.role, owner.owner_id, owner.active]).toEqual([
		"admin",
		null,
		true,
	]);
	expect((await ShopRepository.all(owner.id)).map((s) => s.name)).toEqual([
		"Invited Shop",
	]);
	// no password works before they accept
	expect(
		await AuthService.attempt({
			email: "new-owner@invite.io",
			password: "",
		}),
	).toBeNull();

	expect((await InviteService.invited(token))?.id).toBe(owner.id);
	expect(await InviteService.invited("not-a-token")).toBeNull();
	const accepted = await InviteService.accept(token, {
		name: "Nora",
		password: "secret123",
		password_confirmation: "secret123",
	});
	expect(accepted?.id).toBe(owner.id);
	expect((await UserRepository.find(owner.id))?.name).toBe("Nora");
	expect(
		(
			(await AuthService.attempt({
				email: "new-owner@invite.io",
				password: "secret123",
			})) as { id: number }
		).id,
	).toBe(owner.id);
	// used once: the link is dead now
	expect(await InviteService.invited(token)).toBeNull();
	expect(
		await InviteService.accept(token, {
			name: "Again",
			password: "other1234",
			password_confirmation: "other1234",
		}),
	).toBeNull();
});

test("invite: an email already in use is refused, and an expired link is dead", async () => {
	await UserRepository.create(
		{ name: "Taken", email: "taken@invite.io", password: "", role: "admin" },
		"x",
		null,
	);
	expect(
		await InviteService.createShopFor(shop, "taken@invite.io", "https://x"),
	).toEqual({ errors: { owner_email: "That email is already in use" } });

	const r = await InviteService.createShopFor(
		shop,
		"late@invite.io",
		"https://x",
	);
	const token = r.link!.split("/invite/")[1]!;
	await sql`update user_invites set expires_at = '2000-01-01 00:00:00'`;
	expect(await InviteService.invited(token)).toBeNull();
});
