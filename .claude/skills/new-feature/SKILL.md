---
name: new-feature
description: Definition-of-done checklist for adding a feature to this POS end to end (migration → backend → frontend → unit tests → e2e → docs). Use whenever the user asks to add, build or implement a feature, page, endpoint or flow.
---

# New feature — do all of it, in this order

1. **Read first**: the nearest existing slice (e.g. `Customer*` files, `Pages/Customers/*`, its tests). Reuse helpers that exist (`Paginate.of`, `validate`, `StockRepository.move`, `money`, `Pager`, `CustomerPicker`…).
   Anything on the public storefront (Store/* pages, StoreController, SEO, templates) → load the `online-store` skill as well.
2. **Security** → follow the `security` skill whenever the feature takes input, adds a route, signs someone in, sends a request, runs in a job, or touches money, stock or a delete.
3. **Backend** → follow the `backend` skill (migration if needed, model, validator, repository, service, controller, route in the right `Guard.auth` / `Guard.admin` group).
4. **Frontend** → follow the `frontend` skill (page/component, `types.ts`, accessible names, role-aware UI).
5. **Unit tests** → follow the `unit-test` skill:
   - service/repository logic → `app/services/X.test.ts` (happy path + guard + side effects)
   - new route / role gate / JSON status codes → the e2e spec for the area (no HTTP test file)
6. **E2E** → follow the `e2e-test` skill: the user-visible flow is clicked through in `e2e/flow.spec.ts` (or a new spec).
7. **Docs**: JSDoc on every new class and method. A new or changed screen → its how-to in `resources/guide/<topic>.md` (the user guide the MCP tool reads).
8. **Comments** → follow the `comments` skill: every comment you added is a short JSDoc block, none is a long one-liner.
9. **Verify** (all must pass, paste results, don't claim green without running):
   ```
   bun run lint && bun check && bun test && bun run test:e2e
   ```

## Don't finish until
- [ ] every new service/repo function is exercised by a `bun test`
- [ ] every new route is reached in an e2e spec, including who may not open it (cashier 403 page / guest redirect)
- [ ] every new screen/button is reached by an e2e test
- [ ] `types.ts` matches the server props; money stays integer cents; queries are shop-scoped
- [ ] the user guide (`resources/guide/`) matches the screens
If a step is deliberately skipped (e.g. pure refactor, no UI), say which and why in the final message.
