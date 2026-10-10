import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";

// Temp SQLite DB (never the real data/pos.db); db.ts reads DB_FILE at import, hence the dynamic imports.
process.env.DB_FILE = `${tmpdir()}/pos-auth-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
const { AuthService: _AuthService } = await import("../Auth.Service");
const AuthService = Container.get(_AuthService);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);
const { SessionRepository: _SessionRepository } = await import(
	"@repositories/Session.Repository"
);
const SessionRepository = Container.get(_SessionRepository);

test("changePassword checks the old one, rehashes, and drops other sessions", async () => {
	// another test file may already have migrated the shared temp DB
	const migrated = await sql`select 1 from users`.then(
		() => true,
		() => false,
	);
	if (!migrated)
		for (const [, up] of Object.entries(registry).sort(([a], [b]) =>
			a.localeCompare(b),
		))
			await up(sql);
	await sql`insert into users (name, email, password_hash) values ('A', 'a@x.io', ${await Bun.password.hash("oldpass123")})`;
	const user = (await UserRepository.findByEmail("a@x.io"))!;
	const keep = await SessionRepository.create(user.id, null, 1);
	const other = await SessionRepository.create(user.id, null, 1);

	const input = {
		current_password: "wrong",
		password: "newpass123",
		password_confirmation: "newpass123",
	};
	expect(await AuthService.changePassword(user, keep.id, input)).toMatch(
		/incorrect/,
	);
	expect(
		await AuthService.changePassword(user, keep.id, {
			...input,
			current_password: "oldpass123",
		}),
	).toBeNull();

	expect(
		await AuthService.attempt({ email: "a@x.io", password: "oldpass123" }),
	).toBeNull();
	expect(
		(
			(await AuthService.attempt({
				email: "a@x.io",
				password: "newpass123",
			})) as any
		)?.id,
	).toBe(user.id);
	expect(await SessionRepository.findValid(keep.id)).not.toBeNull();
	expect(await SessionRepository.findValid(other.id)).toBeNull();
});

test("forgot password: a link that works once and signs every device out", async () => {
	const origin = "https://pos.test";
	await sql`insert into users (name, email, password_hash, email_verified_at) values ('R', 'reset@x.io', ${await Bun.password.hash("oldpass123")}, current_timestamp)`;
	await sql`insert into users (name, email, password_hash, email_verified_at, active) values ('Off', 'off@x.io', 'x', current_timestamp, false)`;
	const user = (await UserRepository.findByEmail("reset@x.io"))!;

	// no link for an unknown email, a switched-off account, or a sign-up that was never confirmed
	expect(await AuthService.resetLink("nobody@x.io", origin)).toBeNull();
	expect(await AuthService.resetLink("off@x.io", origin)).toBeNull();
	expect(await AuthService.resetLink("a@x.io", origin)).toBeNull();

	const made = (await AuthService.resetLink("reset@x.io", origin))!;
	expect(made.user.id).toBe(user.id);
	const token = made.link.replace(`${origin}/reset-password/`, "");
	expect(token.length).toBeGreaterThan(30);
	// asked again at once: no second email
	expect(await AuthService.resetLink("reset@x.io", origin)).toBeNull();

	expect((await AuthService.resettable(token))?.id).toBe(user.id);
	expect(await AuthService.resettable("not-a-token")).toBeNull();
	expect(await AuthService.resetPassword("not-a-token", "x")).toBeNull();

	const session = await SessionRepository.create(user.id, null, 1);
	expect((await AuthService.resetPassword(token, "newpass123"))?.id).toBe(
		user.id,
	);
	expect(
		await AuthService.attempt({ email: "reset@x.io", password: "oldpass123" }),
	).toBeNull();
	expect(
		(
			(await AuthService.attempt({
				email: "reset@x.io",
				password: "newpass123",
			})) as any
		)?.id,
	).toBe(user.id);
	expect(await SessionRepository.findValid(session.id)).toBeNull();

	// used: the link is dead
	expect(await AuthService.resettable(token)).toBeNull();
	expect(await AuthService.resetPassword(token, "again12345")).toBeNull();

	// too old: the link is dead
	const late = (await AuthService.resetLink("reset@x.io", origin))!;
	await sql`update user_invites set expires_at = '2000-01-01 00:00:00' where user_id = ${user.id}`;
	expect(
		await AuthService.resettable(
			late.link.replace(`${origin}/reset-password/`, ""),
		),
	).toBeNull();

	// email is not set up in tests: the form says so, for every email
	expect(await AuthService.forgot("reset@x.io", origin)).toBe(
		"Email is not set up yet",
	);
});

test("google sign-in: only a verified Google email of an existing, active account", async () => {
	const { FirebaseApi } = await import("@gateways/firebase/Firebase.Api");
	const firebase = Container.get(FirebaseApi);
	const real = firebase.lookup;
	/**
	 * Stand in for Firebase: the token is the email,
	 * a token that starts with "un" is an unverified one.
	 * @param _key The web API key (not looked at).
	 * @param token The fake token.
	 * @returns The Firebase user, or null for the token "bad".
	 */
	async function fakeLookup(_key: string, token: string) {
		if (token === "bad") return null;
		if (token === "down") throw new Error("Firebase answered 500");
		return {
			uid: "g1",
			email: token.replace(/^un:/, ""),
			email_verified: !token.startsWith("un:"),
			name: null,
		};
	}
	firebase.lookup = fakeLookup;
	try {
		await sql`insert into users (name, email, password_hash) values ('G', 'g@x.io', 'x')`;
		await sql`insert into users (name, email, password_hash, active) values ('GOff', 'goff@x.io', 'x', false)`;
		expect(((await AuthService.firebaseSignIn("g@x.io")) as any)?.email).toBe(
			"g@x.io",
		);
		// an email nobody proved signs nobody in
		expect(await AuthService.firebaseSignIn("un:g@x.io")).toBeNull();
		// no account is ever made: "new" only says the person may sign up
		expect(await AuthService.firebaseSignIn("stranger@x.io")).toBe("new");
		expect(await AuthService.firebaseSignIn("un:stranger@x.io")).toBe("new");
		expect(await UserRepository.findByEmail("stranger@x.io")).toBeNull();
		expect(await AuthService.firebaseSignIn("goff@x.io")).toBe("disabled");
		// a token Firebase refuses, or Firebase being down
		expect(await AuthService.firebaseSignIn("bad")).toBeNull();
		expect(await AuthService.firebaseSignIn("down")).toBeNull();

		// connect in /settings: the password first, then the sign-in account
		// (the stand-in gives every token the same Firebase user)
		const g = (await UserRepository.findByEmail("g@x.io"))!;
		await sql`update users set password_hash = ${await Bun.password.hash("gpass1234")} where id = ${g.id}`;
		const fresh = (await UserRepository.findByEmail("g@x.io"))!;
		expect(await AuthService.providerConnected(g.id)).toBe(false);
		expect(
			(await AuthService.connectProvider(fresh, "wrong", "un:other@x.io"))
				?.current_password,
		).toBeDefined();
		expect(
			await AuthService.connectProvider(fresh, "gpass1234", "un:other@x.io"),
		).toBeNull();
		expect(await AuthService.providerConnected(g.id)).toBe(true);
		// that account signs them in now, whatever email it claims
		expect(
			((await AuthService.firebaseSignIn("un:other@x.io")) as any)?.id,
		).toBe(g.id);
		// one sign-in account, one user
		const off = (await UserRepository.findByEmail("goff@x.io"))!;
		await sql`update users set password_hash = ${await Bun.password.hash("offpass123")} where id = ${off.id}`;
		expect(
			(
				await AuthService.connectProvider(
					(await UserRepository.findByEmail("goff@x.io"))!,
					"offpass123",
					"un:other@x.io",
				)
			)?.microsoft,
		).toMatch(/another user/);
		await AuthService.disconnectProvider(g.id);
		expect(await AuthService.firebaseSignIn("un:g@x.io")).toBeNull();
	} finally {
		firebase.lookup = real;
	}
});
