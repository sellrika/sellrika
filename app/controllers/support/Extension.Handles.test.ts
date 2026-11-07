import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";
import { Url } from "@xcore/http/Url";

// a temp upload folder, never the real one
process.env.UPLOAD_DIR ??= `${tmpdir()}/pos-handles-test-${process.pid}-uploads`;
const { ExtensionHandles } = await import("./Extension.Handles");

/** Built by hand: `uploads.save` needs none of the services. */
const handles = new ExtensionHandles(
	null as never,
	null as never,
	null as never,
	null as never,
	null as never,
).for(7);

test("uploads.save stores a base64 picture in the shop's extension folder", async () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]).toBase64();
	expect(await handles.uploads.save(png)).toEqual({
		url: expect.stringMatching(/^\/uploads\/7\/extensions\/[\w-]+\.\w+$/),
	});
	expect(
		await handles.uploads.save(`data:image/png;base64,${png}`),
	).toHaveProperty("url");
});

test("uploads.save refuses text that is no picture", async () => {
	expect(await handles.uploads.save("aGVsbG8=")).toHaveProperty("error");
	expect(await handles.uploads.save("http://x.io/a.png")).toHaveProperty(
		"error",
	);
	expect(await handles.uploads.save(42 as never)).toHaveProperty("error");
});

test("uploads.url gives a picture's address on the app's own host", () => {
	const url = handles.uploads.url("/uploads/7/extensions/a.webp");
	// APP_URL set: the app's host in front; not set: the path as it is
	expect(url.endsWith("/uploads/7/extensions/a.webp")).toBe(true);
	expect(url).toBe(Url.upload("/uploads/7/extensions/a.webp"));
	// a link that is no upload stays as it is
	expect(handles.uploads.url("https://cdn.test/a.png")).toBe(
		"https://cdn.test/a.png",
	);
});
