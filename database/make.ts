// bun run make:migration create_orders  →  database/migrations/0002_create_orders.ts (+ registered in index.ts)
const name = process.argv[2];
if (!name) throw new Error("usage: bun run make:migration <name>");
const dir = new URL("./migrations/", import.meta.url).pathname;
const index = `${dir}index.ts`;
// the highest number in the list plus one: a count is wrong once a number was skipped
const used = [...(await Bun.file(index).text()).matchAll(/"\.\/(\d+)_/g)].map(
	(m) => Number(m[1]),
);
const n = Math.max(0, ...used) + 1;
const version = `${String(n).padStart(4, "0")}_${name}`;
await Bun.write(
	`${dir}${version}.ts`,
	`import type { SQL } from "bun";\nimport { ID_PK } from "@xcore/database/Database";\n\nexport async function up(db: SQL) {\n  await db.unsafe(\`\`);\n}\n`,
);
await Bun.write(
	index,
	(await Bun.file(index).text()) +
		`export { up as m${version} } from "./${version}";\n`,
);
console.log("created", version);
