import { t } from "@xcore/i18n/I18n";
import type { Socket, SocketHandler } from "bun";
import { Service } from "@xcore/di";
import {
	MailError,
	type InlineImage,
	type MailField,
	type Mailer,
	type MailMessage,
} from "@mail/types";
import { messageOf } from "@helpers/error";
import { SMTP_TIMEOUT_MS } from "@constants/Mail.Constant";

/**
 * SMTP on Bun.connect.
 * No npm package and no node: imports, so the backend stays Bun-only.
 * Enough of RFC 5321 for one message to one recipient.
 * Implicit TLS on 465, STARTTLS otherwise.
 * AUTH LOGIN when a username is set.
 * The body is always base64: no dot-stuffing, no line-length limits.
 * ponytail: single recipient, no connection pooling, no DKIM.
 * Add a queue or a pool if volume ever needs one.
 */

/**
 * Whoever waits for the next reply.
 */
type Waiter = { ok: (r: string) => void; fail: (e: Error) => void };

/**
 * Buffers bytes off the socket and hands back one SMTP reply at a time.
 * A reply ends at the first line whose 4th character isn't "-".
 * That is how multi-line capability lists are continued.
 */
class ReplyBuffer {
	private buf = "";
	/**
	 * A drop can land before anyone is waiting, so it is remembered.
	 */
	private dead: Error | null = null;
	private want: Waiter | null = null;

	/**
	 * Take in bytes that came off the socket.
	 * @param chunk The text that arrived.
	 */
	push(chunk: string) {
		this.buf += chunk;
		this.#settle();
	}

	/**
	 * Fail whoever is waiting, and everyone who asks later.
	 * The first failure is the one that is kept.
	 * @param e Why the conversation ended.
	 */
	fail(e: Error) {
		this.dead ??= e;
		const w = this.want;
		this.want = null;
		w?.fail(e);
	}

	/**
	 * The next reply of the server.
	 * @returns The reply, without its last line break.
	 * It rejects when the conversation has ended.
	 */
	next(): Promise<string> {
		return this.dead
			? Promise.reject(this.dead)
			: new Promise<string>(this.#wait.bind(this));
	}

	/**
	 * Hand a whole reply to whoever waits, when the buffer holds one.
	 */
	#settle() {
		for (let at = 0; this.want; ) {
			const nl = this.buf.indexOf("\r\n", at);
			if (nl < 0) return;
			if (this.buf[at + 3] !== "-") {
				const reply = this.buf.slice(0, nl);
				this.buf = this.buf.slice(nl + 2);
				const w = this.want;
				this.want = null;
				w.ok(reply);
				return;
			}
			at = nl + 2;
		}
	}

	/**
	 * Start waiting for a reply.
	 * @param ok Called with the reply.
	 * @param fail Called when the conversation ends first.
	 */
	#wait(ok: Waiter["ok"], fail: Waiter["fail"]) {
		this.want = { ok, fail };
		this.#settle();
	}
}

/**
 * The conversation with one mail server.
 * A line to write, a reply to read, a way to hang up,
 * and the STARTTLS upgrade.
 * A drop, a stall or a TLS failure surfaces as a MailError
 * on whichever `read()` is waiting.
 * So `send()` only ever has to handle one kind of error.
 */
class SmtpWire {
	private replies = new ReplyBuffer();
	private readonly where: string;
	/**
	 * Bun counts idle seconds, not milliseconds.
	 */
	private readonly idle = Math.ceil(SMTP_TIMEOUT_MS / 1000);
	/**
	 * The socket we are actually talking on.
	 * STARTTLS swaps it for the encrypted one.
	 * It is not set until the connection is open.
	 */
	private socket!: Socket<undefined>;
	/**
	 * Bytes the socket has not taken yet.
	 * Bun's socket.write() is a raw syscall.
	 * It can accept only part of a large buffer and returns how much it took.
	 * A 250 KB message body is exactly that case.
	 * So anything it didn't take waits here and goes out on `drain`.
	 * (node:net queued this for us; Bun hands us the backpressure.)
	 */
	private queued: Buffer | null = null;
	/**
	 * The socket events, each bound to this wire.
	 * The same set is handed to the plain and to the encrypted socket.
	 */
	private readonly handlers: SocketHandler<undefined>;

	/**
	 * @param host Mail server hostname.
	 * @param port Mail server port.
	 */
	private constructor(
		private host: string,
		port: number,
	) {
		this.where = `${host}:${port}`;
		this.handlers = {
			data: this.#onData.bind(this),
			error: this.#onError.bind(this),
			connectError: this.#onError.bind(this),
			close: this.#onClose.bind(this),
			drain: this.#flush.bind(this),
			timeout: this.#onTimeout.bind(this),
		};
	}

	/**
	 * Open a connection and wrap it as a wire.
	 * @param host Mail server hostname.
	 * @param port Mail server port.
	 * @param secure True for implicit TLS (port 465).
	 * False to start in the clear and maybe STARTTLS.
	 * @returns The wire to talk over.
	 * @throws MailError when the server can't be reached.
	 */
	static async open(
		host: string,
		port: number,
		secure: boolean,
	): Promise<SmtpWire> {
		const wire = new SmtpWire(host, port);
		try {
			wire.socket = await Bun.connect({
				hostname: host,
				port,
				tls: secure,
				socket: wire.handlers,
			});
		} catch (e) {
			throw SmtpWire.#unreachable(wire.where, e);
		}
		wire.socket.timeout(wire.idle);
		return wire;
	}

	/**
	 * Write one line to the server.
	 * @param line The line, without its line break.
	 */
	write(line: string) {
		const chunk = Buffer.from(`${line}\r\n`, "utf8");
		this.queued = this.queued ? Buffer.concat([this.queued, chunk]) : chunk;
		this.#flush();
	}

	/**
	 * Read the server's next reply.
	 * @returns The reply.
	 */
	read(): Promise<string> {
		return this.replies.next();
	}

	/**
	 * Hang up.
	 */
	close() {
		this.socket.terminate();
	}

	/**
	 * Wrap the live connection in TLS and keep talking on it
	 * (STARTTLS on 587/25).
	 */
	starttls() {
		const [, tls] = this.socket.upgradeTLS({
			tls: { serverName: this.host },
			socket: this.handlers,
		});
		// reassigned first, so the retiring socket's close event is ignored
		this.socket = tls;
		this.socket.timeout(this.idle);
	}

	/**
	 * Send one command and insist on the reply code it must answer with.
	 * @param line The command, or null to only read (the greeting).
	 * @param expect The reply code the server must answer with.
	 * @returns The server's reply.
	 * @throws MailError when the server answers with another code.
	 */
	async say(line: string | null, expect: number): Promise<string> {
		if (line !== null) this.write(line);
		const reply = await this.read();
		if (Number(reply.slice(0, 3)) !== expect)
			throw new MailError(t("server.smtp_said", { reply: reply.trim() }));
		return reply;
	}

	/**
	 * Bytes arrived.
	 * After STARTTLS the retired plaintext socket still sees the TLS records.
	 * Only the live socket talks.
	 * @param s The socket they arrived on.
	 * @param chunk The bytes.
	 */
	#onData(s: unknown, chunk: Buffer) {
		if (s === this.socket) this.replies.push(chunk.toString("utf8"));
	}

	/**
	 * The socket failed, or could not connect at all.
	 * @param _s The socket.
	 * @param e What went wrong.
	 */
	#onError(_s: unknown, e: Error) {
		this.replies.fail(SmtpWire.#unreachable(this.where, e));
	}

	/**
	 * A socket closed.
	 * STARTTLS retires the plaintext socket.
	 * Only a close on the *live* one ends the conversation.
	 * @param s The socket that closed.
	 */
	#onClose(s: unknown) {
		if (s === this.socket)
			this.replies.fail(new MailError(t("server.smtp_closed")));
	}

	/**
	 * The server stayed silent for too long.
	 * @param s The socket that stalled.
	 */
	#onTimeout(s: { terminate(): void }) {
		this.replies.fail(new MailError(t("server.smtp_timeout")));
		s.terminate();
	}

	/**
	 * Send what is still waiting, as much as the socket takes.
	 * Called after every write and on every `drain`.
	 */
	#flush() {
		if (!this.queued) return;
		const sent = this.socket.write(this.queued);
		this.queued =
			sent >= this.queued.length ? null : this.queued.subarray(sent);
	}

	/**
	 * The error for a server that can't be reached.
	 * @param where The server, as `host:port`.
	 * @param e What the socket reported.
	 * @returns A MailError a person may read.
	 */
	static #unreachable(where: string, e: unknown): MailError {
		return new MailError(
			t("server.smtp_unreachable", { where, reason: messageOf(e) }),
		);
	}
}

/**
 * Plain SMTP.
 * It works with any mail server the merchant already has.
 */
@Service()
export class SmtpMailer implements Mailer {
	readonly key = "smtp";
	readonly label = "SMTP";

	/**
	 * A warning for the provider's card.
	 * Many hosts block the SMTP ports.
	 * So the card says so and points at the HTTPS providers.
	 * @returns The note, translated per request.
	 */
	get note(): string {
		return t("server.smtp_ports_note");
	}

	/**
	 * Is this mail server on this same machine?
	 * Only there may a password go without encryption:
	 * it never leaves the machine.
	 * @param host The host as typed.
	 * @returns True for `localhost` and the loopback addresses.
	 */
	static isLocal(host: string): boolean {
		const h = host
			.trim()
			.toLowerCase()
			.replace(/^\[|\]$/g, "");
		return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
	}

	/**
	 * The host these credentials make the server connect to.
	 * @param creds The decrypted credentials.
	 * @returns The mail server's host name, or null when it is blank.
	 */
	host(creds: Record<string, string>): string | null {
		return creds.host?.trim() || null;
	}

	/**
	 * The credentials the admin fills in.
	 * A getter, not a field: the labels are translated per request.
	 * @returns Host, port, username and password.
	 */
	get fields(): MailField[] {
		return [
			{
				name: "host",
				label: t("server.mail_field_host"),
				secret: false,
				required: true,
				placeholder: "smtp.example.com",
			},
			{
				name: "port",
				label: t("server.mail_field_port"),
				secret: false,
				required: true,
				placeholder: "587",
			},
			{
				name: "username",
				label: t("server.mail_field_username"),
				secret: false,
				required: false,
				placeholder: "you@example.com",
			},
			{
				name: "password",
				label: t("server.mail_field_password"),
				secret: true,
				required: false,
			},
		];
	}

	/**
	 * Deliver one message.
	 * Implicit TLS on port 465.
	 * STARTTLS whenever the server offers it.
	 * AUTH LOGIN when a username is set.
	 * @param creds Host, port and optional username/password.
	 * @param msg Sender, recipient, subject and body.
	 * @throws MailError when the server is unreachable or times out.
	 * Also when it answers with anything unexpected.
	 */
	async send(creds: Record<string, string>, msg: MailMessage): Promise<void> {
		const host = creds.host!;
		const port = Number(creds.port) || 587;
		// 465 is TLS from the first byte; 587/25 negotiate with STARTTLS
		const implicitTls = port === 465;
		const wire = await SmtpWire.open(host, port, implicitTls);

		try {
			// the greeting
			await wire.say(null, 220);
			const ehlo = `EHLO ${Bun.env.HOSTNAME || "localhost"}`;
			const caps = await wire.say(ehlo, 250);
			if (!implicitTls && /starttls/i.test(caps)) {
				await wire.say("STARTTLS", 220);
				wire.starttls();
				// capabilities are announced again on the encrypted channel
				await wire.say(ehlo, 250);
			} else if (!implicitTls && creds.username && !SmtpMailer.isLocal(host)) {
				// the password must never cross a network in the clear
				throw new MailError(t("server.smtp_needs_tls"));
			}
			if (creds.username) {
				await wire.say("AUTH LOGIN", 334);
				await wire.say(this.#b64(creds.username), 334);
				await wire.say(this.#b64(creds.password ?? ""), 235);
			}
			await wire.say(`MAIL FROM:<${this.#bare(msg.from)}>`, 250);
			await wire.say(`RCPT TO:<${this.#bare(msg.to)}>`, 250);
			await wire.say("DATA", 354);
			await wire.say(`${this.#message(msg)}\r\n.`, 250);
			wire.write("QUIT");
		} finally {
			wire.close();
		}
	}

	/**
	 * Text as base64.
	 * @param s The text.
	 * @returns Its UTF-8 bytes, base64.
	 */
	#b64(s: string): string {
		return Buffer.from(s, "utf8").toString("base64");
	}

	/**
	 * RFC 2047 for header text that isn't plain ASCII.
	 * A shop name with accents, an emoji subject…
	 * @param s The header text.
	 * @returns The text as it is, or one encoded word.
	 */
	#header(s: string): string {
		return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${this.#b64(s)}?=`;
	}

	/**
	 * Encode the display name of one address for the header.
	 * A plain ASCII name (quoted or not) passes through as it is.
	 * A non-ASCII name loses its quotes and becomes one RFC 2047 word.
	 * Quotes don't belong inside it.
	 * A bare address passes through.
	 * @param a The address, like `"Café, Co" <a@b.com>` or `a@b.com`.
	 * @returns The header value.
	 */
	#address(a: string): string {
		const m = /^(.*?)\s*<([^>]+)>$/.exec(a);
		if (!m) return a;
		const name = m[1]!;
		const plain = /^[\x20-\x7e]*$/.test(name);
		const shown = plain ? name : this.#header(name.replace(/^"(.*)"$/, "$1"));
		return `${shown} <${m[2]}>`.trim();
	}

	/**
	 * The envelope address.
	 * It is what goes inside MAIL FROM / RCPT TO angle brackets.
	 * @param a The address, with or without a display name.
	 * @returns The bare address.
	 */
	#bare(a: string): string {
		return /^(?:.*<)?([^<>]+?)>?$/.exec(a.trim())?.[1] ?? a;
	}

	/**
	 * Base64 a body and cut it into lines of at most 76 characters.
	 * @param bytes The body, as text or raw bytes.
	 * @returns The lines.
	 */
	#lines(bytes: string | Uint8Array): string[] {
		const text =
			typeof bytes === "string"
				? this.#b64(bytes)
				: Buffer.from(bytes).toString("base64");
		return text.match(/.{1,76}/g) ?? [""];
	}

	/**
	 * Build one multipart body: each part, then the closing boundary.
	 * @param boundary The boundary string.
	 * @param parts Each part as its lines (headers, a blank line, the body).
	 * @returns The lines of the whole body.
	 */
	#multipart(boundary: string, parts: string[][]): string[] {
		return [
			...parts.flatMap(function withBoundary(part) {
				return [`--${boundary}`, ...part];
			}),
			`--${boundary}--`,
		];
	}

	/**
	 * One inline image as a MIME part.
	 * @param img The image.
	 * @returns The part's headers, a blank line, then the base64 body.
	 */
	#imagePart(img: InlineImage): string[] {
		return [
			`Content-Type: ${img.contentType}; name="${img.filename}"`,
			"Content-Transfer-Encoding: base64",
			`Content-ID: <${img.cid}>`,
			`Content-Disposition: inline; filename="${img.filename}"`,
			"",
			...this.#lines(img.content),
		];
	}

	/**
	 * Build the MIME body for an HTML email with inline images.
	 * The outer part is `multipart/alternative`.
	 * So a text-only client shows the text.
	 * Inside it, `multipart/related` holds the HTML.
	 * It also holds the images the HTML shows by `cid:`.
	 * @param msg The message, with `html` and `inline` set.
	 * @returns The Content-Type header and the body lines.
	 */
	#withImages(msg: MailMessage): string[] {
		const alt = `alt-${crypto.randomUUID()}`;
		const rel = `rel-${crypto.randomUUID()}`;
		const images = (msg.inline ?? []).map((img) => this.#imagePart(img));
		const html = [
			"Content-Type: text/html; charset=utf-8",
			"Content-Transfer-Encoding: base64",
			"",
			...this.#lines(msg.html!),
		];
		const text = [
			"Content-Type: text/plain; charset=utf-8",
			"Content-Transfer-Encoding: base64",
			"",
			...this.#lines(msg.text),
		];
		const related = [
			`Content-Type: multipart/related; boundary="${rel}"; type="text/html"`,
			"",
			...this.#multipart(rel, [html, ...images]),
		];
		return [
			`Content-Type: multipart/alternative; boundary="${alt}"`,
			"",
			...this.#multipart(alt, [text, related]),
		];
	}

	/**
	 * One extra header line.
	 * @param entry The header name and its ASCII value.
	 * @returns For example `List-Unsubscribe: <https://…>`.
	 */
	#headerLine([name, value]: [string, string]) {
		return `${name}: ${value}`;
	}

	/**
	 * Build the RFC 5322 message: headers plus a base64 body.
	 * With inline images (and html) the body is multipart.
	 * Otherwise it is one part.
	 * @param msg The message to send.
	 * @returns The DATA payload, CRLF-joined.
	 */
	#message(msg: MailMessage) {
		const body =
			msg.html && msg.inline?.length
				? this.#withImages(msg)
				: [
						`Content-Type: text/${msg.html ? "html" : "plain"}; charset=utf-8`,
						"Content-Transfer-Encoding: base64",
						"",
						...this.#lines(msg.html ?? msg.text),
					];
		return [
			`From: ${this.#address(msg.from)}`,
			`To: ${this.#address(msg.to)}`,
			`Subject: ${this.#header(msg.subject)}`,
			`Date: ${new Date().toUTCString()}`,
			`Message-ID: <${crypto.randomUUID()}@${this.#bare(msg.from).split("@")[1] ?? "localhost"}>`,
			"MIME-Version: 1.0",
			...Object.entries(msg.headers ?? {}).map((entry) =>
				this.#headerLine(entry),
			),
			...body,
		].join("\r\n");
	}
}
