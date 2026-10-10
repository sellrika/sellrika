import { describe, expect, test } from "bun:test";
import { Compress } from "@xcore/http/Compress";

const text = "x".repeat(5000);
const gzipReq = new Request("http://x/", {
	headers: { "accept-encoding": "gzip, deflate, br" },
});

describe("compressed", () => {
	test("gzips a large text body and the client can read it back", async () => {
		const res = await Compress.gzip(
			gzipReq,
			new Response(text, { headers: { "content-type": "text/html" } }),
		);
		expect(res.headers.get("content-encoding")).toBe("gzip");
		expect(res.headers.get("vary")).toBe("Accept-Encoding");
		const body = new Uint8Array(await res.arrayBuffer());
		expect(body.byteLength).toBeLessThan(text.length / 10);
		expect(new TextDecoder().decode(Bun.gunzipSync(body))).toBe(text);
	});

	test("keeps JSON, so Inertia responses shrink too", async () => {
		const res = await Compress.gzip(gzipReq, Response.json({ items: text }));
		expect(res.headers.get("content-encoding")).toBe("gzip");
		expect(res.status).toBe(200);
	});

	test("leaves small bodies alone", async () => {
		const res = await Compress.gzip(
			gzipReq,
			new Response("hi", { headers: { "content-type": "text/plain" } }),
		);
		expect(res.headers.get("content-encoding")).toBeNull();
		expect(await res.text()).toBe("hi");
	});

	test("leaves images, redirects and clients without gzip alone", async () => {
		const png = new Response(text, {
			headers: { "content-type": "image/png" },
		});
		expect(await Compress.gzip(gzipReq, png)).toBe(png);
		const redirect = new Response(null, {
			status: 303,
			headers: { location: "/" },
		});
		expect(await Compress.gzip(gzipReq, redirect)).toBe(redirect);
		const plain = new Response(text, {
			headers: { "content-type": "text/html" },
		});
		expect(await Compress.gzip(new Request("http://x/"), plain)).toBe(plain);
	});

	test("gzips a cached file once", async () => {
		const make = () =>
			new Response(text, { headers: { "content-type": "text/javascript" } });
		const a = await Compress.gzip(gzipReq, make(), "/build/assets/a.js");
		const b = await Compress.gzip(gzipReq, make(), "/build/assets/a.js");
		expect(await a.arrayBuffer()).toEqual(await b.arrayBuffer());
	});
});
