---
name: new-extension
description: Create a new POS extension in `extensions/<key>/` — manifest, entry module (listeners, staff/public routes), browser scripts for pages and slots, then build the upload zip and try it on the dev server. Use when asked to write, scaffold or build an extension, plugin or add-on for this POS, e.g. "make an extension that posts new orders to Slack" or "/new-extension slack-orders".
---

# New extension

Usage: `/new-extension <key> <what it should do>` — e.g. `/new-extension slack-orders post every new order to a Slack webhook`.

Read `extensions/types.ts` first (the types, with the contract in their comments). The full guide is at developer.sellrika.com. Working code to copy from:
`extensions/webhook/` (a listener with settings), `extensions/chat-alerts/` (a listener with several channels), `extensions/labels/` (a page with staff routes) and `extensions/loyalty/` (slots, a settings form, data that grows).

## Steps
1. **Scaffold**: `bun run make:extension <key>` → `extensions/<key>/extension.json` + `index.ts`. Keys: 2–50 lower-case letters, digits, dashes.
2. **Manifest** (`extension.json`): `name`, `version`, one-line `description`, `help_url` if there is a doc page; `fields` for every setting the admin must type (API keys and tokens `secret: true`; anything the extension can't run without `required: true`; URLs `type: "url"`); `pages` for screens of its own (`path`, `title`, `script: "assets/<file>.ts"`, `admin`, `group` = the sidebar section it joins — `"Catalog"`, `"Sales"`, `"Settings"`; default `"Extensions"`); `slots` for UI inside app pages (only names in `EXTENSION_SLOTS`, `app/constants/Extension.Constant.ts` — a new place needs `/extension-slot` first). For AI assistants: `guide: "guide.md"` = how to use the extension, for people; `tools` = the staff routes an assistant may call.
3. **Entry module** (`index.ts`, TypeScript, `satisfies Listeners` / `: Routes`):
   - `export default { "<event>": async ({ shop, config, … }) => … }` for each event it needs (names in `EXTENSION_EVENTS`; a new one needs `/extension-event` first). Throw on failure; never swallow errors silently.
   - `export const routes` for what its browser code calls (`"GET /items"` style keys; return JSON or a `Response`; `ctx.user` is the staff member). Third-party APIs are called **here**, with `config.<secret>`, so keys never reach the browser.
   - `export const publicRoutes` only if the storefront needs something; keep them harmless (no login).
   - Only `import type` from `../types`; runtime imports must be the extension's own files (bundled) — no app modules, no npm packages unless bundled in.
4. **Browser scripts** (`assets/*.ts` or `*.tsx` — JSX is plain DOM, no framework, nothing to import; see `extensions/jsx.d.ts`): default export `(el, api) => …` (`PageScript` / `SlotScript<"slot">`), plain DOM built with JSX and/or `api.ui` (`label`, `input`, `select`, `checkbox`, `button`, `field`, `card`, `hint`, `error` — the app's own component look), `api.dialog()` for dialogs (the api stays basic: a confirm box or a searchable picker is your own few lines on top — see the Labels page, `extensions/labels/assets/labels.tsx`), `api.fetch("/…")` to its own routes, `api.toast()` for feedback, `api.context` in slots; return a cleanup. Only `import type` from `../../types`.
   How a script is laid out (`extensions/labels/assets/labels.tsx` is the model):
   - **`mount` only wires things up** — it builds the elements, fills a state object, assigns handlers and returns the cleanup. **No function declarations inside `mount`.** Every piece of logic (render, search, toggle, submit, load) is a module-level function that takes the state (`function renderList(s: State) …`); a handler is a one-line arrow that delegates (`btn.onclick = () => runImport(s)`). Keep the page's state in one typed object (`type State = { api, picked, results, … the elements it draws into }`) so those functions have one argument.
   - **UI components live under `assets/components/`**, one file per piece (`components/UnitRow.tsx`, `components/List.tsx`, `components/Stepper.tsx` …), each a function tag that returns one element and takes what it shows as props (`{ hit, action }`); pass `api.ui` in as a prop when a component needs the app's controls. A page or slot script imports them with the extension (`./components/UnitRow.tsx`) and holds no component of its own. Something two scripts both show (a row, a formatter) goes in a component or `assets/utils.ts`, never copied.
   - Constants (limits, ids, delays) at the top of the file, named; the route shapes typed once in `assets/utils.ts` and imported.
   - A page that needs app data (the shop's categories, whether a SKU exists) gets it through the extension's **own route**, which uses the app's functions in its context — everything the REST API can do, by area: `ctx.products`, `ctx.categories`, `ctx.stock`, `ctx.orders`, `ctx.coupons`, `ctx.marketing`… (the extension guide › What an extension can do; every call is for the shop of the request) — never by scraping an app page. A page that belongs with an app area names the sidebar section in the manifest (`pages[].group: "Catalog"`); the default is the Extensions group.
   - A batch of work (an import) is **one POST** with the whole list, capped (say 50); the route does the third-party calls in small parallel chunks (`Promise.all` over slices of 5), never one request per row from the browser, and answers with every row in exactly one of `created` / `skipped` / `failed` so the page can show what happened and keep the failed ones for another try.
5. **Build**: `bun run build:extension <key>` → `extensions/<key>/dist/<key>-<version>.zip`. Fix any bundling error it prints.
6. **Try it**: with `bun run dev` running, upload the zip on Admin › Global Extensions (`/admin/extensions`) and switch it on for all shops, then on `/extensions` fill in the settings and enable it; ring up a sale (`/pos`) for `order.created`, open its page from the sidebar, open `/products/create` for a `product.form` slot. Server-side failures print as `[extensions] <key> …` in the server log, browser-side ones in the console.
7. **Check**: `bun check` (the folder is type-checked with the app). If the extension is meant to stay in the repo as an example, add its zip round-trip to `app/services/settings/__tests__/Extension.Service.test.ts` like webhook and chat-alerts, and bump `version` on every change (it cache-busts the browser scripts).

## Don't
- Don't put secrets in `assets/` or send them to the browser; don't call third-party APIs from a page/slot script.
- Don't change app code to make one extension work — if it needs a new event or slot, add that first (`/extension-event`, `/extension-slot`) so every extension gets it.
- Don't commit `dist/` (git-ignored).
