// node:crypto on purpose: an independent second implementation to check our Bun signing against.
import { createHash, createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import { MailError } from "@mail/types";
import { AzureMailer } from "./Azure.Mailer";

const azure = Container.get(AzureMailer);
const key = Buffer.from("secret-key").toString("base64");
const creds = {
	connection_string: `endpoint=https://acs.communication.azure.com/;accesskey=${key}`,
};

/**
 * Run `fn` with `fetch` stubbed, answering each call with the next response.
 * @param answers The responses, in order.
 * @param fn The code that sends email.
 * @returns Every request made: URL, headers and parsed body.
 */
async function capture(answers: Response[], fn: () => Promise<unknown>) {
	const calls: { url: string; headers: Record<string, string>; body: any }[] =
		[];
	const real = globalThis.fetch;
	globalThis.fetch = (async (url: URL, init: RequestInit) => {
		calls.push({
			url: String(url),
			headers: init.headers as Record<string, string>,
			body: JSON.parse(String(init.body)),
		});
		return answers.shift() ?? new Response(null, { status: 202 });
	}) as typeof fetch;
	try {
		await fn();
	} finally {
		globalThis.fetch = real;
	}
	return calls;
}

const msg = {
	from: '"Shop" <DoNotReply@x.io>',
	to: "buyer@x.io",
	subject: "Hi",
	text: "Plain",
	html: '<img src="cid:a@pos">',
	inline: [
		{
			cid: "a@pos",
			filename: "a.png",
			contentType: "image/png",
			content: new Uint8Array([1, 2]),
		},
	],
	headers: { "List-Unsubscribe": "<https://x.io/u>" },
};

test("azure: reads the connection string, key may end in =", () => {
	expect(AzureMailer.parseConnection(creds.connection_string)?.key).toBe(key);
	expect(AzureMailer.parseConnection(creds.connection_string)?.url.host).toBe(
		"acs.communication.azure.com",
	);
	expect(AzureMailer.parseConnection("accesskey=abc")).toBeNull();
});

test("azure: the signature matches Azure's HMAC recipe", () => {
	const url = new URL(
		"https://acs.communication.azure.com/emails:send?api-version=1",
	);
	const date = "Tue, 30 Sep 2026 09:00:00 GMT";
	const h = AzureMailer.signed(url, "{}", key, date);
	const hash = createHash("sha256").update("{}").digest("base64");
	const sig = createHmac("sha256", Buffer.from(key, "base64"))
		.update(
			`POST\n/emails:send?api-version=1\n${date};acs.communication.azure.com;${hash}`,
		)
		.digest("base64");
	expect(h["x-ms-content-sha256"]).toBe(hash);
	expect(h.Authorization).toBe(
		`HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`,
	);
});

test("azure: sends the bare sender, inline images and headers; a 429 is tried again", async () => {
	const calls = await capture(
		[new Response(null, { status: 429, headers: { "retry-after": "0" } })],
		function send() {
			return azure.send(creds, msg);
		},
	);
	expect(calls).toHaveLength(2);
	expect(calls[0]!.url).toBe(
		"https://acs.communication.azure.com/emails:send?api-version=2025-09-01",
	);
	const body = calls[1]!.body;
	expect(body.senderAddress).toBe("DoNotReply@x.io");
	expect(body.recipients.to).toEqual([{ address: "buyer@x.io" }]);
	expect(body.content).toEqual({
		subject: "Hi",
		plainText: "Plain",
		html: msg.html,
	});
	expect(body.attachments[0]).toEqual({
		name: "a.png",
		contentType: "image/png",
		contentInBase64: "AQI=",
		contentId: "a@pos",
	});
	expect(body.headers).toEqual(msg.headers);
});

test("azure: a refusal throws Azure's own message", async () => {
	const refused = Response.json(
		{ error: { code: "DomainNotLinked", message: "Domain not linked" } },
		{ status: 400 },
	);
	let error: unknown;
	await capture([refused], function send() {
		return azure.send(creds, msg).catch(function keep(e) {
			error = e;
		});
	});
	expect(error).toBeInstanceOf(MailError);
	expect((error as Error).message).toBe("Domain not linked");
});
