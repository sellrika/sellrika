import { tmpdir } from "node:os"; // Bun has no equivalent
import { afterAll, expect, test } from "bun:test";
import { Container } from "@xcore/di";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`; // before any app import
process.env.APP_KEY ??= "test-app-key-for-mail-settings";
const { sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
const { MailService: _MailService } = await import("../Mail.Service");
const MailService = Container.get(_MailService);
const { MailError } = await import("@mail");
const { MailInput } = await import("@validators/Mail.Validator");
const { MailerRegistry } = await import("@mail/Mailer.Registry");
const MAILERS = Object.fromEntries(
	Container.get(MailerRegistry)
		.all()
		.map((m) => [m.key, m]),
);
const { SettingRepository: _SettingRepository } = await import(
	"@repositories/Setting.Repository"
);
const SettingRepository = Container.get(_SettingRepository);

await migrate(true);
await sql`delete from settings where ${sql("key")} like 'mail%'`; // every test file shares one DB — start from "not set up"

// the real mailers talk to the network — swap their send() for a recorder, and put them back
// afterwards: every test file shares this process
const sent: { key: string; creds: Record<string, string>; msg: any }[] = [];
const realSend = Object.values(MAILERS).map((m) => [m, m.send] as const);
for (const m of Object.values(MAILERS))
	m.send = async (creds, msg) => void sent.push({ key: m.key, creds, msg });
afterAll(() => {
	for (const [m, send] of realSend) m.send = send;
});

const smtp = {
	host: "smtp.x.io",
	port: "587",
	username: "bob",
	password: "s3cret",
};
const off = { driver: "", from_email: "", credentials: {} };

test("mail settings: the provider that is on must be complete, its secrets are encrypted, blank keeps them", async () => {
	expect(await MailService.config()).toBeNull(); // nothing saved yet
	expect(
		(await MailService.update({ ...off, driver: "pigeon" })).errors,
	).toEqual({ driver: "Unknown email provider" });
	// switched on → host is required and a sender domain is required
	expect(
		(
			await MailService.update({
				...off,
				driver: "smtp",
				from_email: "noreply@x.io",
				credentials: { smtp: { port: "587" } },
			})
		).errors,
	).toEqual({ "credentials.smtp.host": "Host is required" });
	expect(
		(
			await MailService.update({
				...off,
				driver: "smtp",
				credentials: { smtp },
			})
		).errors,
	).toEqual({ from_email: "A sender address is required" });
	// switched off → a half-filled provider saves fine, and nothing sends
	expect(
		await MailService.update({
			...off,
			credentials: {
				smtp: { host: "smtp.x.io", port: "", username: "", password: "" },
			},
		}),
	).toEqual({});
	expect(await MailService.config()).toBeNull();

	expect(
		await MailService.update({
			...off,
			driver: "smtp",
			from_email: "noreply@x.io",
			credentials: { smtp },
		}),
	).toEqual({});
	const raw = (await SettingRepository.get("mail"))!;
	expect(raw).not.toContain("s3cret"); // stored encrypted (app/helpers/crypto.ts)
	const shown = await MailService.settings();
	expect(shown.credentials).toEqual({
		smtp: { host: "smtp.x.io", port: "587", username: "bob", password: "" },
		resend: { api_key: "" },
		azure: { connection_string: "" },
	}); // secrets never echoed
	expect(shown.secret_set).toEqual({
		smtp: { password: true },
		resend: { api_key: false },
		azure: { connection_string: false },
	});
	expect(shown.configured).toBe(true);

	// saving again with a blank secret keeps it; a new value replaces it
	await MailService.update({
		...off,
		driver: "smtp",
		from_email: "noreply@x.io",
		credentials: {
			smtp: { ...smtp, host: "smtp2.x.io", port: "465", password: "" },
		},
	});
	expect((await MailService.config())!.creds).toMatchObject({
		host: "smtp2.x.io",
		port: "465",
		password: "s3cret",
	});
	await MailService.update({
		...off,
		driver: "smtp",
		from_email: "noreply@x.io",
		credentials: {
			smtp: { ...smtp, host: "smtp2.x.io", port: "465", password: "new-one" },
		},
	});
	expect((await MailService.config())!.creds.password).toBe("new-one");
});

test("mail settings: both providers stay saved; the switched-on one delivers", async () => {
	// add Resend and switch delivery over — the SMTP block is untouched and stays stored
	await MailService.update({
		...off,
		driver: "resend",
		from_email: "noreply@x.io",
		credentials: { resend: { api_key: "re_123" } },
	});
	const c = (await MailService.config())!;
	expect(c.mailer.key).toBe("resend");
	expect(c.creds.api_key).toBe("re_123");
	expect(c.from_email).toBe("noreply@x.io");
	expect((await MailService.settings()).credentials.smtp).toMatchObject({
		host: "smtp2.x.io",
		port: "465",
	});

	// switch back without retyping anything: send nothing for either provider's fields
	await MailService.update({
		...off,
		driver: "smtp",
		from_email: "noreply@x.io",
		credentials: {},
	});
	const back = (await MailService.config())!;
	expect(back.mailer.key).toBe("smtp");
	expect(back.creds).toMatchObject({ host: "smtp2.x.io", password: "new-one" });
	expect((await MailService.settings()).secret_set.resend).toEqual({
		api_key: true,
	}); // the Resend key survived
});

/**
 * A small email for the tests.
 * @param name The shop's name; null = the app's own email.
 * @param slug The shop's slug.
 * @param id The shop's id.
 * @returns The email.
 */
function hi(name: string | null = null, slug = "giftoria", id = 9001) {
	return {
		to: "buyer@x.io",
		fromShop: name === null ? null : { id, name, slug },
		build: async () => ({ subject: "Hi", text: "Body" }),
	};
}

test("send: goes through the provider that is on, and says why when it can't", async () => {
	sent.length = 0;
	expect(await MailService.send(hi())).toBeNull();
	expect(sent).toHaveLength(1);
	expect(sent[0]!.key).toBe("smtp");
	expect(sent[0]!.creds.host).toBe("smtp2.x.io");
	expect(sent[0]!.msg).toMatchObject({
		from: "Sellrika <noreply@x.io>", // the app's own email: its own name, the platform's address
		to: "buyer@x.io",
		subject: "Hi",
		text: "Body",
	});
	// a shop's email goes out in the shop's name, from the same address (header-breaking characters dropped)
	await MailService.send(hi('My "Shop" <x>\r\nBcc: a@b.c'));
	expect(sent[1]!.msg.from).toBe('"My Shop xBcc: a@b.c" <noreply@x.io>');
	// a comma or dot would split the name into two addresses, so it is quoted
	await MailService.send(hi("Smith, Sons & Co.", "smith"));
	expect(sent[2]!.msg.from).toBe('"Smith, Sons & Co." <noreply@x.io>');
	// a name that is empty once cleaned falls back to the app's own
	await MailService.send(hi(' "<>" '));
	expect(sent[3]!.msg.from).toBe("Sellrika <noreply@x.io>");

	MAILERS.smtp!.send = async () => {
		throw new MailError("Mail server said: 535 auth failed");
	};
	expect(await MailService.send(hi())).toBe(
		"Mail server said: 535 auth failed",
	);

	// both providers switched off → nothing is sent and the caller is told
	MAILERS.smtp!.send = async (creds, msg) =>
		void sent.push({ key: "smtp", creds, msg });
	await MailService.update({ ...off, from_email: "noreply@x.io" });
	expect(await MailService.config()).toBeNull();
	expect(await MailService.send(hi())).toBe("Email is not set up yet");
});

test("a shop's own setup: needs an address, sends its email, the platform's is the fallback", async () => {
	// the platform is on again (SMTP, x.io)
	await MailService.update({
		...off,
		driver: "smtp",
		from_email: "noreply@x.io",
	});
	expect(
		(await MailService.update({ ...off, driver: "resend" }, 9001)).errors,
	).toEqual({ "credentials.resend.api_key": "API key is required" });
	expect(
		(
			await MailService.update(
				{
					...off,
					driver: "resend",
					credentials: { resend: { api_key: "re_own" } },
				},
				9001,
			)
		).errors,
	).toEqual({ from_email: "A sender address is required" });
	expect(
		await MailService.update(
			{
				...off,
				driver: "resend",
				from_email: "hello@giftoria.com",
				credentials: { resend: { api_key: "re_own" } },
			},
			9001,
		),
	).toEqual({});
	expect(await SettingRepository.get("mail:shop:9001")).not.toContain("re_own");
	expect((await MailService.settings(9001)).configured).toBe(true);
	expect((await MailService.settings()).credentials.resend).toEqual({
		api_key: "",
	}); // the platform's setup is untouched

	sent.length = 0;
	// shop 9001 sends through its own Resend, from its own address
	await MailService.send(hi("Giftoria"));
	expect(sent[0]!.key).toBe("resend");
	expect(sent[0]!.creds.api_key).toBe("re_own");
	expect(sent[0]!.msg.from).toBe("Giftoria <hello@giftoria.com>");
	// another shop has none: the platform's SMTP, from the platform's address
	await MailService.send(hi("Other", "other", 9002));
	expect(sent[1]!.key).toBe("smtp");
	expect(sent[1]!.msg.from).toBe("Other <noreply@x.io>");
	// the app's own email never uses a shop's setup
	await MailService.send(hi());
	expect(sent[2]!.msg.from).toBe("Sellrika <noreply@x.io>");
	expect(await MailService.platformAddress()).toBe("noreply@x.io");

	// the platform off: a shop with its own setup still sends, the others don't
	await MailService.update({ ...off, from_email: "noreply@x.io" });
	expect(await MailService.ready(9001)).toBe(true);
	expect(await MailService.ready(9002)).toBe(false);
	expect(await MailService.send(hi("Other", "other", 9002))).toBe(
		"Email is not set up yet",
	);

	// a shop's own mail server must be a public host, and its failure is told in fixed words
	await MailService.update(
		{
			...off,
			driver: "smtp",
			from_email: "hello@giftoria.com",
			credentials: { smtp: { host: "127.0.0.1", port: "25" } },
		},
		9001,
	);
	sent.length = 0;
	expect(await MailService.send(hi("Giftoria"))).toBe(
		"That mail server address is not allowed. Use a public host name.",
	);
	expect(sent).toEqual([]);

	// a deleted shop's setup is gone
	await MailService.forget(9001);
	expect(await MailService.ready(9001)).toBe(false);
});

test("an older platform row: a domain becomes noreply@ it, an address stays", async () => {
	const smtpCreds = JSON.parse(
		(await SettingRepository.get("mail"))!,
	).credentials;
	for (const [from_domain, address] of [
		["old.io", "noreply@old.io"],
		["orders@old.io", "orders@old.io"],
	] as const) {
		await SettingRepository.set(
			"mail",
			JSON.stringify({ driver: "smtp", from_domain, credentials: smtpCreds }),
		);
		expect((await MailService.config())!.from_email).toBe(address);
		expect((await MailService.settings()).from_email).toBe(address);
	}
});

test("the platform's sender is one whole address: every email goes out from it", async () => {
	expect(
		MailInput.safeParse({ from_email: "Support@X.io" }).data,
	).toMatchObject({ from_email: "support@x.io" });
	expect(MailInput.safeParse({ from_email: "x.io" }).success).toBe(false);
	expect(MailInput.safeParse({ from_email: "support@" }).success).toBe(false);

	await MailService.update({
		...off,
		driver: "smtp",
		from_email: "support@x.io",
	});
	await MailService.send(hi("Other", "other", 9002));
	expect(sent.at(-1)!.msg.from).toBe("Other <support@x.io>");
	await MailService.send(hi());
	expect(sent.at(-1)!.msg.from).toBe("Sellrika <support@x.io>");
	expect(await MailService.platformAddress()).toBe("support@x.io");
});
