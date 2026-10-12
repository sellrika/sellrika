# Change the app with an add-on: `Hooks`

An add-on is your own code that is part of the app's source. It changes the app without editing the app's files.
This guide shows how to make one and what each hook does.

An add-on is not an extension:

| | Add-on | Extension |
|---|---|---|
| Where it lives | In the app's source, in the `cloud/` folder | A zip, uploaded on Admin › Global Extensions |
| Who can add one | Whoever builds and runs the app | The platform admin |
| What it may touch | `Hooks`, services, routes, jobs, words, its own tables | Only what `ctx` gives it |
| Guide | This page | `docs/features/extensions.md` |

Use an extension when you can. Use an add-on only for what an extension can not do: a front page, a plan, your own tables.

## Make an add-on

1. Create the folder `cloud/` in the app's root, with a file `cloud/index.ts`.
2. That is all. The alias `@cloud` now points at your file (`tsconfig.json` › `paths`). Without the folder it points at the empty `app/cloud.ts`.

The app loads `@cloud` first, before any route (`routes/web.ts`). So your file runs once, when the server starts.

```ts
// cloud/index.ts
import { Hooks } from "@xcore/hooks/Hooks";

/**
 * The front page of the app's own host.
 * @param req The current request.
 * @returns The page.
 */
async function frontPage(req: Request) {
	return new Response("Hello from my add-on");
}

Hooks.frontPage = frontPage;
```

Rules:

- Set hooks while the file loads. Never during a request.
- Your code may import anything of the app. The app never imports your code.
- Import your own files as `@cloud/…`, like `@cloud/services/My.Service`.
- The app must still pass its checks with the `cloud/` folder moved away.

## The hooks

All of them are static fields of `Hooks` in `app/xcore/hooks/Hooks.ts`.

| Hook | Type | What it does | Default |
|---|---|---|---|
| `frontPage` | `(req) => Promise<Response>` | The page at `/` of the app's own host | `null`: `/` goes to the sign-in |
| `docsPage` | `(req) => Response` | The page at `/` of the docs host (`DEVELOPER_DOMAIN`) | `null`: no page |
| `docs` | `{ api, extensions }` | Where the app's links to the developer docs lead | The app's own docs address |
| `sitePaths` | `string[]` | The paths of your public pages, for the main host's sitemap | `[]` |
| `closedHosts` | `string[]` | Hosts no search engine may crawl. Their `/robots.txt` closes every path. | `[]` |
| `ssrPages` | `string[]` | The Inertia pages whose HTML is rendered on the server | `[]` |
| `guides` | `Record<topic, markdown>` | More topics for the user guide that AI assistants read | `{}` |
| `plan` | `(user) => Promise<PlanNotice \| null>` | A banner and a menu link about the account's plan, on every page | Returns `null` |
| `signedUp` | `(ownerId) => Promise<void>` | Called once for every new owner who signed up by themselves | Does nothing |
| `signup` | `() => SignupInfo` | A note over the sign-up form, and whether to ask for the terms | No note, no terms |
| `migrations` | `Record<version, up>` | Your own database tables | `{}` |

## Your own tables: `Hooks.migrations`

The app's migrations are one fixed list. `Hooks.migrations` adds yours to it.

```ts
// cloud/migrations/0001_notes.ts
import type { SQL } from "bun";
import { ID_PK } from "@xcore/database/Database";

/**
 * Notes of a shop.
 *   shop_id — the shop
 *   body    — the text
 */
export async function up(db: SQL) {
	await db.unsafe(`create table notes (
    id ${ID_PK},
    shop_id integer not null,
    body text not null
  )`);
}
```

```ts
// cloud/index.ts
import { Hooks } from "@xcore/hooks/Hooks";
import { up as notes } from "@cloud/migrations/0001_notes";

Hooks.migrations = { myaddon_0001_notes: notes };
```

How it works:

- `migrate()` runs them after the app's own migrations, in the order of their names.
- Each one runs once. Its name is recorded in the `migrations` table.
- It runs on boot and with `bun run migrate`. Both load the add-on first.

Rules:

- Give every name your own prefix (`myaddon_`). It must never be the name of one of the app's migrations.
- Never change a migration that has run. Add a new one.
- The same rules as the app's migrations: it must run on SQLite, Postgres and MySQL. See `docs/database.md`.
- A table with a `shop_id` must be emptied when its shop is deleted. Do that in your own code: the app does not know your table.

In a test, load your migrations before you call `migrate()`:

```ts
await import("@cloud/migrations");
const { migrate } = await import("@database/migrate");
await migrate(true);
```

## The other ways in

`Hooks` is one of five ways an add-on may change the app.

| Way | Example |
|---|---|
| `Hooks` | See above |
| The DI container | `Container.set({ id: PlanLimitService, type: MyLimitService })` puts your class in the place of a service. Do it in the first import of `cloud/index.ts`, before any service is made. |
| The router | `router.get("/my-page", [MyController, "show"])`. Put each route in a guard group, like the app's own. |
| `JobRegistry.add()` | `JobRegistry.add({ name, expression, service })` adds a background job. |
| `extend()` of `@i18n` | `extend("en", { "my.key": "My text" })` adds your own words. |

More on these: `docs/architecture.md` › Add-ons.

## Need a hook that is not there?

Add a general one to the app first, then use it from your add-on.

- It must make sense with no add-on: a default that changes nothing.
- It must not name your add-on or what it is for.
- Add it to the table on this page and to `docs/architecture.md` › Add-ons.
