import { tmpdir } from "node:os"; // Bun has no equivalent
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto"; // a test passkey signs like a real device
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import { PASSKEY_MAX } from "@constants/Auth.Constant";

// Temp SQLite DB (never the real one); db.ts reads DB_FILE at import.
process.env.DB_FILE = `${tmpdir()}/pos-passkey-test-${process.pid}.db`;
const { sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { PasskeyService: _PasskeyService } = await import("../Passkey.Service");
const PasskeyService = Container.get(_PasskeyService);
const { PasskeyRepository: _PasskeyRepository } = await import(
	"@repositories/Passkey.Repository"
);
const PasskeyRepository = Container.get(_PasskeyRepository);
const { UserRepository: _UserRepository } = await import(
	"@repositories/User.Repository"
);
const UserRepository = Container.get(_UserRepository);

const ORIGIN = "https://pos.test";
const RP = "pos.test";
const PASSWORD = "secret-pass-1";

/** Touched + verified: what a real device sets after a fingerprint. */
const CHECKED = 0x05;

type Device = { raw: Buffer; id: string; key: KeyObject; publicKey: string };

/**
 * A passkey as a device would hold it: an id and an ES256 key pair.
 * @returns The device.
 */
function device(): Device {
	const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
	return {
		raw,
		id: raw.toString("base64url"),
		key: pair.privateKey,
		publicKey: pair.publicKey
			.export({ format: "der", type: "spki" })
			.toString("base64url"),
	};
}

/**
 * SHA-256 of some bytes.
 * @param data The bytes, or text.
 * @returns The hash.
 */
function sha256(data: Buffer | string) {
	return new Bun.CryptoHasher("sha256").update(data).digest();
}

/**
 * The browser's part of an answer.
 * @param type `webauthn.create` or `webauthn.get`.
 * @param challenge The challenge from the server.
 * @param origin The page that asked.
 * @returns `clientDataJSON` as base64url.
 */
function clientData(type: string, challenge: string, origin = ORIGIN) {
	return Buffer.from(JSON.stringify({ type, challenge, origin })).toString(
		"base64url",
	);
}

/**
 * The device's part of an answer.
 * @param o The site, the flags, the use counter, and the id of a new passkey.
 * @returns `authenticatorData` as base64url.
 */
function authData(
	o: { rp?: string; flags?: number; count?: number; id?: Buffer } = {},
) {
	const head = Buffer.alloc(37);
	sha256(o.rp ?? RP).copy(head);
	head[32] = (o.flags ?? CHECKED) | (o.id ? 0x40 : 0);
	head.writeUInt32BE(o.count ?? 0, 33);
	if (!o.id) return head.toString("base64url");
	const length = Buffer.alloc(2);
	length.writeUInt16BE(o.id.length);
	// 16 zero bytes = the device model; the key after the id is never read
	return Buffer.concat([head, Buffer.alloc(16), length, o.id]).toString(
		"base64url",
	);
}

/**
 * What a device posts when it makes a passkey.
 * @param d The device.
 * @param challenge The challenge from the server.
 * @param o Changes to the honest answer.
 * @returns The input of `PasskeyService.register`.
 */
function creation(
	d: Device,
	challenge: string,
	o: { origin?: string; flags?: number; name?: string } = {},
) {
	return {
		name: o.name ?? "Laptop",
		client_data: clientData("webauthn.create", challenge, o.origin),
		authenticator_data: authData({ id: d.raw, flags: o.flags }),
		public_key: d.publicKey,
	};
}

/**
 * What a device posts when it signs in.
 * @param d The device.
 * @param challenge The challenge from the server.
 * @param o Changes to the honest answer.
 * @returns The input of `PasskeyService.login`.
 */
function assertion(
	d: Device,
	challenge: string,
	o: { rp?: string; count?: number; signer?: Device } = {},
) {
	const client_data = clientData("webauthn.get", challenge);
	const authenticator_data = authData({ rp: o.rp, count: o.count });
	const signed = Buffer.concat([
		Buffer.from(authenticator_data, "base64url"),
		sha256(Buffer.from(client_data, "base64url")),
	]);
	return {
		id: d.id,
		client_data,
		authenticator_data,
		signature: sign("sha256", signed, (o.signer ?? d).key).toString(
			"base64url",
		),
	};
}

/**
 * A fresh challenge for adding a passkey.
 * @param user The signed-in user.
 * @returns The challenge.
 */
async function challengeFor(user: { id: number }) {
	const full = (await UserRepository.find(user.id))!;
	const r = await PasskeyService.registerOptions(full, PASSWORD, ORIGIN);
	return r.options!.challenge;
}

/**
 * A fresh challenge for a sign-in.
 * @returns The challenge.
 */
function loginChallenge() {
	return PasskeyService.loginOptions(ORIGIN).challenge;
}

test("passkeys: add one with the password, sign in with it, and every guard", async () => {
	// another test file may already have migrated the shared temp DB
	await migrate(true);
	const hash = await Bun.password.hash(PASSWORD);
	const tag = `pk${process.pid}`;
	await sql`insert into users (name, email, password_hash) values ('Ann', ${`${tag}-a@x.io`}, ${hash})`;
	await sql`insert into users (name, email, password_hash) values ('Bob', ${`${tag}-b@x.io`}, ${hash})`;
	const ann = (await UserRepository.findByEmail(`${tag}-a@x.io`))!;
	const bob = (await UserRepository.findByEmail(`${tag}-b@x.io`))!;

	// ── adding ──
	// a wrong password gets no challenge
	const refused = await PasskeyService.registerOptions(ann, "nope", ORIGIN);
	expect(refused.errors?.current_password).toMatch(/incorrect/);

	const made = await PasskeyService.registerOptions(ann, PASSWORD, ORIGIN);
	expect(made.options!.rp).toEqual({ id: RP, name: "Sellrika" });
	expect(made.options!.authenticatorSelection.userVerification).toBe(
		"required",
	);
	expect(made.options!.excludeCredentials).toEqual([]);

	const laptop = device();
	const first = made.options!.challenge;
	// the answer of another page, of a device that did not check the person,
	// and of another user: each one is refused
	expect(
		await PasskeyService.register(
			ann,
			creation(laptop, await challengeFor(ann), {
				origin: "https://evil.test",
			}),
			ORIGIN,
		),
	).toEqual({ passkey: expect.stringMatching(/could not be saved/) });
	expect(
		await PasskeyService.register(
			ann,
			creation(laptop, await challengeFor(ann), { flags: 0x01 }),
			ORIGIN,
		),
	).toHaveProperty("passkey");
	expect(
		await PasskeyService.register(
			bob,
			creation(laptop, await challengeFor(ann)),
			ORIGIN,
		),
	).toHaveProperty("passkey");
	expect(await PasskeyService.list(ann.id)).toEqual([]);

	// the honest answer is saved; its challenge works once
	expect(
		await PasskeyService.register(ann, creation(laptop, first), ORIGIN),
	).toBeNull();
	expect(
		await PasskeyService.register(ann, creation(device(), first), ORIGIN),
	).toHaveProperty("passkey");
	const listed = await PasskeyService.list(ann.id);
	expect(listed).toHaveLength(1);
	expect(listed[0]).toMatchObject({ name: "Laptop", last_used_at: null });
	expect(Object.keys(listed[0]!).sort()).toEqual([
		"created_at",
		"id",
		"last_used_at",
		"name",
	]);

	// the same passkey cannot be added twice, not by another user either
	expect(
		await PasskeyService.register(
			bob,
			creation(laptop, await challengeFor(bob)),
			ORIGIN,
		),
	).toEqual({ passkey: expect.stringMatching(/already added/) });
	// the next options tell the browser which passkeys the user has
	const again = await PasskeyService.registerOptions(ann, PASSWORD, ORIGIN);
	expect(again.options!.excludeCredentials).toEqual([
		{ type: "public-key", id: laptop.id },
	]);

	// ── signing in ──
	const user = await PasskeyService.login(
		assertion(laptop, loginChallenge()),
		ORIGIN,
	);
	expect((user as { id: number }).id).toBe(ann.id);
	expect((await PasskeyService.list(ann.id))[0]!.last_used_at).not.toBeNull();

	// a recorded answer does not work a second time
	const replay = assertion(laptop, loginChallenge());
	expect(await PasskeyService.login(replay, ORIGIN)).not.toBeNull();
	expect(await PasskeyService.login(replay, ORIGIN)).toBeNull();
	// a challenge the server never made, or made for adding a passkey
	expect(
		await PasskeyService.login(assertion(laptop, "bWFkZS11cA"), ORIGIN),
	).toBeNull();
	expect(
		await PasskeyService.login(
			assertion(laptop, await challengeFor(ann)),
			ORIGIN,
		),
	).toBeNull();
	// signed by another key, made for another site, or an unknown passkey
	expect(
		await PasskeyService.login(
			assertion(laptop, loginChallenge(), { signer: device() }),
			ORIGIN,
		),
	).toBeNull();
	expect(
		await PasskeyService.login(
			assertion(laptop, loginChallenge(), { rp: "evil.test" }),
			ORIGIN,
		),
	).toBeNull();
	expect(
		await PasskeyService.login(assertion(device(), loginChallenge()), ORIGIN),
	).toBeNull();

	// the use counter must go up: 5 works, 5 again is a copy
	expect(
		await PasskeyService.login(
			assertion(laptop, loginChallenge(), { count: 5 }),
			ORIGIN,
		),
	).not.toBeNull();
	expect(
		await PasskeyService.login(
			assertion(laptop, loginChallenge(), { count: 5 }),
			ORIGIN,
		),
	).toBeNull();

	// a switched-off account stays out
	await sql`update users set active = false where id = ${ann.id}`;
	expect(
		await PasskeyService.login(
			assertion(laptop, loginChallenge(), { count: 6 }),
			ORIGIN,
		),
	).toBe("disabled");
	await sql`update users set active = true where id = ${ann.id}`;

	// ── deleting ──
	// another user's passkey is left alone
	await PasskeyService.remove(bob.id, listed[0]!.id);
	expect(await PasskeyService.list(ann.id)).toHaveLength(1);
	await PasskeyService.remove(ann.id, listed[0]!.id);
	expect(await PasskeyService.list(ann.id)).toEqual([]);
	expect(
		await PasskeyService.login(
			assertion(laptop, loginChallenge(), { count: 7 }),
			ORIGIN,
		),
	).toBeNull();

	// ── the limit, and a deleted user ──
	for (let i = 0; i < PASSKEY_MAX; i++)
		expect(
			await PasskeyService.register(
				bob,
				creation(device(), await challengeFor(bob)),
				ORIGIN,
			),
		).toBeNull();
	const full = await PasskeyService.registerOptions(bob, PASSWORD, ORIGIN);
	expect(full.errors?.passkey).toMatch(/You can keep 10 passkeys/);
	await PasskeyRepository.deleteAllFor(bob.id);
	expect(await PasskeyService.list(bob.id)).toEqual([]);
});
