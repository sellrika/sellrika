import { expect, test } from "bun:test";
// the implementation itself, not MAILERS.smtp: test files share one process, and another file
// stubbing the registry (MailService.test.ts does) would otherwise replace what this tests
import { Container } from "@xcore/di";
import { SmtpMailer } from "./Smtp.Mailer";

const smtp = Container.get(SmtpMailer);
import { MailError } from "@mail/types";
import { TEST_CERT, TEST_KEY } from "./testCert";

/**
 * A throwaway SMTP server on Bun.listen that answers `script` (verb → reply) and records everything it
 * was told. `STARTTLS` in the script makes it upgrade the connection the way a real 587 server does.
 */
function fakeServer(script: Record<string, string>) {
	const log: string[] = [];
	/** One connection's parser state — kept per socket so an upgraded TLS socket carries it over. */
	type State = {
		inData: boolean;
		auth: number;
		buf: string;
		greeted?: boolean;
	};
	const state = new WeakMap<object, State>();
	/**
	 * Plain sockets that were upgraded to TLS.
	 * Bun still hands them the encrypted bytes.
	 * Those bytes are random, so now and then they hold a line break,
	 * and an answer in plain text would break the TLS handshake.
	 */
	const retired = new WeakSet<object>();

	const handle = (sock: any, chunk: Buffer) => {
		if (retired.has(sock)) return;
		if (!state.has(sock)) state.set(sock, { inData: false, auth: 0, buf: "" });
		const st = state.get(sock)!;
		st.buf += chunk.toString();
		const lines = st.buf.split("\r\n");
		st.buf = lines.pop()!; // the trailing partial line waits for the next chunk
		for (const line of lines) {
			log.push(line);
			if (st.inData) {
				if (line === ".") {
					st.inData = false;
					sock.write("250 queued\r\n");
				}
				continue;
			}
			if (st.auth) {
				sock.write(
					`${
						st.auth++ === 1
							? "334 UGFzc3dvcmQ6"
							: (script.PASSWORD ?? "235 authenticated")
					}\r\n`,
				);
				if (st.auth > 2) st.auth = 0;
				continue;
			}
			const verb = line.split(/[ :]/)[0]!.toUpperCase();
			const reply = script[verb] ?? "250 ok";
			if (reply.startsWith("354")) st.inData = true;
			if (verb === "AUTH" && reply.startsWith("334")) st.auth = 1;
			sock.write(`${reply}\r\n`);
			if (verb === "STARTTLS" && reply.startsWith("220")) {
				retired.add(sock);
				// hand the same handlers to the encrypted socket and carry the parser state across
				const [raw, tls] = sock.upgradeTLS({
					tls: { key: TEST_KEY, cert: TEST_CERT },
					socket: handlers,
				});
				// the plain side comes back as a new object: retire that one too
				retired.add(raw);
				state.set(tls, { inData: false, auth: 0, buf: "", greeted: true }); // a real server doesn't re-greet
				return;
			}
			if (verb === "QUIT") sock.end();
		}
	};

	const handlers: any = {
		open: (sock: any) => {
			if (state.get(sock)?.greeted) return; // the socket handed back by upgradeTLS is already mid-session
			state.set(sock, { inData: false, auth: 0, buf: "" });
			sock.write("220 fake ESMTP\r\n");
		},
		data: handle,
		error: () => {}, // the client terminates the socket after QUIT
		close: () => {},
	};
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: handlers,
	});
	return Promise.resolve({
		port: server.port,
		log,
		close: () => server.stop(true),
	});
}

const EHLO_AUTH = {
	EHLO: "250-fake\r\n250 AUTH LOGIN",
	AUTH: "334 VXNlcm5hbWU6",
	DATA: "354 go ahead",
};
const creds = (port: number) => ({
	host: "127.0.0.1",
	port: String(port),
	username: "bob",
	password: "pw",
});
const b64 = (s: string) => Buffer.from(s).toString("base64");

test("smtp: EHLO → AUTH LOGIN → MAIL/RCPT/DATA; base64 body, RFC 2047 headers, bare envelope addresses", async () => {
	const s = await fakeServer(EHLO_AUTH);
	await smtp.send(creds(s.port), {
		from: "Café Shop <shop@x.io>",
		to: "buyer@x.io",
		subject: "Ordér #1",
		text: "Thanks!",
	});
	s.close();
	const log = s.log;
	expect(log[0]).toStartWith("EHLO ");
	expect(log).toContain("AUTH LOGIN");
	expect(log).toContain(b64("bob"));
	expect(log).toContain(b64("pw"));
	expect(log).toContain("MAIL FROM:<shop@x.io>"); // the envelope drops the display name
	expect(log).toContain("RCPT TO:<buyer@x.io>");
	expect(log).toContain("DATA");
	const message = log.join("\r\n");
	expect(message).toContain(
		`From: =?UTF-8?B?${b64("Café Shop")}?= <shop@x.io>`,
	);
	expect(message).toContain(`Subject: =?UTF-8?B?${b64("Ordér #1")}?=`);
	expect(message).toContain("Content-Transfer-Encoding: base64");
	expect(message).toContain(b64("Thanks!"));
	expect(log).toContain("."); // the lone dot that ends DATA (QUIT may or may not land before the socket closes)
	expect(log.filter((l) => l === ".")).toHaveLength(1);
});

test("smtp: a quoted name stays as it is; a non-ASCII one is encoded without its quotes", async () => {
	for (const [from, header] of [
		[
			'"Smith, Sons & Co." <shop@x.io>',
			'From: "Smith, Sons & Co." <shop@x.io>',
		],
		[
			'"Café, Co" <shop@x.io>',
			`From: =?UTF-8?B?${b64("Café, Co")}?= <shop@x.io>`,
		],
	] as const) {
		const s = await fakeServer(EHLO_AUTH);
		await smtp.send(creds(s.port), {
			from,
			to: "b@x.io",
			subject: "x",
			text: "y",
		});
		s.close();
		expect(s.log).toContain("MAIL FROM:<shop@x.io>");
		expect(s.log.join("\r\n")).toContain(header);
	}
});

test("smtp: a long body survives being split across TCP chunks", async () => {
	const s = await fakeServer(EHLO_AUTH);
	const body = "Order line — ".repeat(20000); // ~260 KB: the write lands in many chunks
	await smtp.send(creds(s.port), {
		from: "shop@x.io",
		to: "buyer@x.io",
		subject: "Big",
		text: body,
	});
	s.close();
	const start = s.log.indexOf("") + 1; // the blank line between headers and body
	const end = s.log.lastIndexOf(".");
	expect(
		Buffer.from(s.log.slice(start, end).join(""), "base64").toString("utf8"),
	).toBe(body);
});

test("smtp: STARTTLS upgrades the connection and the conversation continues over TLS", async () => {
	// the fake server presents the self-signed cert in ./testCert.ts, which no CA vouches for
	const verify = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	try {
		const s = await fakeServer({
			EHLO: "250-fake\r\n250-STARTTLS\r\n250 AUTH LOGIN",
			STARTTLS: "220 go ahead",
			AUTH: "334 VXNlcm5hbWU6",
			DATA: "354 go ahead",
		});
		await smtp.send(
			{ ...creds(s.port), port: String(s.port) },
			{
				from: "shop@x.io",
				to: "buyer@x.io",
				subject: "Secure",
				text: "Hidden",
			},
		);
		s.close();
		expect(s.log).toContain("STARTTLS");
		// everything after the upgrade arrived over the encrypted socket
		const after = s.log.slice(s.log.indexOf("STARTTLS") + 1);
		expect(after[0]).toStartWith("EHLO "); // capabilities re-announced on the new channel
		expect(after).toContain("MAIL FROM:<shop@x.io>");
		expect(after).toContain("RCPT TO:<buyer@x.io>");
		expect(after.join("\r\n")).toContain(b64("Hidden"));
	} finally {
		if (verify === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
		else process.env.NODE_TLS_REJECT_UNAUTHORIZED = verify;
	}
});

test("smtp: an unreachable server surfaces as a MailError", async () => {
	const err = await smtp
		.send(
			{ host: "127.0.0.1", port: "1" },
			{ from: "a@x.io", to: "b@x.io", subject: "x", text: "y" },
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(MailError);
});

test("smtp: a refusal from the server surfaces as a MailError", async () => {
	const s = await fakeServer({
		...EHLO_AUTH,
		PASSWORD: "535 5.7.8 authentication failed",
	});
	const err = await smtp
		.send(creds(s.port), {
			from: "shop@x.io",
			to: "buyer@x.io",
			subject: "Hi",
			text: "x",
		})
		.catch((e) => e);
	s.close();
	expect(err).toBeInstanceOf(MailError);
	expect(err.message).toMatch(/535/);
});

test("smtp: html with inline images → multipart/alternative with text + related(html + images)", async () => {
	const s = await fakeServer(EHLO_AUTH);
	const png = new Uint8Array(300).map(function byte(_, i) {
		return i % 256;
	});
	const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
	await smtp.send(creds(s.port), {
		from: "shop@x.io",
		to: "buyer@x.io",
		subject: "Pics",
		text: "Plain",
		html: '<img src="cid:a@pos"><img src="cid:b@pos">',
		inline: [
			{
				cid: "a@pos",
				filename: "a.png",
				contentType: "image/png",
				content: png,
			},
			{
				cid: "b@pos",
				filename: "b.jpg",
				contentType: "image/jpeg",
				content: jpg,
			},
		],
	});
	s.close();
	const log = s.log.slice(0, s.log.lastIndexOf("."));
	const alt = /boundary="(alt-[^"]+)"/.exec(log.join("\n"))![1]!;
	const rel = /boundary="(rel-[^"]+)"; type="text\/html"/.exec(
		log.join("\n"),
	)![1]!;
	expect(log).toContain(
		`Content-Type: multipart/alternative; boundary="${alt}"`,
	);
	expect(
		log.filter(function isAlt(l) {
			return l === `--${alt}`;
		}),
	).toHaveLength(2);
	expect(log).toContain(`--${alt}--`);
	expect(
		log.filter(function isRel(l) {
			return l === `--${rel}`;
		}),
	).toHaveLength(3);
	expect(log).toContain(`--${rel}--`);
	expect(log).toContain("Content-ID: <a@pos>");
	expect(log).toContain("Content-ID: <b@pos>");
	expect(log).toContain('Content-Disposition: inline; filename="b.jpg"');
	expect(
		log.every(function short(l) {
			return l.length <= 998 && !l.startsWith(".");
		}),
	).toBe(true);

	/**
	 * Decode the base64 body of the part whose headers hold `marker`.
	 * @param marker A header line of the part.
	 * @returns The decoded bytes.
	 */
	function body(marker: string): Buffer {
		const from = log.indexOf("", log.indexOf(marker)) + 1;
		const to = log.findIndex(function end(l, i) {
			return i > from && l.startsWith("--");
		});
		const part = log.slice(from, to);
		expect(
			part.every(function fits(l) {
				return l.length <= 76;
			}),
		).toBe(true);
		return Buffer.from(part.join(""), "base64");
	}
	expect(body("Content-Type: text/plain; charset=utf-8").toString()).toBe(
		"Plain",
	);
	expect(body("Content-Type: text/html; charset=utf-8").toString()).toContain(
		"cid:a@pos",
	);
	expect(new Uint8Array(body("Content-ID: <a@pos>"))).toEqual(png);
	expect(new Uint8Array(body("Content-ID: <b@pos>"))).toEqual(jpg);
});

test("smtp: html without images stays one text/html part", async () => {
	const s = await fakeServer(EHLO_AUTH);
	await smtp.send(creds(s.port), {
		from: "shop@x.io",
		to: "buyer@x.io",
		subject: "Hi",
		text: "Plain",
		html: "<b>Hi</b>",
		inline: [],
	});
	s.close();
	const log = s.log;
	expect(log).toContain("Content-Type: text/html; charset=utf-8");
	expect(log.join("\n")).not.toContain("multipart");
	const start = log.indexOf("Content-Transfer-Encoding: base64");
	expect(log[start + 1]).toBe("");
	expect(log[start + 2]).toBe(b64("<b>Hi</b>"));
});

test("smtp: a password goes in the clear only to this same machine", () => {
	for (const host of ["localhost", "127.0.0.1", "127.8.9.1", "::1", "[::1]"])
		expect(SmtpMailer.isLocal(host)).toBe(true);
	for (const host of ["mail.example.com", "10.0.0.5", "127.0.0.1.evil.com"])
		expect(SmtpMailer.isLocal(host)).toBe(false);
});

test("smtp: a server on another machine with no STARTTLS never gets the password; a relay with no user name still works", async () => {
	const plain = { EHLO: "250-fake\r\n250 AUTH LOGIN", DATA: "354 go ahead" };
	const msg = { from: "shop@x.io", to: "buyer@x.io", subject: "Hi", text: "x" };
	// the fake server listens on this machine: say it is not, for this test
	const isLocal = SmtpMailer.isLocal;
	SmtpMailer.isLocal = function remote() {
		return false;
	};
	try {
		const s = await fakeServer({ ...plain, AUTH: "334 VXNlcm5hbWU6" });
		const err = await smtp.send(creds(s.port), msg).catch((e) => e);
		s.close();
		expect(err).toBeInstanceOf(MailError);
		expect(err.message).toContain("STARTTLS");
		expect(s.log).not.toContain("AUTH LOGIN");
		expect(s.log).not.toContain(b64("pw"));

		const relay = await fakeServer(plain);
		await smtp.send({ host: "127.0.0.1", port: String(relay.port) }, msg);
		relay.close();
		expect(relay.log).toContain("MAIL FROM:<shop@x.io>");
	} finally {
		SmtpMailer.isLocal = isLocal;
	}
});
