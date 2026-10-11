/**
 * Loaded by `bun test` before every test file
 * (bunfig.toml › [test] preload).
 * Constants read their env var once, on first import.
 * The module cache is shared by the whole run.
 * So what a test file sets after an earlier file imported the app
 * is ignored.
 * Values every file must agree on are pinned here instead.
 * `node:os` is used because Bun has no equivalent of `tmpdir`.
 */
import { tmpdir } from "node:os";

// Every run uses a throwaway SQLite file, never the real database.
// The real one holds real mail keys, so a test would send real email.
// `=`, not `??=`: Bun loads .env, which points DB_FILE at storage/pos.db.
process.env.DB_CONNECTION = "sqlite";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`;
delete process.env.DATABASE_URL;
// A run on a database server names an empty, throwaway database itself:
// TEST_DATABASE_URL=mysql://… or postgres://… (never the one in .env).
const server = process.env.TEST_DATABASE_URL;
if (server) {
	process.env.DB_CONNECTION = server.startsWith("mysql") ? "mysql" : "postgres";
	process.env.DATABASE_URL = server;
}
// Nothing a test sends reaches Resend: nothing listens on port 9.
process.env.RESEND_API_URL = "http://127.0.0.1:9/emails";

// Uploaded extension zips are unpacked here, never in storage/extensions.
// Both extension test files clean it up.
process.env.EXTENSION_UPLOAD_DIR ??= `${tmpdir()}/pos-test-extensions-${process.pid}`;
// The built-in extensions live in extensions/ (development)
// or build/extensions (production). Tests use a temp folder of their own.
process.env.EXTENSION_BUILTIN_DIR ??= `${tmpdir()}/pos-test-builtin-extensions-${process.pid}`;
// Images a test saves (uploads, copied image links) land here,
// never in storage/uploads.
process.env.UPLOAD_DIR ??= `${tmpdir()}/pos-test-uploads-${process.pid}`;

// Frontend libs under test (resources/js/lib) translate like the staff app:
// app.ts hands in the dictionary.
import { translate } from "@i18n";
import { useDictionary } from "@/lib/i18n";

useDictionary(translate, function noPage() {
	return undefined;
});
