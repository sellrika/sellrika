import { zip } from "@helpers/zip";

/** A range every app version fits, for the test extensions. */
export const ANY_APP_VERSION = ">=0.0.0";

/**
 * A test extension's zip.
 * An upload must say which app versions it runs on (`app_version`).
 * The tests are about other things, so a manifest without one gets
 * `ANY_APP_VERSION`. A manifest that is not a JSON object stays as written.
 * @param files The zip's files, path to contents.
 * @returns The zip's bytes.
 */
export function extensionZip(
	files: Record<string, string | Uint8Array>,
): Uint8Array {
	const raw = files["extension.json"];
	if (raw === undefined) return zip(files);
	try {
		const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
		const manifest = JSON.parse(text);
		if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
			return zip(files);
		if (!("app_version" in manifest)) manifest.app_version = ANY_APP_VERSION;
		return zip({ ...files, "extension.json": JSON.stringify(manifest) });
	} catch {
		return zip(files);
	}
}
