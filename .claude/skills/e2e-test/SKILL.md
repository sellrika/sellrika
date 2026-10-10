---
name: e2e-test
description: Write or extend Playwright end-to-end tests for this POS (e2e/*.spec.ts, run with bun run test:e2e). Use when adding a new page or user flow, changing UI that an existing flow covers, or when asked for e2e/browser tests.
---

# E2E tests (`bun run test:e2e`)

Playwright against the **real production build** on :3100 with a throwaway DB/uploads under `$TMPDIR/pos-e2e` (`playwright.config.ts`, `e2e/tmp.ts`, wiped before and after). One worker, one shared DB, serial.

- `e2e/auth.spec.ts` — login/logout/guest redirect.
- `e2e/flow.spec.ts` — one admin's day in order: category → payment method → products (simple, variants, images) → sell on POS → orders/receipt → reports → cleanup. **Most new features slot into this file** as a new `test()` in the right place in the chain.
- `e2e/g-customers.spec.ts`, `h-stock.spec.ts`, `i-orders.spec.ts` (discount/refund/void/reports), `j-users.spec.ts` (staff/roles/account), `k-catalog.spec.ts` (shops/payment methods/categories/product edit/POS search+scan) — one serial chain per area, all run after `flow.spec.ts` (alphabetical) and never assert on global counts.
- `e2e/helpers.ts` — `login(page)`, `ADMIN` (seeded `admin@sellrika.local` / `password`).

## Adding coverage
1. New page/flow on its own → new `e2e/<area>.spec.ts` (name it so it sorts after `flow.spec.ts`), `login(page)` in `beforeAll`, own unique names via `const run = Date.now().toString(36)`. After saving a product, check it via `/products?q=<name>` — page 1 of the list fills up with other specs' products.
2. Extension of an existing flow (new field on product, new button on order) → add steps to `flow.spec.ts`; keep its exact-total assertions true (it is the only source of orders).
3. Cashier-role paths: create a cashier via `/users` in the test, log in as them in a second `browser.newPage()`.
4. Fake image: reuse the `PNG` buffer in `flow.spec.ts` (`setInputFiles`).

## Locators
Role/label only, never CSS classes: `getByRole("button", { name: "Save product" })`, `getByLabel("Name", { exact: true })`, `getByRole("row").filter({ hasText })`, `getByRole("dialog")`/`("alertdialog")`. If the UI has no accessible name → add `aria-label` in the component (frontend skill), don't work around it.

## Rules
- Unique data per run (`${run}` suffix); clean up what you create at the end of the chain if later tests assert counts.
- Assert on outcomes the user sees (toast, row visible, URL, total text), not on network.
- `bun run test:e2e` must pass locally before you finish; a single file: `bunx playwright test e2e/<file>.spec.ts` (`E2E_PORT=<n> E2E_SKIP_BUILD=1` to run it on its own port/tmp dir next to another run, reusing the current `public/build`). Debug: `SLOWMO=200`, traces in `test-results/` on failure.
- Never point it at `data/` or `storage/` — the config already isolates; don't change that.
