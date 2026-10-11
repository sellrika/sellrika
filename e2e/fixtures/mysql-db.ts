/**
 * Make a new, empty MySQL database for one spec's app server.
 * Usage: bun e2e/fixtures/mysql-db.ts <server url> <database>
 * The server url has no database: mysql://user:password@host:3306
 * Only `E2E_MYSQL_URL` runs use it (playwright.config.ts).
 */
import { SQL } from "bun";

const [url, name] = process.argv.slice(2);
if (!url || !/^\w+$/.test(name ?? ""))
	throw new Error(
		"usage: bun e2e/fixtures/mysql-db.ts <server url> <database>",
	);
const sql = new SQL(url, { allowPublicKeyRetrieval: true });
await sql.unsafe(`drop database if exists ${name}`);
await sql.unsafe(`create database ${name}`);
await sql.close();
