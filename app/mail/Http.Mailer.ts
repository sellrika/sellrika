import {
	MailError,
	type MailField,
	type Mailer,
	type MailMessage,
} from "./types";

/**
 * One call to a provider's REST API, ready to send.
 * `headers()` is asked again on every try.
 * A provider that signs its requests signs with a fresh date each time.
 */
export type MailCall = {
	url: string | URL;
	body: string;
	headers(): Record<string, string>;
};

/**
 * A mail provider reached over HTTPS with plain `fetch`.
 * The steps of a send are the same for every such provider:
 * post the message, wait and try again on "too many requests",
 * and turn a refusal into a `MailError`.
 * A provider only says how its request looks and how it words a refusal.
 */
export abstract class HttpMailer implements Mailer {
	abstract readonly key: string;
	abstract readonly label: string;
	abstract readonly fields: MailField[];

	/**
	 * How many times one message is tried while the provider
	 * answers "too many requests" (429).
	 */
	protected abstract readonly maxTries: number;

	/**
	 * Deliver one message through the provider's REST API.
	 * A 429 waits the provider's `retry-after` and tries again,
	 * up to `maxTries` times.
	 * @param creds The decrypted credentials.
	 * @param msg Sender, recipient, subject and body.
	 * @throws MailError with the provider's own message when it refuses.
	 */
	async send(creds: Record<string, string>, msg: MailMessage): Promise<void> {
		const call = this.call(creds, msg);
		let res: Response;
		for (let tries = 1; ; tries++) {
			// the global `fetch` is read here, so a test can stub it
			res = await fetch(call.url, {
				method: "POST",
				headers: call.headers(),
				body: call.body,
			});
			if (res.status !== 429 || tries >= this.maxTries) break;
			const wait = Number(res.headers.get("retry-after") ?? 1);
			await Bun.sleep((Number.isFinite(wait) ? wait : 1) * 1000);
		}
		if (!res.ok) {
			const data: unknown = await res.json().catch(() => ({}));
			throw new MailError(this.refusal(data, res.status));
		}
	}

	/**
	 * Build the request for one message.
	 * @param creds The decrypted credentials.
	 * @param msg Sender, recipient, subject and body.
	 * @returns Where to post, the body, and the headers per try.
	 * @throws MailError when the credentials can't be used.
	 */
	protected abstract call(
		creds: Record<string, string>,
		msg: MailMessage,
	): MailCall;

	/**
	 * The words for a refused send.
	 * @param data The provider's JSON answer, `{}` when it sent none.
	 * @param status The HTTP status.
	 * @returns The provider's own message, else our own.
	 */
	protected abstract refusal(data: unknown, status: number): string;
}
