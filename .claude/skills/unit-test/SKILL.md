---
name: unit-test
description: Write or extend bun:test unit/integration tests for this POS backend (services, repositories, validators, xcore, HTTP router). Use when adding backend logic, fixing a backend bug, or when asked to add/run unit tests.
---

# Unit tests (`bun test`)

Files sit in a `__tests__/` folder inside their layer once it holds more than one (`app/services/<group>/__tests__/X.Service.test.ts`, `app/repositories/__tests__/X.Repository.test.ts`, `app/helpers/__tests__/x.test.ts`); a lone test file stays beside its module (`app/validators/validate.test.ts`). There is no HTTP-level test file: routes, role gates and status codes are covered by the e2e specs. Run: `bun test` (all) or `bun test app/services/sales/__tests__/Order.Service.test.ts`.

## Where does the test go?
| Change | Test |
|---|---|
| pure function (math, formatting, time) | the existing `*.test.ts` for that module, plain `expect` |
| repository / service logic | `app/services/<group>/__tests__/X.Service.test.ts` against a temp SQLite DB (extend the existing file if one exists) |
| new route, role gate, JSON API status codes | an e2e spec (`e2e-test` skill) — there is no HTTP test file |
| validator rules | `app/validators/validate.test.ts` |

## DB test boilerplate (copy exactly — order matters)
```ts
import { expect, test } from "bun:test";
import { Container } from "@xcore/di";
import { tmpdir } from "node:os";
process.env.DB_FILE = `${tmpdir()}/pos-test-${process.pid}.db`; // before any app import
const { sql } = await import("@xcore/database/Database");
const registry = await import("@database/migrations");
// services/repositories are @Service() classes → resolve the singleton, then call it as before
const { XService: _XService } = await import("../X.Service");
const XService = Container.get(_XService);

const migrated = await sql`select 1 from users`.then(() => true, () => false);
if (!migrated) for (const [, up] of Object.entries(registry).sort(([a], [b]) => a.localeCompare(b))) await up(sql);
const [shop] = await sql`insert into shops (name, currency, timezone) values ('T', 'USD', 'UTC') returning id`;
const S = shop.id as number;
```
- All test files share one process and one DB → **never `sql.close()`**, never assume the DB is empty: create your own shop/users and scope assertions to them (unique emails like `` `u${S}@x.io` ``).
- Need payment methods? `PaymentMethodRepository.seedDefaults(S)`. Need products? `ProductRepository.create(S, {...}, userId)` — pull both out of the container the same way (see `Order.Service.test.ts` fixtures).
- Services return `{ errors }` for user mistakes — assert on the message (`toMatch(/Only 1 × Mug/)`), and assert that nothing was written (count rows before/after).

## Style
- Few, dense tests: one `test()` per scenario chain, many `expect`s, comments stating the arithmetic (`// pro-rata 1000 * 2700/3000 = 900`).
- Cover: happy path, the guard (insufficient stock, duplicate, wrong shop), and the side effects (ledger rows, caches, sessions dropped).
- Finish with `bun test` green and `bun check`.
