import { deflateRawSync } from "node:zlib"; // Bun has no raw-deflate
import { expect, test } from "bun:test";
import { unzip, zip } from "@helpers/zip";

/**
 * A one-file zip whose entry is deflated and claims to unpack to 10 bytes.
 * @param size How many zero bytes the entry really unpacks to.
 * @returns The archive.
 */
function bomb(size: number) {
	const bytes = zip({ "a.txt": deflateRawSync(new Uint8Array(size)) });
	const dv = new DataView(bytes.buffer);
	const central = dv.getUint32(bytes.length - 22 + 16, true);
	dv.setUint16(8, 8, true); // local header: deflated
	dv.setUint16(central + 10, 8, true); // central header: deflated
	dv.setUint32(central + 24, 10, true); // the lie
	return bytes;
}

test("unzip stops a zip that unpacks past the limit, even when it lies about its size", () => {
	expect(unzip(bomb(1000), 2000)[0]!.data.length).toBe(1000);
	expect(() => unzip(bomb(50 * 1024 * 1024), 1024 * 1024)).toThrow(
		/more than 1 MB/,
	);
});
