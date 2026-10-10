import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import { ResendMailer } from "./Resend.Mailer";

const resend = Container.get(ResendMailer);

/**
 * Run `fn` with `fetch` stubbed like Resend, and collect the bodies posted.
 * @param fn The code that sends email.
 * @returns The parsed JSON bodies.
 */
async function capture(fn: () => Promise<unknown>) {
	const sent: any[] = [];
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

const base = {
	from: "Shop <shop@x.io>",
	to: "buyer@x.io",
	subject: "Hi",
	text: "Plain",
	html: '<img src="cid:a@pos">',
};

test("resend: inline images go as attachments with a content_id", async () => {
	const img = new Uint8Array([1, 2, 3, 250]);
	const [body] = await capture(function send() {
		return resend.send(
			{ api_key: "re_x" },
			{
				...base,
				inline: [
					{
						cid: "a@pos",
						filename: "a.png",
						contentType: "image/png",
						content: img,
					},
				],
			},
		);
	});
	expect(body.attachments).toEqual([
		{
			filename: "a.png",
			content: Buffer.from(img).toString("base64"),
			content_type: "image/png",
			content_id: "a@pos",
		},
	]);
});

test("resend: no images → no attachments field", async () => {
	const [body] = await capture(function send() {
		return resend.send({ api_key: "re_x" }, base);
	});
	expect(body).not.toHaveProperty("attachments");
	expect(body.html).toBe(base.html);
});

test("resend: 429 waits retry-after and tries again, then gives up", async () => {
	const real = globalThis.fetch;
	let calls = 0;
	/**
	 * Say "too many requests" until the `ok`-th call.
	 * @param ok The call that succeeds.
	 */
	function stub(ok: number) {
		calls = 0;
		globalThis.fetch = async function busy() {
			calls++;
			if (calls >= ok) return Response.json({ id: "1" });
			return Response.json(
				{ message: "Too many requests" },
				{ status: 429, headers: { "retry-after": "0" } },
			);
		} as unknown as typeof fetch;
	}
	try {
		stub(3);
		await resend.send({ api_key: "re_x" }, base);
		expect(calls).toBe(3);
		stub(99);
		await expect(resend.send({ api_key: "re_x" }, base)).rejects.toThrow(
			"Too many requests",
		);
		expect(calls).toBe(3);
	} finally {
		globalThis.fetch = real;
	}
});
