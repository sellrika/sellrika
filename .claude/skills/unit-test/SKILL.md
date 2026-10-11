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
const { Db, sql } = await import("@xcore/database/Database");
const { migrate } = await import("@database/migrate");
// services/repositories are @Service() classes → resolve the singleton, then call it as before
const { XService: _XService } = await import("../X.Service");
const XService = Container.get(_XService);

await migrate(true); // safe to call in every file: it applies only what is missing
const [shop] = await Db.insert(sql, "shops", sql`insert into shops (name, currency, timezone) values ('T', 'USD', 'UTC')`, sql`id`);
const S = shop.id as number;
```
- The tests also run on MySQL and Postgres (`TEST_DATABASE_URL=mysql://…` or `postgres://…` names an empty database). Postgres checks foreign keys, so a row needs a real shop, never a made-up id. So test SQL follows the same rules as app SQL: no `returning`, no `on conflict` (use `Db.insert` / `Db.upsert`), and a date or a sum may come back as a `Date` or as text — compare with `String()` / `Number()` / `dbDate()`.
- All test files share one process and one DB → **never `sql.close()`**, never assume the DB is empty: create your own shop/users and scope assertions to them (unique emails like `` `u${S}@x.io` ``).
- Need payment methods? `PaymentMethodRepository.seedDefaults(S)`. Need products? `ProductRepository.create(S, {...}, userId)` — pull both out of the container the same way (see `Order.Service.test.ts` fixtures).
- Services return `{ errors }` for user mistakes — assert on the message (`toMatch(/Only 1 × Mug/)`), and assert that nothing was written (count rows before/after).

## Style
- Few, dense tests: one `test()` per scenario chain, many `expect`s, comments stating the arithmetic (`// pro-rata 1000 * 2700/3000 = 900`).
- Cover: happy path, the guard (insufficient stock, duplicate, wrong shop), and the side effects (ledger rows, caches, sessions dropped).
- Finish with `bun test` green and `bun check`.
