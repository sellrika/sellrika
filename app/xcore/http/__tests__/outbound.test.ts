import { expect, test } from "bun:test";
import { Outbound } from "@xcore/http/Outbound";

test("send: an address inside the server's own network is refused, and so is a user name in the link", async () => {
	for (const url of [
		"http://127.0.0.1:8080/hook",
		"https://10.0.0.5/hook",
		"https://[::1]/hook",
		"https://169.254.169.254/latest/meta-data",
		"https://user:pw@93.184.216.34/hook",
		"ftp://93.184.216.34/hook",
	])
		await expect(Outbound.send(url, { method: "POST" })).rejects.toThrow(
			"not allowed",
		);
});
