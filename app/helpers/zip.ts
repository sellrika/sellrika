/**
 * Bun has no raw-deflate inflater.
 * `Bun.inflateSync` expects a zlib header, and zip entries carry none.
 * So `node:zlib` stays.
 */
import { inflateRawSync } from "node:zlib";

/** One file inside a zip archive. */
export type ZipEntry = { name: string; data: Uint8Array };

/**
 * Read a plain zip archive.
 * Made for the GeoNames dumps: one or two deflated files,
 * no ZIP64, no encryption.
 * The central directory at the end names every entry
 * and points at its local header.
 * @param bytes The whole archive.
 * @param maxBytes Most bytes all entries may unpack to.
 * More throws before the memory is used (a zip bomb).
 * @returns Every entry, inflated.
 */
export function unzip(bytes: Uint8Array, maxBytes = Infinity): ZipEntry[] {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// end-of-central-directory record:
	// 22 bytes + an optional comment after it
	let eocd = bytes.length - 22;
	while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
	if (eocd < 0) throw new Error("Not a zip file");
	const count = dv.getUint16(eocd + 10, true);
	let p = dv.getUint32(eocd + 16, true);
	const out: ZipEntry[] = [];
	let left = maxBytes;
	for (let i = 0; i < count; i++) {
		if (dv.getUint32(p, true) !== 0x02014b50)
			throw new Error("Damaged zip file");
		const method = dv.getUint16(p + 10, true);
		const csize = dv.getUint32(p + 20, true);
		// declared unpacked size: may lie, so inflating is capped too
		const size = dv.getUint32(p + 24, true);
		const n = dv.getUint16(p + 28, true),
			m = dv.getUint16(p + 30, true),
			k = dv.getUint16(p + 32, true);
		const local = dv.getUint32(p + 42, true);
		const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + n));
		const start =
			local +
			30 +
			dv.getUint16(local + 26, true) +
			dv.getUint16(local + 28, true);
		const raw = bytes.subarray(start, start + csize);
		if (method !== 0 && method !== 8)
			throw new Error(`Unsupported zip compression (${method})`);
		if (size > left || (method === 0 && csize > left)) throw tooBig(maxBytes);
		let data: Uint8Array;
		try {
			data =
				method === 0
					? raw
					: new Uint8Array(
							inflateRawSync(
								raw,
								left === Infinity ? {} : { maxOutputLength: left + 1 },
							),
						);
		} catch (e) {
			if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
				throw tooBig(maxBytes);
			throw e;
		}
		if (data.length > left) throw tooBig(maxBytes);
		left -= data.length;
		out.push({ name, data });
		p += 46 + n + m + k;
	}
	return out;
}

/**
 * The error for an archive that unpacks to more than allowed.
 * @param max The limit in bytes.
 * @returns An Error naming the limit in MB.
 */
function tooBig(max: number) {
	return new Error(
		`The zip unpacks to more than ${Math.round(max / 1024 / 1024)} MB`,
	);
}

/**
 * One entry of the CRC-32 table.
 * @param _ Unused: the array slot's value.
 * @param n The byte, 0–255.
 * @returns The table value for that byte.
 */
function crcEntry(_: unknown, n: number) {
	for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
	return n >>> 0;
}

/** The CRC-32 lookup table: one value per byte. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, crcEntry);

/**
 * The CRC-32 checksum a zip entry carries.
 * @param b The entry's bytes.
 * @returns The checksum as an unsigned 32-bit number.
 */
function crc32(b: Uint8Array) {
	let c = 0xffffffff;
	for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * Write a plain (stored, uncompressed) zip archive.
 * Enough to pack an extension folder in a test or a script.
 * Runs under Node too (Playwright): no Bun globals.
 * @param files Entry name → contents.
 * @returns The archive bytes.
 */
export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
	const enc = new TextEncoder();
	const locals: Uint8Array[] = [],
		centrals: Uint8Array[] = [];
	let offset = 0;
	for (const [name, body] of Object.entries(files)) {
		const n = enc.encode(name),
			d = typeof body === "string" ? enc.encode(body) : body,
			crc = crc32(d);
		const local = new Uint8Array(30 + n.length),
			lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, d.length, true);
		lv.setUint32(22, d.length, true);
		lv.setUint16(26, n.length, true);
		local.set(n, 30);
		const central = new Uint8Array(46 + n.length),
			cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, d.length, true);
		cv.setUint32(24, d.length, true);
		cv.setUint16(28, n.length, true);
		cv.setUint32(42, offset, true);
		central.set(n, 46);
		locals.push(local, d);
		centrals.push(central);
		offset += local.length + d.length;
	}
	const size = centrals.reduce((s, c) => s + c.length, 0);
	const eocd = new Uint8Array(22),
		ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, centrals.length, true);
	ev.setUint16(10, centrals.length, true);
	ev.setUint32(12, size, true);
	ev.setUint32(16, offset, true);
	const parts = [...locals, ...centrals, eocd],
		out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
