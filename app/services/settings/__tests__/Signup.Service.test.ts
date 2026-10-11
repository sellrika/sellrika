import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
process.env.APP_KEY ||= "test-app-key-for-signup"; // CI has no .env; storing the mail key needs one
const { sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { app } = await import("@config/app");
const { SignupService: _SignupService } = await import("../Signup.Service");
const SignupService = Container.get(_SignupService);
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
const { MailService: _MailService } = await import("../Mail.Service");
const MailService = Container.get(_MailService);

await migrate(true);

/**
 * A filled sign-up form.
 * @param email The new person's email.
 * @returns The form.
 */
function form(email: string) {
	return {
		name: "Sam",
		email,
		password: "secret123",
		password_confirmation: "secret123",
		shop_name: "Sam's Shop",
		currency: "EUR",
		timezone: "UTC",
	};
}

const ORIGIN = "https://pos.test";

/**
 * Switch outgoing email on (Resend) or off.
 * @param on True = Resend with a test key.
 */
async function setMail(on: boolean) {
	await MailService.update({
		driver: on ? "resend" : "",
		from_email: "noreply@x.io",
		credentials: { resend: { api_key: on ? "re_test" : "" } },
	});
}

/**
 * Run `fn` with `fetch` stubbed like Resend, and collect what was sent.
 * @param fn The code that sends email.
 * @returns The bodies posted to Resend.
 */
async function capture(fn: () => Promise<unknown>) {
	const sent: { from: string; to: string[]; subject: string; text: string }[] =
		[];
	const real = globalThis.fetch;
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		sent.push(JSON.parse(String(init.body)));
		return Response.json({ id: "1" });
	}) as typeof fetch;
	try {
		await fn();
	} finally {
		globalThis.fetch = real;
	}
	return sent;
}

/**
 * The confirmation link in an email.
 * @param text The email's plain text.
 * @returns The token at the end of the link.
 */
function tokenIn(text: string) {
	return text.match(/\/confirm\/([\w-]+)/)![1]!;
}

test("signup: off by default, and refused while off", async () => {
	await sql`delete from settings where ${sql("key")} = 'signup'`;
	expect(await SignupService.enabled()).toBe(false);
	expect(await SignupService.register(form("off@signup.io"), ORIGIN)).toEqual({
		errors: { email: "Sign-up is off" },
	});
	expect(await UserRepository.findByEmail("off@signup.io")).toBeNull();
});

test("signup: the switch turns on and off", async () => {
	await SignupService.setEnabled(true);
	expect(await SignupService.enabled()).toBe(true);
	await SignupService.setEnabled(false);
	expect(await SignupService.enabled()).toBe(false);
});

test("signup: refused while outgoing email is off — nobody could confirm", async () => {
	await SignupService.setEnabled(true);
	await setMail(false);
	expect(
		await SignupService.register(form("nomail@signup.io"), ORIGIN),
	).toEqual({
		errors: {
			email: "Sign-up is not possible right now. Please try again later.",
		},
	});
	expect(await UserRepository.findByEmail("nomail@signup.io")).toBeNull();
});

test("signup: creates an owner and a shop, emails the link, and stays unconfirmed until it is opened", async () => {
	await SignupService.setEnabled(true);
	await setMail(true);
	const sent = await capture(() =>
		SignupService.register(form("sam@signup.io"), ORIGIN),
	);
	const user = (await UserRepository.findByEmail("sam@signup.io"))!;
	expect([user.name, user.role, user.owner_id, user.active]).toEqual([
		"Sam",
		"admin",
		null,
		true,
	]);
	const shops = await ShopRepository.all(user.id);
	expect(shops.map((s) => [s.name, s.currency, s.owner_id])).toEqual([
		["Sam's Shop", "EUR", user.id],
	]);

	// the email carries the link; until it is opened the account is unconfirmed
	expect(sent.map((m) => [m.from, m.to, m.subject])).toEqual([
		["Sellrika <noreply@x.io>", ["sam@signup.io"], "Confirm your email"],
	]); // from the app, not from a shop
	expect(sent[0]!.text).toContain(`${ORIGIN}/confirm/`);
	expect(user.email_verified_at).toBeNull();

	// a new link replaces the old one
	const again = await capture(() =>
		SignupService.sendConfirmation(user, ORIGIN),
	);
	expect(await SignupService.confirm(tokenIn(sent[0]!.text), user.id)).toBe(
		false,
	);
	// the link is only for its owner, signed in: a mail scanner or another user confirms nothing
	expect(await SignupService.confirm(tokenIn(again[0]!.text), 0)).toBe(false);
	expect(
		await SignupService.confirm(tokenIn(again[0]!.text), user.id + 1000),
	).toBe(false);
	expect((await UserRepository.find(user.id))!.email_verified_at).toBeNull();
	expect(await SignupService.confirm(tokenIn(again[0]!.text), user.id)).toBe(
		true,
	);
	expect(
		(await UserRepository.find(user.id))!.email_verified_at,
	).not.toBeNull();
	expect(await SignupService.confirm(tokenIn(again[0]!.text), user.id)).toBe(
		false,
	); // used once
	// a fresh link for a confirmed user does nothing (an invitation token can't be spent this way)
	const late = await capture(() =>
		SignupService.sendConfirmation(user, ORIGIN),
	);
	expect(await SignupService.confirm(tokenIn(late[0]!.text), user.id)).toBe(
		false,
	);

	const signedIn = await AuthService.attempt({
		email: "sam@signup.io",
		password: "secret123",
	});
	expect((signedIn as { id: number }).id).toBe(user.id);
});

test("signup: an unconfirmed sign-up does not hold the email — a new sign-up takes it over", async () => {
	await SignupService.setEnabled(true);
	await setMail(true);
	const first = await capture(() =>
		SignupService.register(form("squat@signup.io"), ORIGIN),
	);
	const user = (await UserRepository.findByEmail("squat@signup.io"))!;
	const { SessionRepository: _SessionRepository } = await import(
		"@repositories/Session.Repository"
	);
	await Container.get(_SessionRepository).create(user.id, null, 30);

	const again = await capture(() =>
		SignupService.register(
			{
				...form("squat@signup.io"),
				name: "Real Owner",
				password: "owner-pass-1",
				password_confirmation: "owner-pass-1",
				shop_name: "Real Shop",
				currency: "USD",
			},
			ORIGIN,
		),
	);
	const now = (await UserRepository.findByEmail("squat@signup.io"))!;
	expect([now.id, now.name, now.email_verified_at]).toEqual([
		user.id,
		"Real Owner",
		null,
	]);
	const shops = await ShopRepository.all(user.id);
	expect(shops.map((s) => [s.name, s.currency])).toEqual([
		["Real Shop", "USD"],
	]);
	expect(
		(await sql`select 1 from sessions where user_id = ${user.id}`).length,
	).toBe(0);
	expect(
		await AuthService.attempt({
			email: "squat@signup.io",
			password: "secret123",
		}),
	).toBeNull();
	const signedIn = await AuthService.attempt({
		email: "squat@signup.io",
		password: "owner-pass-1",
	});
	expect((signedIn as { id: number }).id).toBe(user.id);
	expect(await SignupService.confirm(tokenIn(first[0]!.text), user.id)).toBe(
		false,
	);
	expect(await SignupService.confirm(tokenIn(again[0]!.text), user.id)).toBe(
		true,
	);
});

test("signup: a taken email and the platform admin's email are refused", async () => {
	await SignupService.setEnabled(true);
	const taken = { errors: { email: "That email is already in use" } };
	expect(await SignupService.register(form("sam@signup.io"), ORIGIN)).toEqual(
		taken,
	);
	expect(await SignupService.register(form(app.adminEmail), ORIGIN)).toEqual(
		taken,
	);
	// a confirmed sign-up keeps its email
	expect(await SignupService.register(form("squat@signup.io"), ORIGIN)).toEqual(
		taken,
	);
	expect((await UserRepository.findByEmail("squat@signup.io"))!.name).toBe(
		"Real Owner",
	);
	await SignupService.setEnabled(false);
	await setMail(false);
});

test("sign-up with Google or Microsoft: a confirmed owner and a shop with no email sent; Microsoft signs in by its own account, not by the email it claims", async () => {
	const { FirebaseApi } = await import("@gateways/firebase/Firebase.Api");
	const firebase = Container.get(FirebaseApi);
	const real = firebase.lookup;
	/**
	 * Stand in for Firebase: the token is the email,
	 * a token that starts with "un:" is an unverified one.
	 * @param _key The web API key (not looked at).
	 * @param token The fake token.
	 * @returns The Firebase user.
	 */
	async function fakeLookup(_key: string, token: string) {
		return {
			// one Firebase user per sign-in account
			uid: `uid-${token}`,
			email: token.replace(/^un:/, ""),
			email_verified: !token.startsWith("un:"),
			name: "Gina Google",
		};
	}
	/**
	 * The sign-up a provider button sends.
	 * @param token The fake token.
	 * @returns The body.
	 */
	function body(token: string) {
		return { token, shop_name: "G Shop", currency: "EUR", timezone: "UTC" };
	}
	firebase.lookup = fakeLookup;
	try {
		await SignupService.setEnabled(false);
		expect(
			(await SignupService.registerProvider(body("gina@x.io"))).errors,
		).toBeDefined();
		await SignupService.setEnabled(true);
		// outgoing email is not needed: there is no link to send
		await setMail(false);

		const made = await SignupService.registerProvider(body("gina@x.io"));
		const user = made.user!;
		expect(user.name).toBe("Gina Google");
		expect(user.role).toBe("admin");
		expect(user.owner_id).toBeNull();
		expect(user.email_verified_at).not.toBeNull();
		expect((await ShopRepository.first(user.id))?.name).toBe("G Shop");
		// nobody knows the password, but the provider signs them in
		expect(
			await AuthService.attempt({ email: "gina@x.io", password: "" }),
		).toBeNull();
		expect(((await AuthService.firebaseSignIn("gina@x.io")) as any)?.id).toBe(
			user.id,
		);

		// taken: the same email again, and the platform admin's
		for (const email of ["gina@x.io", app.adminEmail])
			expect(
				(await SignupService.registerProvider(body(email))).errors?.provider,
			).toMatch(/already in use/);

		// an unconfirmed password sign-up with that email is taken over, confirmed
		await sql`insert into users (name, email, password_hash, role) values ('Squatter', 'held@x.io', 'x', 'admin')`;
		const taken = (await SignupService.registerProvider(body("held@x.io")))
			.user!;
		const now = (await UserRepository.findByEmail("held@x.io"))!;
		expect(now.id).toBe(taken.id);
		expect(now.name).toBe("Gina Google");
		expect(now.email_verified_at).not.toBeNull();

		// Microsoft: the email is not proved, so the owner signs in by the
		// sign-in account itself, and there is still nothing to confirm
		const ms = (await SignupService.registerProvider(body("un:mia@x.io")))
			.user!;
		expect(ms.email).toBe("mia@x.io");
		expect(ms.email_verified_at).not.toBeNull();
		expect(((await AuthService.firebaseSignIn("un:mia@x.io")) as any)?.id).toBe(
			ms.id,
		);
		// the same sign-in account can't sign up twice
		expect(
			(await SignupService.registerProvider(body("un:mia@x.io"))).errors
				?.provider,
		).toMatch(/already in use/);
		// a sign-in that only claims a taken email makes nothing and gets nowhere
		expect(
			(await SignupService.registerProvider(body("un:gina@x.io"))).errors
				?.provider,
		).toMatch(/already in use/);
		expect(await AuthService.firebaseSignIn("un:gina@x.io")).toBeNull();
		// "Forgot password" hands the account to the mailbox's owner:
		// the sign-in account is cut off
		const { link } = (await AuthService.resetLink("mia@x.io", ORIGIN))!;
		await AuthService.resetPassword(link.split("/").pop()!, "newpass123");
		expect(await AuthService.firebaseSignIn("un:mia@x.io")).toBeNull();
	} finally {
		firebase.lookup = real;
		await SignupService.setEnabled(false);
	}
});
