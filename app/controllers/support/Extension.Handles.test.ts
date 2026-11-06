import { tmpdir } from "node:os"; // Bun has no equivalent
import { expect, test } from "bun:test";

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
