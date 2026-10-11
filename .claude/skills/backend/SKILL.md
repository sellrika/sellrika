---
name: backend
description: Add or change backend code in this POS (Bun.serve routes, controllers, services, repositories, zod validators, migrations). Use when a task touches routes/web.ts, app/controllers, app/services, app/repositories, app/validators, app/models or database/migrations.
---

# Backend slice

Flow: `routes/<area>.ts` (loaded by `routes/web.ts`) → `app/controllers/X.Controller.ts` → `app/services/<group>/X.Service.ts` → `app/repositories/X.Repository.ts` (SQL). `app/models/X.ts` = row types, `app/validators/X.Validator.ts` = zod input. Services are grouped the way the sidebar is: **sales** (orders, customers, reports, the online store), **catalog** (products, stock, categories), **settings** (shops, staff, payments, email, sign-in). Copy the shape of an existing small slice — `Customer*` is the reference (controller, service, repository, validator, model).

**File names carry their layer** and imports use aliases, never `../..`:

```
app/controllers/Auth.Controller.ts   app/services/sales/Order.Service.ts   app/repositories/User.Repository.ts
app/validators/Shop.Validator.ts     app/constants/Stock.Constant.ts app/models/Order.ts
```

Class names stay plain (`AuthController`). Framework code lives in `app/xcore/` (one folder per concern: `http/`, `api/`, `view/`, `auth/`, `database/`, `storage/`, `extensions/`, `i18n/`, `schedule/`, plus `di.ts`; one class per file, the file named after its class); dependency-free utilities go in `app/helpers/`, never in xcore. Tests move to a `__tests__/` folder once a directory has more than one. Aliases: `@controllers/* @services/* @repositories/* @validators/* @models/* @constants/* @gateways @mail @jobs/* @xcore/* @config/* @routes/* @database/* @resources/*` — declared in `tsconfig.json` › `paths` **and** `vite.config.ts` › `resolve.alias`; add to both. Same-directory `./Sibling` stays relative.

**Literals go in `app/constants/<Area>.Constant.ts`** — page sizes, TTLs, cookie names, allowlists, catalogues — never inline in a service or controller. A constant that derives a type keeps the type beside it. `sql` fragments and helper functions are not constants.

**Every user-facing message goes through `t("area.key")`** from `@xcore/i18n/I18n` (keys in `i18n/en.ts` + `i18n/de.ts`); a zod custom message is a key. Code that also runs in the browser returns keys instead.

**Every controller, service and repository is a `@Service()` class** (typedi). Import `Service` from `@xcore/di`, never from `"typedi"` — that module loads `reflect-metadata` first. Collaborators come in through the constructor, each a singleton:

```ts
import { Service } from "@xcore/di";

@Service()
export class CategoryService {
  constructor(private categories: CategoryRepository) {}
  /**
   * Every category of a shop.
   * @param shopId Owning shop.
   * @returns Categories in display order.
   */
  list(shopId: number) { return this.categories.allForShop(shopId); }
}
```

- **No circular imports between injected classes** — the emitted paramtype becomes `undefined` and `Container.get` throws at boot.
- **JSDoc on every method**: one-line summary, `@param` per argument, `@returns` when it returns something.
- **No loose functions next to a class.** A helper that a class file needs is a method of that class: a `#private` instance method when only the class uses it (never `static #name()` in a `@Service()` class: TypeScript refuses a static private name next to a class decorator, TS18036), a public `static` when other files call it (`CampaignEmail.parts(...)`, `ReportService.resolveQuery(...)`). **Private methods are written `#name()`**, never `private name()`; `protected` stays for a method a subclass fills in, and constructor-injected fields stay `private x: Repo` (a parameter property can't be `#`). **Member order in a class**: fields and the constructor, then the public methods, then `protected`, then the `#private` ones last. Only helpers shared by several areas, with no class of their own, stay exported functions in `app/helpers/`.
- Outside classes (middleware, shared props, seeds) use `Container.get(XRepository)` at module level.
- Mailers follow the same shape: `app/mail/<name>/<Name>.Mailer.ts` behind `MailerRegistry`; payment gateways are extensions (`extensions/<key>/`, the `new-extension` skill). Inject the registry.

## Steps
1. **Migration** (schema change only): `bun run make:migration <name>` → fill `up(db)` with `db.unsafe(...)`. Must run on SQLite, Postgres *and* MySQL: `ID_PK`, `text/integer/timestamp/boolean`, one column per line, no dialect-only syntax (MySQL reads the DDL through `app/xcore/database/MysqlDdl.ts`). Never edit an applied migration; add a new one.
2. **Model**: row type in `app/models/`; mirror it in `resources/js/types.ts` if the frontend sees it.
3. **Validator**: zod schema in `app/validators/`, `export type X = z.infer<typeof X>`. Messages are user-facing. Money is integer cents.
4. **Repository**: `sql` tagged templates only (no string building, `db.unsafe` only in migrations). Every query scoped by `shop_id`. Accept `db: SQL = sql` when it must join a transaction. Lists go through `Paginate.of()` / `Paginate.params()` / `Paginate.limit()` (`@xcore/http/Paginate`); one row = `Db.one()`, a yes/no = `Db.exists()` (`@xcore/database/Database`). **MySQL has no `returning` and no `on conflict`**: write `Db.insert()` / `Db.update()` / `Db.delete()` / `Db.upsert()` / `Db.insertOnce()` instead. In an `update`, read a column before the assignment that changes it (MySQL runs assignments left to right); never read the updated table in a plain subquery (wrap it: `(select … from (select … from t) x)`); quote the reserved words `key` and `change` with `sql("key")`, and a reserved alias as `as "by"`.
5. **Service**: business rules, returns Inertia-style `errors` objects (`{ field: "msg" }`) instead of throwing for user errors. Multi-table writes → `sql.begin(tx => …)`; stock changes only via the injected `StockRepository.move(tx, …)`.
6. **Controller**: `ctx(req)` → `{user, session, shop}`; `validate(Schema, await HttpRequest.body(req))` → `v.errors`/`v.data`; reply with `inertia(req, "Page/Name", props)`, `back(req, url)`, `redirect(url)` or `json(data, status)`. JSON endpoints: 201/422 with `{ errors }` (`HttpResponse.unprocessable(errors)`).
7. **Route**: add in the area's file under `routes/` (`sales.ts`, `catalog.ts`, `settings.ts`, `account.ts`, `storefront.ts`, `files.ts` — `web.ts` only loads them) as `router.get("/path", [XController, "method"])` (or `router.resource("/x", XController)`), one route per line, inside the function that file registers with `router.group(Guard.auth, …)`; managers / admins only → the one under `router.group([Guard.auth, Guard.manager], …)` / `[Guard.auth, Guard.admin]`; abusable → `limit("bucket")` after the action (`router.post("/x", [XController, "store"], limit("bucket"))`) or a `limit("bucket")` group (buckets in `routes/limits.ts` + `Security.Constant.ts`). Static paths before `resource()`/`:id` routes.
8. **Docs**: JSDoc on every method. A changed screen → its how-to in `resources/guide/<topic>.md`.

## Rules
- Bun APIs only (no express, pg, node-only deps). Don't add dependencies.
- Every change to `app/services` or `app/repositories` logic ships with a test → load the `unit-test` skill. New route/role gate → click through it in an e2e spec (`e2e-test` skill).
- Finish with `bun run lint && bun check && bun test` (`bun run format` fixes what Biome can).
