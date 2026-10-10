import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
process.env.UPLOAD_DIR = `${tmpdir()}/pos-test-uploads-${process.pid}`;
const { drive, Storage, UPLOAD_DIR } = await import("@xcore/storage/Storage");

test("storeImage sniffs magic bytes; isUploadUrl only accepts our own paths", async () => {
	await Storage.ensure();
	const png = new File(
		[new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])],
		"x.txt",
		{ type: "text/plain" },
	); // lying mime: bytes win
	const r = await Storage.storeImage(png, 7, "products");
	expect("url" in r && r.url).toMatch(/^\/uploads\/7\/products\/[\w-]+\.png$/);
	expect(
		await Bun.file(`${UPLOAD_DIR}${"url" in r ? r.url : ""}`).exists(),
	).toBe(true);
	expect(
		await Storage.storeImage(
			new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }),
			7,
			"products",
		),
	).toEqual({ error: "Only JPG, PNG, WEBP, AVIF or GIF images are allowed" });
	expect(
		await Storage.storeImage(
			new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png"),
			7,
			"products",
		),
	).toEqual({ error: "Image must be 5 MB or smaller" });
	// AVIF: ISO-BMFF header (size, "ftyp", brand "avif")
	const avif = new File(
		[
			new Uint8Array([
				0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0,
				0,
			]),
		],
		"x.avif",
	);
	const a = await Storage.storeImage(avif, 7, "logo");
	expect("url" in a && a.url).toMatch(/\.avif$/);
	expect(Storage.isUploadUrl("/uploads/abc-123.avif")).toBe(true);
	expect(Storage.isUploadUrl("/uploads/abc-123.jpg")).toBe(true);
	expect(Storage.isUploadUrl("/uploads/7/products/abc-123.jpg")).toBe(true);
	expect(Storage.isUploadUrl("/uploads/7/../abc-123.jpg")).toBe(false);
	expect(Storage.isUploadUrl("/uploads/x/products/abc-123.jpg")).toBe(false);
	expect(Storage.isUploadUrl("/uploads/7/products/more/abc-123.jpg")).toBe(
		false,
	);
	expect(Storage.isUploadUrl("http://evil/uploads/a.jpg")).toBe(false);
	expect(Storage.isUploadUrl("/uploads/../x.jpg")).toBe(false);
	expect(Storage.isUploadUrl("/uploads/a.svg")).toBe(false);
});

test("fetchImage: https only, the bytes must be an image, errors never throw", async () => {
	expect(await Storage.fetchImage("http://example.com/a.png")).toEqual({
		error: "Use a full https:// link",
	});
	const real = globalThis.fetch;
	const lookup = Bun.dns.lookup;
	// every name is public here, except intranet.example.com
	Bun.dns.lookup = (async (host: string) => [
		{
			address: host.startsWith("intranet") ? "10.0.0.5" : "93.184.216.34",
			family: 4,
			ttl: 1,
		},
	]) as unknown as typeof lookup;
	const replies: Response[] = [
		new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])),
		new Response("<html>secret</html>"),
		new Response("gone", { status: 404 }),
	];
	globalThis.fetch = Object.assign(
		async function fake() {
			const next = replies.shift();
			if (!next) throw new Error("offline");
			return next;
		},
		{ preconnect: real.preconnect },
	);
	try {
		const ok = await Storage.fetchImage("https://cdn.example.com/a.png");
		expect("type" in ok && ok.type).toBe("image/png");
		expect(await Storage.fetchImage("https://cdn.example.com/page")).toEqual({
			error: "Only JPG, PNG, WEBP, AVIF or GIF images are allowed",
		});
		const failed = { error: "Could not load the image from that link" };
		expect(await Storage.fetchImage("https://cdn.example.com/404")).toEqual(
			failed,
		);
		expect(await Storage.fetchImage("https://cdn.example.com/down")).toEqual(
			failed,
		);
		// a private address, by name or by number, is never fetched
		expect(
			await Storage.fetchImage("https://intranet.example.com/a.png"),
		).toEqual(failed);
		expect(await Storage.fetchImage("https://127.0.0.1/a.png")).toEqual(failed);
		expect(await Storage.fetchImage("https://[::1]/a.png")).toEqual(failed);
		expect(await Storage.fetchImage("https://169.254.169.254/a.png")).toEqual(
			failed,
		);
		// a redirect is checked again: one into the private network is refused
		replies.push(
			new Response(null, {
				status: 302,
				headers: { location: "https://intranet.example.com/a.png" },
			}),
		);
		expect(await Storage.fetchImage("https://cdn.example.com/hop")).toEqual(
			failed,
		);
		// a body with no length is cut off at the cap
		replies.push(
			new Response(
				new ReadableStream({
					pull(c) {
						c.enqueue(new Uint8Array(1024 * 1024));
					},
				}),
			),
		);
		expect(await Storage.fetchImage("https://cdn.example.com/huge")).toEqual({
			error: "Image must be 5 MB or smaller",
		});
		expect(replies.length).toBe(0);
	} finally {
		globalThis.fetch = real;
		Bun.dns.lookup = lookup;
	}
});

test("isImageUrl: our uploads or a plain https link, nothing else", () => {
	expect(Storage.isImageUrl("/uploads/abc-123.jpg")).toBe(true);
	expect(Storage.isImageUrl("https://cdn.example.com/p/1.jpg?w=800")).toBe(
		true,
	);
	expect(Storage.isImageUrl("http://cdn.example.com/p/1.jpg")).toBe(false); // plain http would be mixed content on the store
	expect(Storage.isImageUrl("https://user:pw@cdn.example.com/1.jpg")).toBe(
		false,
	); // no credentials in a public page
	expect(Storage.isImageUrl("javascript:alert(1)")).toBe(false);
	expect(Storage.isImageUrl("cdn.example.com/1.jpg")).toBe(false);
	expect(Storage.isImageUrl(`https://x.io/${"a".repeat(2048)}`)).toBe(false);
	expect(Storage.isImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
	expect(Storage.isImageUrl("iVBORw0KGgo=")).toBe(true);
	expect(Storage.isImageUrl("data:text/html;base64,PGI+")).toBe(false);
	expect(Storage.isImageUrl("A".repeat(8 * 1024 * 1024))).toBe(false); // over 5 MB
});

test("another driver: the image goes through the disk and /uploads reads it back", async () => {
	const fake = drive.fake("local"); // any service: the fake stands in for whatever STORAGE_DRIVER names
	try {
		const r = await Storage.storeImage(
			new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])], "x.png"),
			7,
			"products",
		);
		const url = "url" in r ? r.url : "";
		fake.assertExists(url.slice(1)); // the key is the path without its first slash
		expect(await Bun.file(`${UPLOAD_DIR}${url}`).exists()).toBe(false); // not on the local disk
		const res = await Storage.read(url);
		expect(res?.headers.get("content-type")).toBe("image/png");
		expect(res?.headers.get("cache-control")).toContain("immutable");
		expect(new Uint8Array(await res!.arrayBuffer())[1]).toBe(0x50);
		expect(await Storage.read("/uploads/missing.png")).toBe(null);
		expect(await Storage.read("/uploads/missing.svg")).toBe(null);
	} finally {
		drive.restore("local");
	}
});

test("compress: an upload becomes a WebP of at most 1600 px; a small WebP and a GIF stay as they are", async () => {
	const { UPLOAD_IMAGE_PX } = await import("@constants/Storage.Constant");
	const logo = new Uint8Array(
		await Bun.file("resources/images/android-chrome-512x512.png").arrayBuffer(),
	);
	/**
	 * The size and format of a picture.
	 * @param bytes The picture.
	 * @returns Its width, height and format.
	 */
	function about(bytes: Uint8Array) {
		return new Bun.Image(bytes).metadata();
	}
	// a big photo: made smaller, same shape
	const photo = await new Bun.Image(logo).resize(3000, 2000).jpeg().bytes();
	const small = await Storage.compress(photo);
	expect(await about(small)).toEqual({
		width: UPLOAD_IMAGE_PX,
		height: 1067,
		format: "webp",
	});
	expect(small.byteLength).toBeLessThan(photo.byteLength);
	// a PNG: lossless, so it stays transparent, also in an email thumbnail
	const webp = await Storage.compress(logo);
	expect(await about(webp)).toEqual({
		width: 512,
		height: 512,
		format: "webp",
	});
	expect(
		(await Storage.shrink({ bytes: webp, type: "image/webp" }, 112)).type,
	).toBe("image/png");
	expect(
		(await Storage.shrink({ bytes: small, type: "image/webp" }, 112)).type,
	).toBe("image/jpeg");
	// already a small WebP (what the image editor sends): not encoded a second time
	expect(await Storage.compress(webp)).toBe(webp);
	const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
	expect(await Storage.compress(gif)).toBe(gif);

	// the upload itself stores the WebP
	const r = await Storage.storeImage(
		new File([photo.slice().buffer], "p.jpg"),
		7,
		"products",
	);
	expect("url" in r && r.url).toMatch(/\.webp$/);
});
