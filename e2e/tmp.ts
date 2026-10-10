// Playwright loads its config and specs under Node, not Bun — the Bun globals don't exist here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Every spec file gets its own server + throwaway DB/uploads so the files can run in parallel.
export const BASE_PORT = Number(process.env.E2E_PORT ?? 3100); // E2E_PORT lets several runs share a machine
/**
 * The spec files of an add-on (`cloud/e2e`, see `app/cloud.ts`).
 * The folder is not in the source-available app, so there are none there.
 */
export const CLOUD_DIR = `${import.meta.dirname}/../cloud/e2e`;
/**
 * The names of the spec files in a folder, without `.spec.ts`.
 * @param dir The folder.
 * @returns The names, or none when the folder is missing.
 */
function specsIn(dir: string) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".spec.ts"))
		.map((f) => f.slice(0, -".spec.ts".length));
}
/** The add-on's spec files. A name is used once over both folders. */
export const CLOUD_SPECS = specsIn(CLOUD_DIR);
/**
 * Extra environment for the app servers, from the add-on's `e2e/env` file:
 * one line of `NAME=value` pairs. `{fixtures}` is the fixture server's port.
 * @param fixturesPort The fixture server's port.
 * @returns The pairs, or "" with no add-on.
 */
export function cloudEnv(fixturesPort: number) {
	const file = `${CLOUD_DIR}/env`;
	if (!existsSync(file)) return "";
	return readFileSync(file, "utf8")
		.trim()
		.replaceAll("{fixtures}", String(fixturesPort));
}
const ALL = [...specsIn(import.meta.dirname), ...CLOUD_SPECS].sort();
// E2E_SHARD=<i>/<n> (CI runs six shards side by side, .github/workflows/e2e.yml) keeps every n-th file, round-robin, so each job boots and
// runs only its share; unset = every file. Ports stay indexed by the full list, so shards never collide.
const [shard, shards] = (process.env.E2E_SHARD ?? "1/1")
	.split("/")
	.map(Number) as [number, number];
export const SPECS = ALL.filter((_, i) => i % shards === shard - 1);
export const portOf = (spec: string) => BASE_PORT + ALL.indexOf(spec);
export const tmpOf = (port: number) => `${tmpdir()}/pos-e2e-${port}`;
/**
 * A shop's online store in a spec's server: its free subdomain `<slug>.localhost`.
 * @param spec The spec file's name, like "l-store".
 * @param slug The shop's slug.
 * @returns The store's origin, like `http://main-shop.localhost:3107`.
 */
/**
 * The API docs host of a spec's server (`DEVELOPER_DOMAIN=developer.localhost`).
 * @param spec The spec file's name, like "w-api".
 * @returns The origin, like `http://developer.localhost:3122`.
 */
export const developerOf = (spec: string) =>
	`http://developer.localhost:${portOf(spec)}`;
export const storeOf = (spec: string, slug = "main-shop") =>
	`http://${slug}.localhost:${portOf(spec)}`;
